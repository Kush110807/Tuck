-- Tuck Phase 6A DESIGN SPECIFICATION ONLY.
-- This file is NOT executed by Phase 6A. The live repository remains schema v2.
-- Frozen v2 -> v3 target for the later Phase 6C implementation.

-- 1. Cross-device identity for image assets. image_path remains the device-local
--    cache/source path used by the existing repository. asset_id is stable across devices.
ALTER TABLE items ADD COLUMN asset_id TEXT;
CREATE INDEX idx_items_asset_id
  ON items(asset_id)
  WHERE asset_id IS NOT NULL;
-- Ready Assets are immutable/reusable: multiple image Items may reference the
-- same asset_id (for example an authored-content conflict copy).

-- 2. One logical profile per physical SQLite database. Account profiles use a
--    separate database/storage namespace from local-only and other accounts.
CREATE TABLE sync_profile (
  singleton INTEGER PRIMARY KEY NOT NULL DEFAULT 1 CHECK (singleton = 1),
  profile_kind TEXT NOT NULL CHECK (profile_kind IN ('local-only', 'account')),
  account_id TEXT,
  device_id TEXT NOT NULL,
  sync_enabled INTEGER NOT NULL DEFAULT 0 CHECK (sync_enabled IN (0, 1)),
  CHECK (
    (profile_kind = 'local-only' AND account_id IS NULL AND sync_enabled = 0) OR
    (profile_kind = 'account' AND account_id IS NOT NULL)
  )
);

-- 3. Local concurrency and remote-version metadata are deliberately separate
--    from domain timestamps. Every local or remotely-applied entity mutation
--    increments local_revision. server_version is the last canonical version
--    known from the cloud, and NULL means never represented remotely.
CREATE TABLE sync_entity_state (
  entity_type TEXT NOT NULL CHECK (entity_type IN ('item', 'collection')),
  entity_id TEXT NOT NULL,
  local_revision INTEGER NOT NULL CHECK (local_revision >= 1),
  server_version INTEGER CHECK (server_version IS NULL OR server_version >= 1),
  last_synced_local_revision INTEGER CHECK (
    last_synced_local_revision IS NULL OR last_synced_local_revision >= 1
  ),
  PRIMARY KEY (entity_type, entity_id)
);
CREATE INDEX idx_sync_entity_server_version
  ON sync_entity_state(entity_type, server_version, entity_id);

-- 4. Durable mutation outbox. Queue order comes from position, never timestamps.
--    JSON payloads use the frozen protocol-v1 shapes in src/sync/protocol.ts.
CREATE TABLE sync_outbox (
  position INTEGER PRIMARY KEY AUTOINCREMENT,
  mutation_id TEXT NOT NULL UNIQUE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('item', 'collection')),
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'patch', 'delete')),
  base_server_version INTEGER CHECK (
    (action = 'create' AND base_server_version IS NULL) OR
    (action IN ('patch', 'delete') AND base_server_version >= 1)
  ),
  changed_fields_json TEXT NOT NULL,
  base_values_json TEXT NOT NULL,
  new_values_json TEXT NOT NULL,
  created_local_revision INTEGER NOT NULL CHECK (created_local_revision >= 1),
  depends_on_asset_id TEXT,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'blocked')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code TEXT,
  queued_at INTEGER NOT NULL CHECK (queued_at >= 0)
);
CREATE INDEX idx_sync_outbox_state_position
  ON sync_outbox(state, position);
CREATE INDEX idx_sync_outbox_entity
  ON sync_outbox(entity_type, entity_id, position);
CREATE INDEX idx_sync_outbox_asset_dependency
  ON sync_outbox(depends_on_asset_id, position)
  WHERE depends_on_asset_id IS NOT NULL;

