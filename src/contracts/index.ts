/** Phase 1A shared contracts. Master owns changes to this file. */
export type ItemId = string;
export type ItemType = 'note' | 'link' | 'image';
export type ListRoute = 'Inbox' | 'Archive';
export type RelativeImagePath = string;
export type EpochMs = number;

export type ItemBase = {
  id: ItemId;
  title: string;
  tags: readonly string[];
  createdAt: EpochMs;
  updatedAt: EpochMs;
  archived: boolean;
};

export type SavedItem =
  | (ItemBase & { type: 'note'; body: string; url: null; imagePath: null })
  | (ItemBase & { type: 'link'; body: null; url: string; imagePath: null })
  | (ItemBase & { type: 'image'; body: string | null; url: null; imagePath: RelativeImagePath });

export type ImageSelection = {
  temporaryUri: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  reportedBytes?: number;
};

export type CreateItemInput =
  | { type: 'note'; title: string; body: string; tags: readonly string[] }
  | { type: 'link'; title: string; url: string; tags: readonly string[] }
  | { type: 'image'; title: string; caption: string | null; image: ImageSelection; tags: readonly string[] };

export type UpdateItemInput =
  | { id: ItemId; type: 'note'; expectedUpdatedAt: EpochMs;
      changes: { title?: string; body?: string; tags?: readonly string[] } }
  | { id: ItemId; type: 'link'; expectedUpdatedAt: EpochMs;
      changes: { title?: string; url?: string; tags?: readonly string[] } }
  | { id: ItemId; type: 'image'; expectedUpdatedAt: EpochMs;
      changes: { title?: string; caption?: string | null;
        image?: { kind: 'replace'; selection: ImageSelection }; tags?: readonly string[] } };

export type ItemQuery = {
  archived: boolean;
  text: string;
  type: ItemType | 'all';
  tagKey: string | null;
};

export type FieldKey = 'title' | 'body' | 'url' | 'caption' | 'image' | 'tags';
export type FieldErrors = Partial<Record<FieldKey, string>>;

export type AppError = {
  code: 'INIT_FAILED' | 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' |
    'DB_FAILED' | 'IMAGE_COPY_FAILED' | 'IMAGE_TOO_LARGE' |
    'IMAGE_UNSUPPORTED' | 'PICKER_FAILED' | 'PERMISSION_DENIED' |
    'OPEN_FAILED' | 'INVALID_IMAGE_PATH';
  message: string;
  field?: FieldKey;
};
export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };

export interface ItemRepository {
  initialize(): Promise<Result<void>>;
  list(query: ItemQuery): Promise<Result<readonly SavedItem[]>>;
  get(id: ItemId): Promise<Result<SavedItem>>;
  create(input: CreateItemInput): Promise<Result<SavedItem>>;
  update(input: UpdateItemInput): Promise<Result<SavedItem>>;
  setArchived(id: ItemId, archived: boolean, expectedUpdatedAt: EpochMs): Promise<Result<SavedItem>>;
  remove(id: ItemId, expectedUpdatedAt: EpochMs): Promise<Result<void>>;
  retryPendingFileCleanup(): Promise<Result<{ remaining: number }>>;
}

export type EditorDraft =
  | { type: 'note'; title: string; body: string; tags: readonly string[]; tagEntry: string }
  | { type: 'link'; title: string; url: string; tags: readonly string[]; tagEntry: string }
  | { type: 'image'; title: string; caption: string; tags: readonly string[]; tagEntry: string;
      image: { kind: 'none' } | { kind: 'existing'; path: RelativeImagePath } |
        { kind: 'selected'; selection: ImageSelection } };

export type MutationOperation = 'create' | 'edit' | 'archive' | 'restore' | 'delete';
export type MutationState =
  | { kind: 'idle' }
  | { kind: 'pending'; operation: MutationOperation }
  | { kind: 'failed'; operation: MutationOperation; error: AppError };

export type ImageViewState =
  | { kind: 'none' }
  | { kind: 'available'; uri: string }
  | { kind: 'missing' };
export type ItemListRow = { item: SavedItem; image: ImageViewState };

/** App initialization is separate from a successfully loaded empty inbox. */
export type AppBootState =
  | { kind: 'initializing' }
  | { kind: 'ready' }
  | { kind: 'failed'; error: AppError };
export interface BootGateProps { state: AppBootState; onRetry(): void }

export type ListState =
  | { kind: 'loading'; query: ItemQuery; previousRows: readonly ItemListRow[] }
  | { kind: 'ready'; query: ItemQuery; rows: readonly ItemListRow[]; availableTags: readonly string[] }
  | { kind: 'failed'; query: ItemQuery; previousRows: readonly ItemListRow[]; error: AppError };

export type DetailState =
  | { kind: 'loading' }
  | { kind: 'ready'; item: SavedItem; image: ImageViewState }
  | { kind: 'missing' }
  | { kind: 'failed'; error: AppError };

export type EditorState =
  | { kind: 'loading' }
  | { kind: 'ready'; draft: EditorDraft; fieldErrors: FieldErrors;
      mutation: MutationState; screenError: AppError | null;
      imagePreview: ImageViewState; isDirty: boolean;
      discardConfirmationOpen: boolean }
  | { kind: 'missing' }
  | { kind: 'failed'; error: AppError };

