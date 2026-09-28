# Tuck Sync Protocol v1 — Frozen Phase 6A Contract

The TypeScript wire contract is `src/sync/protocol.ts`. This document freezes behavior that cannot be expressed by types alone.

## 1. Core invariants

- Protocol version: `1`.
- Entity IDs remain stable `TEXT` IDs shared by local/cloud/web.
- Mutation IDs are UUIDs and are immutable idempotency keys.
- Server entity versions start at `1` and increment for each accepted canonical entity change.
- Server change sequence is monotonically increasing and never comes from a device clock.
- `updatedAt` is domain metadata only.
- Tags are owned by the Item version; `item_tags` rows do not have independent versions.
- A pull cursor is persisted in the same local transaction that applies the corresponding change batch.
- A local mutation/outbox record is persisted in the same local transaction as its domain change.

## 2. Change payload decision

`sync_changes` stores the **full canonical entity snapshot at that exact sequence** for every upsert and a full tombstone payload for every delete.

It does not store only a pointer to the current row and it does not require a later canonical fetch. Therefore replay remains deterministic even if an entity changes again or is later deleted.

Tags are embedded in the Item snapshot in normalized display order. Assets have their own canonical metadata snapshot. A Collection delete additionally emits canonical Item upserts for every affected Item whose `collectionId` becomes null.

## 3. Change-log retention

Protocol v1 freezes a rolling **minimum 90-day** incremental change-log retention.

`accounts.change_retention_floor_seq` records the lowest sequence boundary for which incremental replay is still guaranteed. Cleanup may delete `sync_changes` rows whose retention has expired only after atomically advancing the affected account's floor.

A cursor is valid when:

`afterSequence >= minimumRetainedSequence - 1`

If it is older, `pullChanges()` returns `rebootstrap_required`; it never guesses or silently skips history.

Hard-delete tombstones are separate from this transient log and are retained for the **account lifetime** in protocol v1.

## 4. Processed-mutation retention

`processed_mutations` is also retained for the **account lifetime** in protocol v1.

This is intentionally conservative. It guarantees that a very old retry of an already processed mutation cannot become a second logical write merely because an idempotency record aged out.

The server stores a deterministic request hash with the mutation ID:

- same mutation ID + same request hash → return the originally stored result without reapplying;
- same mutation ID + different request hash → reject `MUTATION_ID_REUSE`.

Any future finite-retention design requires a new protocol revision and may not silently weaken this guarantee.

## 5. bootstrap()

### 5.1 Why a server snapshot session exists

Client-driven pagination over live tables can race concurrent writes. Protocol v1 therefore materializes a bounded bootstrap snapshot server-side.

On the first bootstrap request, the server opens one `REPEATABLE READ` transaction and:

1. authenticates/scopes the account;
2. captures the account's current change-log head `snapshotHeadSequence` from the same database snapshot;
3. reads all current canonical Collections, Items+tags and asset metadata from that same snapshot;
4. writes immutable `bootstrap_entries` in deterministic order into a new `bootstrap_session`;
5. commits the session and first page together.

The snapshot session TTL is **1 hour**. Cleanup may remove expired sessions/entries without touching user data or change history.

Deterministic entry order is:

1. Collections by ID;
2. Items by ID;
3. Assets by ID.

Each entry receives an ordinal starting at `1`.

### 5.2 Pagination

First request:

```json
{
  "protocolVersion": 1,
  "accountId": "<account>",
  "pageSize": 100
}
```

Page response conceptually contains:

```json
{
  "kind": "page",
  "protocolVersion": 1,
  "accountId": "<account>",
  "sessionId": "<uuid>",
  "snapshotHeadSequence": 1234,
  "entries": [{ "ordinal": 1, "snapshot": "<canonical entity>" }],
  "nextAfterOrdinal": 100,
  "expiresAtEpochMs": 0
}
```

Resume supplies the same `sessionId` and last committed `afterOrdinal`. Pages are immutable for that session.