-- 5. Durable pull/bootstrap checkpoint. Cursor changes are committed in the same
--    SQLite transaction as the corresponding pulled change batch.
CREATE TABLE sync_state (
  singleton INTEGER PRIMARY KEY NOT NULL DEFAULT 1 CHECK (singleton = 1),
  pull_cursor INTEGER NOT NULL DEFAULT 0 CHECK (pull_cursor >= 0),
  minimum_retained_sequence INTEGER NOT NULL DEFAULT 1 CHECK (minimum_retained_sequence >= 1),
  initial_sync_state TEXT NOT NULL DEFAULT 'not_started' CHECK (
    initial_sync_state IN ('not_started', 'bootstrapping', 'catching_up', 'complete', 'rebootstrap_required')
  ),
  bootstrap_session_id TEXT,
  bootstrap_after_ordinal INTEGER CHECK (bootstrap_after_ordinal IS NULL OR bootstrap_after_ordinal >= 0),
  bootstrap_snapshot_head_sequence INTEGER CHECK (
    bootstrap_snapshot_head_sequence IS NULL OR bootstrap_snapshot_head_sequence >= 0
  ),
  catchup_target_head_sequence INTEGER CHECK (
    catchup_target_head_sequence IS NULL OR catchup_target_head_sequence >= 0
  ),
  last_successful_sync_at INTEGER CHECK (last_successful_sync_at IS NULL OR last_successful_sync_at >= 0)
);

-- 6. Local hard-delete guard. This survives removal of the domain row and blocks
--    stale remote upserts from resurrecting an entity while deletion is pending.
CREATE TABLE sync_local_tombstones (
  entity_type TEXT NOT NULL CHECK (entity_type IN ('item', 'collection')),
  entity_id TEXT NOT NULL,
  local_revision INTEGER NOT NULL CHECK (local_revision >= 1),
  server_version INTEGER CHECK (server_version IS NULL OR server_version >= 1),
  pending_mutation_id TEXT,
  deleted_at_local INTEGER NOT NULL CHECK (deleted_at_local >= 0),
  PRIMARY KEY (entity_type, entity_id),
  FOREIGN KEY (pending_mutation_id) REFERENCES sync_outbox(mutation_id) ON DELETE SET NULL
);

-- 7. Asset state is not inferred from image_path/null or file existence.
--    items.image_path remains the device-local path. This table says what that
--    path means relative to cloud state and retry state.
CREATE TABLE asset_sync_state (
  asset_id TEXT PRIMARY KEY NOT NULL,
  local_state TEXT NOT NULL CHECK (
    local_state IN (
      'remote_known_not_downloaded',
      'download_pending',
      'available',
      'download_failed',
      'missing',
      'corrupt'
    )
  ),
  remote_state TEXT NOT NULL CHECK (remote_state IN ('unknown', 'staging', 'ready')),
  upload_state TEXT NOT NULL CHECK (
    upload_state IN ('not_scheduled', 'not_required', 'pending', 'failed', 'uploaded')
  ),
  upload_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (upload_attempt_count >= 0),
  download_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (download_attempt_count >= 0),
  last_error_code TEXT,
  remote_mime_type TEXT CHECK (
    remote_mime_type IS NULL OR remote_mime_type IN ('image/jpeg', 'image/png', 'image/webp')
  ),
  remote_byte_size INTEGER CHECK (remote_byte_size IS NULL OR remote_byte_size >= 0),
  remote_cleanup_pending INTEGER NOT NULL DEFAULT 0 CHECK (remote_cleanup_pending IN (0, 1))
);
CREATE INDEX idx_asset_sync_upload
  ON asset_sync_state(upload_state, asset_id);
CREATE INDEX idx_asset_sync_download
  ON asset_sync_state(local_state, asset_id);

-- 8. Once v2 image rows have been backfilled with asset IDs, enforce the
--    intended relationship without rebuilding the accepted items table.
CREATE TRIGGER items_asset_id_insert_guard
BEFORE INSERT ON items
FOR EACH ROW
WHEN (
  (NEW.type = 'image' AND NEW.asset_id IS NULL) OR
  (NEW.type <> 'image' AND NEW.asset_id IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'asset_id must exist only for image items');
END;

CREATE TRIGGER items_asset_id_update_guard
BEFORE UPDATE OF type, asset_id ON items
FOR EACH ROW
WHEN (
  (NEW.type = 'image' AND NEW.asset_id IS NULL) OR
  (NEW.type <> 'image' AND NEW.asset_id IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'asset_id must exist only for image items');
END;

-- PRAGMA user_version = 3 is intentionally NOT present in this design file.
-- The future migration implementation sets it only after the application-level
-- UUID backfill and all metadata backfills succeed inside the migration transaction.
