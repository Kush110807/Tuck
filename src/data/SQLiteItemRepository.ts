import * as SQLite from 'expo-sqlite';
import type {
  AppError,
  Collection,
  CollectionId,
  CollectionSummary,
  CreateItemInput,
  EpochMs,
  ItemId,
  ItemQuery,
  ItemRepository,
  LibraryOverview,
  OrganisationRepository,
  RelativeImagePath,
  Result,
  SavedItem,
  SortOrder,
  TagSummary,
  UpdateItemInput,
} from '../contracts';
import {
  fieldContainsSearch,
  normalizeSearchField,
  toComparisonKey,
  validateCollectionName,
  validateCreateInput,
  validateQuery,
  validateUpdateInput,
  type ValidatedTags,
} from '../domain';
import { PersistentImageStore, isSafeAppImagePath } from './PersistentImageStore';

const DATABASE_NAME = 'tuck.db';
const SCHEMA_VERSION = 2;

type Db = SQLite.SQLiteDatabase;
type Tx = SQLite.SQLiteDatabase;

type ItemRow = {
  id: string;
  type: 'note' | 'link' | 'image';
  title: string;
  body: string | null;
  url: string | null;
  image_path: string | null;
  created_at: number;
  updated_at: number;
  archived: number;
  collection_id: string | null;
  pinned: number;
};

type JoinedItemRow = ItemRow & {
  tag_key: string | null;
  tag_display: string | null;
  tag_ordinal: number | null;
};

type TagRow = { tag_key: string; tag_display: string; tag_ordinal: number };
type VersionRow = { user_version: number };
type IntegrityRow = { quick_check?: string; integrity_check?: string };
type ForeignKeyViolationRow = { table: string; rowid: number | null; parent: string; fkid: number };
type CollectionRow = { id: string; name: string; name_key: string; created_at: number; updated_at: number };
type CollectionSummaryRow = CollectionRow & { active_item_count: number };
type TagSummaryRow = { tag_key: string; tag_display: string; active_item_count: number };
type TagAggregateSourceRow = { tag_key: string; tag_display: string; item_id: string; archived: number; created_at: number; tag_ordinal: number };
type CountRow = { count: number };
type TypeCountRow = { type: 'note' | 'link' | 'image'; count: number };
type CleanupRow = { path: string };
type ImageReferenceRow = { image_path: string };

class RepositoryAbort extends Error {
  constructor(readonly appError: AppError) {
    super(appError.message);
    this.name = 'RepositoryAbort';
  }
}

function dbError(message: string): AppError {
  return { code: 'DB_FAILED', message };
}

function initError(message: string): AppError {
  return { code: 'INIT_FAILED', message };
}

function notFoundError(): AppError {
  return { code: 'NOT_FOUND', message: 'Item was not found.' };
}

function collectionNotFoundError(): AppError {
  return { code: 'NOT_FOUND', message: 'Collection was not found.', field: 'collection' };
}

function conflictError(): AppError {
  return { code: 'CONFLICT', message: 'This item changed since it was opened. Reload it and try again.' };
}

function collectionConflictError(): AppError {
  return { code: 'CONFLICT', message: 'This collection changed since it was opened. Reload it and try again.', field: 'collection' };
}

function validationError(message: string): AppError {
  return { code: 'VALIDATION', message };
}