If the session expires before completion, the server returns `bootstrap_expired`; the client discards that incomplete staging snapshot and begins a fresh bootstrap session. It must never mark initial sync complete from mixed sessions.

### 5.3 Local application

Initial/forced bootstrap is built in a staging profile database or staging tables, not destructively over the only trusted copy.

For each page, the client transactionally applies entries and records the page ordinal. A crash resumes from the last committed ordinal.

After the final page, the local state represents exactly the server snapshot paired with `snapshotHeadSequence`.

### 5.4 Concurrent mutation during bootstrap

Writes after the snapshot transaction are not part of the frozen bootstrap entries. They necessarily produce `sync_changes` with sequence greater than `snapshotHeadSequence` and are collected by the catch-up pull. Therefore no concurrent server mutation can be skipped.

## 6. INITIAL_SYNC_COMPLETE

After bootstrap entries finish, state becomes `catching_up`, not `complete`.

The first catch-up `pullChanges(afterSequence=snapshotHeadSequence, targetHeadSequence=null)` captures a finite `targetHeadSequence` equal to the account head observed for that pull cycle.

All subsequent pages for that catch-up cycle send the same `targetHeadSequence` until the local cursor equals it.

`INITIAL_SYNC_COMPLETE` means **all** of the following are durably true:

1. all pages from one unexpired bootstrap session are applied;
2. their `snapshotHeadSequence` is stored;
3. every change `> snapshotHeadSequence` and `<= catchupTargetHeadSequence` is applied in sequence order;
4. local `pull_cursor == catchupTargetHeadSequence`;
5. cursor and final change batch committed atomically;
6. no malformed/unsupported change in that range was skipped;
7. bootstrap state is set to `complete` in that same durable local checkpoint.

It does **not** mean every image byte is downloaded. Canonical asset metadata is sufficient; image downloads continue independently.

Changes committed after `catchupTargetHeadSequence` are ordinary subsequent sync work and do not invalidate the fact that initial sync completed at a real server head.

## 7. pullChanges()

Request:

- protocol/account scope;
- `afterSequence`;
- bounded `limit` (1..500);
- optional `targetHeadSequence`.

If target is omitted, the server captures the current account head and returns it as the finite target for this pull cycle. A page contains only immutable changes:

`afterSequence < seq <= targetHeadSequence`

ordered by `seq ASC`.

If more matching changes remain, `nextAfterSequence` is the last returned sequence. If no more remain, the server may advance `nextAfterSequence` directly to `targetHeadSequence`, safely crossing sequence gaps belonging to other accounts.

Repeated pulls with the same cursor/target return the same change payloads while those sequences remain retained. Local apply is idempotent by entity version and tombstone version.

## 8. Forced rebootstrap

When `rebootstrap_required` occurs:

1. pause remote apply/push for the affected account profile;
2. preserve the existing profile DB, durable outbox, local tombstones and pending asset state untouched;
3. create a fresh staging account database with schema v3;
4. bootstrap/catch up remote canonical state into staging;
5. replay/rebase preserved pending local mutations against staging using the same protocol merge policy;
6. create conflict copies where required rather than discarding local-only content;
7. run SQLite integrity/image reference checks;
8. atomically switch the profile registry to the new validated DB;
9. retain the old DB as rollback material until the new DB successfully reopens; then remove it through the explicit cache-cleanup path.

A forced rebootstrap must never clear an unsynced outbox simply to make the server snapshot fit.

## 9. pushMutations()

### 9.1 Ordering

A push request carries a bounded ordered mutation array. The server processes valid mutation envelopes in request order. This order defines server-order resolution for metadata policies such as pin/archive/Collection assignment.

The client outbox normally sends by durable `position ASC`. Dependencies are honored before batching:

- Collection create before an Item mutation that references it;
- asset must be `ready` before a cloud image Item can reference it;
- entity create before later patch/delete.

### 9.2 Transaction/idempotency

For each accepted logical mutation, these effects are atomic:

