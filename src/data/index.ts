import type { ImageStore, TuckRepository } from '../contracts';
import type { LocalSyncRepository } from '../sync/localState';
import { PersistentImageStore } from './PersistentImageStore';
import { SQLiteItemRepository, type SQLiteItemRepositoryOptions } from './SQLiteItemRepository';

export { PersistentImageStore, isSafeAppImagePath } from './PersistentImageStore';
export { SQLiteItemRepository } from './SQLiteItemRepository';
export type { SQLiteInitialSyncProfile, SQLiteItemRepositoryOptions } from './SQLiteItemRepository';

export type TuckDataLayer = Readonly<{
  repository: TuckRepository;
  syncStore: LocalSyncRepository;
  imageStore: ImageStore;
}>;

/** Production wiring for C/master: one store instance shared by repository and image resolution. */
export function createTuckDataLayer(options: SQLiteItemRepositoryOptions = {}): TuckDataLayer {
  const namespace = options.initialSyncProfile?.kind === 'account'
    ? `account-${options.initialSyncProfile.accountId.replace(/[^A-Za-z0-9._-]/g, '_')}`
    : null;
  const imageStore = new PersistentImageStore(undefined, namespace);
  const repository = new SQLiteItemRepository(imageStore, options);
  return { repository, syncStore: repository, imageStore };
}