export type Feedback = { kind: 'success' | 'error' | 'info'; message: string };

export type PickImageOutcome =
  | { kind: 'selected'; selection: ImageSelection }
  | { kind: 'cancelled' }
  | { kind: 'failed'; error: AppError };

export interface ImagePickerAdapter { pickOne(): Promise<PickImageOutcome> }
export interface ImageStore {
  copySelected(selection: ImageSelection): Promise<Result<RelativeImagePath>>;
  resolve(path: RelativeImagePath): Promise<Result<
    { kind: 'available'; uri: string } | { kind: 'missing' }
  >>;
  removeFile(path: RelativeImagePath): Promise<Result<void>>;
}
export interface LinkOpener { openHttpUrl(url: string): Promise<Result<void>> }

export type RootStackParams = {
  Inbox: undefined;
  Archive: undefined;
  Editor:
    | { mode: 'create'; type: ItemType; origin: 'Inbox' }
    | { mode: 'edit'; id: ItemId; origin: ListRoute };
  Detail: { id: ItemId; origin: ListRoute };
};

export interface NavigationActions {
  showDetail(id: ItemId, origin: ListRoute): void;
  completeCreate(id: ItemId): void;
  completeEdit(id: ItemId, origin: ListRoute): void;
  returnToList(origin: ListRoute): void;
  openEditor(params: RootStackParams['Editor']): void;
  openArchive(): void;
  goBackOrInbox(): void;
}

/** Master-owned, one-shot cross-screen handoff; never persisted as item data. */
export type MutationNotice = {
  sequence: number;
  destination: 'Inbox' | 'Archive' | 'Detail';
  operation: MutationOperation;
  feedback: Feedback;
  itemId?: ItemId;
};
export interface MutationMailbox {
  publish(notice: Omit<MutationNotice, 'sequence'>): MutationNotice;
  consume(destination: MutationNotice['destination'], itemId?: ItemId): readonly MutationNotice[];
}

export interface InboxScreenProps {
  state: ListState; feedback: Feedback | null;
  onQueryChange(next: ItemQuery): void; onOpen(id: ItemId): void;
  onAdd(type: ItemType): void; onOpenArchive(): void;
  onRetry(): void; onDismissFeedback(): void;
}
export interface ArchiveScreenProps {
  state: ListState; feedback: Feedback | null;
  onQueryChange(next: ItemQuery): void; onOpen(id: ItemId): void;
  onBack(): void; onRetry(): void; onDismissFeedback(): void;
}
export interface EditorScreenProps {
  state: EditorState; mode: 'create' | 'edit';
  onTitleChange(value: string): void; onBodyChange(value: string): void;
  onUrlChange(value: string): void; onCaptionChange(value: string): void;
  onTagEntryChange(value: string): void; onAddTag(): void;
  onRemoveTag(tagKey: string): void; onPickImage(): void;
  onSave(): void; onCancel(): void; onRetry(): void;
  onConfirmDiscard(): void; onKeepEditing(): void; onBackToInbox(): void;
}
export interface DetailScreenProps {
  state: DetailState; mutation: MutationState; feedback: Feedback | null;
  deleteConfirmationOpen: boolean;
  onOpenLink(): void; onEdit(): void; onArchiveOrRestore(): void;
  onRequestDelete(): void; onConfirmDelete(): void; onCancelDelete(): void;
  onBack(): void; onRetry(): void; onDismissFeedback(): void;
}
export interface ItemCardProps { row: ItemListRow; onPress(): void }
export interface TypeChipProps { type: ItemType | 'all'; selected: boolean; onPress(): void }
export interface TagChipProps { label: string; selected?: boolean; onPress?(): void; onRemove?(): void }
export interface SearchFieldProps { value: string; onChangeText(value: string): void; onClear(): void }
export interface FilterBarProps {
  type: ItemType | 'all'; tagKey: string | null; availableTags: readonly string[];
  onTypeChange(type: ItemType | 'all'): void; onTagChange(tagKey: string | null): void;
}
export interface FormFieldProps {
  label: string; value: string; onChangeText(value: string): void;
  error?: string; multiline?: boolean; maxLength?: number;
}
export interface ImagePickerFieldProps {
  image: ImageViewState; error?: string; disabled: boolean; onPick(): void;
}
export interface EmptyStateProps { title: string; message: string; actionLabel?: string; onAction?(): void }
export interface FeedbackBannerProps { feedback: Feedback; onDismiss(): void }
export interface ConfirmDialogProps {
  visible: boolean; title: string; message: string; confirmLabel: string;
  destructive: boolean; onConfirm(): void; onCancel(): void;
}

export interface InboxControllerOutput { props: InboxScreenProps; refresh(): Promise<void>; onFocus(): Promise<void> }
export interface ArchiveControllerOutput { props: ArchiveScreenProps; refresh(): Promise<void>; onFocus(): Promise<void> }
export interface EditorControllerOutput { props: EditorScreenProps; requestExit(): void }
export interface DetailControllerOutput { props: DetailScreenProps; refresh(): Promise<void>; onFocus(): Promise<void> }
