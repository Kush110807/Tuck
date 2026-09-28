import type { ImageStore, ItemRepository } from '../contracts';
import { PersistentImageStore } from './PersistentImageStore';
import { SQLiteItemRepository, type SQLiteItemRepositoryOptions } from './SQLiteItemRepository';

export { PersistentImageStore, isSafeAppImagePath } from './PersistentImageStore';
export { SQLiteItemRepository } from './SQLiteItemRepository';
export type { SQLiteItemRepositoryOptions } from './SQLiteItemRepository';

export type TuckDataLayer = Readonly<{
  repository: ItemRepository;
  imageStore: ImageStore;
}>;

/** Production wiring for C/master: one store instance shared by repository and image resolution. */
export function createTuckDataLayer(options: SQLiteItemRepositoryOptions = {}): TuckDataLayer {
  const imageStore = new PersistentImageStore();
  const repository = new SQLiteItemRepository(imageStore, options);
  return { repository, imageStore };
}
