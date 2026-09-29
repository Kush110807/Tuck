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
import {
  SYNC_PROTOCOL_VERSION,
  type CanonicalCollection,
  type CanonicalItem,
  type ChangeSequence,
  type SyncChange,
  type SyncEntityType,
  type SyncMutation,
} from '../sync/protocol';
import { isCanonicalMutationUuid, validateSyncMutationV1 } from '../sync/validation';
import type {
  DurableOutboxMutation,
  LocalBootstrapCheckpointUpdate,
  LocalEntitySyncState,
  LocalSyncCheckpoint,
  LocalSyncProfile,
  LocalSyncRepository,
} from '../sync/localState';

const DATABASE_NAME = 'tuck.db';
const SCHEMA_VERSION = 3;

type Db = SQLite.SQLiteDatabase;
type Tx = SQLite.SQLiteDatabase;

type ItemRow = {
  id: string;
  type: 'note' | 'link' | 'image';
  title: string;
  body: string | null;
  url: string | null;
  image_path: string | null;
  asset_id: string | null;
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

type SyncProfileRow = {
  profile_kind: 'local-only' | 'account';
  account_id: string | null;
  device_id: string;
  sync_enabled: number;
};
type SyncEntityStateRow = {
  entity_type: 'item' | 'collection';
  entity_id: string;
  local_revision: number;
  server_version: number | null;
  last_synced_local_revision: number | null;
};
type SyncStateRow = {
  pull_cursor: number;
  minimum_retained_sequence: number;
  initial_sync_state: LocalSyncCheckpoint['initialSyncState'];
  bootstrap_session_id: string | null;
  bootstrap_after_ordinal: number | null;
  bootstrap_snapshot_head_sequence: number | null;
  catchup_target_head_sequence: number | null;
  last_successful_sync_at: number | null;
};
type OutboxRow = {
  position: number;
  mutation_id: string;
  entity_type: 'item' | 'collection';
  entity_id: string;
  action: 'create' | 'patch' | 'delete';
  base_server_version: number | null;
  changed_fields_json: string;
  base_values_json: string;
  new_values_json: string;
  created_local_revision: number;
  depends_on_asset_id: string | null;
  state: 'queued' | 'blocked';
  attempt_count: number;
  last_error_code: string | null;
  queued_at: number;
};
type PendingEntityOutboxRow = OutboxRow;
type AssetSyncStateRow = {
  asset_id: string;
  local_state: string;
  remote_state: string;
  upload_state: string;
  remote_mime_type: string | null;
  remote_byte_size: number | null;
};

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

export type SQLiteInitialSyncProfile =
  | Readonly<{ kind: 'local-only'; deviceId?: string }>
  | Readonly<{ kind: 'account'; accountId: string; deviceId?: string; syncEnabled?: boolean }>;

export type SQLiteItemRepositoryOptions = Readonly<{
  databaseName?: string;
  now?: () => number;
  /** Domain entity IDs. Preserved separately from sync/mutation/asset IDs for deterministic tests. */
  createId?: () => string;
  /** Mutation/device/asset UUID source. */
  createSyncId?: () => string;
  /** Used only when creating a brand-new v3 database; existing v1/v2 installs migrate local-only. */
  initialSyncProfile?: SQLiteInitialSyncProfile;
}>;

/** SQLite implementation of the frozen ItemRepository contract plus Phase 6C local sync persistence. */
export class SQLiteItemRepository implements ItemRepository, OrganisationRepository, LocalSyncRepository {
  private db: Db | null = null;
  private initialized = false;
  private readonly databaseName: string;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly createSyncId: () => string;
  private readonly initialSyncProfile: SQLiteInitialSyncProfile | undefined;
  private operationTail: Promise<void> = Promise.resolve();
  private reconciliationPending = true;

  constructor(
    private readonly imageStore: PersistentImageStore,
    options: SQLiteItemRepositoryOptions = {},
  ) {
    this.databaseName = options.databaseName ?? (options.initialSyncProfile?.kind === 'account'
      ? `tuck-account-${options.initialSyncProfile.accountId.replace(/[^A-Za-z0-9._-]/g, '_')}.db`
      : DATABASE_NAME);
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? createUuid;
    this.createSyncId = options.createSyncId ?? createUuid;
    this.initialSyncProfile = options.initialSyncProfile;
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
        await this.verifyRequestedProfile(db);
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
          `SELECT i.id, i.type, i.title, i.body, i.url, i.image_path, i.asset_id, i.created_at, i.updated_at, i.archived,
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
      const assetId = value.type === 'image' ? this.createSyncId() : null;
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
            `INSERT INTO items (id, type, title, body, url, image_path, asset_id, created_at, updated_at, archived, collection_id, pinned)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0)`,
            id,
            value.type,
            value.title,
            body,
            url,
            newImagePath,
            assetId,
            timestamp,
            timestamp,
            value.collectionId,
          );
          await insertTags(tx, id, value.tags);
          const localRevision = await this.insertEntitySyncState(tx, 'item', id);
          const syncContext = await this.syncContext(tx);
          if (assetId) {
            await tx.runAsync(
              `INSERT INTO asset_sync_state (
                 asset_id, local_state, remote_state, upload_state, upload_attempt_count,
                 download_attempt_count, last_error_code, remote_cleanup_pending
               ) VALUES (?, 'available', 'unknown', ?, 0, 0, NULL, 0)`,
              assetId,
              syncContext ? 'pending' : 'not_scheduled',
            );
          }
          if (syncContext) {
            const row: ItemRow = {
              id,
              type: value.type,
              title: value.title,
              body,
              url,
              image_path: newImagePath,
              asset_id: assetId,
              created_at: timestamp,
              updated_at: timestamp,
              archived: 0,
              collection_id: value.collectionId,
              pinned: 0,
            };
            await this.queueCreateMutation(
              tx,
              'item',
              id,
              localRevision,
              this.itemCreateValues(row, value.tags.display),
              assetId,
            );
          }
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
      const replacementAssetId = replacementPath ? this.createSyncId() : null;
      let committedItem: SavedItem | null = null;
      try {
        await db.withExclusiveTransactionAsync(async tx => {
          const current = await this.getItemRow(tx, validated.value.id);
          if (!current) throw new RepositoryAbort(notFoundError());
          if (current.updated_at !== validated.value.expectedUpdatedAt) throw new RepositoryAbort(conflictError());
          if (current.type !== validated.value.type) throw new RepositoryAbort(validationError('Item type cannot change.'));

          const changes = validated.value.changes;
          const currentTags = await this.getTags(tx, validated.value.id);
          const requestedFields = Object.keys(changes);
          if (requestedFields.length === 0) {
            committedItem = rowToSavedItem(current, currentTags);
            return;
          }
          const timestamp = nextTimestamp(current.updated_at, this.now());
          let title = current.title;
          let body = current.body;
          let url = current.url;
          let imagePath = current.image_path;
          let assetId = current.asset_id;
          let collectionId = current.collection_id;
          let tags = currentTags;
          const changedFields: string[] = [];

          if (changes.title !== undefined) { title = changes.title; changedFields.push('title'); }
          if (changes.collectionId !== undefined) {
            if (changes.collectionId !== null && !(await this.getCollectionRow(tx, changes.collectionId))) {
              throw new RepositoryAbort(collectionNotFoundError());
            }
            collectionId = changes.collectionId;
            changedFields.push('collectionId');
          }
          if (validated.value.type === 'note' && validated.value.changes.body !== undefined) {
            body = validated.value.changes.body;
            changedFields.push('body');
          }
          if (validated.value.type === 'link' && validated.value.changes.url !== undefined) {
            url = validated.value.changes.url;
            changedFields.push('url');
          }
          if (validated.value.type === 'image') {
            if (validated.value.changes.caption !== undefined) { body = validated.value.changes.caption; changedFields.push('body'); }
            if (replacementPath) {
              if (!current.image_path || !replacementAssetId) throw new RepositoryAbort(validationError('Image item has no stored image.'));
              oldImagePath = current.image_path;
              imagePath = replacementPath;
              assetId = replacementAssetId;
              changedFields.push('assetId');
              await this.queueDeletion(tx, oldImagePath);
            }
          }
          if (changes.tags !== undefined) changedFields.push('tags');
          changedFields.push('updatedAt');

          await tx.runAsync(
            `UPDATE items
                SET title = ?, body = ?, url = ?, image_path = ?, asset_id = ?, collection_id = ?, updated_at = ?
              WHERE id = ?`,
            title,
            body,
            url,
            imagePath,
            assetId,
            collectionId,
            timestamp,
            validated.value.id,
          );

          if (changes.tags !== undefined) {
            await replaceTags(tx, validated.value.id, changes.tags);
            tags = changes.tags.display;
          }
          const nextRow: ItemRow = {
            ...current,
            title,
            body,
            url,
            image_path: imagePath,
            asset_id: assetId,
            collection_id: collectionId,
            updated_at: timestamp,
          };
          const revisionState = await this.bumpEntityRevision(tx, 'item', validated.value.id);
          if (replacementAssetId) {
            const syncContext = await this.syncContext(tx);
            await tx.runAsync(
              `INSERT INTO asset_sync_state (
                 asset_id, local_state, remote_state, upload_state, upload_attempt_count,
                 download_attempt_count, last_error_code, remote_cleanup_pending
               ) VALUES (?, 'available', 'unknown', ?, 0, 0, NULL, 0)`,
              replacementAssetId,
              syncContext ? 'pending' : 'not_scheduled',
            );
          }
          await this.queuePatchMutation(
            tx,
            'item',
            validated.value.id,
            revisionState,
            changedFields,
            this.itemCreateValues(current, currentTags),
            this.itemCreateValues(nextRow, tags),
            assetId,
          );
          committedItem = rowToSavedItem(nextRow, tags);
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
          const nextRow: ItemRow = { ...current, archived: archived ? 1 : 0, updated_at: timestamp };
          const revisionState = await this.bumpEntityRevision(tx, 'item', id);
          await this.queuePatchMutation(
            tx,
            'item',
            id,
            revisionState,
            ['archived', 'updatedAt'],
            this.itemCreateValues(current, tags),
            this.itemCreateValues(nextRow, tags),
            nextRow.asset_id,
          );
          committedItem = rowToSavedItem(nextRow, tags);
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
          const nextRow: ItemRow = { ...current, pinned: pinned ? 1 : 0 };
          const revisionState = await this.bumpEntityRevision(tx, 'item', id);
          await this.queuePatchMutation(
            tx,
            'item',
            id,
            revisionState,
            ['pinned'],
            this.itemCreateValues(current, tags),
            this.itemCreateValues(nextRow, tags),
            nextRow.asset_id,
          );
          committedItem = rowToSavedItem(nextRow, tags);
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
          const row: CollectionRow = {
            id,
            name: validated.value.name,
            name_key: validated.value.nameKey,
            created_at: timestamp,
            updated_at: timestamp,
          };
          const localRevision = await this.insertEntitySyncState(tx, 'collection', id);
          await this.queueCreateMutation(tx, 'collection', id, localRevision, this.collectionCreateValues(row));
          committed = rowToCollection(row);
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
          const nextRow: CollectionRow = { ...current, name: validated.value.name, name_key: validated.value.nameKey, updated_at: timestamp };
          const revisionState = await this.bumpEntityRevision(tx, 'collection', id);
          await this.queuePatchMutation(
            tx,
            'collection',
            id,
            revisionState,
            ['name', 'updatedAt'],
            this.collectionCreateValues(current),
            this.collectionCreateValues(nextRow),
          );
          committed = rowToCollection(nextRow);
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
          const affectedItems = await tx.getAllAsync<{ id: string }>(
            'SELECT id FROM items WHERE collection_id = ? ORDER BY id',
            id,
          );
          for (const item of affectedItems) await this.bumpEntityRevision(tx, 'item', item.id);
          const revisionState = await this.bumpEntityRevision(tx, 'collection', id);
          const pendingMutationId = await this.queueDeleteMutation(tx, 'collection', id, revisionState);
          await this.insertOrReplaceLocalTombstone(
            tx,
            'collection',
            id,
            revisionState.local_revision,
            revisionState.server_version,
            pendingMutationId,
          );
          // ON DELETE SET NULL preserves items and intentionally does not rewrite item updated_at.
          await tx.runAsync('DELETE FROM collections WHERE id = ?', id);
          await tx.runAsync("DELETE FROM sync_entity_state WHERE entity_type = 'collection' AND entity_id = ?", id);
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
          const revisionState = await this.bumpEntityRevision(tx, 'item', id);
          const pendingMutationId = await this.queueDeleteMutation(tx, 'item', id, revisionState);
          await this.insertOrReplaceLocalTombstone(
            tx,
            'item',
            id,
            revisionState.local_revision,
            revisionState.server_version,
            pendingMutationId,
          );
          await tx.runAsync('DELETE FROM items WHERE id = ?', id);
          await tx.runAsync("DELETE FROM sync_entity_state WHERE entity_type = 'item' AND entity_id = ?", id);
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

  getLocalSyncProfile(): Promise<Result<LocalSyncProfile>> {
    return this.serialized(async () => {
      const database = this.requireDb();
      if (!database.ok) return database;
      try {
        const row = await this.getSyncProfileRow(database.value);
        if (!row) return { ok: false, error: dbError('Sync profile is missing.') };
        return {
          ok: true,
          value: {
            profileKind: row.profile_kind,
            accountId: row.account_id,
            deviceId: row.device_id,
            syncEnabled: row.sync_enabled === 1,
          },
        };
      } catch {
        return { ok: false, error: dbError('Could not load local sync profile.') };
      }
    });
  }

  getLocalSyncCheckpoint(): Promise<Result<LocalSyncCheckpoint>> {
    return this.serialized(async () => {
      const database = this.requireDb();
      if (!database.ok) return database;
      try {
        const row = await database.value.getFirstAsync<SyncStateRow>(
          `SELECT pull_cursor, minimum_retained_sequence, initial_sync_state,
                  bootstrap_session_id, bootstrap_after_ordinal, bootstrap_snapshot_head_sequence,
                  catchup_target_head_sequence, last_successful_sync_at
             FROM sync_state WHERE singleton = 1`,
        );
        if (!row) return { ok: false, error: dbError('Local sync checkpoint is missing.') };
        return {
          ok: true,
          value: {
            pullCursor: row.pull_cursor,
            minimumRetainedSequence: row.minimum_retained_sequence,
            initialSyncState: row.initial_sync_state,
            bootstrapSessionId: row.bootstrap_session_id,
            bootstrapAfterOrdinal: row.bootstrap_after_ordinal,
            bootstrapSnapshotHeadSequence: row.bootstrap_snapshot_head_sequence,
            catchupTargetHeadSequence: row.catchup_target_head_sequence,
            lastSuccessfulSyncAt: row.last_successful_sync_at,
          },
        };
      } catch {
        return { ok: false, error: dbError('Could not load local sync checkpoint.') };
      }
    });
  }

  getEntitySyncState(entityType: SyncEntityType, entityId: string): Promise<Result<LocalEntitySyncState>> {
    return this.serialized(async () => {
      if ((entityType !== 'item' && entityType !== 'collection') || typeof entityId !== 'string' || !entityId) {
        return { ok: false, error: validationError('Sync entity identity is invalid.') };
      }
      const database = this.requireDb();
      if (!database.ok) return database;
      try {
        const row = await this.getSyncEntityStateRow(database.value, entityType, entityId);
        if (!row) return { ok: false, error: { code: 'NOT_FOUND', message: 'Sync entity state was not found.' } };
        return {
          ok: true,
          value: {
            entityType: row.entity_type,
            entityId: row.entity_id,
            localRevision: row.local_revision,
            serverVersion: row.server_version,
            lastSyncedLocalRevision: row.last_synced_local_revision,
          },
        };
      } catch {
        return { ok: false, error: dbError('Could not load sync entity state.') };
      }
    });
  }

  listDurableOutbox(limit = 100): Promise<Result<readonly DurableOutboxMutation[]>> {
    return this.serialized(async () => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
        return { ok: false, error: validationError('Outbox limit must be between 1 and 500.') };
      }
      const database = this.requireDb();
      if (!database.ok) return database;
      try {
        const profile = await this.getSyncProfileRow(database.value);
        if (!profile) return { ok: false, error: dbError('Sync profile is missing.') };
        const rows = await database.value.getAllAsync<OutboxRow>(
          `SELECT position, mutation_id, entity_type, entity_id, action, base_server_version,
                  changed_fields_json, base_values_json, new_values_json, created_local_revision,
                  depends_on_asset_id, state, attempt_count, last_error_code, queued_at
             FROM sync_outbox ORDER BY position ASC LIMIT ?`,
          limit,
        );
        if (rows.length === 0) return { ok: true, value: [] };
        if (profile.profile_kind !== 'account' || !profile.account_id) {
          return { ok: false, error: dbError('Local-only profile unexpectedly contains sync outbox rows.') };
        }
        const entries: DurableOutboxMutation[] = [];
        for (const row of rows) {
          const candidate = {
            protocolVersion: SYNC_PROTOCOL_VERSION,
            accountId: profile.account_id,
            mutationId: row.mutation_id,
            originDeviceId: profile.device_id,
            entityType: row.entity_type,
            entityId: row.entity_id,
            action: row.action,
            baseServerVersion: row.base_server_version,
            changedFields: JSON.parse(row.changed_fields_json),
            baseValues: JSON.parse(row.base_values_json),
            newValues: JSON.parse(row.new_values_json),
          };
          const validated = validateSyncMutationV1(candidate, profile.account_id);
          if (!validated.ok) throw new Error(`Persisted outbox mutation is invalid: ${validated.message}`);
          entries.push({
            position: row.position,
            mutation: validated.value,
            createdLocalRevision: row.created_local_revision,
            dependsOnAssetId: row.depends_on_asset_id,
            state: row.state,
            attemptCount: row.attempt_count,
            lastErrorCode: row.last_error_code,
            queuedAt: row.queued_at,
          });
        }
        return { ok: true, value: entries };
      } catch {
        return { ok: false, error: dbError('Could not load durable sync outbox.') };
      }
    });
  }

  updateBootstrapCheckpoint(update: LocalBootstrapCheckpointUpdate): Promise<Result<void>> {
    return this.serialized(async () => {
      const database = this.requireDb();
      if (!database.ok) return database;
      try {
        const current = await database.value.getFirstAsync<SyncStateRow>(
          `SELECT pull_cursor, minimum_retained_sequence, initial_sync_state,
                  bootstrap_session_id, bootstrap_after_ordinal, bootstrap_snapshot_head_sequence,
                  catchup_target_head_sequence, last_successful_sync_at
             FROM sync_state WHERE singleton = 1`,
        );
        if (!current) return { ok: false, error: dbError('Local sync checkpoint is missing.') };
        const next = {
          initialSyncState: update.initialSyncState,
          bootstrapSessionId: update.bootstrapSessionId === undefined ? current.bootstrap_session_id : update.bootstrapSessionId,
          bootstrapAfterOrdinal: update.bootstrapAfterOrdinal === undefined ? current.bootstrap_after_ordinal : update.bootstrapAfterOrdinal,
          bootstrapSnapshotHeadSequence: update.bootstrapSnapshotHeadSequence === undefined
            ? current.bootstrap_snapshot_head_sequence
            : update.bootstrapSnapshotHeadSequence,
          catchupTargetHeadSequence: update.catchupTargetHeadSequence === undefined
            ? current.catchup_target_head_sequence
            : update.catchupTargetHeadSequence,
        };
        await database.value.withExclusiveTransactionAsync(async tx => {
          await tx.runAsync(
            `UPDATE sync_state
                SET initial_sync_state = ?, bootstrap_session_id = ?, bootstrap_after_ordinal = ?,
                    bootstrap_snapshot_head_sequence = ?, catchup_target_head_sequence = ?
              WHERE singleton = 1`,
            next.initialSyncState,
            next.bootstrapSessionId,
            next.bootstrapAfterOrdinal,
            next.bootstrapSnapshotHeadSequence,
            next.catchupTargetHeadSequence,
          );
        });
        return { ok: true, value: undefined };
      } catch {
        return { ok: false, error: dbError('Could not persist bootstrap checkpoint.') };
      }
    });
  }

  applyRemoteChanges(
    changes: readonly SyncChange[],
    nextPullCursor: ChangeSequence,
    minimumRetainedSequence?: ChangeSequence,
  ): Promise<Result<void>> {
    return this.serialized(async () => {
      if (!Number.isSafeInteger(nextPullCursor) || nextPullCursor < 0 ||
          (minimumRetainedSequence !== undefined && (!Number.isSafeInteger(minimumRetainedSequence) || minimumRetainedSequence < 1))) {
        return { ok: false, error: validationError('Remote apply checkpoint is invalid.') };
      }
      const database = this.requireDb();
      if (!database.ok) return database;
      const db = database.value;
      try {
        await db.withExclusiveTransactionAsync(async tx => {
          const context = await this.syncContext(tx);
          if (!context) throw new RepositoryAbort(validationError('Remote apply requires an enabled account profile.'));
          const checkpoint = await tx.getFirstAsync<SyncStateRow>(
            `SELECT pull_cursor, minimum_retained_sequence, initial_sync_state,
                    bootstrap_session_id, bootstrap_after_ordinal, bootstrap_snapshot_head_sequence,
                    catchup_target_head_sequence, last_successful_sync_at
               FROM sync_state WHERE singleton = 1`,
          );
          if (!checkpoint) throw new Error('Local sync checkpoint is missing.');
          if (nextPullCursor < checkpoint.pull_cursor) throw new RepositoryAbort(conflictError());

          let previousSequence = checkpoint.pull_cursor;
          for (const change of changes) {
            if (!Number.isSafeInteger(change.sequence) || change.sequence <= previousSequence || change.sequence > nextPullCursor) {
              throw new RepositoryAbort(validationError('Remote changes are not in valid sequence order.'));
            }
            previousSequence = change.sequence;
            if (change.entityType === 'asset') {
              if (change.kind !== 'upsert' || change.payload.entityType !== 'asset') {
                throw new RepositoryAbort(validationError('Protocol v1 does not apply Asset delete changes locally.'));
              }
              const asset = change.payload.entity;
              const existing = await tx.getFirstAsync<AssetSyncStateRow>(
                `SELECT asset_id, local_state, remote_state, upload_state, remote_mime_type, remote_byte_size
                   FROM asset_sync_state WHERE asset_id = ?`,
                asset.id,
              );
              await tx.runAsync(
                `INSERT INTO asset_sync_state (
                   asset_id, local_state, remote_state, upload_state, upload_attempt_count,
                   download_attempt_count, last_error_code, remote_mime_type, remote_byte_size, remote_cleanup_pending
                 ) VALUES (?, ?, ?, 'not_required', 0, 0, NULL, ?, ?, 0)
                 ON CONFLICT(asset_id) DO UPDATE SET
                   remote_state = excluded.remote_state,
                   remote_mime_type = excluded.remote_mime_type,
                   remote_byte_size = excluded.remote_byte_size`,
                asset.id,
                existing?.local_state ?? 'remote_known_not_downloaded',
                asset.remoteState,
                asset.mimeType,
                asset.byteSize,
              );
              continue;
            }

            const pending = await tx.getFirstAsync<CountRow>(
              'SELECT COUNT(*) AS count FROM sync_outbox WHERE entity_type = ? AND entity_id = ?',
              change.entityType,
              change.entityId,
            );
            if ((pending?.count ?? 0) > 0) {
              throw new RepositoryAbort({ code: 'CONFLICT', message: 'Remote apply cannot overwrite pending authored work.' });
            }

            const tombstone = await tx.getFirstAsync<{ server_version: number | null }>(
              'SELECT server_version FROM sync_local_tombstones WHERE entity_type = ? AND entity_id = ?',
              change.entityType,
              change.entityId,
            );
            if (change.kind === 'upsert' && tombstone) {
              throw new RepositoryAbort({ code: 'CONFLICT', message: 'Remote upsert would resurrect a locally tombstoned entity.' });
            }

            if (change.kind === 'delete') {
              if (!('deletedVersion' in change.payload) || change.payload.entityType !== change.entityType) {
                throw new RepositoryAbort(validationError('Remote tombstone entity type does not match change envelope.'));
              }
              const tombstonePayload = change.payload;
              const priorState = await this.getSyncEntityStateRow(tx, change.entityType, change.entityId);
              const localRevision = (priorState?.local_revision ?? 0) + 1;
              if (change.entityType === 'item') {
                const item = await this.getItemRow(tx, change.entityId);
                if (item?.type === 'image' && item.image_path) await this.queueDeletion(tx, item.image_path as RelativeImagePath);
                await tx.runAsync('DELETE FROM items WHERE id = ?', change.entityId);
              } else {
                await tx.runAsync('DELETE FROM collections WHERE id = ?', change.entityId);
              }
              await this.insertOrReplaceLocalTombstone(
                tx,
                change.entityType,
                change.entityId,
                localRevision,
                tombstonePayload.deletedVersion,
                null,
              );
              await tx.runAsync(
                'DELETE FROM sync_entity_state WHERE entity_type = ? AND entity_id = ?',
                change.entityType,
                change.entityId,
              );
              continue;
            }

            if (!('entity' in change.payload) || change.payload.entityType !== change.entityType) {
              throw new RepositoryAbort(validationError('Remote entity type does not match change envelope.'));
            }
            const upsertPayload = change.payload;
            if (change.entityType === 'collection') {
              const collection = upsertPayload.entity as CanonicalCollection;
              const prior = await this.getSyncEntityStateRow(tx, 'collection', collection.id);
              if (prior?.server_version !== null && prior?.server_version !== undefined && prior.server_version >= collection.version) continue;
              await tx.runAsync(
                `INSERT INTO collections (id, name, name_key, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                   name = excluded.name, name_key = excluded.name_key, updated_at = excluded.updated_at`,
                collection.id,
                collection.name,
                collection.nameKey,
                collection.createdAt,
                collection.updatedAt,
              );
              const localRevision = (prior?.local_revision ?? 0) + 1;
              await tx.runAsync(
                `INSERT INTO sync_entity_state (entity_type, entity_id, local_revision, server_version, last_synced_local_revision)
                 VALUES ('collection', ?, ?, ?, ?)
                 ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                   local_revision = excluded.local_revision,
                   server_version = excluded.server_version,
                   last_synced_local_revision = excluded.last_synced_local_revision`,
                collection.id,
                localRevision,
                collection.version,
                localRevision,
              );
              continue;
            }

            const item = upsertPayload.entity as CanonicalItem;
            const prior = await this.getSyncEntityStateRow(tx, 'item', item.id);
            if (prior?.server_version !== null && prior?.server_version !== undefined && prior.server_version >= item.version) continue;
            if (item.collectionId !== null && !(await this.getCollectionRow(tx, item.collectionId))) {
              throw new RepositoryAbort(validationError('Remote Item references a Collection not yet applied.'));
            }
            const existing = await this.getItemRow(tx, item.id);
            let imagePath: string | null = null;
            if (item.type === 'image') {
              if (!item.assetId) throw new RepositoryAbort(validationError('Remote image Item is missing assetId.'));
              imagePath = existing?.type === 'image' && existing.asset_id === item.assetId && existing.image_path
                ? existing.image_path
                : (`images/remote-${item.assetId.replace(/[^A-Za-z0-9._-]/g, '_')}.jpg`);
              await tx.runAsync(
                `INSERT INTO asset_sync_state (
                   asset_id, local_state, remote_state, upload_state, upload_attempt_count,
                   download_attempt_count, last_error_code, remote_cleanup_pending
                 ) VALUES (?, 'remote_known_not_downloaded', 'unknown', 'not_required', 0, 0, NULL, 0)
                 ON CONFLICT(asset_id) DO NOTHING`,
                item.assetId,
              );
            } else if (item.assetId !== null) {
              throw new RepositoryAbort(validationError('Remote non-image Item must not contain assetId.'));
            }
            await tx.runAsync(
              `INSERT INTO items (
                 id, type, title, body, url, image_path, asset_id, created_at, updated_at,
                 archived, collection_id, pinned
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 type = excluded.type,
                 title = excluded.title,
                 body = excluded.body,
                 url = excluded.url,
                 image_path = excluded.image_path,
                 asset_id = excluded.asset_id,
                 updated_at = excluded.updated_at,
                 archived = excluded.archived,
                 collection_id = excluded.collection_id,
                 pinned = excluded.pinned`,
              item.id,
              item.type,
              item.title,
              item.body,
              item.url,
              imagePath,
              item.assetId,
              item.createdAt,
              item.updatedAt,
              item.archived ? 1 : 0,
              item.collectionId,
              item.pinned ? 1 : 0,
            );
            await tx.runAsync('DELETE FROM item_tags WHERE item_id = ?', item.id);
            for (let ordinal = 0; ordinal < item.tags.length; ordinal += 1) {
              const display = item.tags[ordinal];
              await tx.runAsync(
                'INSERT INTO item_tags (item_id, tag_key, display, ordinal) VALUES (?, ?, ?, ?)',
                item.id,
                toComparisonKey(display),
                display,
                ordinal,
              );
            }
            const localRevision = (prior?.local_revision ?? 0) + 1;
            await tx.runAsync(
              `INSERT INTO sync_entity_state (entity_type, entity_id, local_revision, server_version, last_synced_local_revision)
               VALUES ('item', ?, ?, ?, ?)
               ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                 local_revision = excluded.local_revision,
                 server_version = excluded.server_version,
                 last_synced_local_revision = excluded.last_synced_local_revision`,
              item.id,
              localRevision,
              item.version,
              localRevision,
            );
          }

          await tx.runAsync(
            `UPDATE sync_state
                SET pull_cursor = ?, minimum_retained_sequence = ?, last_successful_sync_at = ?
              WHERE singleton = 1`,
            nextPullCursor,
            minimumRetainedSequence ?? checkpoint.minimum_retained_sequence,
            this.now(),
          );
        });
        await this.runImageMaintenanceBestEffort(db);
        return { ok: true, value: undefined };
      } catch (error) {
        if (error instanceof RepositoryAbort) return { ok: false, error: error.appError };
        return { ok: false, error: dbError('Could not apply remote sync changes.') };
      }
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
    const startingVersion = version;
    if (version > SCHEMA_VERSION) throw new Error('Database schema is newer than this app supports.');

    if (version === 0) {
      await this.migrateV0ToV1(db);
      version = 1;
    }
    if (version === 1) {
      await this.migrateV1ToV2(db);
      version = 2;
    }
    if (version === 2) {
      // Only a brand-new database may be born directly as an account profile.
      // Existing v1/v2 installations always migrate as local-only, per the frozen Phase 6A contract.
      await this.migrateV2ToV3(db, startingVersion === 0 ? this.initialSyncProfile : undefined);
      version = 3;
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

  private async migrateV2ToV3(db: Db, initialProfile?: SQLiteInitialSyncProfile): Promise<void> {
    await db.withExclusiveTransactionAsync(async tx => {
      await tx.execAsync(`
        ALTER TABLE items ADD COLUMN asset_id TEXT;
        CREATE INDEX idx_items_asset_id ON items(asset_id) WHERE asset_id IS NOT NULL;

        CREATE TABLE sync_profile (
          singleton INTEGER PRIMARY KEY NOT NULL DEFAULT 1 CHECK (singleton = 1),
          profile_kind TEXT NOT NULL CHECK (profile_kind IN ('local-only', 'account')),
          account_id TEXT,
          device_id TEXT NOT NULL,
          sync_enabled INTEGER NOT NULL DEFAULT 0 CHECK (sync_enabled IN (0, 1)),
          CHECK (
            (profile_kind = 'local-only' AND account_id IS NULL AND sync_enabled = 0) OR
            (profile_kind = 'account' AND account_id IS NOT NULL)
          )
        );

        CREATE TABLE sync_entity_state (
          entity_type TEXT NOT NULL CHECK (entity_type IN ('item', 'collection')),
          entity_id TEXT NOT NULL,
          local_revision INTEGER NOT NULL CHECK (local_revision >= 1),
          server_version INTEGER CHECK (server_version IS NULL OR server_version >= 1),
          last_synced_local_revision INTEGER CHECK (last_synced_local_revision IS NULL OR last_synced_local_revision >= 1),
          PRIMARY KEY (entity_type, entity_id)
        );
        CREATE INDEX idx_sync_entity_server_version
          ON sync_entity_state(entity_type, server_version, entity_id);

        CREATE TABLE sync_outbox (
          position INTEGER PRIMARY KEY AUTOINCREMENT,
          mutation_id TEXT NOT NULL UNIQUE,
          entity_type TEXT NOT NULL CHECK (entity_type IN ('item', 'collection')),
          entity_id TEXT NOT NULL,
          action TEXT NOT NULL CHECK (action IN ('create', 'patch', 'delete')),
          base_server_version INTEGER CHECK (
            (action = 'create' AND base_server_version IS NULL) OR
            (action IN ('patch', 'delete') AND base_server_version >= 1)
          ),
          changed_fields_json TEXT NOT NULL,
          base_values_json TEXT NOT NULL,
          new_values_json TEXT NOT NULL,
          created_local_revision INTEGER NOT NULL CHECK (created_local_revision >= 1),
          depends_on_asset_id TEXT,
          state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'blocked')),
          attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
          last_error_code TEXT,
          queued_at INTEGER NOT NULL CHECK (queued_at >= 0)
        );
        CREATE INDEX idx_sync_outbox_state_position ON sync_outbox(state, position);
        CREATE INDEX idx_sync_outbox_entity ON sync_outbox(entity_type, entity_id, position);
        CREATE INDEX idx_sync_outbox_asset_dependency
          ON sync_outbox(depends_on_asset_id, position) WHERE depends_on_asset_id IS NOT NULL;

        CREATE TABLE sync_state (
          singleton INTEGER PRIMARY KEY NOT NULL DEFAULT 1 CHECK (singleton = 1),
          pull_cursor INTEGER NOT NULL DEFAULT 0 CHECK (pull_cursor >= 0),
          minimum_retained_sequence INTEGER NOT NULL DEFAULT 1 CHECK (minimum_retained_sequence >= 1),
          initial_sync_state TEXT NOT NULL DEFAULT 'not_started' CHECK (
            initial_sync_state IN ('not_started', 'bootstrapping', 'catching_up', 'complete', 'rebootstrap_required')
          ),
          bootstrap_session_id TEXT,
          bootstrap_after_ordinal INTEGER CHECK (bootstrap_after_ordinal IS NULL OR bootstrap_after_ordinal >= 0),
          bootstrap_snapshot_head_sequence INTEGER CHECK (bootstrap_snapshot_head_sequence IS NULL OR bootstrap_snapshot_head_sequence >= 0),
          catchup_target_head_sequence INTEGER CHECK (catchup_target_head_sequence IS NULL OR catchup_target_head_sequence >= 0),
          last_successful_sync_at INTEGER CHECK (last_successful_sync_at IS NULL OR last_successful_sync_at >= 0)
        );

        CREATE TABLE sync_local_tombstones (
          entity_type TEXT NOT NULL CHECK (entity_type IN ('item', 'collection')),
          entity_id TEXT NOT NULL,
          local_revision INTEGER NOT NULL CHECK (local_revision >= 1),
          server_version INTEGER CHECK (server_version IS NULL OR server_version >= 1),
          pending_mutation_id TEXT,
          deleted_at_local INTEGER NOT NULL CHECK (deleted_at_local >= 0),
          PRIMARY KEY (entity_type, entity_id),
          FOREIGN KEY (pending_mutation_id) REFERENCES sync_outbox(mutation_id) ON DELETE SET NULL
        );

        CREATE TABLE asset_sync_state (
          asset_id TEXT PRIMARY KEY NOT NULL,
          local_state TEXT NOT NULL CHECK (
            local_state IN ('remote_known_not_downloaded', 'download_pending', 'available', 'download_failed', 'missing', 'corrupt')
          ),
          remote_state TEXT NOT NULL CHECK (remote_state IN ('unknown', 'staging', 'ready')),
          upload_state TEXT NOT NULL CHECK (upload_state IN ('not_scheduled', 'not_required', 'pending', 'failed', 'uploaded')),
          upload_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (upload_attempt_count >= 0),
          download_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (download_attempt_count >= 0),
          last_error_code TEXT,
          remote_mime_type TEXT CHECK (remote_mime_type IS NULL OR remote_mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
          remote_byte_size INTEGER CHECK (remote_byte_size IS NULL OR remote_byte_size >= 0),
          remote_cleanup_pending INTEGER NOT NULL DEFAULT 0 CHECK (remote_cleanup_pending IN (0, 1))
        );
        CREATE INDEX idx_asset_sync_upload ON asset_sync_state(upload_state, asset_id);
        CREATE INDEX idx_asset_sync_download ON asset_sync_state(local_state, asset_id);
      `);

      const profile = initialProfile ?? { kind: 'local-only' as const };
      const deviceId = profile.deviceId ?? this.createSyncId();
      if (typeof deviceId !== 'string' || !deviceId) throw new Error('Sync device ID is invalid.');
      if (profile.kind === 'account') {
        if (!profile.accountId) throw new Error('Account profile requires an account ID.');
        await tx.runAsync(
          'INSERT INTO sync_profile (singleton, profile_kind, account_id, device_id, sync_enabled) VALUES (1, ?, ?, ?, ?)',
          'account', profile.accountId, deviceId, profile.syncEnabled === false ? 0 : 1,
        );
      } else {
        await tx.runAsync(
          'INSERT INTO sync_profile (singleton, profile_kind, account_id, device_id, sync_enabled) VALUES (1, ?, NULL, ?, 0)',
          'local-only', deviceId,
        );
      }
      await tx.execAsync(`
        INSERT INTO sync_state (
          singleton, pull_cursor, minimum_retained_sequence, initial_sync_state
        ) VALUES (1, 0, 1, 'not_started');

        INSERT INTO sync_entity_state (entity_type, entity_id, local_revision, server_version, last_synced_local_revision)
          SELECT 'item', id, 1, NULL, NULL FROM items;
        INSERT INTO sync_entity_state (entity_type, entity_id, local_revision, server_version, last_synced_local_revision)
          SELECT 'collection', id, 1, NULL, NULL FROM collections;
      `);

      const images = await tx.getAllAsync<{ id: string }>("SELECT id FROM items WHERE type = 'image' ORDER BY id");
      for (const image of images) {
        const assetId = this.createSyncId();
        if (!assetId) throw new Error('Asset ID generation failed.');
        await tx.runAsync('UPDATE items SET asset_id = ? WHERE id = ?', assetId, image.id);
        await tx.runAsync(
          `INSERT INTO asset_sync_state (
             asset_id, local_state, remote_state, upload_state, upload_attempt_count, download_attempt_count, remote_cleanup_pending
           ) VALUES (?, 'available', 'unknown', 'not_scheduled', 0, 0, 0)`,
          assetId,
        );
      }

      const invalidAssetRows = await tx.getFirstAsync<CountRow>(
        `SELECT COUNT(*) AS count FROM items
          WHERE (type = 'image' AND asset_id IS NULL)
             OR (type <> 'image' AND asset_id IS NOT NULL)`,
      );
      if ((invalidAssetRows?.count ?? 0) !== 0) throw new Error('Schema v3 asset backfill failed.');

      await tx.execAsync(`
        CREATE TRIGGER items_asset_id_insert_guard
        BEFORE INSERT ON items
        FOR EACH ROW
        WHEN (
          (NEW.type = 'image' AND NEW.asset_id IS NULL) OR
          (NEW.type <> 'image' AND NEW.asset_id IS NOT NULL)
        )
        BEGIN
          SELECT RAISE(ABORT, 'asset_id must exist only for image items');
        END;

        CREATE TRIGGER items_asset_id_update_guard
        BEFORE UPDATE OF type, asset_id ON items
        FOR EACH ROW
        WHEN (
          (NEW.type = 'image' AND NEW.asset_id IS NULL) OR
          (NEW.type <> 'image' AND NEW.asset_id IS NOT NULL)
        )
        BEGIN
          SELECT RAISE(ABORT, 'asset_id must exist only for image items');
        END;
      `);

      const foreignKeyViolations = await tx.getAllAsync<ForeignKeyViolationRow>('PRAGMA foreign_key_check');
      if (foreignKeyViolations.length > 0) throw new Error('SQLite foreign_key_check failed during v3 migration.');
      await tx.execAsync('PRAGMA user_version = 3;');
    });
  }

  private async verifyRequestedProfile(db: Db): Promise<void> {
    if (!this.initialSyncProfile) return;
    const profile = await this.getSyncProfileRow(db);
    if (!profile) throw new Error('Sync profile is missing.');
    if (this.initialSyncProfile.kind === 'local-only') {
      if (profile.profile_kind !== 'local-only') throw new Error('Database belongs to an account profile.');
      return;
    }
    if (profile.profile_kind !== 'account' || profile.account_id !== this.initialSyncProfile.accountId) {
      throw new Error('Database belongs to a different sync profile.');
    }
  }

  private async getSyncProfileRow(db: Tx): Promise<SyncProfileRow | null> {
    return db.getFirstAsync<SyncProfileRow>(
      'SELECT profile_kind, account_id, device_id, sync_enabled FROM sync_profile WHERE singleton = 1',
    );
  }

  private async getSyncEntityStateRow(
    db: Tx,
    entityType: SyncEntityType,
    entityId: string,
  ): Promise<SyncEntityStateRow | null> {
    return db.getFirstAsync<SyncEntityStateRow>(
      `SELECT entity_type, entity_id, local_revision, server_version, last_synced_local_revision
         FROM sync_entity_state WHERE entity_type = ? AND entity_id = ?`,
      entityType,
      entityId,
    );
  }

  private async insertEntitySyncState(
    tx: Tx,
    entityType: SyncEntityType,
    entityId: string,
    serverVersion: number | null = null,
    lastSyncedLocalRevision: number | null = null,
  ): Promise<number> {
    const revision = 1;
    await tx.runAsync(
      `INSERT INTO sync_entity_state (
         entity_type, entity_id, local_revision, server_version, last_synced_local_revision
       ) VALUES (?, ?, ?, ?, ?)`,
      entityType,
      entityId,
      revision,
      serverVersion,
      lastSyncedLocalRevision,
    );
    return revision;
  }

  private async bumpEntityRevision(
    tx: Tx,
    entityType: SyncEntityType,
    entityId: string,
  ): Promise<SyncEntityStateRow> {
    const current = await this.getSyncEntityStateRow(tx, entityType, entityId);
    if (!current) throw new Error(`Missing sync entity state for ${entityType}:${entityId}.`);
    const next = current.local_revision + 1;
    await tx.runAsync(
      'UPDATE sync_entity_state SET local_revision = ? WHERE entity_type = ? AND entity_id = ?',
      next,
      entityType,
      entityId,
    );
    return { ...current, local_revision: next };
  }

  private async syncContext(tx: Tx): Promise<{ accountId: string; deviceId: string } | null> {
    const profile = await this.getSyncProfileRow(tx);
    if (!profile) throw new Error('Sync profile is missing.');
    if (profile.profile_kind !== 'account' || profile.sync_enabled !== 1 || !profile.account_id) return null;
    return { accountId: profile.account_id, deviceId: profile.device_id };
  }

  private allocateMutationId(): string {
    const id = this.createSyncId();
    if (!isCanonicalMutationUuid(id)) throw new Error('Sync mutation ID generator did not return a canonical UUID.');
    return id;
  }

  private itemMutableValues(row: ItemRow, tags: readonly string[]): Record<string, unknown> {
    return {
      title: row.title,
      body: row.body,
      url: row.url,
      assetId: row.asset_id,
      tags: [...tags],
      collectionId: row.collection_id,
      pinned: row.pinned === 1,
      archived: row.archived === 1,
      updatedAt: row.updated_at,
    };
  }

  private itemCreateValues(row: ItemRow, tags: readonly string[]): Record<string, unknown> {
    return {
      type: row.type,
      ...this.itemMutableValues(row, tags),
      createdAt: row.created_at,
    };
  }

  private collectionMutableValues(row: CollectionRow): Record<string, unknown> {
    return { name: row.name, updatedAt: row.updated_at };
  }

  private collectionCreateValues(row: CollectionRow): Record<string, unknown> {
    return { name: row.name, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  private async latestMutableOutboxRow(
    tx: Tx,
    entityType: SyncEntityType,
    entityId: string,
  ): Promise<PendingEntityOutboxRow | null> {
    return tx.getFirstAsync<PendingEntityOutboxRow>(
      `SELECT position, mutation_id, entity_type, entity_id, action, base_server_version,
              changed_fields_json, base_values_json, new_values_json, created_local_revision,
              depends_on_asset_id, state, attempt_count, last_error_code, queued_at
         FROM sync_outbox
        WHERE entity_type = ? AND entity_id = ? AND state = 'queued' AND attempt_count = 0
        ORDER BY position DESC LIMIT 1`,
      entityType,
      entityId,
    );
  }

  private async insertOutboxRow(
    tx: Tx,
    row: Readonly<{
      mutationId: string;
      entityType: SyncEntityType;
      entityId: string;
      action: 'create' | 'patch' | 'delete';
      baseServerVersion: number | null;
      changedFields: readonly string[];
      baseValues: Record<string, unknown>;
      newValues: Record<string, unknown>;
      createdLocalRevision: number;
      dependsOnAssetId?: string | null;
      state?: 'queued' | 'blocked';
    }>,
  ): Promise<void> {
    await tx.runAsync(
      `INSERT INTO sync_outbox (
         mutation_id, entity_type, entity_id, action, base_server_version,
         changed_fields_json, base_values_json, new_values_json,
         created_local_revision, depends_on_asset_id, state, attempt_count, queued_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      row.mutationId,
      row.entityType,
      row.entityId,
      row.action,
      row.baseServerVersion,
      JSON.stringify(row.changedFields),
      JSON.stringify(row.baseValues),
      JSON.stringify(row.newValues),
      row.createdLocalRevision,
      row.dependsOnAssetId ?? null,
      row.state ?? 'queued',
      this.now(),
    );
  }

  private async queueCreateMutation(
    tx: Tx,
    entityType: SyncEntityType,
    entityId: string,
    localRevision: number,
    newValues: Record<string, unknown>,
    dependsOnAssetId: string | null = null,
  ): Promise<string | null> {
    if (!(await this.syncContext(tx))) return null;
    const mutationId = this.allocateMutationId();
    const changedFields = entityType === 'item'
      ? ['title', 'body', 'url', 'assetId', 'tags', 'collectionId', 'pinned', 'archived', 'updatedAt']
      : ['name', 'updatedAt'];
    await this.insertOutboxRow(tx, {
      mutationId,
      entityType,
      entityId,
      action: 'create',
      baseServerVersion: null,
      changedFields,
      baseValues: {},
      newValues,
      createdLocalRevision: localRevision,
      dependsOnAssetId,
    });
    return mutationId;
  }

  private async queuePatchMutation(
    tx: Tx,
    entityType: SyncEntityType,
    entityId: string,
    state: SyncEntityStateRow,
    changedFields: readonly string[],
    beforeValues: Record<string, unknown>,
    afterValues: Record<string, unknown>,
    dependsOnAssetId: string | null = null,
  ): Promise<string | null> {
    if (changedFields.length === 0 || !(await this.syncContext(tx))) return null;
    const existing = await this.latestMutableOutboxRow(tx, entityType, entityId);

    if (existing?.action === 'create') {
      const createValues = entityType === 'item'
        ? (() => {
            const rowLike = afterValues;
            return {
              type: rowLike.type,
              title: rowLike.title,
              body: rowLike.body,
              url: rowLike.url,
              assetId: rowLike.assetId,
              tags: rowLike.tags,
              collectionId: rowLike.collectionId,
              pinned: rowLike.pinned,
              archived: rowLike.archived,
              createdAt: rowLike.createdAt,
              updatedAt: rowLike.updatedAt,
            };
          })()
        : { name: afterValues.name, createdAt: afterValues.createdAt, updatedAt: afterValues.updatedAt };
      await tx.runAsync(
        `UPDATE sync_outbox
            SET new_values_json = ?, created_local_revision = ?, depends_on_asset_id = ?
          WHERE position = ?`,
        JSON.stringify(createValues),
        state.local_revision,
        dependsOnAssetId,
        existing.position,
      );
      return existing.mutation_id;
    }

    if (state.server_version === null) {
      throw new Error(`Cannot queue ${entityType} patch without a server version or unsent create.`);
    }

    if (existing?.action === 'patch' && existing.base_server_version === state.server_version) {
      const oldFields = JSON.parse(existing.changed_fields_json) as string[];
      const oldBase = JSON.parse(existing.base_values_json) as Record<string, unknown>;
      const oldNew = JSON.parse(existing.new_values_json) as Record<string, unknown>;
      const mergedFields = [...oldFields];
      for (const field of changedFields) if (!mergedFields.includes(field)) mergedFields.push(field);
      for (const field of changedFields) {
        if (field !== 'updatedAt' && !(field in oldBase)) oldBase[field] = beforeValues[field];
        oldNew[field] = afterValues[field];
      }
      await tx.runAsync(
        `UPDATE sync_outbox
            SET changed_fields_json = ?, base_values_json = ?, new_values_json = ?,
                created_local_revision = ?, depends_on_asset_id = ?
          WHERE position = ?`,
        JSON.stringify(mergedFields),
        JSON.stringify(oldBase),
        JSON.stringify(oldNew),
        state.local_revision,
        dependsOnAssetId,
        existing.position,
      );
      return existing.mutation_id;
    }

    const mutationId = this.allocateMutationId();
    const baseValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};
    for (const field of changedFields) {
      if (field !== 'updatedAt') baseValues[field] = beforeValues[field];
      newValues[field] = afterValues[field];
    }
    await this.insertOutboxRow(tx, {
      mutationId,
      entityType,
      entityId,
      action: 'patch',
      baseServerVersion: state.server_version,
      changedFields,
      baseValues,
      newValues,
      createdLocalRevision: state.local_revision,
      dependsOnAssetId,
    });
    return mutationId;
  }

  private async queueDeleteMutation(
    tx: Tx,
    entityType: SyncEntityType,
    entityId: string,
    state: SyncEntityStateRow,
  ): Promise<string | null> {
    if (!(await this.syncContext(tx))) return null;
    const pending = await this.latestMutableOutboxRow(tx, entityType, entityId);
    if (state.server_version === null) {
      if (pending?.action === 'create') {
        await tx.runAsync(
          "DELETE FROM sync_outbox WHERE entity_type = ? AND entity_id = ? AND attempt_count = 0",
          entityType,
          entityId,
        );
        return null;
      }
      throw new Error(`Cannot queue ${entityType} delete without a server version or unsent create.`);
    }
    await tx.runAsync(
      "DELETE FROM sync_outbox WHERE entity_type = ? AND entity_id = ? AND attempt_count = 0",
      entityType,
      entityId,
    );
    const mutationId = this.allocateMutationId();
    await this.insertOutboxRow(tx, {
      mutationId,
      entityType,
      entityId,
      action: 'delete',
      baseServerVersion: state.server_version,
      changedFields: [],
      baseValues: {},
      newValues: {},
      createdLocalRevision: state.local_revision,
    });
    return mutationId;
  }

  private async insertOrReplaceLocalTombstone(
    tx: Tx,
    entityType: SyncEntityType,
    entityId: string,
    localRevision: number,
    serverVersion: number | null,
    pendingMutationId: string | null,
  ): Promise<void> {
    await tx.runAsync(
      `INSERT INTO sync_local_tombstones (
         entity_type, entity_id, local_revision, server_version, pending_mutation_id, deleted_at_local
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_type, entity_id) DO UPDATE SET
         local_revision = excluded.local_revision,
         server_version = excluded.server_version,
         pending_mutation_id = excluded.pending_mutation_id,
         deleted_at_local = excluded.deleted_at_local`,
      entityType,
      entityId,
      localRevision,
      serverVersion,
      pendingMutationId,
      this.now(),
    );
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
      `SELECT id, type, title, body, url, image_path, asset_id, created_at, updated_at, archived, collection_id, pinned
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
