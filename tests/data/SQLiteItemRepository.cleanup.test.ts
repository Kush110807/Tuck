import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-sqlite', () => ({ openDatabaseAsync: vi.fn() }));
vi.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, Paths: { document: 'file:///tmp' } }));
vi.mock('react-native', () => ({ Image: { getSize: vi.fn() } }));

import * as SQLite from 'expo-sqlite';
import type { RelativeImagePath, Result } from '../../src/contracts';
import { SQLiteItemRepository } from '../../src/data/SQLiteItemRepository';
import type { PersistentImageStore } from '../../src/data/PersistentImageStore';

const queuedPath = 'images/orphan.jpg' as RelativeImagePath;

function createFakeDatabase() {
  return {
    execAsync: vi.fn(async () => undefined),
    withExclusiveTransactionAsync: vi.fn(async (task: (tx: unknown) => Promise<void>) => task({})),
    runAsync: vi.fn(async () => ({ changes: 1, lastInsertRowId: 0 })),
    getFirstAsync: vi.fn(async (sql: string) => {
      if (sql.includes('PRAGMA user_version')) return { user_version: 2 };
      if (sql.includes('PRAGMA quick_check')) return { quick_check: 'ok' };
      if (sql.includes('COUNT(*) AS count')) return { count: 1 };
      return null;
    }),
    getAllAsync: vi.fn(async (sql: string) => {
      if (sql.includes('pending_file_deletions')) return [{ path: queuedPath }];
      if (sql.includes('SELECT image_path FROM items')) return [];
      if (sql.includes('FROM items i')) return [];
      return [];
    }),
  };
}

describe('SQLiteItemRepository cleanup resilience', () => {
  it('keeps metadata access available when a queued image deletion still cannot be removed', async () => {
    const db = createFakeDatabase();
    vi.mocked(SQLite.openDatabaseAsync).mockResolvedValue(db as never);

    const imageStore = {
      prepare: () => ({ ok: true, value: undefined }) as Result<void>,
      removeFile: vi.fn(async () => ({
        ok: false,
        error: { code: 'OPEN_FAILED', message: 'File is temporarily locked.' },
      } as const)),
      listOwnedRelativePaths: () => ({ ok: true, value: [queuedPath] }) as Result<readonly RelativeImagePath[]>,
    } as unknown as PersistentImageStore;

    const repository = new SQLiteItemRepository(imageStore);

    await expect(repository.initialize()).resolves.toEqual({ ok: true, value: undefined });
    await expect(repository.list({ archived: false, text: '', type: 'all', tagKey: null }))
      .resolves.toEqual({ ok: true, value: [] });
    await expect(repository.retryPendingFileCleanup()).resolves.toEqual({ ok: true, value: { remaining: 1 } });

    expect(imageStore.removeFile).toHaveBeenCalled();
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO pending_file_deletions'),
      queuedPath,
      expect.any(Number),
    );
  });
});
