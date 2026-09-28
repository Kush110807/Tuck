import type {
  AppError,
  CreateItemInput,
  EditorControllerOutput,
  EditorDraft,
  EditorScreenProps,
  EditorState,
  FieldErrors,
  FieldKey,
  ImagePickerAdapter,
  ImageSelection,
  ImageStore,
  ImageViewState,
  ItemId,
  ItemRepository,
  ItemType,
  ListRoute,
  MutationMailbox,
  NavigationActions,
  SavedItem,
  UpdateItemInput,
} from '../contracts';
import { MAX_TAG_CHARS, MAX_TAGS } from '../domain';
import { normalizeTagDisplay, resolveImageState, tagKey, unexpectedRepositoryError } from './helpers';
import { ObservableController } from './observable';

type PersistentField = 'title' | 'body' | 'url' | 'caption' | 'tags' | 'image';

type CreateParams = { mode: 'create'; type: ItemType; origin: 'Inbox' };
type EditParams = { mode: 'edit'; id: ItemId; origin: ListRoute };
export type EditorControllerParams = CreateParams | EditParams;

function emptyDraft(type: ItemType): EditorDraft {
  if (type === 'note') return { type, title: '', body: '', tags: [], tagEntry: '' };
  if (type === 'link') return { type, title: '', url: '', tags: [], tagEntry: '' };
  return { type, title: '', caption: '', tags: [], tagEntry: '', image: { kind: 'none' } };
}

function draftFromItem(item: SavedItem): EditorDraft {
  if (item.type === 'note') return { type: 'note', title: item.title, body: item.body, tags: [...item.tags], tagEntry: '' };
  if (item.type === 'link') return { type: 'link', title: item.title, url: item.url, tags: [...item.tags], tagEntry: '' };
  return {
    type: 'image', title: item.title, caption: item.body ?? '', tags: [...item.tags], tagEntry: '',
    image: { kind: 'existing', path: item.imagePath },
  };
}

