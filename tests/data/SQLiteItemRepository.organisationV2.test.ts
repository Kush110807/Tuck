import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-sqlite', () => ({ openDatabaseAsync: vi.fn() }));
vi.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, Paths: { document: 'file:///tmp' } }));
vi.mock('react-native', () => ({ Image: { getSize: vi.fn() } }));

import * as SQLite from 'expo-sqlite';
import type { ImageSelection, RelativeImagePath, Result, SavedItem } from '../../src/contracts';
import { SQLiteItemRepository } from '../../src/data/SQLiteItemRepository';
import type { PersistentImageStore } from '../../src/data/PersistentImageStore';
import { createSmartViewQuery } from '../../src/domain';
import { SQLiteTestAdapter, V1_SCHEMA_SQL } from './sqliteTestAdapter';

const adapters: SQLiteTestAdapter[] = [];
const selection: ImageSelection = { temporaryUri: 'file:///tmp/new.png', mimeType: 'image/png', reportedBytes: 100 };

afterEach(() => {
  vi.clearAllMocks();
  for (const adapter of adapters.splice(0)) {
    try { adapter.close(); } catch { /* already closed */ }
  }
});

function makeAdapter(): SQLiteTestAdapter {
  const adapter = new SQLiteTestAdapter();
  adapter.raw.exec(V1_SCHEMA_SQL);
  adapters.push(adapter);
  return adapter;
}

function makeImageStore(): PersistentImageStore {
  let imageIndex = 0;
  return {
    prepare: vi.fn(() => ({ ok: true, value: undefined }) as Result<void>),
    copySelected: vi.fn(async () => ({ ok: true, value: `images/copied-${++imageIndex}.png` as RelativeImagePath } as const)),
    resolve: vi.fn(async () => ({ ok: true, value: { kind: 'missing' } } as const)),
    removeFile: vi.fn(async () => ({ ok: true, value: undefined } as const)),
    listOwnedRelativePaths: vi.fn(() => ({ ok: true, value: [] }) as Result<readonly RelativeImagePath[]>),
  } as unknown as PersistentImageStore;
}

async function makeRepository(options: { ids?: string[]; now?: number } = {}) {
  const db = makeAdapter();
  vi.mocked(SQLite.openDatabaseAsync).mockResolvedValue(db as never);
  const ids = [...(options.ids ?? ['id-1', 'id-2', 'id-3', 'id-4', 'id-5', 'id-6', 'id-7', 'id-8'])];
  let currentNow = options.now ?? 10_000;
  const repository = new SQLiteItemRepository(makeImageStore(), {
    createId: () => ids.shift() ?? `generated-${ids.length}`,
    now: () => currentNow,
  });
  await expect(repository.initialize()).resolves.toEqual({ ok: true, value: undefined });
  return {
    db,
    repository,
    setNow(value: number) { currentNow = value; },
  };
}

