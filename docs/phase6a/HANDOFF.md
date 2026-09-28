# Phase 6A Handoff — Architecture & Contract Freeze

This handoff is for review of the Phase 6A candidate built directly on accepted baseline `813999a097b15a40d94fcbba8f4f14577d40261c`.

The candidate's exact final Git SHA and ZIP SHA-256 are reported with the delivered artifact rather than hard-coded into this tracked file.

## Scope completed

Phase 6A freezes, without deploying production sync:

- cross-device architecture invariants;
- schema-v3 local design and atomic v2→v3 migration specification;
- PostgreSQL server schema specification;
- Auth/RLS/RPC/Storage security contract;
- protocol-v1 TypeScript payloads;
- bootstrap snapshot and `INITIAL_SYNC_COMPLETE` definition;
- push/pull ordering, idempotency and retention rules;
- exact merge/conflict policies;
- conflict-copy behavior;
- account profile/logout/cache-removal behavior;
- image/asset state machine;
- deterministic fake server and test harness.

## Frozen bootstrap decision

Bootstrap uses a one-hour server-materialized snapshot session created from a single REPEATABLE READ database view. The session contains immutable, ordinal-paginated canonical Collection/Item/asset entries and a `snapshotHeadSequence` captured from the same view.

After the final bootstrap page, the client performs a bounded catch-up pull to a finite captured `targetHeadSequence`. Initial sync is complete only when that target cursor and all corresponding changes are atomically applied and persisted.

## Frozen retention decisions

- incremental `sync_changes`: minimum rolling 90 days;
- account records expose a retention floor;
- cursor below `floor - 1`: `rebootstrap_required`;
- Item/Collection tombstones: account lifetime;
- processed mutation/idempotency records: account lifetime in protocol v1.

## Frozen conflict decisions

- disjoint Item field edits: merge;
- title/body-caption/URL/image replacement concurrent same-field edits: conflict, never silent loss;
- tags: three-way normalized set merge;
- Collection assignment: later server-processed assignment wins if destination exists; deleted destination → Unfiled;
- pin/archive: later server-processed value wins;
- Collection rename/rename: explicit conflict;
- stale hard delete after entity version advanced: conflict;
- remote delete followed by offline Item edit: tombstone keeps original deleted, local work becomes conflict copy;
- no conflict rule uses client timestamps.

## Conflict-copy contract

A new locally generated stable ID is used. The user's local desired Item is copied, tags/archive/pin are preserved, Collection is preserved only if it still exists, and the title gets ` (conflict copy)` with code-point truncation to stay within the existing title limit. The copy is an ordinary local create and enters the outbox with a new mutation ID.

## Profile/logout contract

`local-only`, `account:A`, `account:B` use distinct SQLite/storage namespaces. Normal logout pauses/hides an account profile but retains its DB, unsynced outbox and asset state. Explicit local cache removal is separate and blocked while the profile is active or contains unsynced-only work/pending asset transfers.

## Asset contract

`assetId` is stable cloud identity. Existing `imagePath` remains device-local path. `asset_sync_state` distinguishes remote-known/not-downloaded, download pending/failed, locally available, genuinely missing/corrupt, upload pending/failed and remote staging/ready. Existing Phase 5A/5B-A image files are preserved byte-for-byte by the designed v2→v3 migration.

## Reference-model test inventory

The deterministic Phase 6A tests cover:

- protocol JSON serialization;
- duplicate mutation/idempotency;
- old retry after later mutation;
- server-version mismatch;
- disjoint title/body merge;
- body/body conflict;
- title/title conflict;
- tag three-way merge;
- pin concurrency;
- archive/restore concurrency;
- content edit vs archive;
- Collection rename conflict;
- Collection delete vs assignment;
- remote delete vs offline edit;
- stale delete after remote edit;
- wrong device clock;
- malformed mutation;
- wrong-account request;
- second-device bootstrap;
- mutation during bootstrap;
- interrupted bootstrap resume;
- repeated pull;
- expired cursor / rebootstrap;
- conflict-copy details;
- account switch/logout with pending outbox;
- safe account-cache removal;
- global logout;
- remotely deleted account;
- remote image known but not downloaded;
- upload/download retry states.

## Verification classification

The candidate contains no real Supabase client, no authentication flow, no network transport, no image transfer implementation, no sync UI and no web app.

Dependency-backed canonical Expo/Vitest commands must be run in an environment where `npm ci` can materialize the exact lockfile. If the delivery environment cannot access the missing npm package cache/registry, those commands are **NOT RUN**, not passed.

Phase 6A is not an independent review and this handoff makes no such claim.