function cloneDraft(draft: EditorDraft): EditorDraft {
  if (draft.type === 'note') return { ...draft, tags: [...draft.tags] };
  if (draft.type === 'link') return { ...draft, tags: [...draft.tags] };
  return { ...draft, tags: [...draft.tags], image: { ...draft.image } };
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function fieldValue(draft: EditorDraft, field: PersistentField): unknown {
  if (field === 'title') return draft.title;
  if (field === 'tags') return draft.tags;
  if (field === 'body') return draft.type === 'note' ? draft.body : undefined;
  if (field === 'url') return draft.type === 'link' ? draft.url : undefined;
  if (field === 'caption') return draft.type === 'image' ? draft.caption : undefined;
  return draft.type === 'image' ? draft.image : undefined;
}

function persistentFieldEqual(left: EditorDraft, right: EditorDraft, field: PersistentField): boolean {
  if (left.type !== right.type) return false;
  const a = fieldValue(left, field);
  const b = fieldValue(right, field);
  if (Array.isArray(a) && Array.isArray(b)) return arraysEqual(a, b);
  if (field === 'image' && typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

function withFieldError(errors: FieldErrors, field: FieldKey, message: string): FieldErrors {
  return { ...errors, [field]: message };
}

export class EditorController extends ObservableController implements EditorControllerOutput {
  private state: EditorState;
  private baselineDraft: EditorDraft;
  private baselineItem: SavedItem | null = null;
  private touched = new Set<PersistentField>();
  private pickerPending = false;
  private loadGeneration = 0;
  private conflictBaseline: SavedItem | null = null;

  constructor(
    private readonly params: EditorControllerParams,
    private readonly repository: ItemRepository,
    private readonly imageStore: ImageStore,
    private readonly picker: ImagePickerAdapter,
    private readonly mailbox: MutationMailbox,
    private readonly navigation: NavigationActions,
  ) {
    super();
    if (params.mode === 'create') {
      const draft = emptyDraft(params.type);
      this.baselineDraft = cloneDraft(draft);
      this.state = this.readyState(draft, { kind: 'none' });
    } else {
      this.baselineDraft = emptyDraft('note');
      this.state = { kind: 'loading' };
    }
  }

  get props(): EditorScreenProps {
    return {
      state: this.state,
      mode: this.params.mode,
      onTitleChange: value => this.changeText('title', value),
      onBodyChange: value => this.changeText('body', value),
      onUrlChange: value => this.changeText('url', value),
      onCaptionChange: value => this.changeText('caption', value),
      onTagEntryChange: value => this.changeTagEntry(value),
      onAddTag: () => this.addTag(),
      onRemoveTag: key => this.removeTag(key),
      onPickImage: () => { void this.pickImage(); },
      onSave: () => { void this.save(); },
      onCancel: () => this.requestExit(),
      onRetry: () => { void this.retry(); },
      onConfirmDiscard: () => this.confirmDiscard(),
      onKeepEditing: () => this.keepEditing(),
      onConfirmConflictOverwrite: () => { void this.confirmConflictOverwrite(); },
      onCancelConflictOverwrite: () => this.cancelConflictOverwrite(),
      onBackToInbox: () => this.backToInbox(),
    };
  }

  async load(): Promise<void> {
    if (this.params.mode !== 'edit') return;
    const generation = ++this.loadGeneration;
    this.state = { kind: 'loading' };
    this.emitChange();
    try {
      const result = await this.repository.get(this.params.id);
      if (generation !== this.loadGeneration) return;
      if (!result.ok) {
        this.state = result.error.code === 'NOT_FOUND' ? { kind: 'missing' } : { kind: 'failed', error: result.error };
        this.emitChange();
        return;
      }
      await this.acceptLoadedItem(result.value, generation);
    } catch {
      if (generation !== this.loadGeneration) return;
      this.state = { kind: 'failed', error: unexpectedRepositoryError() };
      this.emitChange();
    }
  }

  requestExit(): void {
    if (this.isMutationPending()) return;
    if (this.state.kind === 'ready' && this.state.conflictConfirmationOpen) return;
    if (this.state.kind === 'ready' && this.state.isDirty) {
      this.state = { ...this.state, discardConfirmationOpen: true };
      this.emitChange();
      return;
    }
    this.navigation.goBackOrInbox();
  }

  private readyState(
    draft: EditorDraft,
    imagePreview: ImageViewState,
    fieldErrors: FieldErrors = {},
    screenError: AppError | null = null,
    mutation: Extract<EditorState, { kind: 'ready' }>['mutation'] = { kind: 'idle' },
    discardConfirmationOpen = false,
    conflictConfirmationOpen = false,
  ): Extract<EditorState, { kind: 'ready' }> {
    return {
      kind: 'ready', draft, fieldErrors, mutation, screenError, imagePreview,
      isDirty: this.isDraftDirty(draft), discardConfirmationOpen, conflictConfirmationOpen,
    };
  }

  private isDraftDirty(draft: EditorDraft): boolean {
    return this.touched.size > 0 || draft.tagEntry !== this.baselineDraft.tagEntry;
  }

  private isMutationPending(): boolean {
    return this.state.kind === 'ready' && this.state.mutation.kind === 'pending';
  }

  private currentReady(): Extract<EditorState, { kind: 'ready' }> | null {
    return this.state.kind === 'ready' ? this.state : null;
  }

  private updateTouched(field: PersistentField, draft: EditorDraft): void {
    if (persistentFieldEqual(draft, this.baselineDraft, field)) this.touched.delete(field);
    else this.touched.add(field);
  }

  private changeText(field: 'title' | 'body' | 'url' | 'caption', value: string): void {
    const ready = this.currentReady();
    if (!ready || ready.mutation.kind === 'pending' || ready.conflictConfirmationOpen) return;
    let draft = cloneDraft(ready.draft);
    if (field === 'title') draft.title = value;
    else if (field === 'body' && draft.type === 'note') draft.body = value;
    else if (field === 'url' && draft.type === 'link') draft.url = value;
    else if (field === 'caption' && draft.type === 'image') draft.caption = value;
    else return;
    this.updateTouched(field, draft);
    const fieldErrors = { ...ready.fieldErrors };
    delete fieldErrors[field];
    this.state = this.readyState(draft, ready.imagePreview, fieldErrors, null, { kind: 'idle' }, ready.discardConfirmationOpen);
    this.emitChange();
  }

  private changeTagEntry(value: string): void {
    const ready = this.currentReady();
    if (!ready || ready.mutation.kind === 'pending' || ready.conflictConfirmationOpen) return;
    const draft = cloneDraft(ready.draft);
    draft.tagEntry = value;
    const fieldErrors = { ...ready.fieldErrors };
    delete fieldErrors.tags;
    this.state = this.readyState(draft, ready.imagePreview, fieldErrors, null, { kind: 'idle' }, ready.discardConfirmationOpen);
    this.emitChange();
  }

  private addTag(): void {
    const ready = this.currentReady();
    if (!ready || ready.mutation.kind === 'pending' || ready.conflictConfirmationOpen) return;
    const display = normalizeTagDisplay(ready.draft.tagEntry);
    if (!display) return;
    if (Array.from(display).length > MAX_TAG_CHARS) {
      this.state = this.readyState(ready.draft, ready.imagePreview,
        withFieldError(ready.fieldErrors, 'tags', `Tags can be at most ${MAX_TAG_CHARS} characters.`),
        ready.screenError, ready.mutation, ready.discardConfirmationOpen);
      this.emitChange();
      return;
    }
    const key = tagKey(display);
    const duplicate = ready.draft.tags.some(tag => tagKey(tag) === key);
    if (!duplicate && ready.draft.tags.length >= MAX_TAGS) {
      this.state = this.readyState(ready.draft, ready.imagePreview,
        withFieldError(ready.fieldErrors, 'tags', `You can add up to ${MAX_TAGS} tags.`),
        ready.screenError, ready.mutation, ready.discardConfirmationOpen);
      this.emitChange();
      return;
    }
    const draft = cloneDraft(ready.draft);
    draft.tagEntry = '';
    if (!duplicate) draft.tags = [...draft.tags, display];
    this.updateTouched('tags', draft);
    const fieldErrors = { ...ready.fieldErrors };
    delete fieldErrors.tags;
    this.state = this.readyState(draft, ready.imagePreview, fieldErrors, null, { kind: 'idle' }, ready.discardConfirmationOpen);
    this.emitChange();
  }

  private removeTag(key: string): void {
    const ready = this.currentReady();
    if (!ready || ready.mutation.kind === 'pending' || ready.conflictConfirmationOpen) return;
    const draft = cloneDraft(ready.draft);
    const normalizedKey = tagKey(key);
    draft.tags = draft.tags.filter(tag => tagKey(tag) !== normalizedKey);
    this.updateTouched('tags', draft);
    this.state = this.readyState(draft, ready.imagePreview, ready.fieldErrors, null, { kind: 'idle' }, ready.discardConfirmationOpen);
    this.emitChange();
  }

  private async pickImage(): Promise<void> {
    const ready = this.currentReady();
    if (!ready || ready.draft.type !== 'image' || ready.mutation.kind === 'pending' || this.pickerPending) return;
    this.pickerPending = true;
    try {
      const outcome = await this.picker.pickOne();
      const current = this.currentReady();
      if (!current || current.draft.type !== 'image' || current.mutation.kind === 'pending') return;
      if (outcome.kind === 'cancelled') return;
      if (outcome.kind === 'failed') {
        this.state = this.readyState(current.draft, current.imagePreview, current.fieldErrors, outcome.error,
          current.mutation, current.discardConfirmationOpen);
        this.emitChange();
        return;
      }
      const draft = cloneDraft(current.draft);
      if (draft.type !== 'image') return;
      draft.image = { kind: 'selected', selection: outcome.selection };
      this.updateTouched('image', draft);
      const fieldErrors = { ...current.fieldErrors };
      delete fieldErrors.image;
      this.state = this.readyState(draft, { kind: 'available', uri: outcome.selection.temporaryUri }, fieldErrors,
        null, { kind: 'idle' }, current.discardConfirmationOpen);
      this.emitChange();
    } catch {
      const current = this.currentReady();
      if (current) {
        const error: AppError = { code: 'PICKER_FAILED', message: 'The image picker could not be opened.' };
        this.state = this.readyState(current.draft, current.imagePreview, current.fieldErrors, error,
          current.mutation, current.discardConfirmationOpen);
        this.emitChange();
      }
    } finally {
      this.pickerPending = false;
    }
  }

  private async save(): Promise<void> {
    const ready = this.currentReady();
    if (!ready || ready.mutation.kind === 'pending' || ready.conflictConfirmationOpen) return;

    if (normalizeTagDisplay(ready.draft.tagEntry)) {
      this.state = this.readyState(ready.draft, ready.imagePreview,
        withFieldError(ready.fieldErrors, 'tags', 'Add this tag or clear the tag field before saving.'),
        null, ready.mutation, ready.discardConfirmationOpen);
      this.emitChange();
      return;
    }

    if (this.params.mode === 'create') {
      const input = this.createInput(ready.draft);
      if (!input.ok) {
        this.state = this.readyState(ready.draft, ready.imagePreview,
          withFieldError(ready.fieldErrors, input.field, input.message), null, ready.mutation,
          ready.discardConfirmationOpen);
        this.emitChange();
        return;
      }
      await this.createItem(input.value);
      return;
    }

    if (!this.baselineItem) return;
    if (this.touched.size === 0) {
      this.navigation.completeEdit(this.params.id, this.params.origin);
      return;
    }
    await this.updateItem(this.buildUpdateInput(ready.draft, this.baselineItem));
  }

  private createInput(draft: EditorDraft):
    | { ok: true; value: CreateItemInput }
    | { ok: false; field: FieldKey; message: string } {
    if (draft.type === 'note') return { ok: true, value: { type: 'note', title: draft.title, body: draft.body, tags: draft.tags } };
    if (draft.type === 'link') return { ok: true, value: { type: 'link', title: draft.title, url: draft.url, tags: draft.tags } };
    if (draft.image.kind !== 'selected') return { ok: false, field: 'image', message: 'Choose an image before saving.' };
    return {
      ok: true,
      value: { type: 'image', title: draft.title, caption: draft.caption || null, image: draft.image.selection, tags: draft.tags },
    };
  }

  private buildUpdateInput(draft: EditorDraft, baseline: SavedItem): UpdateItemInput {
    if (draft.type === 'note' && baseline.type === 'note') {
      const changes: Extract<UpdateItemInput, { type: 'note' }>['changes'] = {};
      if (this.touched.has('title')) changes.title = draft.title;
      if (this.touched.has('body')) changes.body = draft.body;
      if (this.touched.has('tags')) changes.tags = draft.tags;
      return { id: baseline.id, type: 'note', expectedUpdatedAt: baseline.updatedAt, changes };
    }
    if (draft.type === 'link' && baseline.type === 'link') {
      const changes: Extract<UpdateItemInput, { type: 'link' }>['changes'] = {};
      if (this.touched.has('title')) changes.title = draft.title;
      if (this.touched.has('url')) changes.url = draft.url;
      if (this.touched.has('tags')) changes.tags = draft.tags;
      return { id: baseline.id, type: 'link', expectedUpdatedAt: baseline.updatedAt, changes };
    }
    if (draft.type === 'image' && baseline.type === 'image') {
      const changes: Extract<UpdateItemInput, { type: 'image' }>['changes'] = {};
      if (this.touched.has('title')) changes.title = draft.title;
      if (this.touched.has('caption')) changes.caption = draft.caption || null;
      if (this.touched.has('tags')) changes.tags = draft.tags;
      if (this.touched.has('image') && draft.image.kind === 'selected') {
        changes.image = { kind: 'replace', selection: draft.image.selection };
      }
      return { id: baseline.id, type: 'image', expectedUpdatedAt: baseline.updatedAt, changes };
    }
    throw new Error('Editor draft type no longer matches the loaded item.');
  }

  private async createItem(input: CreateItemInput): Promise<void> {
    const ready = this.currentReady();
    if (!ready) return;
    this.state = this.readyState(ready.draft, ready.imagePreview, {}, null,
      { kind: 'pending', operation: 'create' }, ready.discardConfirmationOpen);
    this.emitChange();

    let result: Awaited<ReturnType<ItemRepository['create']>>;
    try { result = await this.repository.create(input); }
    catch { result = { ok: false, error: unexpectedRepositoryError() }; }
    const current = this.currentReady();
    if (!current) return;
    if (!result.ok) {
      this.applyMutationFailure('create', result.error);
      return;
    }
    this.baselineItem = result.value;
    this.conflictBaseline = null;
    this.baselineDraft = cloneDraft(current.draft);
    this.touched.clear();
    this.state = this.readyState(current.draft, current.imagePreview, {}, null, { kind: 'idle' }, false);
    this.mailbox.publish({
      destination: 'Detail', itemId: result.value.id, operation: 'create',
      feedback: { kind: 'success', message: 'Item saved.' },
    });
    this.emitChange();
    this.navigation.completeCreate(result.value.id);
  }

  private async updateItem(input: UpdateItemInput): Promise<void> {
    const ready = this.currentReady();
    if (!ready || this.params.mode !== 'edit') return;
    this.state = this.readyState(ready.draft, ready.imagePreview, {}, null,
      { kind: 'pending', operation: 'edit' }, ready.discardConfirmationOpen);
    this.emitChange();

    let result: Awaited<ReturnType<ItemRepository['update']>>;
    try { result = await this.repository.update(input); }
    catch { result = { ok: false, error: unexpectedRepositoryError() }; }
    if (!result.ok) {
      if (result.error.code === 'CONFLICT') await this.handleConflict(result.error);
      else this.applyMutationFailure('edit', result.error);
      return;
    }
    const current = this.currentReady();
    if (!current) return;
    this.baselineItem = result.value;
    this.conflictBaseline = null;
    this.baselineDraft = cloneDraft(current.draft);
    this.touched.clear();
    this.state = this.readyState(current.draft, current.imagePreview, {}, null, { kind: 'idle' }, false);
    this.mailbox.publish({
      destination: 'Detail', itemId: result.value.id, operation: 'edit',
      feedback: { kind: 'success', message: 'Changes saved.' },
    });
    this.emitChange();
    this.navigation.completeEdit(result.value.id, this.params.origin);
  }

  private applyMutationFailure(operation: 'create' | 'edit', error: AppError): void {
    const ready = this.currentReady();
    if (!ready) return;
    const fieldErrors = error.code === 'VALIDATION' && error.field
      ? withFieldError(ready.fieldErrors, error.field, error.message)
      : ready.fieldErrors;
    this.state = this.readyState(ready.draft, ready.imagePreview, fieldErrors,
      error.code === 'VALIDATION' && error.field ? null : error,
      { kind: 'failed', operation, error }, ready.discardConfirmationOpen);
    this.emitChange();
  }

  private async handleConflict(error: AppError): Promise<void> {
    const ready = this.currentReady();
    if (!ready || this.params.mode !== 'edit') return;
    let latest: Awaited<ReturnType<ItemRepository['get']>>;
    try { latest = await this.repository.get(this.params.id); }
    catch { latest = { ok: false, error: unexpectedRepositoryError() }; }
    if (!latest.ok) {
      if (latest.error.code === 'NOT_FOUND') {
        this.state = { kind: 'missing' };
        this.emitChange();
        return;
      }
      this.state = this.readyState(ready.draft, ready.imagePreview, ready.fieldErrors, error,
        { kind: 'failed', operation: 'edit', error }, ready.discardConfirmationOpen, false);
      this.emitChange();
      return;
    }

    // Preserve the user's draft exactly. The fresh item is held only as the
    // candidate timestamp for an explicit overwrite decision. Nothing is
    // rebased or retried automatically.
    this.conflictBaseline = latest.value;
    this.state = this.readyState(ready.draft, ready.imagePreview, ready.fieldErrors, null,
      { kind: 'failed', operation: 'edit', error }, false, true);
    this.emitChange();
  }

  private async confirmConflictOverwrite(): Promise<void> {
    const ready = this.currentReady();
    const latest = this.conflictBaseline;
    if (!ready || !ready.conflictConfirmationOpen || !latest || this.params.mode !== 'edit') return;
    this.conflictBaseline = null;
    this.state = this.readyState(ready.draft, ready.imagePreview, ready.fieldErrors, null,
      { kind: 'idle' }, false, false);
    this.emitChange();
    await this.updateItem(this.buildUpdateInput(ready.draft, latest));
  }

  private cancelConflictOverwrite(): void {
    const ready = this.currentReady();
    if (!ready || !ready.conflictConfirmationOpen || this.isMutationPending()) return;
    this.conflictBaseline = null;
    this.state = this.readyState(ready.draft, ready.imagePreview, ready.fieldErrors, null,
      { kind: 'idle' }, false, false);
    this.emitChange();
  }

  private async acceptLoadedItem(item: SavedItem, generation: number): Promise<void> {
    const draft = draftFromItem(item);
    let preview: ImageViewState = { kind: 'none' };
    if (item.type === 'image') {
      const image = await resolveImageState(item, this.imageStore);
      if (generation !== this.loadGeneration) return;
      if (!image.ok) {
        this.state = { kind: 'failed', error: image.error };
        this.emitChange();
        return;
      }
      preview = image.value;
    }
    this.baselineItem = item;
    this.conflictBaseline = null;
    this.baselineDraft = cloneDraft(draft);
    this.touched.clear();
    this.state = this.readyState(draft, preview);
    this.emitChange();
  }

  private async retry(): Promise<void> {
    if (this.params.mode === 'edit') await this.load();
  }

  private confirmDiscard(): void {
    if (this.isMutationPending()) return;
    const ready = this.currentReady();
    if (!ready || !ready.discardConfirmationOpen) return;
    this.state = { ...ready, discardConfirmationOpen: false };
    this.emitChange();
    this.navigation.goBackOrInbox();
  }

  private keepEditing(): void {
    if (this.isMutationPending()) return;
    const ready = this.currentReady();
    if (!ready || !ready.discardConfirmationOpen) return;
    this.state = { ...ready, discardConfirmationOpen: false };
    this.emitChange();
  }

  private backToInbox(): void {
    if (this.isMutationPending()) return;
    this.navigation.returnToList('Inbox');
  }
}

export function createEditorController(
  params: EditorControllerParams,
  repository: ItemRepository,
  imageStore: ImageStore,
  picker: ImagePickerAdapter,
  mailbox: MutationMailbox,
  navigation: NavigationActions,
): EditorController {
  return new EditorController(params, repository, imageStore, picker, mailbox, navigation);
}