function expectOk<T>(result: Result<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe('Phase 5B collections and pinning', () => {
  it('normalizes collection names, rejects logical duplicates, persists assignments, and deletes with SET NULL', async () => {
    const { db, repository, setNow } = await makeRepository({ ids: ['collection-1', 'collection-2', 'note-1', 'image-1'] });

    const created = expectOk(await repository.createCollection('  Work   Ideas  '));
    expect(created).toMatchObject({ id: 'collection-1', name: 'Work Ideas', nameKey: 'work ideas' });

    const duplicate = await repository.createCollection('work ideas');
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) throw new Error('expected duplicate collection rejection');
    expect(duplicate.error).toMatchObject({ code: 'VALIDATION', field: 'collection' });

    setNow(10_100);
    const caseOnlyRename = expectOk(await repository.renameCollection(created.id, 'WORK IDEAS', created.updatedAt));
    expect(caseOnlyRename.name).toBe('WORK IDEAS');
    expect(caseOnlyRename.nameKey).toBe('work ideas');
    expect(caseOnlyRename.updatedAt).toBeGreaterThan(created.updatedAt);

    const travel = expectOk(await repository.createCollection('Travel'));
    const duplicateRename = await repository.renameCollection(travel.id, ' work ideas ', travel.updatedAt);
    expect(duplicateRename.ok).toBe(false);
    if (duplicateRename.ok) throw new Error('expected duplicate rename rejection');
    expect(duplicateRename.error.code).toBe('VALIDATION');

    setNow(20_000);
    const note = expectOk(await repository.create({
      type: 'note', title: 'Assigned note', body: 'Body', tags: ['AI'], collectionId: caseOnlyRename.id,
    }));
    expect(note).toMatchObject({ collectionId: caseOnlyRename.id, pinned: false });

    const image = expectOk(await repository.create({
      type: 'image', title: 'Assigned image', caption: 'Reference', tags: ['Ideas'], image: selection,
      collectionId: caseOnlyRename.id,
    }));
    const pinnedImage = expectOk(await repository.setPinned(image.id, true, image.updatedAt));
    const archivedImage = expectOk(await repository.setArchived(image.id, true, pinnedImage.updatedAt));

    const beforeDeleteNoteUpdatedAt = note.updatedAt;
    const beforeDeleteImageUpdatedAt = archivedImage.updatedAt;
    await expect(repository.deleteCollection(caseOnlyRename.id, caseOnlyRename.updatedAt)).resolves.toEqual({ ok: true, value: undefined });

    const noteAfterDelete = expectOk(await repository.get(note.id));
    expect(noteAfterDelete).toMatchObject({ collectionId: null, tags: ['AI'], pinned: false, archived: false, updatedAt: beforeDeleteNoteUpdatedAt });
    const imageAfterDelete = expectOk(await repository.get(image.id));
    expect(imageAfterDelete).toMatchObject({
      collectionId: null,
      tags: ['Ideas'],
      pinned: true,
      archived: true,
      imagePath: image.imagePath,
      updatedAt: beforeDeleteImageUpdatedAt,
    });

    expect(db.raw.prepare('SELECT COUNT(*) AS count FROM items').get()).toMatchObject({ count: 2 });

    // Collection rows persist independently of the repository instance, including empty Collections.
    vi.mocked(SQLite.openDatabaseAsync).mockResolvedValue(db as never);
    const restarted = new SQLiteItemRepository(makeImageStore());
    await expect(restarted.initialize()).resolves.toEqual({ ok: true, value: undefined });
    expect(expectOk(await restarted.listCollections())).toEqual([
      expect.objectContaining({ id: travel.id, name: 'Travel', activeItemCount: 0 }),
    ]);
    await expect(restarted.deleteCollection(travel.id, travel.updatedAt)).resolves.toEqual({ ok: true, value: undefined });
    expect(expectOk(await restarted.listCollections())).toEqual([]);
  });

  it('treats explicit collection assignment, move, and removal as normal metadata edits but pinning never changes updatedAt', async () => {
    const { repository, setNow } = await makeRepository({ ids: ['collection-1', 'collection-2', 'note-1'] });
    const work = expectOk(await repository.createCollection('Work'));
    const travel = expectOk(await repository.createCollection('Travel'));
    setNow(30_000);
    const note = expectOk(await repository.create({ type: 'note', title: 'Plan', body: 'Text', tags: [], collectionId: work.id }));

    setNow(31_000);
    const moved = expectOk(await repository.update({
      id: note.id,
      type: 'note',
      expectedUpdatedAt: note.updatedAt,
      changes: { collectionId: travel.id },
    }));
    expect(moved.collectionId).toBe(travel.id);
    expect(moved.updatedAt).toBeGreaterThan(note.updatedAt);

    setNow(32_000);
    const removed = expectOk(await repository.update({
      id: note.id,
      type: 'note',
      expectedUpdatedAt: moved.updatedAt,
      changes: { collectionId: null },
    }));
    expect(removed.collectionId).toBeNull();
    expect(removed.updatedAt).toBeGreaterThan(moved.updatedAt);

    setNow(33_000);
    const reassigned = expectOk(await repository.update({
      id: note.id,
      type: 'note',
      expectedUpdatedAt: removed.updatedAt,
      changes: { collectionId: travel.id },
    }));
    expect(reassigned.collectionId).toBe(travel.id);
    expect(reassigned.updatedAt).toBeGreaterThan(removed.updatedAt);

    setNow(40_000);
    const pinned = expectOk(await repository.setPinned(note.id, true, reassigned.updatedAt));
    expect(pinned.pinned).toBe(true);
    expect(pinned.updatedAt).toBe(reassigned.updatedAt);
    const repeatedPin = expectOk(await repository.setPinned(note.id, true, reassigned.updatedAt));
    expect(repeatedPin.updatedAt).toBe(reassigned.updatedAt);

    const unpinned = expectOk(await repository.setPinned(note.id, false, reassigned.updatedAt));
    expect(unpinned.pinned).toBe(false);
    expect(unpinned.updatedAt).toBe(reassigned.updatedAt);
  });

  it('retains pin state through archive/restore and across repository restart', async () => {
    const { db, repository } = await makeRepository({ ids: ['note-1'] });
    const note = expectOk(await repository.create({ type: 'note', title: 'Important', body: 'Body', tags: [] }));
    const pinned = expectOk(await repository.setPinned(note.id, true, note.updatedAt));
    const archived = expectOk(await repository.setArchived(note.id, true, pinned.updatedAt));
    expect(archived.pinned).toBe(true);

    const activePinnedWhileArchived = expectOk(await repository.list(createSmartViewQuery('pinned').query));
    expect(activePinnedWhileArchived).toEqual([]);

    const restored = expectOk(await repository.setArchived(note.id, false, archived.updatedAt));
    expect(restored.pinned).toBe(true);
    const activePinnedAfterRestore = expectOk(await repository.list(createSmartViewQuery('pinned').query));
    expect(activePinnedAfterRestore.map(item => item.id)).toEqual([note.id]);

    vi.mocked(SQLite.openDatabaseAsync).mockResolvedValue(db as never);
    const restarted = new SQLiteItemRepository(makeImageStore());
    await expect(restarted.initialize()).resolves.toEqual({ ok: true, value: undefined });
    expect(expectOk(await restarted.get(note.id)).pinned).toBe(true);
  });
});

