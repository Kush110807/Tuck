# Frozen v2 → v3 Local Migration Specification

This is a design contract for the later implementation phase. Phase 6A does not change `SQLiteItemRepository.SCHEMA_VERSION`, does not execute this migration and does not alter existing user databases.

## Preconditions

- Open the same accepted Phase 5B-A database.
- Enable foreign keys and WAL exactly as today.
- Read `PRAGMA user_version`.
- Versions newer than the running app remain a hard initialization failure.
- Run `quick_check` and `foreign_key_check` after migration before the repository becomes ready.

## Transaction boundary

The entire v2→v3 structural change and required data backfill must be inside one exclusive SQLite transaction. `PRAGMA user_version = 3` is the final statement after every backfill and integrity condition succeeds.

A crash/failure before that point rolls the transaction back to a valid v2 database.

## Exact migration steps

1. Execute the structural DDL from `local-schema-v3.sql` **except** the two asset guard triggers and do not advance `user_version`.
2. Generate or load one stable installation `device_id`. It is not an account ID and contains no user content.
3. Insert the single `sync_profile` row:
   - existing pre-account installations start as `profile_kind='local-only'`, `account_id=NULL`, `sync_enabled=0`;
   - account-profile databases are created separately later and never reuse another account's DB.
4. Insert one `sync_state` row with:
   - `pull_cursor=0`;
   - `minimum_retained_sequence=1`;
   - `initial_sync_state='not_started'`.
5. For each existing Item, insert `sync_entity_state(entity_type='item', entity_id, local_revision=1, server_version=NULL, last_synced_local_revision=NULL)`.
6. For each existing Collection, insert the equivalent Collection state with `local_revision=1` and no server version.
7. For every existing image Item:
   - generate a canonical UUID-style `asset_id` using the same quality of ID generation required for normal entities;
   - store it in `items.asset_id`;
   - insert `asset_sync_state` with `local_state='available'`, `remote_state='unknown'`, `upload_state='not_scheduled'`, zero attempts and no error;
   - preserve the existing `image_path` byte-for-byte;
   - do **not** copy, delete, rename or re-encode the existing image file.
8. Verify all note/link Items have `asset_id IS NULL` and all image Items have a non-null asset ID. Existing rows receive freshly generated IDs during this migration, but schema v3 deliberately does **not** require one Asset per Item: a later conflict copy may reuse the same immutable `asset_id`.
9. Create the two `items_asset_id_*_guard` triggers from `local-schema-v3.sql`.
10. Re-run `PRAGMA foreign_key_check` inside the migration transaction.
11. Set `PRAGMA user_version = 3`.
12. Commit.
13. After commit, run the existing image reconciliation/cleanup behavior unchanged. No v3 step may classify a valid Phase 5A/5B-A image as orphan merely because it has not uploaded.

## Account upgrade is not schema migration

Local-only → account association happens later as an explicit sync workflow. Schema v3 only makes local state capable of sync. It must not silently create a cloud account or start uploading.

## Existing IDs and timestamps

All existing Item/Collection IDs, tags, names, timestamps, archive/pin state, Collection assignment and file paths are preserved exactly. No entity is recreated solely for v3.

## Local concurrency after v3

Later repository contracts will replace `expectedUpdatedAt` as the concurrency authority with an opaque local revision/token. `updatedAt` remains domain metadata. Remote apply also increments local revision so an Editor opened before a remote change cannot overwrite it as if nothing changed.
