import type {
  AppError,
  CreateItemInput,
  ImagePickerAdapter,
  ImageStore,
  ItemId,
  ItemQuery,
  ItemRepository,
  LinkOpener,
  MutationMailbox,
  MutationNotice,
  NavigationActions,
  PickImageOutcome,
  RelativeImagePath,
  Result,
  RootStackParams,
  SavedItem,
  UpdateItemInput,
} from '../../src/contracts';

export type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
};


export async function flushAsync(): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const notImplemented = (method: string): AppError => ({ code: 'DB_FAILED', message: `Mock ${method} is not configured.` });

export class MockItemRepository implements ItemRepository {
  initializeCalls = 0;
  listCalls: ItemQuery[] = [];
  getCalls: ItemId[] = [];
  createCalls: CreateItemInput[] = [];
  updateCalls: UpdateItemInput[] = [];
  setArchivedCalls: Array<{ id: ItemId; archived: boolean; expectedUpdatedAt: number }> = [];
  removeCalls: Array<{ id: ItemId; expectedUpdatedAt: number }> = [];
  cleanupCalls = 0;

  initializeImpl: () => Promise<Result<void>> = async () => ({ ok: true, value: undefined });
  listImpl: (query: ItemQuery) => Promise<Result<readonly SavedItem[]>> = async () => ({ ok: true, value: [] });
  getImpl: (id: ItemId) => Promise<Result<SavedItem>> = async () => ({ ok: false, error: { code: 'NOT_FOUND', message: 'Missing.' } });
  createImpl: (input: CreateItemInput) => Promise<Result<SavedItem>> = async () => ({ ok: false, error: notImplemented('create') });
  updateImpl: (input: UpdateItemInput) => Promise<Result<SavedItem>> = async () => ({ ok: false, error: notImplemented('update') });
  setArchivedImpl: (id: ItemId, archived: boolean, expectedUpdatedAt: number) => Promise<Result<SavedItem>> = async () => ({ ok: false, error: notImplemented('setArchived') });
  removeImpl: (id: ItemId, expectedUpdatedAt: number) => Promise<Result<void>> = async () => ({ ok: false, error: notImplemented('remove') });
  cleanupImpl: () => Promise<Result<{ remaining: number }>> = async () => ({ ok: true, value: { remaining: 0 } });

  async initialize(): Promise<Result<void>> { this.initializeCalls += 1; return this.initializeImpl(); }
  async list(query: ItemQuery): Promise<Result<readonly SavedItem[]>> { this.listCalls.push({ ...query }); return this.listImpl(query); }
  async get(id: ItemId): Promise<Result<SavedItem>> { this.getCalls.push(id); return this.getImpl(id); }
  async create(input: CreateItemInput): Promise<Result<SavedItem>> { this.createCalls.push(input); return this.createImpl(input); }
  async update(input: UpdateItemInput): Promise<Result<SavedItem>> { this.updateCalls.push(input); return this.updateImpl(input); }
  async setArchived(id: ItemId, archived: boolean, expectedUpdatedAt: number): Promise<Result<SavedItem>> {
    this.setArchivedCalls.push({ id, archived, expectedUpdatedAt });
    return this.setArchivedImpl(id, archived, expectedUpdatedAt);
  }
  async remove(id: ItemId, expectedUpdatedAt: number): Promise<Result<void>> {
    this.removeCalls.push({ id, expectedUpdatedAt });
    return this.removeImpl(id, expectedUpdatedAt);
  }
  async retryPendingFileCleanup(): Promise<Result<{ remaining: number }>> { this.cleanupCalls += 1; return this.cleanupImpl(); }
}

export class MockImageStore implements ImageStore {
  resolveCalls: RelativeImagePath[] = [];
  resolveImpl: ImageStore['resolve'] = async path => ({ ok: true, value: { kind: 'available', uri: `file:///${path}` } });
  copySelected: ImageStore['copySelected'] = async () => ({ ok: false, error: notImplemented('copySelected') });
  removeFile: ImageStore['removeFile'] = async () => ({ ok: true, value: undefined });
  async resolve(path: RelativeImagePath) {
    this.resolveCalls.push(path);
    return this.resolveImpl(path);
  }
}

export class MockImagePicker implements ImagePickerAdapter {
  calls = 0;
  outcome: PickImageOutcome = { kind: 'cancelled' };
  async pickOne(): Promise<PickImageOutcome> { this.calls += 1; return this.outcome; }
}

export class MockLinkOpener implements LinkOpener {
  calls: string[] = [];
  result: Result<void> = { ok: true, value: undefined };
  async openHttpUrl(url: string): Promise<Result<void>> { this.calls.push(url); return this.result; }
}

export class MockNavigation implements NavigationActions {
  calls: Array<{ name: string; args: unknown[] }> = [];
  private record(name: string, ...args: unknown[]): void { this.calls.push({ name, args }); }
  showDetail(id: ItemId, origin: 'Inbox' | 'Archive'): void { this.record('showDetail', id, origin); }
  completeCreate(id: ItemId): void { this.record('completeCreate', id); }
  completeEdit(id: ItemId, origin: 'Inbox' | 'Archive'): void { this.record('completeEdit', id, origin); }
  returnToList(origin: 'Inbox' | 'Archive'): void { this.record('returnToList', origin); }
  openEditor(params: RootStackParams['Editor']): void { this.record('openEditor', params); }
  openArchive(): void { this.record('openArchive'); }
  goBackOrInbox(): void { this.record('goBackOrInbox'); }
}

export class MockMailbox implements MutationMailbox {
  published: MutationNotice[] = [];
  consumed: Array<{ destination: MutationNotice['destination']; itemId?: ItemId }> = [];
  private sequence = 0;
  pending: MutationNotice[] = [];

  publish(notice: Omit<MutationNotice, 'sequence'>): MutationNotice {
    const event = { ...notice, sequence: ++this.sequence };
    this.published.push(event);
    this.pending.push(event);
    return event;
  }

  consume(destination: MutationNotice['destination'], itemId?: ItemId): readonly MutationNotice[] {
    this.consumed.push({ destination, ...(itemId === undefined ? {} : { itemId }) });
    const matches = this.pending.filter(event => event.destination === destination &&
      (destination !== 'Detail' || event.itemId === itemId));
    const sequences = new Set(matches.map(event => event.sequence));
    this.pending = this.pending.filter(event => !sequences.has(event.sequence));
    return matches;
  }
}
