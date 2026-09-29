# Phase 6B backend implementation notes

## Account identity and authorization

`auth.users.id` is the sole account authority. A trigger initializes `public.accounts` and `private.account_sync_heads`. Hardened RPC caller identity is derived from the validated JWT subject through `private.tuck_current_user_id()`, which mirrors `auth.uid()` null/UUID semantics without requiring the custom RPC owner to access Supabase's protected `auth` schema. RPC request `accountId` is only a protocol field and must equal that derived caller identity. Direct client DML is revoked; public user-owned tables have own-row RLS for defense in depth, while protocol tables live in the non-exposed `private` schema.

The public RPCs are `SECURITY DEFINER` functions owned by the dedicated `tuck_rpc_owner` (`NOLOGIN`, `NOINHERIT`, `BYPASSRLS`) role. Client roles cannot execute private helpers, cannot execute public sync RPCs as `anon`, and cannot directly read/write protocol state. Functions use a fixed search path, schema-qualified authenticated identity and no dynamic SQL.

## Transactional account sequencing

`private.account_sync_heads` is the synchronization authority. A valid first-seen mutation takes the account head row lock before reading mutable canonical state. Each visible logical change calls `private.allocate_change_seq`, which updates that same row and returns the new head. The entity/version write, `sync_changes`, tombstone (when needed) and processed-mutation result commit in the same PostgreSQL transaction.

There is no identity, sequence or `nextval()` ordering authority. Same-account writers serialize on one row; different accounts lock different rows.

## Idempotency

A canonical SHA-256 fingerprint of PostgreSQL `jsonb` text plus `(user_id, mutation_id)` is stored in `private.processed_mutations` for protocol-v1 account lifetime.

- same mutation UUID + same canonical payload returns the stored result and does not allocate another sequence;
- same mutation UUID + different payload returns `MUTATION_ID_REUSE` and does not mutate/advance the head;
- valid deterministic conflicts/rejections are stored too;
- structurally malformed mutations are rejected before they qualify as a canonical processed mutation, matching the Phase 6A reference model.

## Merge/version behavior

The migration implements the Phase 6A policies rather than last-write-wins:

- authored Item fields (`title`, `body`, `url`, `assetId`) detect same-field divergence;
- `tags` use the frozen three-way merge/normalization rule;
- `collectionId`, `pinned`, `archived` follow metadata/server-order rules;
- Collection rename divergence produces `COLLECTION_RENAME_CONFLICT`;
- deletes require the exact current server version and produce `STALE_DELETE` otherwise;
- `updatedAt` is domain metadata, not the concurrency version;
- no semantic Item/Collection change returns accepted `changed=false` with no new sequence/version.

## Collection delete transaction

Collection delete runs inside the mutation transaction. Affected Items are processed deterministically by ID, unfiled without changing their domain `updatedAt`, incremented in server version and emitted as full Item changes. The Collection is then deleted, lifetime-tombstoned and emitted as a delete change. Any unexpected PostgreSQL error rolls the whole RPC transaction back.

## Pull and retention

`pullChanges` captures the current committed account head when no `targetHeadSequence` is supplied. Every page is bounded by `afterSequence < seq <= targetHeadSequence`, ordered by sequence, and returns continuation state. A cursor below `change_retention_floor_seq - 1` returns `rebootstrap_required` rather than skipping history.

Each new change has `retain_until = now() + 90 days`. `private.prune_expired_sync_changes` exists for controlled/admin execution and updates the account retention floor. Phase 6B intentionally installs no destructive cron. Tombstones and processed mutations are not pruned by this helper.

## Bootstrap consistency

Initial bootstrap materialization uses one data-modifying SQL statement with materialized CTEs for the committed account head and canonical Collections/Items/ready Assets. PostgreSQL statement-level MVCC therefore gives one paired visibility point even if the surrounding PostgREST transaction is `READ COMMITTED`: an uncommitted writer contributes neither head nor entity state; a writer committed before the statement contributes both.

That immutable materialization is stored in a one-hour session and paginated by ordinal. Continuation after expiry returns `bootstrap_expired`. A subsequent bounded pull from `snapshotHeadSequence` catches changes that committed after the snapshot.

## Assets and Storage

`public.assets` has `staging` and `ready` states. Creating staging metadata emits no `sync_change`. `tuck_finalize_asset` serializes on the account head, verifies the expected private Storage object, byte size and MIME type, transitions `staging -> ready`, increments the Asset server version and emits the ready Asset upsert.

The `tuck-assets` bucket is private. Authenticated clients may insert once under their own `<auth.uid()>/<assetId>/...` prefix and read only their own prefix. Client UPDATE/DELETE policies are intentionally absent so ready objects cannot be overwritten/deleted. Eventual staging-orphan cleanup and zero-live-reference GC remain privileged future operations; no production GC is installed in 6B.

## Android boundary

`SupabaseSyncTransport` is only a future network boundary. Phase 6B makes no changes to `src/data/SQLiteItemRepository.ts`, controllers, UI, navigation or `App.tsx`; no local CRUD schedules a push, no remote change is applied to Android SQLite, and no image upload/download is wired.