describe('Phase 5B query, sort, tag aggregation, and Library overview', () => {
  it('supports deterministic sorting and required filter combinations', async () => {
    const { db, repository } = await makeRepository();
    db.raw.prepare('INSERT INTO collections (id, name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('research', 'Research', 'research', 1, 1);
    const insertItem = db.raw.prepare(
      `INSERT INTO items (id, type, title, body, url, image_path, asset_id, created_at, updated_at, archived, collection_id, pinned)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertItem.run('a', 'note', 'beta', 'Deep focus pricing', null, null, null, 100, 500, 0, 'research', 1);
    insertItem.run('b', 'link', 'Alpha', null, 'https://example.com/ai', null, null, 200, 500, 0, 'research', 0);
    insertItem.run('c', 'image', 'Zulu', 'Visual reference', null, 'images/zulu.png', 'asset-c', 200, 300, 0, null, 1);
    insertItem.run('d', 'note', 'Archived', 'Deep archive', null, null, null, 50, 600, 1, 'research', 1);
    const insertTag = db.raw.prepare('INSERT INTO item_tags (item_id, tag_key, display, ordinal) VALUES (?, ?, ?, ?)');
    insertTag.run('a', 'ai', 'AI', 0);
    insertTag.run('a', 'pricing', 'Pricing', 1);
    insertTag.run('b', 'ai', 'ai', 0);
    insertTag.run('d', 'ai', 'Ai Archived', 0);

    const base = { archived: false, text: '', type: 'all' as const, tagKey: null };
    expect(expectOk(await repository.list({ ...base, sort: 'updated_desc' })).map(item => item.id)).toEqual(['a', 'b', 'c']);
    expect(expectOk(await repository.list({ ...base, sort: 'created_desc' })).map(item => item.id)).toEqual(['b', 'c', 'a']);
    expect(expectOk(await repository.list({ ...base, sort: 'created_asc' })).map(item => item.id)).toEqual(['a', 'b', 'c']);
    expect(expectOk(await repository.list({ ...base, sort: 'title_asc' })).map(item => item.id)).toEqual(['b', 'a', 'c']);

    expect(expectOk(await repository.list({ ...base, collectionId: 'research', text: 'deep' })).map(item => item.id)).toEqual(['a']);
    expect(expectOk(await repository.list({ ...base, collectionId: 'research', type: 'link' })).map(item => item.id)).toEqual(['b']);
    expect(expectOk(await repository.list({ ...base, collectionId: 'research', tagKey: 'AI' })).map(item => item.id)).toEqual(['a', 'b']);
    expect(expectOk(await repository.list({ ...base, collectionId: 'research', pinned: true })).map(item => item.id)).toEqual(['a']);
    expect(expectOk(await repository.list({ ...base, tagKey: 'ai', type: 'note' })).map(item => item.id)).toEqual(['a']);
    expect(expectOk(await repository.list({ ...base, tagKey: 'AI', text: 'example' })).map(item => item.id)).toEqual(['b']);
    expect(expectOk(await repository.list({ ...base, pinned: true, type: 'image' })).map(item => item.id)).toEqual(['c']);
    expect(expectOk(await repository.list({ ...base, pinned: true, text: 'pricing' })).map(item => item.id)).toEqual(['a']);
    expect(expectOk(await repository.list({ ...base, hasTags: false, text: 'visual' })).map(item => item.id)).toEqual(['c']);
    expect(expectOk(await repository.list({ ...base, hasCollection: false, type: 'image' })).map(item => item.id)).toEqual(['c']);
    expect(expectOk(await repository.list({ ...base, archived: true, collectionId: 'research' })).map(item => item.id)).toEqual(['d']);
    expect(expectOk(await repository.list({ ...base, archived: true, tagKey: 'ai' })).map(item => item.id)).toEqual(['d']);
    expect(expectOk(await repository.list({ ...base, collectionId: 'research', sort: 'title_asc' })).map(item => item.id)).toEqual(['b', 'a']);

    expect(expectOk(await repository.list(createSmartViewQuery('pinned').query)).map(item => item.id)).toEqual(['a', 'c']);
    expect(expectOk(await repository.list(createSmartViewQuery('untagged').query)).map(item => item.id)).toEqual(['c']);
    expect(expectOk(await repository.list(createSmartViewQuery('unfiled').query)).map(item => item.id)).toEqual(['c']);
  });

  it('aggregates active tag counts with stable display spelling and provides Library counts', async () => {
    const { db, repository } = await makeRepository();
    db.raw.prepare('INSERT INTO collections (id, name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('research', 'Research', 'research', 1, 1);
    const insertItem = db.raw.prepare(
      `INSERT INTO items (id, type, title, body, url, image_path, asset_id, created_at, updated_at, archived, collection_id, pinned)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // Earliest spelling is archived; it remains the deterministic display source but contributes zero to active count.
    insertItem.run('old', 'note', 'Old', 'Old', null, null, null, 50, 50, 1, 'research', 0);
    insertItem.run('n1', 'note', 'One', 'Body', null, null, null, 100, 100, 0, 'research', 1);
    insertItem.run('l1', 'link', 'Two', null, 'https://example.com', null, null, 200, 200, 0, null, 0);
    insertItem.run('i1', 'image', 'Three', null, null, 'images/three.png', 'asset-i1', 300, 300, 0, null, 0);
    const insertTag = db.raw.prepare('INSERT INTO item_tags (item_id, tag_key, display, ordinal) VALUES (?, ?, ?, ?)');
    insertTag.run('old', 'ai', 'Ai Original', 0);
    insertTag.run('old', 'archived-only', 'Archived Only', 1);
    insertTag.run('n1', 'ai', 'AI', 0);
    insertTag.run('l1', 'ai', 'ai', 0);
    insertTag.run('l1', 'reading', 'Reading', 1);

    const tags = expectOk(await repository.listTags());
    expect(tags).toEqual([
      { key: 'ai', display: 'Ai Original', activeItemCount: 2 },
      { key: 'reading', display: 'Reading', activeItemCount: 1 },
    ]);

    const overview = expectOk(await repository.getLibraryOverview());
    expect(overview.activeItemCount).toBe(3);
    expect(overview.archivedItemCount).toBe(1);
    expect(overview.collections).toEqual([
      expect.objectContaining({ id: 'research', activeItemCount: 1 }),
    ]);
    expect(overview.tags).toEqual(tags);
    expect(overview.smartViews).toEqual({ pinned: 1, untagged: 1, unfiled: 2 });
    expect(overview.types).toEqual({ note: 1, link: 1, image: 1 });
  });
});
