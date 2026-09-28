import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-sqlite', () => ({ openDatabaseAsync: vi.fn() }));
vi.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, Paths: { document: 'file:///tmp' } }));
vi.mock('react-native', () => ({ Image: { getSize: vi.fn() } }));

import * as SQLite from 'expo-sqlite';
import type { RelativeImagePath, Result } from '../../src/contracts';
import { SQLiteItemRepository } from '../../src/data/SQLiteItemRepository';
import type { PersistentImageStore } from '../../src/data/PersistentImageStore';

const orphan = 'images/orphan.jpg' as RelativeImagePath;
const noteRow = {
  id: 'note-1', type: 'note' as const, title: 'Kept metadata', body: 'Readable body', url: null,
  image_path: null, created_at: 1, updated_at: 2, archived: 0,
  tag_key: 'work', tag_display: 'Work', tag_ordinal: 0,
};

function createDatabase(quickCheck = 'ok') {
  return {
    execAsync: vi.fn(async () => undefined),
    withExclusiveTransactionAsync: vi.fn(async (task: (tx: unknown) => Promise<void>) => task({})),
    runAsync: vi.fn(async () => ({ changes: 1, lastInsertRowId: 0 })),
    getFirstAsync: vi.fn(async (sql: string) => {
      if (sql.includes('PRAGMA user_version')) return { user_version: 2 };
      if (sql.includes('PRAGMA quick_check')) return { quick_check: quickCheck };
      if (sql.includes('COUNT(*) AS count')) return { count: 0 };
      return null;
    }),
    getAllAsync: vi.fn(async (sql: string) => {
      if (sql.includes('pending_file_deletions')) return [];
      if (sql.includes('SELECT image_path FROM items')) return [];
      if (sql.includes('FROM items i')) return [noteRow];
      return [];
    }),
  };
}

describe('SQLiteItemRepository initialization boundaries', () => {
  it('keeps metadata available after recoverable image enumeration failure and later reconciles it', async () => {
    const db = createDatabase();
    vi.mocked(SQLite.openDatabaseAsync).mockResolvedValue(db as never);
    let enumerationCalls = 0;
    const imageStore = {
      prepare: vi.fn(() => ({ ok: true, value: undefined }) as Result<void>),
      removeFile: vi.fn(async () => ({ ok: true, value: undefined } as const)),
      listOwnedRelativePaths: vi.fn(() => {
        enumerationCalls += 1;
        return enumerationCalls === 1
          ? ({ ok: false, error: { code: 'OPEN_FAILED', message: 'Directory temporarily unavailable.', field: 'image' } } as const)
          : ({ ok: true, value: [orphan] } as Result<readonly RelativeImagePath[]>);
      }),
    } as unknown as PersistentImageStore;
    const repository = new SQLiteItemRepository(imageStore);

    await expect(repository.initialize()).resolves.toEqual({ ok: true, value: undefined });
    const listed = await repository.list({ archived: false, text: '', type: 'all', tagKey: null });
    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error('expected metadata list');
    expect(listed.value[0]).toMatchObject({ id: 'note-1', title: 'Kept metadata', body: 'Readable body' });
    expect(imageStore.removeFile).not.toHaveBeenCalled();

    await expect(repository.retryPendingFileCleanup()).resolves.toEqual({ ok: true, value: { remaining: 0 } });
    expect(imageStore.listOwnedRelativePaths).toHaveBeenCalledTimes(2);
    expect(imageStore.removeFile).toHaveBeenCalledWith(orphan);
  });

  it('still fails initialization when the cleanup queue cannot be read from SQLite', async () => {
    const db = createDatabase();
    db.getAllAsync.mockImplementation(async (sql: string) => {
      if (sql.includes('pending_file_deletions')) throw new Error('sqlite read failed');
      if (sql.includes('SELECT image_path FROM items')) return [];
      if (sql.includes('FROM items i')) return [noteRow];
      return [];
    });
    vi.mocked(SQLite.openDatabaseAsync).mockResolvedValue(db as never);
    const imageStore = {
      prepare: vi.fn(() => ({ ok: true, value: undefined }) as Result<void>),
      removeFile: vi.fn(async () => ({ ok: true, value: undefined } as const)),
      listOwnedRelativePaths: vi.fn(() => ({ ok: true, value: [] }) as Result<readonly RelativeImagePath[]>),
    } as unknown as PersistentImageStore;
    const repository = new SQLiteItemRepository(imageStore);

    const initialized = await repository.initialize();
    expect(initialized.ok).toBe(false);
    if (initialized.ok) throw new Error('expected initialization failure');
    expect(initialized.error.code).toBe('INIT_FAILED');

    const listed = await repository.list({ archived: false, text: '', type: 'all', tagKey: null });
    expect(listed.ok).toBe(false);
    if (listed.ok) throw new Error('expected blocked metadata access');
    expect(listed.error.code).toBe('DB_FAILED');
    expect(imageStore.listOwnedRelativePaths).not.toHaveBeenCalled();
  });

  it('still blocks repository access when SQLite integrity verification fails', async () => {
    const db = createDatabase('*** database corruption detected ***');
    vi.mocked(SQLite.openDatabaseAsync).mockResolvedValue(db as never);
    const imageStore = {
      prepare: vi.fn(() => ({ ok: true, value: undefined }) as Result<void>),
      removeFile: vi.fn(async () => ({ ok: true, value: undefined } as const)),
      listOwnedRelativePaths: vi.fn(() => ({ ok: true, value: [] }) as Result<readonly RelativeImagePath[]>),
    } as unknown as PersistentImageStore;
    const repository = new SQLiteItemRepository(imageStore);

    const initialized = await repository.initialize();
    expect(initialized.ok).toBe(false);
    if (initialized.ok) throw new Error('expected initialization failure');
    expect(initialized.error.code).toBe('INIT_FAILED');

    const listed = await repository.list({ archived: false, text: '', type: 'all', tagKey: null });
    expect(listed.ok).toBe(false);
    if (listed.ok) throw new Error('expected blocked metadata access');
    expect(listed.error.code).toBe('DB_FAILED');
    expect(imageStore.listOwnedRelativePaths).not.toHaveBeenCalled();
  });
});
