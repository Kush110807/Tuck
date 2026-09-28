import * as SQLite from 'expo-sqlite';
import type {
  AppError,
  CreateItemInput,
  EpochMs,
  ItemId,
  ItemQuery,
  ItemRepository,
  RelativeImagePath,
  Result,
  SavedItem,
  UpdateItemInput,
} from '../contracts';
import {
  fieldContainsSearch,
  normalizeSearchField,
  validateCreateInput,
  validateQuery,
  validateUpdateInput,
  type ValidatedTags,
} from '../domain';
import { PersistentImageStore, isSafeAppImagePath } from './PersistentImageStore';

const DATABASE_NAME = 'tuck.db';
const SCHEMA_VERSION = 1;

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
};

type JoinedItemRow = ItemRow & {
  tag_key: string | null;
  tag_display: string | null;
  tag_ordinal: number | null;
};

type TagRow = { tag_key: string; tag_display: string; tag_ordinal: number };
type VersionRow = { user_version: number };
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

function conflictError(): AppError {
  return { code: 'CONFLICT', message: 'This item changed since it was opened. Reload it and try again.' };
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
export class SQLiteItemRepository implements ItemRepository {
  private db: Db | null = null;
  private initialized = false;
  private readonly databaseName: string;
  private readonly now: () => number;
  private readonly createId: () => string;
  private operationTail: Promise<void> = Promise.resolve();

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

        const prepared = this.imageStore.prepare();
        if (!prepared.ok) return { ok: false, error: initError(prepared.error.message) };

        const cleanup = await this.retryPendingFileCleanupUnsafe(db);
        if (!cleanup.ok) return { ok: false, error: initError(cleanup.error.message) };

        const reconcile = await this.reconcileUnreferencedImages(db);
        if (!reconcile.ok) return { ok: false, error: initError(reconcile.error.message) };

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
        const whereType = validated.value.type === 'all' ? '' : ' AND i.type = ?';
        const params = validated.value.type === 'all'
          ? [validated.value.archived ? 1 : 0]
          : [validated.value.archived ? 1 : 0, validated.value.type];
        const rows = await database.value.getAllAsync<JoinedItemRow>(
          `SELECT i.id, i.type, i.title, i.body, i.url, i.image_path, i.created_at, i.updated_at, i.archived,
                  t.tag_key, t.display AS tag_display, t.ordinal AS tag_ordinal
             FROM items i
             LEFT JOIN item_tags t ON t.item_id = i.id
            WHERE i.archived = ?${whereType}
            ORDER BY i.updated_at DESC, i.id ASC, t.ordinal ASC`,
          params,
        );

        const grouped = new Map<string, { row: ItemRow; tags: string[]; tagKeys: string[] }>();
        for (const row of rows) {
          let group = grouped.get(row.id);
          if (!group) {
            group = { row, tags: [], tagKeys: [] };
            grouped.set(row.id, group);
          }
          if (row.tag_display !== null && row.tag_key !== null) {
            group.tags.push(row.tag_display);
            group.tagKeys.push(row.tag_key);
          }
        }

        const result: SavedItem[] = [];
        for (const group of grouped.values()) {
          const item = rowToSavedItem(group.row, group.tags);
          if (validated.value.tagKey !== null && !group.tagKeys.includes(validated.value.tagKey)) continue;
          if (!matchesText(item, validated.value.textKey)) continue;
          result.push(item);
        }
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
      const created: SavedItem = value.type === 'note'
        ? { id, type: 'note', title: value.title, body: value.body, url: null, imagePath: null, tags: value.tags.display, createdAt: timestamp, updatedAt: timestamp, archived: false }
        : value.type === 'link'
          ? { id, type: 'link', title: value.title, body: null, url: value.url, imagePath: null, tags: value.tags.display, createdAt: timestamp, updatedAt: timestamp, archived: false }
          : { id, type: 'image', title: value.title, body: value.caption, url: null, imagePath: newImagePath!, tags: value.tags.display, createdAt: timestamp, updatedAt: timestamp, archived: false };

      try {
        await db.withExclusiveTransactionAsync(async tx => {
          await tx.runAsync(
            `INSERT INTO items (id, type, title, body, url, image_path, created_at, updated_at, archived)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
            id,
            value.type,
            value.title,
            body,
            url,
            newImagePath,
            timestamp,
            timestamp,
          );
          await insertTags(tx, id, value.tags);
        });
      } catch {
        if (newImagePath) await this.cleanupUnreferencedCopy(db, newImagePath);
        return { ok: false, error: dbError('Could not save the item.') };
      }

      await this.retryPendingFileCleanupUnsafe(db);
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
          let tags = currentTags;

          if (changes.title !== undefined) title = changes.title;
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
                SET title = ?, body = ?, url = ?, image_path = ?, updated_at = ?
              WHERE id = ?`,
            title,
            body,
            url,
            imagePath,
            timestamp,
            validated.value.id,
          );

          if (changes.tags !== undefined) {
            await replaceTags(tx, validated.value.id, changes.tags);
            tags = changes.tags.display;
          }
          committedItem = rowToSavedItem({ ...current, title, body, url, image_path: imagePath, updated_at: timestamp }, tags);
        });
      } catch (error) {
        if (replacementPath) await this.cleanupUnreferencedCopy(db, replacementPath);
        if (error instanceof RepositoryAbort) return { ok: false, error: error.appError };
        return { ok: false, error: dbError('Could not update the item.') };
      }

      if (!committedItem) return { ok: false, error: dbError('Update did not produce a committed item.') };
      if (oldImagePath) await this.removeQueuedPath(db, oldImagePath);
      await this.retryPendingFileCleanupUnsafe(db);
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
      await this.retryPendingFileCleanupUnsafe(db);
      return { ok: true, value: committedItem };
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
      await this.retryPendingFileCleanupUnsafe(db);
      return { ok: true, value: undefined };
    });
  }

  retryPendingFileCleanup(): Promise<Result<{ remaining: number }>> {
    return this.serialized(async () => {
      const database = this.requireDb();
      if (!database.ok) return database;
      return this.retryPendingFileCleanupUnsafe(database.value);
    });
  }

  private async migrate(db: Db): Promise<void> {
    const row = await db.getFirstAsync<VersionRow>('PRAGMA user_version');
    const version = row?.user_version ?? 0;
    if (version > SCHEMA_VERSION) throw new Error('Database schema is newer than this app supports.');

    if (version < 1) {
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

          PRAGMA user_version = 1;
        `);
      });
    }
  }

  private async getItemRow(db: Tx, id: ItemId): Promise<ItemRow | null> {
    return db.getFirstAsync<ItemRow>(
      `SELECT id, type, title, body, url, image_path, created_at, updated_at, archived
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
