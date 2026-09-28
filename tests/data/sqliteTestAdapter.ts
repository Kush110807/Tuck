import { DatabaseSync } from 'node:sqlite';

type FailureHook = (sql: string) => void;

function flattenArgs(args: unknown[]): unknown[] {
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  return args;
}

export class SQLiteTestAdapter {
  readonly raw: DatabaseSync;
  private failureHook: FailureHook | null = null;

  constructor() {
    this.raw = new DatabaseSync(':memory:');
  }

  setFailureHook(hook: FailureHook | null): void {
    this.failureHook = hook;
  }

  async execAsync(sql: string): Promise<void> {
    this.failureHook?.(sql);
    this.raw.exec(sql);
  }

  async runAsync(sql: string, ...args: unknown[]): Promise<{ changes: number; lastInsertRowId: number }> {
    this.failureHook?.(sql);
    const result = this.raw.prepare(sql).run(...flattenArgs(args) as never[]);
    return {
      changes: Number(result.changes),
      lastInsertRowId: Number(result.lastInsertRowid),
    };
  }

  async getFirstAsync<T>(sql: string, ...args: unknown[]): Promise<T | null> {
    this.failureHook?.(sql);
    const row = this.raw.prepare(sql).get(...flattenArgs(args) as never[]);
    return (row ?? null) as T | null;
  }

  async getAllAsync<T>(sql: string, ...args: unknown[]): Promise<T[]> {
    this.failureHook?.(sql);
    return this.raw.prepare(sql).all(...flattenArgs(args) as never[]) as T[];
  }

  async withExclusiveTransactionAsync(task: (tx: SQLiteTestAdapter) => Promise<void>): Promise<void> {
    this.raw.exec('BEGIN EXCLUSIVE');
    try {
      await task(this);
      this.raw.exec('COMMIT');
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.raw.close();
  }
}

export const V1_SCHEMA_SQL = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE items (
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
  CREATE TABLE item_tags (
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    tag_key TEXT NOT NULL,
    display TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    PRIMARY KEY (item_id, tag_key),
    UNIQUE (item_id, ordinal)
  );
  CREATE TABLE pending_file_deletions (
    path TEXT PRIMARY KEY NOT NULL,
    queued_at INTEGER NOT NULL
  );
  CREATE INDEX idx_items_archive_type_updated
    ON items (archived, type, updated_at DESC, id ASC);
  CREATE INDEX idx_item_tags_key
    ON item_tags (tag_key, item_id);
  PRAGMA user_version = 1;
`;
