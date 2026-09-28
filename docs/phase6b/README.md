# Tuck Phase 6B — Backend & Auth Foundation

Phase 6B implements the frozen Phase 6A server/auth boundary without connecting ordinary Android CRUD to the cloud. The Android repository remains local-first and `SQLiteItemRepository` remains production schema v2. Local schema v3/outbox/cursor/application of remote changes belong to Phase 6C/6D.

## What is implemented

- repository-backed Supabase configuration and one versioned PostgreSQL migration;
- authenticated account initialization from `auth.users`;
- public canonical tables plus private protocol tables;
- account-scoped transactional sequence allocation through `private.account_sync_heads`;
- immutable full-payload `sync_changes`, lifetime Item/Collection tombstones and lifetime processed-mutation idempotency;
- hardened `SECURITY DEFINER` RPCs for push, pull and bootstrap;
- Phase 6A merge/conflict/delete rules, including atomic Collection deletion;
- one-hour materialized bootstrap sessions produced from one PostgreSQL statement/MVCC snapshot;
- 90-day minimum change retention metadata and an admin/manual prune helper (no destructive cron);
- private `tuck-assets` bucket foundation, staging/finalize RPCs and immutable ready-asset behavior;
- Expo/React Native auth foundation for email magic-link initiation, session restore/refresh, local/global sign-out, account-deletion request boundary and session generations;
- HTTP RPC transport boundary for future sync composition; it is not imported by `App.tsx`, controllers, UI or the SQLite repository;
- source/client tests plus real-PostgreSQL/Supabase test suites.

## Dependencies

No runtime or dev dependency was added in Phase 6B. The client foundation uses Supabase's documented Auth/PostgREST HTTP endpoints through `fetch`, so the accepted Expo dependency tree is not upgraded just to establish an unused SDK composition root. `ExpoSecureStoreAuthStorage` is a structural adapter: later composition can inject an Expo SecureStore-compatible module when sign-in UI/account profile wiring is approved.

## Environment

Copy `.env.example` to an untracked `.env` (or set variables in the shell):

- `EXPO_PUBLIC_SUPABASE_URL` — public project URL.
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` — normal public anon/publishable key.
- `TUCK_TEST_DATABASE_URL` — **test shell only**, for the isolated live PostgreSQL harness. Never expose this as `EXPO_PUBLIC_*`.

Never commit a service-role key, database password, JWT signing secret, Storage admin credential or user token.

## Local Supabase

Prerequisites: Docker-compatible runtime, Supabase CLI and `psql` for the concurrent live harness.

```text
supabase start
supabase db reset
supabase test db
TUCK_TEST_DATABASE_URL=<local-test-db-url> node tests/backend/live-postgres.mjs
supabase stop
```

Equivalent package scripts are in `package.json`: `backend:start`, `backend:reset`, `test:backend:db`, `test:backend:live`, and `backend:stop`.

No dashboard-only schema/security edits are required. Migrations, bucket setup and policies are source-controlled.
