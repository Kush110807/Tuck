import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-sqlite', () => ({ openDatabaseAsync: vi.fn() }));
vi.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, Paths: { document: 'file:///tmp' } }));
vi.mock('react-native', () => ({ Image: { getSize: vi.fn() } }));

import * as SQLite from 'expo-sqlite';
import type { RelativeImagePath, Result } from '../../src/contracts';
import { SQLiteItemRepository } from '../../src/data/SQLiteItemRepository';
import type { PersistentImageStore } from '../../src/data/PersistentImageStore';
import { SQLiteTestAdapter, V1_SCHEMA_SQL } from './sqliteTestAdapter';

const openAdapters: SQLiteTestAdapter[] = [];

afterEach(() => {
  vi.clearAllMocks();
  for (const adapter of openAdapters.splice(0)) {
    try { adapter.close(); } catch { /* already closed */ }
  }
});

function makeAdapter(): SQLiteTestAdapter {
  const adapter = new SQLiteTestAdapter();
  openAdapters.push(adapter);
  return adapter;
}

function imageStore(options: { cleanupSucceeds?: boolean } = {}): PersistentImageStore {
  const cleanupSucceeds = options.cleanupSucceeds ?? false;
  return {
    prepare: vi.fn(() => ({ ok: true, value: undefined }) as Result<void>),
    copySelected: vi.fn(async () => ({ ok: false, error: { code: 'IMAGE_COPY_FAILED', message: 'not used' } } as const)),
    resolve: vi.fn(async () => ({ ok: true, value: { kind: 'missing' } } as const)),
    removeFile: vi.fn(async () => cleanupSucceeds
      ? ({ ok: true, value: undefined } as const)
      : ({ ok: false, error: { code: 'OPEN_FAILED', message: 'keep queued cleanup' } } as const)),
    listOwnedRelativePaths: vi.fn(() => ({ ok: true, value: [] }) as Result<readonly RelativeImagePath[]>),
  } as unknown as PersistentImageStore;
}

