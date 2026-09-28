-- Tuck Phase 6A PROPOSED POSTGRESQL SCHEMA ONLY.
-- Do not deploy this file in Phase 6A.
-- auth.users and storage.objects are Supabase-owned schemas/tables referenced by design.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE public.accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleting')),
  protocol_version integer NOT NULL DEFAULT 1 CHECK (protocol_version >= 1),
  change_retention_floor_seq bigint NOT NULL DEFAULT 1 CHECK (change_retention_floor_seq >= 1),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.assets (
  user_id uuid NOT NULL REFERENCES public.accounts(user_id) ON DELETE CASCADE,
  id text NOT NULL CHECK (length(id) BETWEEN 1 AND 128 AND id !~ '[[:cntrl:]]'),
  storage_path text NOT NULL CHECK (length(storage_path) BETWEEN 1 AND 512),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  state text NOT NULL CHECK (state IN ('staging', 'ready')),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, storage_path),
  CHECK ((state = 'staging' AND ready_at IS NULL) OR (state = 'ready' AND ready_at IS NOT NULL))
);

CREATE TABLE public.collections (
  user_id uuid NOT NULL REFERENCES public.accounts(user_id) ON DELETE CASCADE,
  id text NOT NULL CHECK (length(id) BETWEEN 1 AND 128 AND id !~ '[[:cntrl:]]'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 240),
  name_key text NOT NULL CHECK (length(name_key) BETWEEN 1 AND 240),
  created_at bigint NOT NULL CHECK (created_at >= 0),
  updated_at bigint NOT NULL CHECK (updated_at >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, name_key)
);

CREATE TABLE public.items (
  user_id uuid NOT NULL REFERENCES public.accounts(user_id) ON DELETE CASCADE,
  id text NOT NULL CHECK (length(id) BETWEEN 1 AND 128 AND id !~ '[[:cntrl:]]'),
  type text NOT NULL CHECK (type IN ('note', 'link', 'image')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 480),
  body text,
  url text,
  asset_id text,
  collection_id text,
  pinned boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  created_at bigint NOT NULL CHECK (created_at >= 0),
  updated_at bigint NOT NULL CHECK (updated_at >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, collection_id)
    REFERENCES public.collections(user_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, asset_id)
    REFERENCES public.assets(user_id, id) ON DELETE RESTRICT,
  CHECK (
    (type = 'note' AND body IS NOT NULL AND url IS NULL AND asset_id IS NULL) OR
    (type = 'link' AND body IS NULL AND url IS NOT NULL AND asset_id IS NULL) OR
    (type = 'image' AND url IS NULL AND asset_id IS NOT NULL)
  )
);

CREATE INDEX idx_items_user_archive_updated
  ON public.items(user_id, archived, updated_at DESC, id ASC);
CREATE INDEX idx_items_user_collection
  ON public.items(user_id, collection_id, archived, updated_at DESC, id ASC);
CREATE INDEX idx_items_user_pinned
  ON public.items(user_id, archived, pinned, updated_at DESC, id ASC);

CREATE TABLE public.item_tags (
  user_id uuid NOT NULL,
  item_id text NOT NULL,
  tag_key text NOT NULL CHECK (length(tag_key) BETWEEN 1 AND 192),
  display text NOT NULL CHECK (length(display) BETWEEN 1 AND 192),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  PRIMARY KEY (user_id, item_id, tag_key),
  UNIQUE (user_id, item_id, ordinal),
  FOREIGN KEY (user_id, item_id)
    REFERENCES public.items(user_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_item_tags_user_key
  ON public.item_tags(user_id, tag_key, item_id);

-- Hard-delete memory is account-lifetime in protocol v1 and is separate from
-- transient incremental sync history.
CREATE TABLE private.entity_tombstones (
  user_id uuid NOT NULL REFERENCES public.accounts(user_id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('item', 'collection')),
  entity_id text NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 128),
  deleted_version bigint NOT NULL CHECK (deleted_version >= 1),
  deleted_seq bigint NOT NULL CHECK (deleted_seq >= 1),
  deleted_at timestamptz NOT NULL DEFAULT now(),
  origin_device_id text NOT NULL CHECK (length(origin_device_id) BETWEEN 1 AND 128),
  PRIMARY KEY (user_id, entity_type, entity_id)
);
CREATE INDEX idx_tombstones_user_deleted_seq
  ON private.entity_tombstones(user_id, deleted_seq);

-- Every row carries the complete canonical payload at that sequence. Upserts
-- therefore remain replayable even when the entity changes again later.
CREATE TABLE private.sync_changes (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.accounts(user_id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('item', 'collection', 'asset')),
  entity_id text NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 128),
  entity_version bigint NOT NULL CHECK (entity_version >= 1),
  kind text NOT NULL CHECK (kind IN ('upsert', 'delete')),
  payload jsonb NOT NULL,
  mutation_id uuid,
  origin_device_id text NOT NULL CHECK (length(origin_device_id) BETWEEN 1 AND 128),
  server_at timestamptz NOT NULL DEFAULT now(),
  retain_until timestamptz NOT NULL DEFAULT (now() + interval '90 days')
);
CREATE INDEX idx_sync_changes_user_seq
  ON private.sync_changes(user_id, seq);
CREATE INDEX idx_sync_changes_retention
  ON private.sync_changes(retain_until, user_id, seq);

-- Protocol-v1 idempotency records are retained for account lifetime. The
-- request hash prevents reusing a mutation UUID for a different payload.
CREATE TABLE private.processed_mutations (
  user_id uuid NOT NULL REFERENCES public.accounts(user_id) ON DELETE CASCADE,
  mutation_id uuid NOT NULL,
  protocol_version integer NOT NULL CHECK (protocol_version >= 1),
  request_hash text NOT NULL,
  result_payload jsonb NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mutation_id)
);

-- Bootstrap uses a bounded, server-materialized snapshot so pagination cannot
-- race live writes. Creation of a session and its entries occurs in one
-- REPEATABLE READ transaction with snapshot_head_seq captured from the same view.
CREATE TABLE private.bootstrap_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.accounts(user_id) ON DELETE CASCADE,
  snapshot_head_seq bigint NOT NULL CHECK (snapshot_head_seq >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX idx_bootstrap_sessions_expiry
  ON private.bootstrap_sessions(expires_at);

CREATE TABLE private.bootstrap_entries (
  session_id uuid NOT NULL REFERENCES private.bootstrap_sessions(id) ON DELETE CASCADE,
  ordinal bigint NOT NULL CHECK (ordinal >= 1),
  entity_type text NOT NULL CHECK (entity_type IN ('item', 'collection', 'asset')),
  entity_id text NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 128),
  payload jsonb NOT NULL,
  PRIMARY KEY (session_id, ordinal),
  UNIQUE (session_id, entity_type, entity_id)
);

-- RLS is defense-in-depth on user-owned public tables. Direct client DML is
-- still revoked; versioned sync RPCs are the only mutation path.
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounts_select_own ON public.accounts
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY assets_select_own ON public.assets
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY collections_select_own ON public.collections
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY items_select_own ON public.items
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY item_tags_select_own ON public.item_tags
  FOR SELECT USING (user_id = auth.uid());

REVOKE ALL ON public.accounts, public.assets, public.collections, public.items, public.item_tags
  FROM anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- RPC function definitions and grants are intentionally specified, not deployed,
-- in docs/phase6a/SECURITY.md and docs/phase6a/PROTOCOL.md.
