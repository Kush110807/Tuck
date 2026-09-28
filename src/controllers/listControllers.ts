import type {
  ArchiveControllerOutput,
  ArchiveScreenProps,
  Feedback,
  ImageStore,
  InboxControllerOutput,
  InboxScreenProps,
  ItemQuery,
  ItemRepository,
  ListRoute,
  ListState,
  MutationMailbox,
  NavigationActions,
} from '../contracts';
import { buildListRows, collectAvailableTags, unexpectedRepositoryError } from './helpers';
import { ObservableController } from './observable';

const defaultQuery = (archived: boolean): ItemQuery => ({ archived, text: '', type: 'all', tagKey: null });

abstract class BaseListController extends ObservableController {
  protected state: ListState;
  protected feedback: Feedback | null = null;
  private generation = 0;

  protected constructor(
    protected readonly route: ListRoute,
    private readonly repository: ItemRepository,
    private readonly imageStore: ImageStore,
    private readonly mailbox: MutationMailbox,
  ) {
    super();
    this.state = { kind: 'loading', query: defaultQuery(route === 'Archive'), previousRows: [] };
  }

  protected get currentQuery(): ItemQuery {
    return this.state.query;
  }

  protected previousRows(): readonly import('../contracts').ItemListRow[] {
    if (this.state.kind === 'ready') return this.state.rows;
    return this.state.previousRows;
  }

  protected changeQuery(next: ItemQuery): void {
    const enforced: ItemQuery = { ...next, archived: this.route === 'Archive' };
    void this.load(enforced);
  }

  async refresh(): Promise<void> {
    await this.load(this.currentQuery);
  }

  async onFocus(): Promise<void> {
    const notices = this.mailbox.consume(this.route);
    if (notices.length > 0) {
      this.feedback = notices[notices.length - 1].feedback;
      this.emitChange();
    }
    // Always refresh on focus. Cross-list mutations can make a previously mounted
    // list stale even when its success feedback belongs to the other destination.
    await this.refresh();
  }

  protected retry(): void {
    void this.refresh();
  }

  protected dismissFeedback(): void {
    if (this.feedback === null) return;
    this.feedback = null;
    this.emitChange();
  }

  private async load(query: ItemQuery): Promise<void> {
    const generation = ++this.generation;
    const previousRows = this.previousRows();
    this.state = { kind: 'loading', query, previousRows };
    this.emitChange();

    try {
      const result = await this.repository.list(query);
      if (generation !== this.generation) return;
      if (!result.ok) {
        this.state = { kind: 'failed', query, previousRows, error: result.error };
        this.emitChange();
        return;
      }

      const rows = await buildListRows(result.value, this.imageStore);
      if (generation !== this.generation) return;
      this.state = {
        kind: 'ready',
        query,
        rows,
        availableTags: collectAvailableTags(result.value),
      };
      this.emitChange();
    } catch {
      if (generation !== this.generation) return;
      this.state = { kind: 'failed', query, previousRows, error: unexpectedRepositoryError() };
      this.emitChange();
    }
  }
}

export class InboxController extends BaseListController implements InboxControllerOutput {
  constructor(
    repository: ItemRepository,
    imageStore: ImageStore,
    mailbox: MutationMailbox,
    private readonly navigation: NavigationActions,
  ) {
    super('Inbox', repository, imageStore, mailbox);
  }

  get props(): InboxScreenProps {
    return {
      state: this.state,
      feedback: this.feedback,
      onQueryChange: next => this.changeQuery(next),
      onOpen: id => this.navigation.showDetail(id, 'Inbox'),
      onAdd: type => this.navigation.openEditor({ mode: 'create', type, origin: 'Inbox' }),
      onOpenArchive: () => this.navigation.openArchive(),
      onRetry: () => this.retry(),
      onDismissFeedback: () => this.dismissFeedback(),
    };
  }
}

export class ArchiveController extends BaseListController implements ArchiveControllerOutput {
  constructor(
    repository: ItemRepository,
    imageStore: ImageStore,
    mailbox: MutationMailbox,
    private readonly navigation: NavigationActions,
  ) {
    super('Archive', repository, imageStore, mailbox);
  }

  get props(): ArchiveScreenProps {
    return {
      state: this.state,
      feedback: this.feedback,
      onQueryChange: next => this.changeQuery(next),
      onOpen: id => this.navigation.showDetail(id, 'Archive'),
      onBack: () => this.navigation.goBackOrInbox(),
      onRetry: () => this.retry(),
      onDismissFeedback: () => this.dismissFeedback(),
    };
  }
}

export function createInboxController(
  repository: ItemRepository,
  imageStore: ImageStore,
  mailbox: MutationMailbox,
  navigation: NavigationActions,
): InboxController {
  return new InboxController(repository, imageStore, mailbox, navigation);
}

export function createArchiveController(
  repository: ItemRepository,
  imageStore: ImageStore,
  mailbox: MutationMailbox,
  navigation: NavigationActions,
): ArchiveController {
  return new ArchiveController(repository, imageStore, mailbox, navigation);
}