- ownership/version validation;
- canonical entity mutation;
- entity version increment if state changed;
- immutable change-log append(s);
- tombstone creation if deleting;
- processed-mutation result storage.

Unexpected RPC failure rolls back the RPC transaction. Retrying the same mutation ID is safe.

A deterministic conflict/rejection for a structurally valid mutation ID is also stored, so replay returns the same result. Rebase/user resolution creates a new mutation ID.

### 9.3 Create

- `baseServerVersion` must be null.
- same live ID → `ENTITY_ID_COLLISION`;
- ID present in account-lifetime tombstones → `ENTITY_ID_REUSED_AFTER_DELETE`;
- first accepted canonical version = `1`.
- image create may reference only a `ready` asset owned by the account.
- missing/deleted requested Collection is coerced to `collectionId=null` with warning `COLLECTION_DELETED_COERCED_TO_UNFILED`.

### 9.4 Patch base mismatch algorithm

A patch carries:

- `baseServerVersion`;
- exact `changedFields`;
- base values for every changed field where conflict detection needs them;
- requested new values.

`updatedAt` is carried only as domain metadata and never participates in conflict comparison.

If `baseServerVersion == current.version`, the same field-policy rules below still validate the payload, then apply it.

If versions differ, the server evaluates only fields the mutation says the user changed. It compares current canonical value to that mutation field's base value; this is enough to distinguish a disjoint remote edit without trusting clocks.

### 9.5 Exact Item field policies

#### `title`, `body`/caption, `url`, `assetId`

These are authored-content fields.

For each changed field:

- current == requested new → already converged; no conflict for that field;
- current == base → safe to apply local new value;
- otherwise → `AUTHORED_FIELD_CONFLICT`.

Any authored conflict prevents the patch from changing the original Item. The client uses conflict-copy semantics in section 11.

#### `tags`

Tags use a three-way set merge by existing normalized comparison key.

Given Base, Current(server), Local(new):

- tag existed in Base and either side removed it → removed;
- concurrent additions from either side → union;
- existing server display spelling/order is kept first;
- genuinely new local additions append in local order;
- duplicate logical keys collapse through existing Tuck normalization.

Example:

- Base = `Study, Reading`
- Current = `Study, Important`
- Local = `Study, Reading, Build`
- Result = `Study, Important, Build`

`Reading` was removed remotely; `Important` and `Build` are concurrent additions.

#### `collectionId`

Metadata, server-processing-order policy. The later processed assignment wins **if the destination Collection still exists**. If it was deleted, canonical result is Unfiled (`null`) with a warning.

Collection deletion itself unfiles all affected Items and increments their server versions without changing their domain `updatedAt`.

#### `pinned`

Metadata, server-processing-order policy. Later processed value wins. Pinning never needs to modify domain `updatedAt`.

#### `archived`

Metadata, server-processing-order policy. Later processed archive/restore wins. Its supplied `updatedAt` follows the accepted semantic mutation as domain metadata.

#### `updatedAt`

Mechanical domain metadata. It is applied only when at least one semantic field from that mutation changes canonical state. It cannot create a change by itself and cannot resolve a conflict.

### 9.6 Collection rename

Collection has one authored mutable field: `name`.

- current name == requested name → already converged;
- current name == base name → apply normalized requested name/nameKey;
- otherwise → `COLLECTION_RENAME_CONFLICT`.

Normalized-name uniqueness is checked per account before commit.

### 9.7 Delete

Hard delete is deliberately conservative:

- already tombstoned ID + same/new delete request → canonical tombstone response, no resurrection;
- live entity with `baseServerVersion == current.version` → delete accepted;
- live entity whose version advanced since the delete base → `STALE_DELETE` rather than silently deleting newer remote work.

For a Collection delete, Item assignment changes do **not** increment Collection version. Therefore a valid Collection delete can still win over concurrent Item assignment: affected Items become Unfiled and receive their own new Item versions/change entries.

For a server-deleted Item receiving a later offline patch, server returns `REMOTE_DELETED`; the tombstone remains authoritative for the original ID and the client preserves the offline work as a conflict copy.

