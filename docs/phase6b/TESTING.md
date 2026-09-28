# Phase 6B verification and test matrix

## Static/client suite (Vitest)

- all pre-existing Phase 6A tests remain in `tests/sync/**` and must not be weakened;
- `tests/auth/SupabaseAuthService.test.ts` covers local-only config, no/restored session, secure-storage adapter, refresh, magic-link request, current-device/global sign-out, generation behavior and account-deletion boundary;
- `tests/sync/transport/SupabaseSyncTransport.test.ts` verifies RPC routes, authenticated bearer use, frozen request envelope and no-token rejection;
- `tests/backend/sourceContract.test.ts` guards production SQLite v2/no App sync wiring, per-account head ordering, bootstrap materialization, RPC hardening, lifetime state/retention, immutable Storage policy and secret safety.

Run:

```text
npm ci
npx expo install --check
npm run typecheck
npm test
npm run export:android
```

## Supabase database test

`supabase/tests/001_phase6b_contract.sql` runs through `supabase test db` (pgTAP) and verifies the core schema, RPC exposure, RPC/table privileges, RLS, private bucket and explicit retention floor.

Recommended clean run:

```text
supabase start
supabase db reset
supabase test db
```

## Real concurrent PostgreSQL harness

`tests/backend/live-postgres.mjs` requires a **throwaway, migrated test database** and `psql`. It opens separate real PostgreSQL client processes; it is not a mock or in-memory substitute.

```text
TUCK_TEST_DATABASE_URL=<isolated-db-url> node tests/backend/live-postgres.mjs
```

It covers:

- same-account writer blocking and commit ordering;
- same-account rollback proving an uncommitted sequence/result does not survive;
- different accounts not serializing on one global lock;
- same-ID/same-payload replay and same-ID/different-payload rejection;
- malformed outer request rejection, wrong-account RPC rejection and wrong-user entity-ID non-enumeration;
- bootstrap during an uncommitted writer (old head + old entity), then catch-up pull;
- bootstrap after a committed writer (new head + new entity);
- disjoint stale-base merge, authored same-field conflict and version advancement;
- Item hard-delete tombstone/resurrection prevention plus Collection delete rollback/atomic commit, Item unfiling/version bump while preserving `updatedAt`, Collection lifetime tombstone and stale ID resurrection prevention;
- one ready Asset referenced by multiple Items;
- finite pull target, deterministic pagination and stale cursor -> `rebootstrap_required`.

The Storage cross-prefix boundary is additionally represented by the source-controlled bucket policy and pgTAP privilege/policy checks. When a local Supabase Storage API is available, manual/API-level wrong-prefix upload/read checks should be included in the release evidence because Storage API behavior cannot be faithfully replaced by a fake.

## BLOCKED classification

If Docker, Supabase CLI, `psql`, package-network access or the required local services are unavailable, the affected command is **BLOCKED**, never PASS. Do not substitute the Phase 6A fake/reference server for the required real PostgreSQL concurrency suite.
