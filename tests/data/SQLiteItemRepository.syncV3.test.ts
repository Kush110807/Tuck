import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-sqlite', () => ({ openDatabaseAsync: vi.fn() }));
vi.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, Paths: { document: 'file:///tmp' } }));
vi.mock('react-native', () => ({ Image: { getSize: vi.fn() } }));

import * as SQLite from 'expo-sqlite';
import type { RelativeImagePath, Result } from '../../src/contracts';
import { SQLiteItemRepository } from '../../src/data/SQLiteItemRepository';
import type { PersistentImageStore } from '../../src/data/PersistentImageStore';
import type { SyncChange } from '../../src/sync/protocol';
import { SQLiteTestAdapter, V1_SCHEMA_SQL } from './sqliteTestAdapter';

const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';
const REMOTE_DEVICE = '33333333-3333-4333-8333-333333333333';
const adapters: SQLiteTestAdapter[] = [];

afterEach(() => {
  vi.clearAllMocks();
  for (const adapter of adapters.splice(0)) {
    try { adapter.close(); } catch { /* already closed */ }
  }
});

function makeAdapter(): SQLiteTestAdapter {
  const adapter = new SQLiteTestAdapter();
  adapters.push(adapter);
  return adapter;
}

function imageStore(): PersistentImageStore {
  return {
    prepare: vi.fn(() => ({ ok: true, value: undefined }) as Result<void>),
    copySelected: vi.fn(async () => ({ ok: true, value: 'images/copied.png' as RelativeImagePath } as const)),
    resolve: vi.fn(async () => ({ ok: true, value: { kind: 'missing' } } as const)),
    removeFile: vi.fn(async () => ({ ok: true, value: undefined } as const)),
    listOwnedRelativePaths: vi.fn(() => ({ ok: true, value: [] }) as Result<readonly RelativeImagePath[]>),
  } as unknown as PersistentImageStore;
}

function uuidSource(start = 1): () => string {
  let value = start;
  return () => `00000000-0000-4000-8000-${String(value++).padStart(12, '0')}`;
}

function idSource(values: string[]): () => string {
  const ids = [...values];
  return () => ids.shift() ?? `id-${ids.length}`;
}

async function accountRepository(
  db: SQLiteTestAdapter,
  accountId = ACCOUNT_A,
  ids = ['item-1', 'collection-1', 'item-2'],
  now = 10_000,
) {
  vi.mocked(SQLite.openDatabaseAsync).mockResolvedValue(db as never);
  const repository = new SQLiteItemRepository(imageStore(), {
    createId: idSource(ids),
    createSyncId: uuidSource(),
    now: () => now,
    initialSyncProfile: { kind: 'account', accountId, deviceId: `device-${accountId}`, syncEnabled: true },
  });
  await expect(repository.initialize()).resolves.toEqual({ ok: true, value: undefined });
  return repository;
}

async function localRepository(db: SQLiteTestAdapter, ids = ['item-1']) {
  vi.mocked(SQLite.openDatabaseAsync).mockResolvedValue(db as never);
  const repository = new SQLiteItemRepository(imageStore(), {
    createId: idSource(ids),
    createSyncId: uuidSource(),
    now: () => 10_000,
  });
  await expect(repository.initialize()).resolves.toEqual({ ok: true, value: undefined });
  return repository;
}