function createUuid(): string {
  const cryptoObject = (globalThis as typeof globalThis & { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoObject?.randomUUID) return cryptoObject.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, token => {
    const random = Math.floor(Math.random() * 16);
    const value = token === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function isItemType(value: string): value is ItemRow['type'] {
  return value === 'note' || value === 'link' || value === 'image';
}

function nextTimestamp(previous: EpochMs, now: EpochMs): EpochMs {
  return Math.max(now, previous + 1);
}

function rowToSavedItem(row: ItemRow, tags: readonly string[]): SavedItem {
  const base = {
    id: row.id,
    title: row.title,
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archived: row.archived === 1,
    collectionId: row.collection_id ?? null,
    pinned: row.pinned === 1,
  };

  if (!isItemType(row.type)) throw new Error('Invalid item type in database.');
  switch (row.type) {
    case 'note':
      if (row.body === null) throw new Error('Note body is missing.');
      return { ...base, type: 'note', body: row.body, url: null, imagePath: null };
    case 'link':
      if (row.url === null) throw new Error('Link URL is missing.');
      return { ...base, type: 'link', body: null, url: row.url, imagePath: null };
    case 'image':
      if (row.image_path === null) throw new Error('Image path is missing.');
      return { ...base, type: 'image', body: row.body, url: null, imagePath: row.image_path };
  }
}


function rowToCollection(row: CollectionRow): Collection {
  return {
    id: row.id,
    name: row.name,
    nameKey: row.name_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToCollectionSummary(row: CollectionSummaryRow): CollectionSummary {
  return { ...rowToCollection(row), activeItemCount: row.active_item_count };
}

function rowToTagSummary(row: TagSummaryRow): TagSummary {
  return { key: row.tag_key, display: row.tag_display, activeItemCount: row.active_item_count };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareItems(left: SavedItem, right: SavedItem, sort: SortOrder): number {
  const byId = () => compareText(left.id, right.id);
  switch (sort) {
    case 'updated_desc':
      return right.updatedAt - left.updatedAt || byId();
    case 'created_desc':
      return right.createdAt - left.createdAt || byId();
    case 'created_asc':
      return left.createdAt - right.createdAt || byId();
    case 'title_asc': {
      const titleOrder = compareText(toComparisonKey(left.title), toComparisonKey(right.title));
      return titleOrder || byId();
    }
  }
}

function tagsForSearch(item: SavedItem): readonly string[] {
  return item.tags.map(tag => normalizeSearchField(tag));
}

function matchesText(item: SavedItem, textKey: string): boolean {
  if (!textKey) return true;
  if (fieldContainsSearch(item.title, textKey)) return true;
  if (item.type === 'note' && fieldContainsSearch(item.body, textKey)) return true;
  if (item.type === 'link' && fieldContainsSearch(item.url, textKey)) return true;
  if (item.type === 'image' && fieldContainsSearch(item.body, textKey)) return true;
  return tagsForSearch(item).some(tag => tag.includes(textKey));
}

async function replaceTags(tx: Tx, id: ItemId, tags: ValidatedTags): Promise<void> {
  await tx.runAsync('DELETE FROM item_tags WHERE item_id = ?', id);
  for (let ordinal = 0; ordinal < tags.records.length; ordinal += 1) {
    const tag = tags.records[ordinal];
    await tx.runAsync(
      'INSERT INTO item_tags (item_id, tag_key, display, ordinal) VALUES (?, ?, ?, ?)',
      id,
      tag.key,
      tag.display,
      ordinal,
    );
  }
}

async function insertTags(tx: Tx, id: ItemId, tags: ValidatedTags): Promise<void> {
  for (let ordinal = 0; ordinal < tags.records.length; ordinal += 1) {
    const tag = tags.records[ordinal];
    await tx.runAsync(
      'INSERT INTO item_tags (item_id, tag_key, display, ordinal) VALUES (?, ?, ?, ?)',
      id,
      tag.key,
      tag.display,
      ordinal,
    );
  }
}

export type SQLiteItemRepositoryOptions = Readonly<{
  databaseName?: string;
  now?: () => number;
  createId?: () => string;
}>;

/** SQLite implementation of the frozen ItemRepository contract. */
export class SQLiteItemRepository implements ItemRepository, OrganisationRepository {
  private db: Db | null = null;
  private initialized = false;
  private readonly databaseName: string;
  private readonly now: () => number;
  private readonly createId: () => string;
  private operationTail: Promise<void> = Promise.resolve();
  private reconciliationPending = true;

  constructor(
    private readonly imageStore: PersistentImageStore,
    options: SQLiteItemRepositoryOptions = {},
  ) {
    this.databaseName = options.databaseName ?? DATABASE_NAME;
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? createUuid;
  }

  private serialized<T>(operation: () => Promise<Result<T>>): Promise<Result<T>> {
    const run = this.operationTail.then(operation, operation);
    this.operationTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private requireDb(): Result<Db> {
    if (!this.db || !this.initialized) return { ok: false, error: dbError('Repository is not initialized.') };
    return { ok: true, value: this.db };
  }

  initialize(): Promise<Result<void>> {
    return this.serialized(async () => {
      this.initialized = false;
      try {
        if (!this.db) this.db = await SQLite.openDatabaseAsync(this.databaseName);
        const db = this.db;
        await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
        await this.migrate(db);
        await this.verifyDatabaseIntegrity(db);

        // Database-backed maintenance state is part of initialization: if the
        // cleanup queue itself cannot be read/written, report initialization
        // failure honestly. Physical file removals remain non-fatal here: the
        // queue is retained when removeFile() fails.
        const cleanup = await this.retryPendingFileCleanupUnsafe(db);
        if (!cleanup.ok) throw new Error(cleanup.error.message);

        this.reconciliationPending = true;
        const reconcile = await this.reconcileUnreferencedImages(db);
        if (!reconcile.ok && reconcile.error.code === 'DB_FAILED') {
          throw new Error(reconcile.error.message);
        }
        if (reconcile.ok) this.reconciliationPending = false;

        // A filesystem-only reconciliation/enumeration failure is recoverable:
        // complete database reference information has already been read and no
        // deletion is attempted from an incomplete file listing. Metadata can
        // therefore remain available while an explicit/later retry is pending.
        this.initialized = true;
        return { ok: true, value: undefined };
      } catch {
        return { ok: false, error: initError('Could not initialize local storage.') };
      }
    });
  }

  list(query: ItemQuery): Promise<Result<readonly SavedItem[]>> {
    return this.serialized(async () => {
      const validated = validateQuery(query);
      if (!validated.ok) return validated;
      const database = this.requireDb();
      if (!database.ok) return database;

      try {
        const where: string[] = ['i.archived = ?'];
        const params: Array<string | number> = [validated.value.archived ? 1 : 0];
        if (validated.value.type !== 'all') {
          where.push('i.type = ?');
          params.push(validated.value.type);
        }
        if (validated.value.collectionId !== null) {
          where.push('i.collection_id = ?');
          params.push(validated.value.collectionId);
        }
        if (validated.value.pinned !== null) {
          where.push('i.pinned = ?');
          params.push(validated.value.pinned ? 1 : 0);
        }
        if (validated.value.hasCollection !== null) {
          where.push(validated.value.hasCollection ? 'i.collection_id IS NOT NULL' : 'i.collection_id IS NULL');
        }
        if (validated.value.hasTags !== null) {
          where.push(validated.value.hasTags
            ? 'EXISTS (SELECT 1 FROM item_tags ht WHERE ht.item_id = i.id)'
            : 'NOT EXISTS (SELECT 1 FROM item_tags ht WHERE ht.item_id = i.id)');
        }
        if (validated.value.tagKey !== null) {
          where.push('EXISTS (SELECT 1 FROM item_tags ft WHERE ft.item_id = i.id AND ft.tag_key = ?)');
          params.push(validated.value.tagKey);
        }

        const rows = await database.value.getAllAsync<JoinedItemRow>(
          `SELECT i.id, i.type, i.title, i.body, i.url, i.image_path, i.created_at, i.updated_at, i.archived,
                  i.collection_id, i.pinned,
                  t.tag_key, t.display AS tag_display, t.ordinal AS tag_ordinal
             FROM items i
             LEFT JOIN item_tags t ON t.item_id = i.id
            WHERE ${where.join(' AND ')}
            ORDER BY i.id ASC, t.ordinal ASC`,
          params,
        );

        const grouped = new Map<string, { row: ItemRow; tags: string[] }>();
        for (const row of rows) {
          let group = grouped.get(row.id);
          if (!group) {
            group = { row, tags: [] };
            grouped.set(row.id, group);
          }
          if (row.tag_display !== null) group.tags.push(row.tag_display);
        }

        const result: SavedItem[] = [];
        for (const group of grouped.values()) {
          const item = rowToSavedItem(group.row, group.tags);
          if (!matchesText(item, validated.value.textKey)) continue;
          result.push(item);
        }
        result.sort((left, right) => compareItems(left, right, validated.value.sort));
        return { ok: true, value: result };
      } catch {
        return { ok: false, error: dbError('Could not load items.') };
      }
    });
  }

  get(id: ItemId): Promise<Result<SavedItem>> {
    return this.serialized(async () => {
      const database = this.requireDb();
      if (!database.ok) return database;
      return this.getUnsafe(database.value, id);
    });
  }

  create(input: CreateItemInput): Promise<Result<SavedItem>> {
    return this.serialized(async () => {
      const validated = validateCreateInput(input);
      if (!validated.ok) return validated;
      const database = this.requireDb();
      if (!database.ok) return database;
      const db = database.value;

      let newImagePath: RelativeImagePath | null = null;
      if (validated.value.type === 'image') {
        const copied = await this.imageStore.copySelected(validated.value.image);
        if (!copied.ok) return copied;
        newImagePath = copied.value;
      }

      const id = this.createId();
      const timestamp = this.now();
      const value = validated.value;
      const body = value.type === 'note' ? value.body : value.type === 'image' ? value.caption : null;
      const url = value.type === 'link' ? value.url : null;
      const common = { tags: value.tags.display, createdAt: timestamp, updatedAt: timestamp, archived: false, collectionId: value.collectionId, pinned: false };
      const created: SavedItem = value.type === 'note'
        ? { id, type: 'note', title: value.title, body: value.body, url: null, imagePath: null, ...common }
        : value.type === 'link'
          ? { id, type: 'link', title: value.title, body: null, url: value.url, imagePath: null, ...common }
          : { id, type: 'image', title: value.title, body: value.caption, url: null, imagePath: newImagePath!, ...common };

      try {
        await db.withExclusiveTransactionAsync(async tx => {
          if (value.collectionId !== null && !(await this.getCollectionRow(tx, value.collectionId))) {
            throw new RepositoryAbort(collectionNotFoundError());
          }
          await tx.runAsync(
            `INSERT INTO items (id, type, title, body, url, image_path, created_at, updated_at, archived, collection_id, pinned)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0)`,
            id,
            value.type,
            value.title,
            body,
            url,
            newImagePath,
            timestamp,
            timestamp,
            value.collectionId,
          );
          await insertTags(tx, id, value.tags);
        });
      } catch (error) {
        if (newImagePath) await this.cleanupUnreferencedCopy(db, newImagePath);
        if (error instanceof RepositoryAbort) return { ok: false, error: error.appError };
        return { ok: false, error: dbError('Could not save the item.') };
      }

      await this.runImageMaintenanceBestEffort(db);
      return { ok: true, value: created };
    });
  }

  update(input: UpdateItemInput): Promise<Result<SavedItem>> {
    return this.serialized(async () => {
      const validated = validateUpdateInput(input);
      if (!validated.ok) return validated;
      const database = this.requireDb();
      if (!database.ok) return database;
      const db = database.value;

      let replacementPath: RelativeImagePath | null = null;
      if (validated.value.type === 'image' && validated.value.changes.image) {
        const copied = await this.imageStore.copySelected(validated.value.changes.image.selection);
        if (!copied.ok) return copied;
        replacementPath = copied.value;
      }

      let oldImagePath: RelativeImagePath | null = null;
      let committedItem: SavedItem | null = null;
      try {
        await db.withExclusiveTransactionAsync(async tx => {
          const current = await this.getItemRow(tx, validated.value.id);
          if (!current) throw new RepositoryAbort(notFoundError());
          if (current.updated_at !== validated.value.expectedUpdatedAt) throw new RepositoryAbort(conflictError());
          if (current.type !== validated.value.type) throw new RepositoryAbort(validationError('Item type cannot change.'));

          const timestamp = nextTimestamp(current.updated_at, this.now());
          const changes = validated.value.changes;
          const currentTags = await this.getTags(tx, validated.value.id);
          let title = current.title;
          let body = current.body;
          let url = current.url;
          let imagePath = current.image_path;
          let collectionId = current.collection_id;
          let tags = currentTags;

          if (changes.title !== undefined) title = changes.title;
          if (changes.collectionId !== undefined) {
            if (changes.collectionId !== null && !(await this.getCollectionRow(tx, changes.collectionId))) {
              throw new RepositoryAbort(collectionNotFoundError());
            }
            collectionId = changes.collectionId;
          }
          if (validated.value.type === 'note' && validated.value.changes.body !== undefined) body = validated.value.changes.body;
          if (validated.value.type === 'link' && validated.value.changes.url !== undefined) url = validated.value.changes.url;
          if (validated.value.type === 'image') {
            if (validated.value.changes.caption !== undefined) body = validated.value.changes.caption;
            if (replacementPath) {
              if (!current.image_path) throw new RepositoryAbort(validationError('Image item has no stored image.'));
              oldImagePath = current.image_path;
              imagePath = replacementPath;
              await this.queueDeletion(tx, oldImagePath);
            }
          }

          await tx.runAsync(
            `UPDATE items
                SET title = ?, body = ?, url = ?, image_path = ?, collection_id = ?, updated_at = ?
              WHERE id = ?`,
            title,
            body,
            url,
            imagePath,
            collectionId,
            timestamp,
            validated.value.id,
          );

          if (changes.tags !== undefined) {
            await replaceTags(tx, validated.value.id, changes.tags);
            tags = changes.tags.display;
          }
          committedItem = rowToSavedItem({ ...current, title, body, url, image_path: imagePath, collection_id: collectionId, updated_at: timestamp }, tags);
        });
      } catch (error) {
        if (replacementPath) await this.cleanupUnreferencedCopy(db, replacementPath);
        if (error instanceof RepositoryAbort) return { ok: false, error: error.appError };
        return { ok: false, error: dbError('Could not update the item.') };
      }

      if (!committedItem) return { ok: false, error: dbError('Update did not produce a committed item.') };
      if (oldImagePath) await this.removeQueuedPath(db, oldImagePath);
      await this.runImageMaintenanceBestEffort(db);
      return { ok: true, value: committedItem };
    });
  }

  setArchived(id: ItemId, archived: boolean, expectedUpdatedAt: EpochMs): Promise<Result<SavedItem>> {
    return this.serialized(async () => {
      if (typeof id !== 'string' || !id || typeof archived !== 'boolean' || !Number.isSafeInteger(expectedUpdatedAt) || expectedUpdatedAt < 0) {
        return { ok: false, error: validationError('Archive request is invalid.') };
      }
      const database = this.requireDb();
      if (!database.ok) return database;
      const db = database.value;

      let committedItem: SavedItem | null = null;
      try {
        await db.withExclusiveTransactionAsync(async tx => {
          const current = await this.getItemRow(tx, id);
          if (!current) throw new RepositoryAbort(notFoundError());
          if (current.updated_at !== expectedUpdatedAt) throw new RepositoryAbort(conflictError());
          const tags = await this.getTags(tx, id);
          if ((current.archived === 1) === archived) {
            committedItem = rowToSavedItem(current, tags);
            return;
          }

          const timestamp = nextTimestamp(current.updated_at, this.now());
          await tx.runAsync(
            'UPDATE items SET archived = ?, updated_at = ? WHERE id = ?',
            archived ? 1 : 0,
            timestamp,
            id,
          );
          committedItem = rowToSavedItem({ ...current, archived: archived ? 1 : 0, updated_at: timestamp }, tags);
        });
      } catch (error) {
        if (error instanceof RepositoryAbort) return { ok: false, error: error.appError };
        return { ok: false, error: dbError(archived ? 'Could not archive the item.' : 'Could not restore the item.') };
      }

      if (!committedItem) return { ok: false, error: dbError('Archive operation did not produce a committed item.') };
      await this.runImageMaintenanceBestEffort(db);
      return { ok: true, value: committedItem };
    });
  }

  setPinned(id: ItemId, pinned: boolean, expectedUpdatedAt: EpochMs): Promise<Result<SavedItem>> {
    return this.serialized(async () => {
      if (typeof id !== 'string' || !id || typeof pinned !== 'boolean' || !Number.isSafeInteger(expectedUpdatedAt) || expectedUpdatedAt < 0) {
        return { ok: false, error: validationError('Pin request is invalid.') };
      }
      const database = this.requireDb();
      if (!database.ok) return database;

      let committedItem: SavedItem | null = null;
      try {
        await database.value.withExclusiveTransactionAsync(async tx => {
          const current = await this.getItemRow(tx, id);
          if (!current) throw new RepositoryAbort(notFoundError());
          if (current.updated_at !== expectedUpdatedAt) throw new RepositoryAbort(conflictError());
          const tags = await this.getTags(tx, id);
          if ((current.pinned === 1) === pinned) {
            committedItem = rowToSavedItem(current, tags);
            return;
          }
          await tx.runAsync('UPDATE items SET pinned = ? WHERE id = ?', pinned ? 1 : 0, id);
          committedItem = rowToSavedItem({ ...current, pinned: pinned ? 1 : 0 }, tags);
        });
      } catch (error) {
        if (error instanceof RepositoryAbort) return { ok: false, error: error.appError };
        return { ok: false, error: dbError(pinned ? 'Could not pin the item.' : 'Could not unpin the item.') };
      }

      if (!committedItem) return { ok: false, error: dbError('Pin operation did not produce a committed item.') };
      return { ok: true, value: committedItem };
    });
  }

  listCollections(): Promise<Result<readonly CollectionSummary[]>> {
    return this.serialized(async () => {
      const database = this.requireDb();
      if (!database.ok) return database;
      try {
        return { ok: true, value: await this.listCollectionsUnsafe(database.value) };
      } catch {
        return { ok: false, error: dbError('Could not load collections.') };
      }
    });
  }

  getCollection(id: CollectionId): Promise<Result<Collection>> {
    return this.serialized(async () => {
      if (typeof id !== 'string' || !id) return { ok: false, error: validationError('Collection ID is required.') };
      const database = this.requireDb();
      if (!database.ok) return database;
      try {
        const row = await this.getCollectionRow(database.value, id);
        return row ? { ok: true, value: rowToCollection(row) } : { ok: false, error: collectionNotFoundError() };
      } catch {
        return { ok: false, error: dbError('Could not load the collection.') };
      }
    });
  }

  createCollection(name: string): Promise<Result<Collection>> {
    return this.serialized(async () => {
      const validated = validateCollectionName(name);
      if (!validated.ok) return validated;
      const database = this.requireDb();
      if (!database.ok) return database;
      let committed: Collection | null = null;

      try {
        await database.value.withExclusiveTransactionAsync(async tx => {
          const duplicate = await this.getCollectionByNameKey(tx, validated.value.nameKey);
          if (duplicate) throw new RepositoryAbort(validationError('A collection with this name already exists.'));
          // Allocate identity only after validation/duplicate checks so rejected creates do not consume IDs.
          const id = this.createId();
          const timestamp = this.now();
          await tx.runAsync(
            'INSERT INTO collections (id, name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
            id,
            validated.value.name,
            validated.value.nameKey,
            timestamp,
            timestamp,
          );
          committed = {
            id,
            name: validated.value.name,
            nameKey: validated.value.nameKey,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
        });
      } catch (error) {
        if (error instanceof RepositoryAbort) return { ok: false, error: { ...error.appError, field: 'collection' } };
        return { ok: false, error: dbError('Could not create the collection.') };
      }
      if (!committed) return { ok: false, error: dbError('Collection creation did not produce a committed collection.') };
      return { ok: true, value: committed };
    });
  }

  renameCollection(id: CollectionId, name: string, expectedUpdatedAt: EpochMs): Promise<Result<Collection>> {
    return this.serialized(async () => {
      if (typeof id !== 'string' || !id || !Number.isSafeInteger(expectedUpdatedAt) || expectedUpdatedAt < 0) {
        return { ok: false, error: validationError('Collection rename request is invalid.') };
      }
      const validated = validateCollectionName(name);
      if (!validated.ok) return validated;
      const database = this.requireDb();
      if (!database.ok) return database;
      let committed: Collection | null = null;

      try {
        await database.value.withExclusiveTransactionAsync(async tx => {
          const current = await this.getCollectionRow(tx, id);
          if (!current) throw new RepositoryAbort(collectionNotFoundError());
          if (current.updated_at !== expectedUpdatedAt) throw new RepositoryAbort(collectionConflictError());
          if (current.name === validated.value.name && current.name_key === validated.value.nameKey) {
            committed = rowToCollection(current);
            return;
          }
          const duplicate = await this.getCollectionByNameKey(tx, validated.value.nameKey);
          if (duplicate && duplicate.id !== id) {
            throw new RepositoryAbort(validationError('A collection with this name already exists.'));
          }
          const timestamp = nextTimestamp(current.updated_at, this.now());
          await tx.runAsync(
            'UPDATE collections SET name = ?, name_key = ?, updated_at = ? WHERE id = ?',
            validated.value.name,
            validated.value.nameKey,
            timestamp,
            id,
          );
          committed = rowToCollection({ ...current, name: validated.value.name, name_key: validated.value.nameKey, updated_at: timestamp });
        });
      } catch (error) {
        if (error instanceof RepositoryAbort) return { ok: false, error: { ...error.appError, ...(error.appError.code === 'VALIDATION' ? { field: 'collection' as const } : {}) } };
        return { ok: false, error: dbError('Could not rename the collection.') };
      }
      if (!committed) return { ok: false, error: dbError('Collection rename did not produce a committed collection.') };
      return { ok: true, value: committed };
    });
  }

  deleteCollection(id: CollectionId, expectedUpdatedAt: EpochMs): Promise<Result<void>> {
    return this.serialized(async () => {
      if (typeof id !== 'string' || !id || !Number.isSafeInteger(expectedUpdatedAt) || expectedUpdatedAt < 0) {
        return { ok: false, error: validationError('Collection delete request is invalid.') };
      }
      const database = this.requireDb();
      if (!database.ok) return database;
      try {
        await database.value.withExclusiveTransactionAsync(async tx => {
          const current = await this.getCollectionRow(tx, id);
          if (!current) throw new RepositoryAbort(collectionNotFoundError());
          if (current.updated_at !== expectedUpdatedAt) throw new RepositoryAbort(collectionConflictError());
          // ON DELETE SET NULL preserves items and intentionally does not rewrite item updated_at.
          await tx.runAsync('DELETE FROM collections WHERE id = ?', id);
        });
        return { ok: true, value: undefined };
      } catch (error) {
        if (error instanceof RepositoryAbort) return { ok: false, error: error.appError };
        return { ok: false, error: dbError('Could not delete the collection.') };
      }
    });
  }

  listTags(): Promise<Result<readonly TagSummary[]>> {
    return this.serialized(async () => {
      const database = this.requireDb();
      if (!database.ok) return database;
      try {
        return { ok: true, value: await this.listTagsUnsafe(database.value) };
      } catch {
        return { ok: false, error: dbError('Could not load tags.') };
      }
    });
  }

  getLibraryOverview(): Promise<Result<LibraryOverview>> {
    return this.serialized(async () => {
      const database = this.requireDb();
      if (!database.ok) return database;
      const db = database.value;
      try {
        // Keep one SQLite connection's reads ordered rather than relying on concurrent driver scheduling.
        const collections = await this.listCollectionsUnsafe(db);
        const tags = await this.listTagsUnsafe(db);
        const active = await db.getFirstAsync<CountRow>('SELECT COUNT(*) AS count FROM items WHERE archived = 0');
        const archived = await db.getFirstAsync<CountRow>('SELECT COUNT(*) AS count FROM items WHERE archived = 1');
        const pinned = await db.getFirstAsync<CountRow>('SELECT COUNT(*) AS count FROM items WHERE archived = 0 AND pinned = 1');
        const untagged = await db.getFirstAsync<CountRow>(
          'SELECT COUNT(*) AS count FROM items i WHERE i.archived = 0 AND NOT EXISTS (SELECT 1 FROM item_tags t WHERE t.item_id = i.id)',
        );
        const unfiled = await db.getFirstAsync<CountRow>('SELECT COUNT(*) AS count FROM items WHERE archived = 0 AND collection_id IS NULL');
        const typeRows = await db.getAllAsync<TypeCountRow>('SELECT type, COUNT(*) AS count FROM items WHERE archived = 0 GROUP BY type');
        const types: Record<'note' | 'link' | 'image', number> = { note: 0, link: 0, image: 0 };
        for (const row of typeRows) types[row.type] = row.count;
        return {
          ok: true,
          value: {
            activeItemCount: active?.count ?? 0,
            archivedItemCount: archived?.count ?? 0,
            collections,
            tags,
            smartViews: {
              pinned: pinned?.count ?? 0,
              untagged: untagged?.count ?? 0,
              unfiled: unfiled?.count ?? 0,
            },
            types,
          },
        };
      } catch {
        return { ok: false, error: dbError('Could not load Library data.') };
      }
    });
  }

  remove(id: ItemId, expectedUpdatedAt: EpochMs): Promise<Result<void>> {
    return this.serialized(async () => {
      if (typeof id !== 'string' || !id || !Number.isSafeInteger(expectedUpdatedAt) || expectedUpdatedAt < 0) {
        return { ok: false, error: validationError('Delete request is invalid.') };
      }
      const database = this.requireDb();
      if (!database.ok) return database;
      const db = database.value;
      let imagePath: RelativeImagePath | null = null;

      try {
        await db.withExclusiveTransactionAsync(async tx => {
          const current = await this.getItemRow(tx, id);
          if (!current) throw new RepositoryAbort(notFoundError());
          if (current.updated_at !== expectedUpdatedAt) throw new RepositoryAbort(conflictError());

          if (current.type === 'image' && current.image_path) {
            imagePath = current.image_path;
            await this.queueDeletion(tx, imagePath);
          }
          await tx.runAsync('DELETE FROM items WHERE id = ?', id);
        });
      } catch (error) {
        if (error instanceof RepositoryAbort) return { ok: false, error: error.appError };
        return { ok: false, error: dbError('Could not delete the item.') };
      }

      if (imagePath) await this.removeQueuedPath(db, imagePath);
      await this.runImageMaintenanceBestEffort(db);
      return { ok: true, value: undefined };
    });
  }

  retryPendingFileCleanup(): Promise<Result<{ remaining: number }>> {
    return this.serialized(async () => {
      const database = this.requireDb();
      if (!database.ok) return database;
      const cleanup = await this.retryPendingFileCleanupUnsafe(database.value);
      if (!cleanup.ok) return cleanup;
      const reconcile = await this.reconcileUnreferencedImages(database.value);
      if (!reconcile.ok) {
        this.reconciliationPending = true;
        return { ok: false, error: reconcile.error };
      }
      this.reconciliationPending = false;
      return cleanup;
    });
  }

  private async verifyDatabaseIntegrity(db: Db): Promise<void> {
    const row = await db.getFirstAsync<IntegrityRow>('PRAGMA quick_check');
    const result = row?.quick_check ?? row?.integrity_check;
    if (result !== 'ok') throw new Error('SQLite quick_check failed.');
    const foreignKeyViolations = await db.getAllAsync<ForeignKeyViolationRow>('PRAGMA foreign_key_check');
    if (foreignKeyViolations.length > 0) throw new Error('SQLite foreign_key_check failed.');
  }

  private async migrate(db: Db): Promise<void> {
    const row = await db.getFirstAsync<VersionRow>('PRAGMA user_version');
    let version = row?.user_version ?? 0;
    if (version > SCHEMA_VERSION) throw new Error('Database schema is newer than this app supports.');

    if (version === 0) {
      await this.migrateV0ToV1(db);
      version = 1;
    }
    if (version === 1) {
      await this.migrateV1ToV2(db);
      version = 2;
    }
    if (version !== SCHEMA_VERSION) throw new Error('Database schema migration did not reach the supported version.');
  }

  private async migrateV0ToV1(db: Db): Promise<void> {
    await db.withExclusiveTransactionAsync(async tx => {
      await tx.execAsync(`
        CREATE TABLE IF NOT EXISTS items (
          id TEXT PRIMARY KEY NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('note', 'link', 'image')),
          title TEXT NOT NULL,
          body TEXT,
          url TEXT,
          image_path TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
          CHECK (
            (type = 'note' AND body IS NOT NULL AND url IS NULL AND image_path IS NULL) OR
            (type = 'link' AND body IS NULL AND url IS NOT NULL AND image_path IS NULL) OR
            (type = 'image' AND url IS NULL AND image_path IS NOT NULL)
          )
        );

        CREATE TABLE IF NOT EXISTS item_tags (
          item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
          tag_key TEXT NOT NULL,
          display TEXT NOT NULL,
          ordinal INTEGER NOT NULL,
          PRIMARY KEY (item_id, tag_key),
          UNIQUE (item_id, ordinal)
        );

        CREATE TABLE IF NOT EXISTS pending_file_deletions (
          path TEXT PRIMARY KEY NOT NULL,
          queued_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_items_archive_type_updated
          ON items (archived, type, updated_at DESC, id ASC);
        CREATE INDEX IF NOT EXISTS idx_item_tags_key
          ON item_tags (tag_key, item_id);
      `);
      await tx.execAsync('PRAGMA user_version = 1;');
    });
  }

  private async migrateV1ToV2(db: Db): Promise<void> {
    await db.withExclusiveTransactionAsync(async tx => {
      await tx.execAsync(`
        CREATE TABLE collections (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          name_key TEXT NOT NULL UNIQUE,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
      await tx.execAsync(
        'ALTER TABLE items ADD COLUMN collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL;',
      );
      await tx.execAsync(
        'ALTER TABLE items ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1));',
      );
      await tx.execAsync(`
        CREATE INDEX idx_items_collection_archive_updated
          ON items (collection_id, archived, updated_at DESC, id ASC);
        CREATE INDEX idx_items_archive_pinned_updated
          ON items (archived, pinned, updated_at DESC, id ASC);
      `);
      // Version is advanced only inside the transaction after every v2 change succeeds.
      await tx.execAsync('PRAGMA user_version = 2;');
    });
  }

  private async getCollectionRow(db: Tx, id: CollectionId): Promise<CollectionRow | null> {
    return db.getFirstAsync<CollectionRow>(
      'SELECT id, name, name_key, created_at, updated_at FROM collections WHERE id = ?',
      id,
    );
  }

  private async getCollectionByNameKey(db: Tx, nameKey: string): Promise<CollectionRow | null> {
    return db.getFirstAsync<CollectionRow>(
      'SELECT id, name, name_key, created_at, updated_at FROM collections WHERE name_key = ?',
      nameKey,
    );
  }

  private async listCollectionsUnsafe(db: Tx): Promise<readonly CollectionSummary[]> {
    const rows = await db.getAllAsync<CollectionSummaryRow>(
      `SELECT c.id, c.name, c.name_key, c.created_at, c.updated_at,
              SUM(CASE WHEN i.archived = 0 THEN 1 ELSE 0 END) AS active_item_count
         FROM collections c
         LEFT JOIN items i ON i.collection_id = c.id
        GROUP BY c.id, c.name, c.name_key, c.created_at, c.updated_at
        ORDER BY c.name_key ASC, c.id ASC`,
    );
    return rows.map(rowToCollectionSummary);
  }

  private async listTagsUnsafe(db: Tx): Promise<readonly TagSummary[]> {
    const rows = await db.getAllAsync<TagAggregateSourceRow>(
      `SELECT t.tag_key, t.display AS tag_display, t.item_id, i.archived, i.created_at,
              t.ordinal AS tag_ordinal
         FROM item_tags t
         JOIN items i ON i.id = t.item_id
        ORDER BY t.tag_key ASC, i.created_at ASC, t.item_id ASC, t.ordinal ASC`,
    );
    const aggregated = new Map<string, TagSummaryRow>();
    for (const row of rows) {
      const existing = aggregated.get(row.tag_key);
      if (!existing) {
        aggregated.set(row.tag_key, {
          tag_key: row.tag_key,
          tag_display: row.tag_display,
          active_item_count: row.archived === 0 ? 1 : 0,
        });
      } else if (row.archived === 0) {
        existing.active_item_count += 1;
      }
    }
    return [...aggregated.values()]
      .filter(row => row.active_item_count > 0)
      .map(rowToTagSummary);
  }

  private async getItemRow(db: Tx, id: ItemId): Promise<ItemRow | null> {
    return db.getFirstAsync<ItemRow>(
      `SELECT id, type, title, body, url, image_path, created_at, updated_at, archived, collection_id, pinned
         FROM items WHERE id = ?`,
      id,
    );
  }

  private async getTags(db: Tx, id: ItemId): Promise<readonly string[]> {
    const rows = await db.getAllAsync<TagRow>(
      `SELECT tag_key, display AS tag_display, ordinal AS tag_ordinal
         FROM item_tags WHERE item_id = ? ORDER BY ordinal ASC`,
      id,
    );
    return rows.map(tag => tag.tag_display);
  }

  private async getUnsafe(db: Db, id: ItemId): Promise<Result<SavedItem>> {
    if (typeof id !== 'string' || !id) return { ok: false, error: validationError('Item ID is required.') };
    try {
      const row = await this.getItemRow(db, id);
      if (!row) return { ok: false, error: notFoundError() };
      const tags = await this.getTags(db, id);
      return { ok: true, value: rowToSavedItem(row, tags) };
    } catch {
      return { ok: false, error: dbError('Could not load the item.') };
    }
  }

  private async queueDeletion(tx: Tx, path: RelativeImagePath): Promise<void> {
    await tx.runAsync(
      `INSERT INTO pending_file_deletions (path, queued_at)
       VALUES (?, ?)
       ON CONFLICT(path) DO NOTHING`,
      path,
      this.now(),
    );
  }

  private async cleanupUnreferencedCopy(db: Db, path: RelativeImagePath): Promise<void> {
    const removed = await this.imageStore.removeFile(path);
    if (removed.ok) return;
    try {
      await this.queueDeletion(db, path);
    } catch {
      // Last-resort startup reconciliation can still discover this app-owned orphan.
    }
  }

  private async removeQueuedPath(db: Db, path: RelativeImagePath): Promise<void> {
    const removed = await this.imageStore.removeFile(path);
    if (!removed.ok) return;
    try {
      await db.runAsync('DELETE FROM pending_file_deletions WHERE path = ?', path);
    } catch {
      // Leaving a queue record is safe: retry sees a missing file as successful and clears it later.
    }
  }

  private async retryPendingFileCleanupUnsafe(db: Db): Promise<Result<{ remaining: number }>> {
    try {
      const rows = await db.getAllAsync<CleanupRow>('SELECT path FROM pending_file_deletions ORDER BY queued_at ASC, path ASC');
      for (const row of rows) {
        if (!isSafeAppImagePath(row.path)) continue;
        const removed = await this.imageStore.removeFile(row.path);
        if (!removed.ok) continue;
        await db.runAsync('DELETE FROM pending_file_deletions WHERE path = ?', row.path);
      }
      const remaining = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM pending_file_deletions');
      return { ok: true, value: { remaining: remaining?.count ?? 0 } };
    } catch {
      return { ok: false, error: dbError('Could not retry pending image cleanup.') };
    }
  }

  private async runImageMaintenanceBestEffort(db: Db): Promise<void> {
    // A cleanup failure keeps queue rows in place; there is nothing unsafe to
    // infer from that failure and metadata access remains available.
    await this.retryPendingFileCleanupUnsafe(db);
    if (!this.reconciliationPending) return;

    // Reconciliation reads the complete DB reference set before enumerating or
    // deleting app-owned files. A failed enumeration returns no paths and thus
    // cannot trigger deletion from incomplete reference information.
    const reconcile = await this.reconcileUnreferencedImages(db);
    if (reconcile.ok) this.reconciliationPending = false;
  }

  private async reconcileUnreferencedImages(db: Db): Promise<Result<void>> {
    try {
      const references = await db.getAllAsync<ImageReferenceRow>(
        `SELECT image_path FROM items WHERE type = 'image' AND image_path IS NOT NULL`,
      );
      const referenced = new Set(references.map(row => row.image_path));
      const stored = this.imageStore.listOwnedRelativePaths();
      if (!stored.ok) return stored;

      for (const path of stored.value) {
        if (referenced.has(path)) continue;
        const removed = await this.imageStore.removeFile(path);
        if (removed.ok) continue;
        try {
          await this.queueDeletion(db, path);
        } catch {
          return { ok: false, error: dbError('Could not queue interrupted image cleanup.') };
        }
      }
      return { ok: true, value: undefined };
    } catch {
      return { ok: false, error: dbError('Could not reconcile app image storage.') };
    }
  }
}
