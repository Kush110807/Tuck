# Tuck Phase 6A — Architecture & Contract Freeze

Status: **design/reference-model only**. The live Android repository remains Phase 5B-A schema v2 and no Supabase/network/auth/web implementation is introduced by 6A.

Starting baseline: `813999a097b15a40d94fcbba8f4f14577d40261c`.

## Frozen architecture decisions

1. Android remains local-first. A normal user write succeeds when the local SQLite transaction commits.
2. Network availability is never required for normal local CRUD.
3. `SQLiteItemRepository` remains the accepted persistence foundation; Phase 6 layers sync around it rather than replacing it.
4. In the future schema-v3 implementation, a synchronizable domain mutation and its durable outbox record must commit in the **same SQLite transaction**.
5. Supabase/Postgres is the cloud architecture: Supabase Auth, PostgreSQL, RLS, private Storage and a Tuck-owned versioned sync protocol.
6. Android/web must not perform arbitrary cloud table CRUD as the synchronization mechanism.
7. Entity IDs are stable `TEXT` and identical local/cloud. No ID translation table is introduced.
8. `updatedAt` remains domain/display/sort metadata. It is never a concurrency token.
9. Local concurrency uses an opaque monotonically increasing `localRevision`. Cloud concurrency uses an independent integer entity `version`.
10. Incremental server changes use a monotonically increasing sequence and client cursor.
11. The local outbox stores high-level mutations, not only dirty snapshots.
12. Every mutation has a UUID idempotency key. Protocol-v1 processed mutation records are retained for the account lifetime.
13. Hard-deleted Items and Collections leave account-lifetime server tombstones.
14. Each local-only/account profile has a logically separate SQLite database and app-owned storage namespace.
15. Normal sign-out never deletes an account profile's unsynced outbox or local-only pending asset work.
16. `assetId` is cross-device image identity. `imagePath` remains the device-local source/cache path. Asset state is tracked separately and is never inferred only from path nullability/existence.
17. Authored content conflicts (`title`, note/caption body, URL, image replacement) never silently discard one side.
18. Metadata conflicts use explicit policies described in `PROTOCOL.md`; no client clock decides the winner.
19. The future laptop client is a separate React web client sharing domain/protocol semantics.
20. E2EE is out of Phase 6. TLS, per-user authorization, RLS/private storage and minimum telemetry are required instead.

## Domain vs local-sync vs server-sync state

### Domain tables/data

Existing user-facing state remains conceptually domain data:

- Item type/title/body-or-caption/URL/tags
- Collection assignment
- pinned / archived
- createdAt / updatedAt
- Collection name/nameKey/timestamps
- device-local `imagePath`

The only planned cross-device identity added to an Item is `assetId` for images.

### Local sync metadata

Schema-v3 design puts these outside normal domain rows wherever practical:

- profile/account binding
- device ID
- `localRevision`
- last known `serverVersion`
- durable mutation outbox
- pull cursor / bootstrap state
- local hard-delete guard/tombstone
- asset transfer/cache state

Exact DDL: `local-schema-v3.sql`.

### Server sync metadata

- entity `version`
- global change `seq`
- full immutable change payload
- server processing time
- originating device ID
- mutation ID/idempotency record
- tombstones
- retention floor
- bounded bootstrap snapshot sessions

Exact DDL: `server-schema.sql`.

## Why updatedAt cannot be the sync version

Phase 5B-A intentionally permits synchronizable state changes that do not modify `updatedAt` (for example pin state, and Collection deletion unfiling affected Items). Therefore equal timestamps do not mean equal state. Conversely, a wrong device clock can produce a misleading timestamp without invalidating sync correctness. Versions/revisions are the only concurrency authority.

## Atomic local-write rule for the later schema-v3 implementation

A local mutation that should eventually sync must do all of the following in one exclusive SQLite transaction:

1. validate the current `localRevision`;
2. modify domain rows;
3. increment `sync_entity_state.local_revision`;
4. create/compact the protocol mutation in `sync_outbox`;
5. create/update a local tombstone when the domain row is hard-deleted;
6. commit.

If any step fails, none of them may commit. Network I/O is never part of this transaction.

## Queue model

The outbox is mutation-based because conflict handling needs intent:

- which fields were changed;
- what those fields were at the mutation base;
- what the user wants them to become;
- the base cloud version.

A generic dirty snapshot cannot safely distinguish a body edit from a pin/archive change.

Before a mutation has ever been sent, adjacent queued operations may be compacted while preserving semantics. Once a mutation ID has been submitted, its payload is immutable; rebasing or resolving a conflict creates a **new mutation ID**.

## Web boundary

The future web app shares protocol/domain TypeScript where useful but does not inherit Android filesystem, SQLite or native-navigation assumptions. Full offline web parity is not required to begin cross-device access.

## Explicit non-goals of 6A

- real Supabase project/client
- real authentication
- network push/pull
- deployed schema v3
- image upload/download
- sync UI
- web client
- CRDT/live collaborative editing
- E2EE
- semantic search implementation
- browser extension implementation
