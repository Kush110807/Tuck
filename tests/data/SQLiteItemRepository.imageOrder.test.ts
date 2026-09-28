import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-sqlite', () => ({ openDatabaseAsync: vi.fn() }));
vi.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, Paths: { document: 'file:///tmp' } }));
vi.mock('react-native', () => ({ Image: { getSize: vi.fn() } }));

import * as SQLite from 'expo-sqlite';
import type { ImageSelection, RelativeImagePath, Result } from '../../src/contracts';
import { SQLiteItemRepository } from '../../src/data/SQLiteItemRepository';
import type { PersistentImageStore } from '../../src/data/PersistentImageStore';

const oldPath = 'images/old.jpg' as RelativeImagePath;
const newPath = 'images/new.jpg' as RelativeImagePath;
const selection: ImageSelection = { temporaryUri: 'file:///tmp/new.jpg', mimeType: 'image/jpeg', reportedBytes: 100 };

const imageRow = {
  id: 'image-1', type: 'image' as const, title: 'Old title', body: 'Old caption', url: null,
  image_path: oldPath, created_at: 1000, updated_at: 1000, archived: 0,
};

function createDatabase(events: string[], options: { failItemUpdate?: boolean } = {}) {
  const pending = new Set<string>();
  const db: Record<string, unknown> = {};
  db.execAsync = vi.fn(async () => undefined);
  db.getFirstAsync = vi.fn(async (sql: string) => {
    if (sql.includes('PRAGMA user_version')) return { user_version: 2 };
    if (sql.includes('PRAGMA quick_check')) return { quick_check: 'ok' };
    if (sql.includes('COUNT(*) AS count')) return { count: pending.size };
    if (sql.includes('FROM items WHERE id = ?')) return imageRow;
    return null;
  });
  db.getAllAsync = vi.fn(async (sql: string) => {
    if (sql.includes('pending_file_deletions')) return [...pending].map(path => ({ path }));
    if (sql.includes('SELECT image_path FROM items')) return [{ image_path: oldPath }];
    if (sql.includes('FROM item_tags')) return [{ tag_key: 'ideas', tag_display: 'Ideas', tag_ordinal: 0 }];
    return [];
  });
  db.runAsync = vi.fn(async (sql: string, ...args: unknown[]) => {
    if (sql.includes('INSERT INTO pending_file_deletions')) {
      events.push(`queue:${String(args[0])}`);
      pending.add(String(args[0]));
    } else if (sql.includes('UPDATE items')) {
      events.push('db:update-item');
      if (options.failItemUpdate) throw new Error('forced update failure');
    } else if (sql.includes('DELETE FROM items')) {
      events.push('db:delete-item');
    } else if (sql.includes('DELETE FROM pending_file_deletions')) {
      events.push(`dequeue:${String(args[0])}`);
      pending.delete(String(args[0]));
    }
    return { changes: 1, lastInsertRowId: 0 };
  });
  db.withExclusiveTransactionAsync = vi.fn(async (task: (tx: unknown) => Promise<void>) => {
    const snapshot = new Set(pending);
    try {
      await task(db);
    } catch (error) {
      pending.clear();
      for (const path of snapshot) pending.add(path);
      throw error;
    }
  });
  return { db, pending };
}

function createImageStore(events: string[]) {
  return {
    prepare: () => ({ ok: true, value: undefined }) as Result<void>,
    copySelected: vi.fn(async () => {
      events.push('copy:new');
      return { ok: true, value: newPath } as const;
    }),
    removeFile: vi.fn(async (path: RelativeImagePath) => {
      events.push(`remove:${path}`);
      return { ok: true, value: undefined } as const;
    }),
    resolve: vi.fn(async () => ({ ok: true, value: { kind: 'missing' } } as const)),
    listOwnedRelativePaths: () => ({ ok: true, value: [] }) as Result<readonly RelativeImagePath[]>,
  } as unknown as PersistentImageStore;
}

async function initializedRepository(events: string[], options: { failItemUpdate?: boolean } = {}) {
  const { db, pending } = createDatabase(events, options);
  vi.mocked(SQLite.openDatabaseAsync).mockResolvedValue(db as never);
  const imageStore = createImageStore(events);
  const repository = new SQLiteItemRepository(imageStore, { now: () => 2000 });
  await expect(repository.initialize()).resolves.toEqual({ ok: true, value: undefined });
  events.length = 0;
  return { repository, imageStore, pending };
}

describe('SQLiteItemRepository image operation ordering', () => {
  it('copies replacement first, commits new reference/old cleanup queue, then removes the old file', async () => {
    const events: string[] = [];
    const { repository } = await initializedRepository(events);

    const result = await repository.update({
      id: imageRow.id, type: 'image', expectedUpdatedAt: imageRow.updated_at,
      changes: { image: { kind: 'replace', selection } },
    });

    expect(result.ok).toBe(true);
    expect(events.indexOf('copy:new')).toBeLessThan(events.indexOf(`queue:${oldPath}`));
    expect(events.indexOf(`queue:${oldPath}`)).toBeLessThan(events.indexOf('db:update-item'));
    expect(events.indexOf('db:update-item')).toBeLessThan(events.indexOf(`remove:${oldPath}`));
  });

  it('cleans the new replacement copy and never removes the old file when the DB transaction fails', async () => {
    const events: string[] = [];
    const { repository, pending } = await initializedRepository(events, { failItemUpdate: true });

    const result = await repository.update({
      id: imageRow.id, type: 'image', expectedUpdatedAt: imageRow.updated_at,
      changes: { image: { kind: 'replace', selection } },
    });

    expect(result.ok).toBe(false);
    expect(events).toContain('copy:new');
    expect(events).toContain(`remove:${newPath}`);
    expect(events).not.toContain(`remove:${oldPath}`);
    expect(pending.has(oldPath)).toBe(false);
  });

  it('queues an image before deleting metadata and removes the physical file only after commit', async () => {
    const events: string[] = [];
    const { repository } = await initializedRepository(events);

    await expect(repository.remove(imageRow.id, imageRow.updated_at)).resolves.toEqual({ ok: true, value: undefined });

    expect(events.indexOf(`queue:${oldPath}`)).toBeLessThan(events.indexOf('db:delete-item'));
    expect(events.indexOf('db:delete-item')).toBeLessThan(events.indexOf(`remove:${oldPath}`));
  });

  it('retains the original image and metadata when replacement validation/copy fails before the transaction', async () => {
    const events: string[] = [];
    const { repository, imageStore } = await initializedRepository(events);
    vi.mocked(imageStore.copySelected).mockResolvedValue({
      ok: false,
      error: { code: 'IMAGE_UNSUPPORTED', message: 'Corrupt image.', field: 'image' },
    });

    const result = await repository.update({
      id: imageRow.id, type: 'image', expectedUpdatedAt: imageRow.updated_at,
      changes: { image: { kind: 'replace', selection } },
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'IMAGE_UNSUPPORTED', message: 'Corrupt image.', field: 'image' },
    });
    expect(events).not.toContain(`queue:${oldPath}`);
    expect(events).not.toContain('db:update-item');
    expect(events).not.toContain(`remove:${oldPath}`);
  });
});
