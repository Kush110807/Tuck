import type {
  DetailControllerOutput,
  DetailScreenProps,
  DetailState,
  Feedback,
  ImageStore,
  ItemId,
  ItemRepository,
  LinkOpener,
  ListRoute,
  MutationMailbox,
  MutationState,
  NavigationActions,
  SavedItem,
} from '../contracts';
import { resolveImageState, unexpectedRepositoryError } from './helpers';
import { ObservableController } from './observable';

export class DetailController extends ObservableController implements DetailControllerOutput {
  private state: DetailState = { kind: 'loading' };
  private mutation: MutationState = { kind: 'idle' };
  private feedback: Feedback | null = null;
  private deleteConfirmationOpen = false;
  private generation = 0;
  private hasLoaded = false;

  constructor(
    private readonly id: ItemId,
    private readonly origin: ListRoute,
    private readonly repository: ItemRepository,
    private readonly imageStore: ImageStore,
    private readonly linkOpener: LinkOpener,
    private readonly mailbox: MutationMailbox,
    private readonly navigation: NavigationActions,
  ) {
    super();
  }

  get props(): DetailScreenProps {
    return {
      state: this.state,
      mutation: this.mutation,
      feedback: this.feedback,
      deleteConfirmationOpen: this.deleteConfirmationOpen,
      onOpenLink: () => { void this.openLink(); },
      onEdit: () => this.openEditor(),
      onArchiveOrRestore: () => { void this.archiveOrRestore(); },
      onRequestDelete: () => this.requestDelete(),
      onConfirmDelete: () => { void this.confirmDelete(); },
      onCancelDelete: () => this.cancelDelete(),
      onBack: () => this.back(),
      onRetry: () => { if (!this.isPending()) void this.refresh(); },
      onDismissFeedback: () => this.dismissFeedback(),
    };
  }

  async refresh(): Promise<void> {
    const generation = ++this.generation;
    this.state = { kind: 'loading' };
    this.emitChange();
    try {
      const result = await this.repository.get(this.id);
      if (generation !== this.generation) return;
      if (!result.ok) {
        this.state = result.error.code === 'NOT_FOUND' ? { kind: 'missing' } : { kind: 'failed', error: result.error };
        this.hasLoaded = true;
        this.emitChange();
        return;
      }
      const image = await resolveImageState(result.value, this.imageStore);
      if (generation !== this.generation) return;
      this.state = image.ok
        ? { kind: 'ready', item: result.value, image: image.value }
        : { kind: 'failed', error: image.error };
      this.hasLoaded = true;
      this.emitChange();
    } catch {
      if (generation !== this.generation) return;
      this.state = { kind: 'failed', error: unexpectedRepositoryError() };
      this.hasLoaded = true;
      this.emitChange();
    }
  }

  async onFocus(): Promise<void> {
    const notices = this.mailbox.consume('Detail', this.id);
    if (notices.length > 0) {
      this.feedback = notices[notices.length - 1].feedback;
      this.emitChange();
      await this.refresh();
      return;
    }
    if (!this.hasLoaded) await this.refresh();
  }

  private readyItem(): SavedItem | null {
    return this.state.kind === 'ready' ? this.state.item : null;
  }

  private isPending(): boolean {
    return this.mutation.kind === 'pending';
  }

  private back(): void {
    if (this.isPending()) return;
    this.navigation.returnToList(this.origin);
  }

  private openEditor(): void {
    if (this.isPending()) return;
    const item = this.readyItem();
    if (!item) return;
    this.navigation.openEditor({ mode: 'edit', id: item.id, origin: this.origin });
  }

  private async openLink(): Promise<void> {
    if (this.isPending()) return;
    const item = this.readyItem();
    if (!item || item.type !== 'link') return;
    try {
      const result = await this.linkOpener.openHttpUrl(item.url);
      if (!result.ok) {
        this.feedback = { kind: 'error', message: result.error.message };
        this.emitChange();
      }
    } catch {
      this.feedback = { kind: 'error', message: 'The link could not be opened.' };
      this.emitChange();
    }
  }

  private async archiveOrRestore(): Promise<void> {
    if (this.isPending()) return;
    const item = this.readyItem();
    if (!item) return;
    const archived = !item.archived;
    const operation = archived ? 'archive' : 'restore';
    this.mutation = { kind: 'pending', operation };
    this.emitChange();

    let result: Awaited<ReturnType<ItemRepository['setArchived']>>;
    try {
      result = await this.repository.setArchived(item.id, archived, item.updatedAt);
    } catch {
      result = { ok: false, error: unexpectedRepositoryError() };
    }

    if (!result.ok) {
      this.mutation = { kind: 'failed', operation, error: result.error };
      if (result.error.code === 'CONFLICT') {
        this.feedback = { kind: 'error', message: 'This item changed elsewhere. Review the latest version before trying again.' };
        this.emitChange();
        await this.refreshAfterConflict();
      } else {
        this.feedback = { kind: 'error', message: result.error.message };
        this.emitChange();
      }
      return;
    }

    this.mutation = { kind: 'idle' };
    const destination: ListRoute = archived ? 'Inbox' : 'Archive';
    this.mailbox.publish({
      destination,
      operation,
      itemId: result.value.id,
      feedback: { kind: 'success', message: archived ? 'Item archived.' : 'Item restored.' },
    });
    this.emitChange();
    this.navigation.returnToList(destination);
  }

  private requestDelete(): void {
    if (this.isPending() || this.state.kind !== 'ready') return;
    this.deleteConfirmationOpen = true;
    this.emitChange();
  }

  private cancelDelete(): void {
    if (this.isPending() || !this.deleteConfirmationOpen) return;
    this.deleteConfirmationOpen = false;
    this.emitChange();
  }

  private async confirmDelete(): Promise<void> {
    if (this.isPending() || !this.deleteConfirmationOpen) return;
    const item = this.readyItem();
    if (!item) return;
    this.deleteConfirmationOpen = false;
    this.mutation = { kind: 'pending', operation: 'delete' };
    this.emitChange();

    let result: Awaited<ReturnType<ItemRepository['remove']>>;
    try {
      result = await this.repository.remove(item.id, item.updatedAt);
    } catch {
      result = { ok: false, error: unexpectedRepositoryError() };
    }

    if (!result.ok) {
      this.mutation = { kind: 'failed', operation: 'delete', error: result.error };
      if (result.error.code === 'CONFLICT') {
        this.feedback = { kind: 'error', message: 'This item changed elsewhere. Review the latest version before trying again.' };
        this.emitChange();
        await this.refreshAfterConflict();
      } else {
        this.feedback = { kind: 'error', message: result.error.message };
        this.emitChange();
      }
      return;
    }

    this.mutation = { kind: 'idle' };
    this.mailbox.publish({
      destination: this.origin,
      operation: 'delete',
      itemId: item.id,
      feedback: { kind: 'success', message: 'Item deleted.' },
    });
    this.emitChange();
    this.navigation.returnToList(this.origin);
  }

  private async refreshAfterConflict(): Promise<void> {
    const failedMutation = this.mutation;
    await this.refresh();
    this.mutation = failedMutation;
    this.emitChange();
  }

  private dismissFeedback(): void {
    if (this.feedback === null) return;
    this.feedback = null;
    this.emitChange();
  }
}

export function createDetailController(
  id: ItemId,
  origin: ListRoute,
  repository: ItemRepository,
  imageStore: ImageStore,
  linkOpener: LinkOpener,
  mailbox: MutationMailbox,
  navigation: NavigationActions,
): DetailController {
  return new DetailController(id, origin, repository, imageStore, linkOpener, mailbox, navigation);
}
