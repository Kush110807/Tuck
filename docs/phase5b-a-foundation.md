# Phase 5B-A — Data & Organisation Foundation

## Provenance and scope

Phase 5B-A is built directly on the immutable, verified Phase 5A baseline:

`0938083ff282e665ff0990c5140975391c72720e`

This gate changes only shared contracts, domain validation/query helpers, SQLite persistence, data-layer typing, and automated tests required for the organisation foundation. It intentionally does **not** add Library/navigation screens, filter/sort sheets, collection-picker UI, pin UI, Editor/Detail organisation UI, global tag mutations, browser capture, AI, sync, accounts, or later-phase functionality.

## Schema version 2

Phase 5B-A advances `PRAGMA user_version` from 1 to 2.

The v1 tables (`items`, `item_tags`, `pending_file_deletions`) remain intact. Version 2 adds one table and two item columns:

```sql
CREATE TABLE collections (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

ALTER TABLE items
  ADD COLUMN collection_id TEXT
  REFERENCES collections(id)
  ON DELETE SET NULL;

ALTER TABLE items
  ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0
  CHECK (pinned IN (0, 1));

CREATE INDEX idx_items_collection_archive_updated
  ON items (collection_id, archived, updated_at DESC, id ASC);

CREATE INDEX idx_items_archive_pinned_updated
  ON items (archived, pinned, updated_at DESC, id ASC);
```

Existing indexes are retained:

```sql
CREATE INDEX idx_items_archive_type_updated
  ON items (archived, type, updated_at DESC, id ASC);

CREATE INDEX idx_item_tags_key
  ON item_tags (tag_key, item_id);
```

No global tags table, Smart View table, pin table, or Collection/item join table is introduced. Each item has at most one Collection.

## Migration and recovery

Migrations are versioned and serialized:

- `0 -> 1`: existing v1 schema creation.
- `1 -> 2`: additive organisation migration.

Each migration runs inside `withExclusiveTransactionAsync`. `PRAGMA user_version` advances only as the final statement inside that migration transaction. Therefore a failure before commit rolls back all changes and leaves the previous schema/version retryable.

The v1 -> v2 migration does not rewrite existing rows. Existing item IDs, type/content/URL/image paths, timestamps, archive state, all `item_tags` rows including spelling and ordinal, and pending cleanup rows are preserved. New values are produced by SQLite defaults/nullability:

- `collection_id = NULL`
- `pinned = 0`

Initialization still performs `PRAGMA quick_check` and now also requires `PRAGMA foreign_key_check` to return no violations. A database whose `user_version` is newer than the app-supported schema fails initialization safely. Initialization failure never recreates or clears the database.

### Downgrade policy

After a database has successfully committed schema v2, automatic downgrade to the frozen Phase 5A/schema-v1 binary is not supported. The Phase 5A source baseline remains recoverable in Git; schema-version correctness is not weakened to simulate downgrade support.

## Collection semantics

A Collection answers “where does this item belong?” An item has zero or one Collection.

Collection names are normalized as:

1. Unicode NFKC
2. trim
3. internal whitespace collapse
4. lowercase comparison key

The normalized display name is limited to 60 Unicode code points. `name_key` is unique, so case-insensitive logical duplicates are rejected. Empty Collections are valid. No nesting, colors, covers, icons, or custom ordering are present in this gate.

Deleting a Collection relies on `ON DELETE SET NULL`. Items are not deleted and their item `updated_at` values are not touched by the cascade. Item content, tags, image path, pin state, and archive state survive.

An explicit user collection assignment/move/removal is a normal item metadata edit through `update()` and therefore advances item `updatedAt`, matching existing tag-edit semantics.

## Pin semantics

`pinned` is stored directly on `items`.

`setPinned(id, pinned, expectedUpdatedAt)` is a dedicated optimistic mutation. It verifies the caller's `expectedUpdatedAt` but intentionally does not modify `updated_at`. Repeating the same pin value is idempotent.

Archiving an item preserves its pin bit. Active Pinned queries always include `archived=false`, so archived pinned items disappear from the active Pinned view and automatically reappear when restored.

## Sorting and query semantics

Supported sort values:

- `updated_desc`: `updatedAt DESC`, then `id ASC`
- `created_desc`: `createdAt DESC`, then `id ASC`
- `created_asc`: `createdAt ASC`, then `id ASC`
- `title_asc`: normalized title ASC, then `id ASC`

The default remains `updated_desc` so legacy Phase 5A callers preserve their previous ordering. Text/id comparisons used for deterministic ordering use code-unit ordering rather than host-locale collation.

`ItemQuery` combines applicable criteria with AND:

- archive state
- text search
- type
- exact normalized tag key
- exact collection ID
- pinned state
- has/does-not-have tags
- has/does-not-have Collection
- sort

For Phase 5A compatibility, newly introduced query fields are optional in the shared contract; omission means no new filter, while omitted `sort` means `updated_desc`.

Contradictory filters such as a concrete tag plus `hasTags=false`, or a concrete Collection plus `hasCollection=false`, fail validation rather than silently choosing one condition.

## Smart View query presets

Smart Views are derived query presets and are never persisted rows:

- Pinned: `archived=false`, `pinned=true`
- Untagged: `archived=false`, `hasTags=false`
- Unfiled: `archived=false`, `hasCollection=false`

Notes, Links, and Images remain normal type filters. Recent is not a separate Smart View.

## Repository surface

`SQLiteItemRepository` remains the concrete repository; it is not renamed or rewritten for aesthetics. It implements both `ItemRepository` and `OrganisationRepository` through the `TuckRepository` intersection type.

Organisation capabilities introduced in 5B-A:

- `getLibraryOverview()`
- `listCollections()`
- `getCollection()`
- `createCollection()`
- `renameCollection()`
- `deleteCollection()`
- `listTags()`

Item capabilities added/expanded:

- collection-aware create/update/query
- `setPinned()`
- expanded deterministic sorting/filtering

`LibraryOverview` supplies active/archived item counts, Collection summaries with active counts, read-only tag summaries, active Smart View counts, and active type counts for later UI gates.

## Tag aggregation semantics in 5B-A

Tag storage and normalization are unchanged. 5B-A adds read-only aggregation only.

`listTags()` groups by existing normalized `tag_key`. The deterministic display spelling is taken from the earliest existing tag occurrence ordered by item `created_at`, item ID, then tag ordinal. Archived rows remain eligible to supply that stable historical display spelling, but **do not** contribute to `activeItemCount`. Tags with zero active items are omitted from the active Library tag list.

No tag row is rewritten during migration, and no global tag rename/delete/merge mutation exists in 5B-A.

## Upgrade verification for a populated Phase 5A database

For physical-device upgrade testing:

1. Install/run the exact Phase 5A baseline build associated with `0938083ff282e665ff0990c5140975391c72720e`.
2. Create representative note, link, and image items; include tagged/untagged and archived records, and retain at least one image-backed item.
3. Record visible content/tags/archive state and verify the image loads.
4. Install the Phase 5B-A candidate over the existing app without clearing application data.
5. Launch once and allow initialization to migrate schema v1 -> v2.
6. Verify all previous items, tags, archive state, timestamps as surfaced by behaviour, and images remain usable.
7. Verify ordinary Phase 5A create/edit/search/type/tag/archive/restore/image flows still work.
8. Confirm repeated creation remains available in a populated Inbox (NEW-01 regression check).
9. Kill/relaunch the app and repeat persistence checks.

5B-A has no new organisation UI, so Collection/pin repository capabilities are verified automatically in this gate; physical UI interaction for those features belongs to later Phase 5B gates.