function seedV2(db: SQLiteTestAdapter): void {
  db.raw.exec(V1_SCHEMA_SQL);
  db.raw.exec(`
    CREATE TABLE collections (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    ALTER TABLE items ADD COLUMN collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL;
    ALTER TABLE items ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1));
    CREATE INDEX idx_items_collection_archive_updated ON items (collection_id, archived, updated_at DESC, id ASC);
    CREATE INDEX idx_items_archive_pinned_updated ON items (archived, pinned, updated_at DESC, id ASC);
    PRAGMA user_version = 2;
  `);
  db.raw.prepare('INSERT INTO collections (id, name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('collection-existing', 'Existing', 'existing', 50, 60);
  const insert = db.raw.prepare(
    `INSERT INTO items (id, type, title, body, url, image_path, created_at, updated_at, archived, collection_id, pinned)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insert.run('note-existing', 'note', 'Note', 'Body', null, null, 100, 110, 1, 'collection-existing', 1);
  insert.run('image-existing', 'image', 'Image', 'Caption', null, 'images/original.png', 200, 210, 0, null, 0);
  db.raw.prepare('INSERT INTO item_tags (item_id, tag_key, display, ordinal) VALUES (?, ?, ?, ?)')
    .run('note-existing', 'work', 'Work', 0);
}

function expectOk<T>(result: Result<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function remoteCollectionChange(sequence = 1, version = 1): SyncChange {
  return {
    sequence,
    entityType: 'collection',
    entityId: 'remote-collection',
    entityVersion: version,
    kind: 'upsert',
    payload: {
      entityType: 'collection',
      entity: {
        id: 'remote-collection', name: 'Remote', nameKey: 'remote', createdAt: 100, updatedAt: 100, version,
      },
    },
    mutationId: null,
    originDeviceId: REMOTE_DEVICE,
    serverEpochMs: 100,
  };
}

function remoteItemChange(sequence = 2, version = 1): SyncChange {
  return {
    sequence,
    entityType: 'item',
    entityId: 'remote-item',
    entityVersion: version,
    kind: 'upsert',
    payload: {
      entityType: 'item',
      entity: {
        id: 'remote-item', type: 'note', title: 'Remote note', body: 'Cloud body', url: null, assetId: null,
        tags: ['Cloud'], collectionId: 'remote-collection', pinned: false, archived: false,
        createdAt: 101, updatedAt: 102, version,
      },
    },
    mutationId: null,
    originDeviceId: REMOTE_DEVICE,
    serverEpochMs: 102,
  };
}

describe('Phase 6C schema v3 migration', () => {
  it('migrates populated v2 data without changing domain IDs, timestamps, archive/pin, tags, Collection or image path', async () => {
    const db = makeAdapter();
    seedV2(db);
    const beforeItems = db.raw.prepare('SELECT * FROM items ORDER BY id').all() as Array<Record<string, unknown>>;
    const beforeCollections = db.raw.prepare('SELECT * FROM collections ORDER BY id').all();
    const beforeTags = db.raw.prepare('SELECT * FROM item_tags ORDER BY item_id, ordinal').all();

    vi.mocked(SQLite.openDatabaseAsync).mockResolvedValue(db as never);
    const repository = new SQLiteItemRepository(imageStore(), { createSyncId: uuidSource() });
    await expect(repository.initialize()).resolves.toEqual({ ok: true, value: undefined });

    expect(db.raw.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 3 });
    const afterItems = db.raw.prepare(
      'SELECT id, type, title, body, url, image_path, created_at, updated_at, archived, collection_id, pinned, asset_id FROM items ORDER BY id',
    ).all() as Array<Record<string, unknown>>;
    for (const before of beforeItems) {
      const after = afterItems.find(row => row.id === before.id)!;
      for (const key of ['id', 'type', 'title', 'body', 'url', 'image_path', 'created_at', 'updated_at', 'archived', 'collection_id', 'pinned']) {
        expect(after[key]).toEqual(before[key]);
      }
    }
    expect(afterItems.find(row => row.id === 'note-existing')?.asset_id).toBeNull();
    expect(typeof afterItems.find(row => row.id === 'image-existing')?.asset_id).toBe('string');
    expect(db.raw.prepare('SELECT * FROM collections ORDER BY id').all()).toEqual(beforeCollections);
    expect(db.raw.prepare('SELECT * FROM item_tags ORDER BY item_id, ordinal').all()).toEqual(beforeTags);
    expect(db.raw.prepare('SELECT profile_kind, account_id, sync_enabled FROM sync_profile').get())
      .toMatchObject({ profile_kind: 'local-only', account_id: null, sync_enabled: 0 });
    expect(db.raw.prepare('SELECT COUNT(*) AS count FROM sync_entity_state').get()).toMatchObject({ count: 3 });
    expect(db.raw.prepare('SELECT COUNT(*) AS count FROM sync_outbox').get()).toMatchObject({ count: 0 });
  });

  it('rolls back an interrupted v2-to-v3 migration and retries deterministically', async () => {
    const db = makeAdapter();
    seedV2(db);
    db.setFailureHook(sql => {
      if (sql.includes('CREATE TABLE sync_outbox')) throw new Error('simulated v3 interruption');
    });
    vi.mocked(SQLite.openDatabaseAsync).mockResolvedValue(db as never);
    const repository = new SQLiteItemRepository(imageStore(), { createSyncId: uuidSource() });

    const failed = await repository.initialize();
    expect(failed.ok).toBe(false);
    expect(db.raw.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 2 });
    expect((db.raw.prepare('PRAGMA table_info(items)').all() as Array<{ name: string }>).map(row => row.name)).not.toContain('asset_id');
    expect(db.raw.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='sync_outbox'").get())
      .toMatchObject({ count: 0 });

    db.setFailureHook(null);
    await expect(repository.initialize()).resolves.toEqual({ ok: true, value: undefined });
    expect(db.raw.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 3 });
  });
});

describe('Phase 6C durable authored outbox', () => {
  it('atomically writes create/update/archive/restore/pin mutations and compacts an unsent create', async () => {
    const db = makeAdapter();
    const repository = await accountRepository(db);
    const created = expectOk(await repository.create({ type: 'note', title: 'One', body: 'Body', tags: ['A'] }));
    let outbox = expectOk(await repository.listDurableOutbox());
    expect(outbox).toHaveLength(1);
    expect(outbox[0].mutation).toMatchObject({ entityType: 'item', entityId: created.id, action: 'create' });

    const updated = expectOk(await repository.update({
      id: created.id, type: 'note', expectedUpdatedAt: created.updatedAt, changes: { body: 'Body 2', tags: ['A', 'B'] },
    }));
    const pinned = expectOk(await repository.setPinned(created.id, true, updated.updatedAt));
    const archived = expectOk(await repository.setArchived(created.id, true, pinned.updatedAt));
    const restored = expectOk(await repository.setArchived(created.id, false, archived.updatedAt));

    outbox = expectOk(await repository.listDurableOutbox());
    expect(outbox).toHaveLength(1);
    expect(outbox[0].mutation.action).toBe('create');
    if (outbox[0].mutation.action !== 'create' || outbox[0].mutation.entityType !== 'item') throw new Error('expected item create');
    expect(outbox[0].mutation.newValues).toMatchObject({ body: 'Body 2', tags: ['A', 'B'], pinned: true, archived: false });
    const state = expectOk(await repository.getEntitySyncState('item', created.id));
    expect(state).toMatchObject({ localRevision: 5, serverVersion: null });
    expect(restored.updatedAt).toBeGreaterThan(created.updatedAt);
  });

  it('rolls back the domain create when outbox persistence fails', async () => {
    const db = makeAdapter();
    const repository = await accountRepository(db);
    db.setFailureHook(sql => {
      if (sql.includes('INSERT INTO sync_outbox')) throw new Error('outbox write failed');
    });

    const result = await repository.create({ type: 'note', title: 'Atomic', body: 'Body', tags: [] });
    expect(result.ok).toBe(false);
    expect(db.raw.prepare('SELECT COUNT(*) AS count FROM items').get()).toMatchObject({ count: 0 });
    expect(db.raw.prepare('SELECT COUNT(*) AS count FROM sync_outbox').get()).toMatchObject({ count: 0 });
    expect(db.raw.prepare('SELECT COUNT(*) AS count FROM sync_entity_state').get()).toMatchObject({ count: 0 });
  });

  it('rolls back an authored update when compacting its outbox fails', async () => {
    const db = makeAdapter();
    const repository = await accountRepository(db);
    const created = expectOk(await repository.create({ type: 'note', title: 'Before', body: 'Body', tags: [] }));
    db.setFailureHook(sql => {
      if (sql.includes('UPDATE sync_outbox')) throw new Error('outbox compaction failed');
    });

    const result = await repository.update({
      id: created.id, type: 'note', expectedUpdatedAt: created.updatedAt, changes: { title: 'After' },
    });
    expect(result.ok).toBe(false);
    const row = db.raw.prepare('SELECT title, updated_at FROM items WHERE id = ?').get(created.id) as { title: string; updated_at: number };
    expect(row).toEqual({ title: 'Before', updated_at: created.updatedAt });
    expect(db.raw.prepare("SELECT local_revision FROM sync_entity_state WHERE entity_type='item' AND entity_id=?").get(created.id))
      .toMatchObject({ local_revision: 1 });
  });

  it('persists outbox rows across repository reopen', async () => {
    const db = makeAdapter();
    const repository = await accountRepository(db);
    const created = expectOk(await repository.create({ type: 'note', title: 'Persist', body: 'Body', tags: [] }));

    vi.mocked(SQLite.openDatabaseAsync).mockResolvedValue(db as never);
    const reopened = new SQLiteItemRepository(imageStore(), {
      initialSyncProfile: { kind: 'account', accountId: ACCOUNT_A },
    });
    await expect(reopened.initialize()).resolves.toEqual({ ok: true, value: undefined });
    const outbox = expectOk(await reopened.listDurableOutbox());
    expect(outbox).toHaveLength(1);
    expect(outbox[0].mutation.entityId).toBe(created.id);
  });

  it('records Collection mutations and a local hard-delete tombstone', async () => {
    const db = makeAdapter();
    const repository = await accountRepository(db, ACCOUNT_A, ['collection-1', 'item-1']);
    const collection = expectOk(await repository.createCollection('Work'));
    const renamed = expectOk(await repository.renameCollection(collection.id, 'Work 2', collection.updatedAt));
    let outbox = expectOk(await repository.listDurableOutbox());
    expect(outbox).toHaveLength(1);
    expect(outbox[0].mutation).toMatchObject({ entityType: 'collection', entityId: collection.id, action: 'create' });
    if (outbox[0].mutation.entityType !== 'collection' || outbox[0].mutation.action !== 'create') throw new Error('expected collection create');
    expect(outbox[0].mutation.newValues.name).toBe('Work 2');

    await expect(repository.deleteCollection(collection.id, renamed.updatedAt)).resolves.toEqual({ ok: true, value: undefined });
    outbox = expectOk(await repository.listDurableOutbox());
    expect(outbox).toEqual([]);
    expect(db.raw.prepare("SELECT entity_type, entity_id, server_version, pending_mutation_id FROM sync_local_tombstones WHERE entity_type='collection'").get())
      .toMatchObject({ entity_type: 'collection', entity_id: collection.id, server_version: null, pending_mutation_id: null });
  });
});

describe('Phase 6C remote-apply and checkpoint foundation', () => {
  it('applies canonical server state without authored outbox, updates serverVersion, and persists the pull cursor', async () => {
    const db = makeAdapter();
    const repository = await accountRepository(db);
    await expect(repository.applyRemoteChanges([remoteCollectionChange(), remoteItemChange()], 2, 1))
      .resolves.toEqual({ ok: true, value: undefined });

    expect(expectOk(await repository.listDurableOutbox())).toEqual([]);
    expect(expectOk(await repository.get('remote-item'))).toMatchObject({ title: 'Remote note', body: 'Cloud body', tags: ['Cloud'] });
    expect(expectOk(await repository.getEntitySyncState('item', 'remote-item')))
      .toMatchObject({ localRevision: 1, serverVersion: 1, lastSyncedLocalRevision: 1 });
    expect(expectOk(await repository.getLocalSyncCheckpoint())).toMatchObject({ pullCursor: 2, minimumRetainedSequence: 1 });

    vi.mocked(SQLite.openDatabaseAsync).mockResolvedValue(db as never);
    const reopened = new SQLiteItemRepository(imageStore(), { initialSyncProfile: { kind: 'account', accountId: ACCOUNT_A } });
    await expect(reopened.initialize()).resolves.toEqual({ ok: true, value: undefined });
    expect(expectOk(await reopened.getLocalSyncCheckpoint()).pullCursor).toBe(2);
  });

  it('persists bootstrap state and keeps account profile state isolated by database', async () => {
    const dbA = makeAdapter();
    const repoA = await accountRepository(dbA, ACCOUNT_A, ['a-item']);
    const dbB = makeAdapter();
    const repoB = await accountRepository(dbB, ACCOUNT_B, ['b-item']);

    await repoA.updateBootstrapCheckpoint({
      initialSyncState: 'bootstrapping',
      bootstrapSessionId: 'session-a',
      bootstrapAfterOrdinal: 5,
      bootstrapSnapshotHeadSequence: 10,
    });
    expect(expectOk(await repoA.getLocalSyncCheckpoint())).toMatchObject({
      initialSyncState: 'bootstrapping', bootstrapSessionId: 'session-a', bootstrapAfterOrdinal: 5,
    });
    expect(expectOk(await repoB.getLocalSyncCheckpoint())).toMatchObject({
      initialSyncState: 'not_started', bootstrapSessionId: null, pullCursor: 0,
    });

    await repoA.create({ type: 'note', title: 'A', body: 'A', tags: [] });
    await repoB.create({ type: 'note', title: 'B', body: 'B', tags: [] });
    expect(expectOk(await repoA.listDurableOutbox())[0].mutation.accountId).toBe(ACCOUNT_A);
    expect(expectOk(await repoB.listDurableOutbox())[0].mutation.accountId).toBe(ACCOUNT_B);
  });

  it('hard-deletes a server-known Item into a durable delete mutation + tombstone', async () => {
    const db = makeAdapter();
    const repository = await accountRepository(db);
    await repository.applyRemoteChanges([remoteCollectionChange(), remoteItemChange()], 2);
    const item = expectOk(await repository.get('remote-item'));

    await expect(repository.remove(item.id, item.updatedAt)).resolves.toEqual({ ok: true, value: undefined });
    const outbox = expectOk(await repository.listDurableOutbox());
    expect(outbox).toHaveLength(1);
    expect(outbox[0].mutation).toMatchObject({ entityType: 'item', entityId: item.id, action: 'delete', baseServerVersion: 1 });
    expect(db.raw.prepare("SELECT server_version, pending_mutation_id FROM sync_local_tombstones WHERE entity_type='item' AND entity_id=?").get(item.id))
      .toMatchObject({ server_version: 1, pending_mutation_id: outbox[0].mutation.mutationId });
  });
});

describe('Phase 6C local-only regression', () => {
  it('keeps unsigned/offline CRUD fully local and produces no outbox', async () => {
    const db = makeAdapter();
    const repository = await localRepository(db);
    const created = expectOk(await repository.create({ type: 'note', title: 'Offline', body: 'Body', tags: ['Local'] }));
    const updated = expectOk(await repository.update({
      id: created.id, type: 'note', expectedUpdatedAt: created.updatedAt, changes: { title: 'Offline 2' },
    }));
    const archived = expectOk(await repository.setArchived(created.id, true, updated.updatedAt));
    const restored = expectOk(await repository.setArchived(created.id, false, archived.updatedAt));
    expect(restored.title).toBe('Offline 2');
    expect(expectOk(await repository.listDurableOutbox())).toEqual([]);
    expect(expectOk(await repository.getLocalSyncProfile())).toMatchObject({ profileKind: 'local-only', accountId: null, syncEnabled: false });
  });
});
