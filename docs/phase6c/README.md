# Tuck Phase 6C-MVP — Local Sync Infrastructure

Baseline: `3439b8905dcc6876e69c8bc18eb09ede99d7e6c5` (accepted/frozen Phase 6B).

Phase 6C-MVP changes only local persistence. It does **not** start network push/pull, a SyncEngine, background work, account UI, sync UI, or image transfer.

## SQLite schema v3

The production repository now migrates v2 → v3 in one exclusive SQLite transaction, following the frozen Phase 6A design:

- `items.asset_id` plus image/asset guard triggers;
- `sync_profile` — exactly one logical local-only/account profile per DB;
- `sync_entity_state` — monotonic local revision + last known server version;
- `sync_outbox` — durable high-level protocol-v1 mutations;
- `sync_state` — pull cursor and bootstrap/catch-up checkpoint;
- `sync_local_tombstones` — hard-delete guard/state;
- `asset_sync_state` — device/cloud asset metadata independent of `image_path`.

Existing v1/v2 installations migrate as `local-only`, with sync disabled. A brand-new database may be created as an account profile through `SQLiteItemRepositoryOptions.initialSyncProfile`. Account profiles default to separate DB names and account-specific image-storage namespaces.

## Atomic authored writes

For an enabled account profile, the same exclusive SQLite transaction now contains the domain mutation, local-revision change, and outbox creation/compaction. A failure rolls back all of them. Local-only profiles still perform normal CRUD with no outbox/network dependency.

Unsent entity creates are compacted in place: later local edits/archive/pin operations update the one queued create instead of creating impossible patches with no server version. A hard delete of a never-uploaded create removes that unsent create and writes a local tombstone. A server-known entity delete queues a protocol delete and links the tombstone to its mutation ID.

## Remote-apply foundation

`LocalSyncRepository` exposes persistence-only primitives for the next phase:

- profile/checkpoint/entity-state reads;
- durable outbox reads;
- bootstrap checkpoint persistence;
- atomic remote-change application + pull-cursor advancement.

Remote apply never creates authored outbox rows. It updates `server_version` and increments `local_revision`. Pending authored work blocks a remote overwrite instead of being silently discarded.

## Competition-MVP boundary

There is still no live Supabase synchronization. `App.tsx` does not instantiate `SupabaseSyncTransport` or a SyncEngine. The current Android app remains offline/local-first and uses the local-only profile by default.
