import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/202609290001_phase6b_backend_auth_foundation.sql'), 'utf8');
const sqlite = fs.readFileSync(path.join(root, 'src/data/SQLiteItemRepository.ts'), 'utf8');
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');

describe('Phase 6B repository/source invariants', () => {
  it('keeps Android production SQLite on schema v2 and does not wire sync into App.tsx', () => {
    expect(sqlite).toContain('const SCHEMA_VERSION = 2;');
    expect(sqlite).not.toContain('sync_outbox');
    expect(app).not.toMatch(/SupabaseSyncTransport|tuck_push_mutations|SyncEngine/);
  });

  it('uses account-scoped transactional head allocation, never identity/serial ordering', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS private.account_sync_heads');
    expect(migration).toContain('SET head_seq = head_seq + 1');
    expect(migration).toContain('FOR UPDATE');
    expect(migration).not.toMatch(/GENERATED\s+.*IDENTITY|\bSERIAL\b|nextval\s*\(/i);
    expect(migration).toContain('PRIMARY KEY (user_id, seq)');
  });

  it('materializes bootstrap head/entities through one statement-level MVCC snapshot', () => {
    expect(migration).toContain('WITH snapshot_head AS MATERIALIZED');
    expect(migration).toContain('snapshots AS MATERIALIZED');
    expect(migration).toContain("now()+interval '1 hour'");
    expect(migration).toContain('ONE PostgreSQL MVCC');
  });

  it('hardens RPCs and private protocol state', () => {
    for (const fn of ['tuck_push_mutations', 'tuck_pull_changes', 'tuck_bootstrap']) {
      expect(migration).toContain(`FUNCTION public.${fn}`);
    }
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('CREATE ROLE tuck_rpc_owner NOLOGIN NOINHERIT BYPASSRLS');
    expect(migration).toContain('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO tuck_rpc_owner');
    expect(migration).toContain('GRANT USAGE ON SCHEMA auth TO tuck_rpc_owner;');
    expect(migration).not.toContain('GRANT SELECT ON auth.users');
    const membershipGrant = migration.indexOf('GRANT tuck_rpc_owner TO postgres;');
    const firstOwnerTransfer = migration.indexOf('ALTER FUNCTION public.tuck_push_mutations(jsonb) OWNER TO tuck_rpc_owner;');
    const lastOwnerTransfer = migration.indexOf('ALTER FUNCTION private.initialize_tuck_account() OWNER TO tuck_rpc_owner;');
    const finalExecuteGrant = migration.indexOf('GRANT EXECUTE ON FUNCTION public.tuck_finalize_asset(text,text) TO authenticated;');
    const finalComment = migration.indexOf("'Protocol-v1 bounded pull over retained immutable per-account sync_changes.';");
    const membershipRevoke = migration.indexOf('REVOKE tuck_rpc_owner FROM postgres;');
    expect(membershipGrant).toBeGreaterThan(-1);
    expect(membershipGrant).toBeLessThan(firstOwnerTransfer);
    expect(membershipRevoke).toBeGreaterThan(lastOwnerTransfer);
    expect(membershipRevoke).toBeGreaterThan(finalExecuteGrant);
    expect(membershipRevoke).toBeGreaterThan(finalComment);
    expect(migration.match(/GRANT tuck_rpc_owner TO postgres;/g)).toHaveLength(1);
    expect(migration.match(/REVOKE tuck_rpc_owner FROM postgres;/g)).toHaveLength(1);
  });

  it('keeps tombstones/idempotency account-lifetime and storage private', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS private.entity_tombstones');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS private.processed_mutations');
    expect(migration).toContain("VALUES('tuck-assets','tuck-assets',false");
    expect(migration).toContain('DROP POLICY IF EXISTS tuck_assets_update_own ON storage.objects');
    expect(migration).not.toContain('CREATE POLICY tuck_assets_update_own');
    expect(migration).not.toContain('CREATE POLICY tuck_assets_delete_own');
    expect(migration).toContain("retain_until timestamptz NOT NULL DEFAULT (now() + interval '90 days')");
  });

  it('does not contain committed service-role/database/JWT signing credentials', () => {
    const trackedText = [
      migration,
      fs.readFileSync(path.join(root, '.env.example'), 'utf8'),
      fs.readFileSync(path.join(root, 'src/config/supabase.ts'), 'utf8'),
    ].join('\n');
    expect(trackedText).not.toMatch(/service[_-]?role\s*[=:]\s*['\"][A-Za-z0-9._-]{20,}/i);
    expect(trackedText).not.toMatch(/postgres(?:ql)?:\/\/[^\s:]+:[^\s@]{8,}@/i);
    expect(trackedText).not.toMatch(/jwt[_-]?(?:secret|signing)\s*[=:]\s*['\"][^'\"]{12,}/i);
  });
});