function seedPopulatedV1(db: SQLiteTestAdapter): void {
  db.raw.exec(V1_SCHEMA_SQL);
  const insertItem = db.raw.prepare(
    `INSERT INTO items (id, type, title, body, url, image_path, created_at, updated_at, archived)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertItem.run('note-1', 'note', 'Research note', 'Body preserved', null, null, 100, 110, 0);
  insertItem.run('link-1', 'link', 'Expo', null, 'https://docs.expo.dev/', null, 200, 210, 0);
  insertItem.run('image-1', 'image', 'Reference', 'Caption', null, 'images/reference.png', 300, 310, 0);
  insertItem.run('archived-1', 'note', 'Old note', 'Archived body', null, null, 400, 410, 1);

  const insertTag = db.raw.prepare('INSERT INTO item_tags (item_id, tag_key, display, ordinal) VALUES (?, ?, ?, ?)');
  insertTag.run('note-1', 'ai', 'AI', 0);
  insertTag.run('note-1', 'pricing', 'Pricing', 1);
  insertTag.run('image-1', 'ideas', 'Ideas', 0);
  insertTag.run('archived-1', 'archive', 'Archive', 0);
  db.raw.prepare('INSERT INTO pending_file_deletions (path, queued_at) VALUES (?, ?)').run('images/pending.png', 999);
}

async function initializeWith(db: SQLiteTestAdapter, store = imageStore()): Promise<SQLiteItemRepository> {
  vi.mocked(SQLite.openDatabaseAsync).mockResolvedValue(db as never);
  const repository = new SQLiteItemRepository(store);
  await expect(repository.initialize()).resolves.toEqual({ ok: true, value: undefined });
  return repository;
}

describe('SQLite schema migration through Phase 6C v3', () => {
  it('migrates a realistic populated v1 database non-destructively and preserves cleanup state', async () => {
    const db = makeAdapter();
    seedPopulatedV1(db);

    const beforeItems = db.raw.prepare('SELECT * FROM items ORDER BY id').all();
    const beforeTags = db.raw.prepare('SELECT * FROM item_tags ORDER BY item_id, ordinal').all();
    const beforeCleanup = db.raw.prepare('SELECT * FROM pending_file_deletions ORDER BY path').all();

    const repository = await initializeWith(db);

    expect(db.raw.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 3 });
    const columns = db.raw.prepare('PRAGMA table_info(items)').all() as Array<{ name: string }>;
    expect(columns.map(column => column.name)).toEqual(expect.arrayContaining(['collection_id', 'pinned']));

    const afterItems = db.raw.prepare(
      `SELECT id, type, title, body, url, image_path, asset_id, created_at, updated_at, archived, collection_id, pinned
         FROM items ORDER BY id`,
    ).all() as Array<Record<string, unknown>>;
    expect(afterItems).toHaveLength(beforeItems.length);
    for (const item of afterItems) {
      expect(item.collection_id).toBeNull();
      expect(item.pinned).toBe(0);
      const before = (beforeItems as Array<Record<string, unknown>>).find(row => row.id === item.id)!;
      if (item.type === 'image') expect(typeof item.asset_id).toBe('string');
      else expect(item.asset_id).toBeNull();
      for (const key of ['id', 'type', 'title', 'body', 'url', 'image_path', 'created_at', 'updated_at', 'archived']) {
        expect(item[key]).toEqual(before[key]);
      }
    }
    expect(db.raw.prepare('SELECT * FROM item_tags ORDER BY item_id, ordinal').all()).toEqual(beforeTags);
    expect(db.raw.prepare('SELECT * FROM pending_file_deletions ORDER BY path').all()).toEqual(beforeCleanup);
    expect(db.raw.prepare('SELECT COUNT(*) AS count FROM collections').get()).toMatchObject({ count: 0 });
    expect(db.raw.prepare('SELECT profile_kind, account_id, sync_enabled FROM sync_profile WHERE singleton = 1').get())
      .toMatchObject({ profile_kind: 'local-only', account_id: null, sync_enabled: 0 });
    expect(db.raw.prepare('SELECT COUNT(*) AS count FROM sync_entity_state').get()).toMatchObject({ count: 4 });
    expect(db.raw.prepare('SELECT COUNT(*) AS count FROM sync_outbox').get()).toMatchObject({ count: 0 });

    const note = await repository.get('note-1');
    expect(note).toMatchObject({ ok: true, value: { id: 'note-1', collectionId: null, pinned: false } });
  });

  it('migrates an empty v1 database and repeated v2 initialization is idempotent', async () => {
    const db = makeAdapter();
    db.raw.exec(V1_SCHEMA_SQL);
    const store = imageStore({ cleanupSucceeds: true });
    const repository = await initializeWith(db, store);

    await expect(repository.initialize()).resolves.toEqual({ ok: true, value: undefined });
    expect(db.raw.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 3 });
    expect(db.raw.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='collections'").get())
      .toMatchObject({ count: 1 });
  });

  it('rolls back a halfway v1-to-v2 failure and safely retries on the next initialization', async () => {
    const db = makeAdapter();
    seedPopulatedV1(db);
    db.setFailureHook(sql => {
      if (sql.includes('ADD COLUMN pinned')) throw new Error('simulated interruption');
    });
    vi.mocked(SQLite.openDatabaseAsync).mockResolvedValue(db as never);
    const repository = new SQLiteItemRepository(imageStore());

    const failed = await repository.initialize();
    expect(failed.ok).toBe(false);
    if (failed.ok) throw new Error('expected migration failure');
    expect(failed.error.code).toBe('INIT_FAILED');
    expect(db.raw.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 1 });
    expect(db.raw.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='collections'").get())
      .toMatchObject({ count: 0 });
    const columnsAfterRollback = db.raw.prepare('PRAGMA table_info(items)').all() as Array<{ name: string }>;
    expect(columnsAfterRollback.map(column => column.name)).not.toContain('collection_id');
    expect(columnsAfterRollback.map(column => column.name)).not.toContain('pinned');

    db.setFailureHook(null);
    await expect(repository.initialize()).resolves.toEqual({ ok: true, value: undefined });
    expect(db.raw.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 3 });
  });

  it('fails safely when the database schema is newer than supported', async () => {
    const db = makeAdapter();
    db.raw.exec(V1_SCHEMA_SQL);
    db.raw.exec('PRAGMA user_version = 4;');
    vi.mocked(SQLite.openDatabaseAsync).mockResolvedValue(db as never);
    const repository = new SQLiteItemRepository(imageStore());

    const result = await repository.initialize();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected safe initialization failure');
    expect(result.error.code).toBe('INIT_FAILED');
    expect(db.raw.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 4 });
  });

  it('fails initialization when foreign_key_check finds an existing violation', async () => {
    const db = makeAdapter();
    seedPopulatedV1(db);
    await initializeWith(db, imageStore({ cleanupSucceeds: true }));

    db.raw.exec('PRAGMA foreign_keys = OFF;');
    db.raw.prepare('UPDATE items SET collection_id = ? WHERE id = ?').run('missing-collection', 'note-1');
    db.raw.exec('PRAGMA foreign_keys = ON;');

    vi.mocked(SQLite.openDatabaseAsync).mockResolvedValue(db as never);
    const repository = new SQLiteItemRepository(imageStore({ cleanupSucceeds: true }));
    const result = await repository.initialize();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected foreign-key integrity failure');
    expect(result.error.code).toBe('INIT_FAILED');
  });
});
