import type {
  Collection, CollectionId, CollectionSummary, CreateItemInput, EpochMs, ItemId, ItemQuery,
  LibraryOverview, Result, SavedItem, TagSummary, TuckRepository, UpdateItemInput,
} from '../contracts';
import type { SyncEngine } from './SyncEngine';

/** Keeps local repository semantics intact and schedules sync only after a successful local commit. */
export class SyncTriggerRepository implements TuckRepository {
  constructor(private readonly base: TuckRepository, private readonly engine: SyncEngine) {}
  initialize = () => this.base.initialize();
  list = (query: ItemQuery) => this.base.list(query);
  get = (id: ItemId) => this.base.get(id);
  retryPendingFileCleanup = () => this.base.retryPendingFileCleanup();
  getLibraryOverview = () => this.base.getLibraryOverview();
  listCollections = () => this.base.listCollections();
  getCollection = (id: CollectionId) => this.base.getCollection(id);
  listTags = () => this.base.listTags();

  create(input: CreateItemInput): Promise<Result<SavedItem>> { return this.after(this.base.create(input)); }
  update(input: UpdateItemInput): Promise<Result<SavedItem>> { return this.after(this.base.update(input)); }
  setArchived(id: ItemId, archived: boolean, expectedUpdatedAt: EpochMs): Promise<Result<SavedItem>> {
    return this.after(this.base.setArchived(id, archived, expectedUpdatedAt));
  }
  setPinned(id: ItemId, pinned: boolean, expectedUpdatedAt: EpochMs): Promise<Result<SavedItem>> {
    return this.after(this.base.setPinned(id, pinned, expectedUpdatedAt));
  }
  remove(id: ItemId, expectedUpdatedAt: EpochMs): Promise<Result<void>> {
    return this.after(this.base.remove(id, expectedUpdatedAt));
  }
  createCollection(name: string): Promise<Result<Collection>> { return this.after(this.base.createCollection(name)); }
  renameCollection(id: CollectionId, name: string, expectedUpdatedAt: EpochMs): Promise<Result<Collection>> {
    return this.after(this.base.renameCollection(id, name, expectedUpdatedAt));
  }
  deleteCollection(id: CollectionId, expectedUpdatedAt: EpochMs): Promise<Result<void>> {
    return this.after(this.base.deleteCollection(id, expectedUpdatedAt));
  }

  private async after<T>(operation: Promise<Result<T>>): Promise<Result<T>> {
    const result = await operation;
    if (result.ok) {
      this.engine.noteLocalSave();
      void this.engine.runOnce('local-write');
    }
    return result;
  }
}