## 10. Device clock rule

No server version, mutation ordering, cursor, retention decision, idempotency decision or conflict decision uses client time.

Client-created `createdAt`/`updatedAt` remain domain metadata for the existing product experience. A badly wrong device clock can therefore affect human-facing time/sort presentation, but **cannot cause lost sync history or win a conflict**.

## 11. Conflict-copy semantics

Conflict copies apply to Item authored-content conflicts and remote-delete-vs-local-edit. Collection rename conflicts require explicit rename/retry and do not duplicate Collections automatically.

When required, the client:

1. keeps/applies the server canonical state (or tombstone) to the original Item ID;
2. snapshots the user's local desired Item state before replacing/deleting the original;
3. generates a fresh canonical UUID-style Item ID locally;
4. creates an ordinary Item with the same type/content/tags;
5. title becomes `<title> (conflict copy)` and is code-point-truncated before the suffix to remain within the existing 120-code-point title limit;
6. Collection is preserved only if that Collection still exists locally after applying server state; otherwise it becomes Unfiled;
7. archive state is preserved;
8. pin state is preserved;
9. image conflict copy preserves the losing side's `assetId`/local image relationship; asset safety rules decide whether it must upload;
10. the original ID is not exposed in user-facing text; an optional local diagnostic source reference may exist only in sync metadata/logging;
11. creation of the copy is a normal local create and **enters the durable sync outbox** with a new mutation ID.

No version number or server implementation detail appears in the user-facing title/message.

## 12. Profile / logout model

Local profile keys are logically:

- `local-only`
- `account:<A>`
- `account:<B>`

Each uses a separate SQLite file and separate app-owned image/cache namespace.

### Normal sign-out

For account A:

1. increment local session generation so late A responses cannot apply;
2. cancel/pause A network work;
3. keep A DB/outbox/tombstones/cache privately on device;
4. preserve partial asset transfer state;
5. hide A data;
6. activate local-only (or another explicitly chosen account) profile.

Signing into A again reopens the same A profile and resumes pending work after auth/session validation.

### Account switch

Account B never opens/reuses A's DB. It selects/creates B's own profile. Outbox rows are never moved between accounts.

### Remove downloaded account data from this device

This is separate from sign-out. It is blocked while:

- account profile is active;
- unsynced outbox rows exist;
- pending/failed local-only asset transfers could contain data absent from cloud.

Once safe and explicitly confirmed, the operation removes that account's DB and cache namespace from the device only. It does not delete the cloud account.

### Global sign-out

Request server session revocation, increment local session generation, pause all account profiles and hide them. It does not erase their databases automatically.

### Remote account deletion

Mark profile `remote-deleted`, stop sync and hide it. Preserve local-only pending data for explicit recovery/export/removal; never automatically recreate the cloud account from the outbox.

## 13. Image/asset state contract

The Item relationship is:

- `assetId`: stable cross-device identity;
- `imagePath`: intended device-local source/cache path;
- `asset_sync_state`: authoritative interpretation of transfer/cache state.

An image path may point to the deterministic destination before bytes have downloaded. Therefore file absence alone does not mean the cloud asset is missing.

Minimum distinct local states:

- `remote_known_not_downloaded`
- `download_pending`
- `available`
- `download_failed`
- `missing`
- `corrupt`

Remote states:

- `unknown`
- `staging`
- `ready`

Upload states:

- `not_scheduled` (local-only/pre-account)
- `not_required` (remote-origin asset)
- `pending`
- `failed`
- `uploaded`

Existing Phase 5A/5B-A image paths/files are preserved during v3 migration. They begin `available + unknown + not_scheduled`, receive an asset ID, and are queued for upload only during explicit account migration/sync enablement.

A new remote image Item can be materially present in the local database before the image bytes are downloaded. Metadata UI must remain usable while the asset state is `remote_known_not_downloaded`/`download_pending`/`download_failed`.
