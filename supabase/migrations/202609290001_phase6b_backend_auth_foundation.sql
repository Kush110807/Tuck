-- Tuck Phase 6B — Backend & Auth Foundation
-- Frozen protocol: Phase 6A / protocol v1.
-- This migration implements server schema, account-scoped transactional sequencing,
-- RLS, hardened RPCs, bootstrap materialization, idempotency, tombstones, and the
-- private asset/storage foundation. It does NOT wire Android CRUD to sync.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS private;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tuck_rpc_owner') THEN
    CREATE ROLE tuck_rpc_owner NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Core schema
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleting')),
  protocol_version integer NOT NULL DEFAULT 1 CHECK (protocol_version >= 1),
  change_retention_floor_seq bigint NOT NULL DEFAULT 1 CHECK (change_retention_floor_seq >= 1),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS private.account_sync_heads (
  user_id uuid PRIMARY KEY REFERENCES public.accounts(user_id) ON DELETE CASCADE,
  head_seq bigint NOT NULL DEFAULT 0 CHECK (head_seq >= 0)
);

CREATE TABLE IF NOT EXISTS public.assets (
  user_id uuid NOT NULL REFERENCES public.accounts(user_id) ON DELETE CASCADE,
  id text NOT NULL CHECK (char_length(id) BETWEEN 1 AND 128 AND id !~ '[[:cntrl:]]'),
  storage_path text NOT NULL CHECK (char_length(storage_path) BETWEEN 1 AND 512),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size bigint NOT NULL CHECK (byte_size >= 0 AND byte_size <= 10485760),
  state text NOT NULL CHECK (state IN ('staging', 'ready')),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, storage_path),
  CHECK ((state = 'staging' AND ready_at IS NULL) OR (state = 'ready' AND ready_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.collections (
  user_id uuid NOT NULL REFERENCES public.accounts(user_id) ON DELETE CASCADE,
  id text NOT NULL CHECK (char_length(id) BETWEEN 1 AND 128 AND id !~ '[[:cntrl:]]'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 240),
  name_key text NOT NULL CHECK (char_length(name_key) BETWEEN 1 AND 240),
  created_at bigint NOT NULL CHECK (created_at >= 0),
  updated_at bigint NOT NULL CHECK (updated_at >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, name_key)
);

CREATE TABLE IF NOT EXISTS public.items (
  user_id uuid NOT NULL REFERENCES public.accounts(user_id) ON DELETE CASCADE,
  id text NOT NULL CHECK (char_length(id) BETWEEN 1 AND 128 AND id !~ '[[:cntrl:]]'),
  type text NOT NULL CHECK (type IN ('note', 'link', 'image')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 480),
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

CREATE INDEX IF NOT EXISTS idx_items_user_archive_updated
  ON public.items(user_id, archived, updated_at DESC, id ASC);
CREATE INDEX IF NOT EXISTS idx_items_user_collection
  ON public.items(user_id, collection_id, archived, updated_at DESC, id ASC);
CREATE INDEX IF NOT EXISTS idx_items_user_pinned
  ON public.items(user_id, archived, pinned, updated_at DESC, id ASC);
CREATE INDEX IF NOT EXISTS idx_items_user_asset
  ON public.items(user_id, asset_id) WHERE asset_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.item_tags (
  user_id uuid NOT NULL,
  item_id text NOT NULL,
  tag_key text NOT NULL CHECK (char_length(tag_key) BETWEEN 1 AND 192),
  display text NOT NULL CHECK (char_length(display) BETWEEN 1 AND 192),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  PRIMARY KEY (user_id, item_id, tag_key),
  UNIQUE (user_id, item_id, ordinal),
  FOREIGN KEY (user_id, item_id)
    REFERENCES public.items(user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_item_tags_user_key
  ON public.item_tags(user_id, tag_key, item_id);

CREATE TABLE IF NOT EXISTS private.entity_tombstones (
  user_id uuid NOT NULL REFERENCES public.accounts(user_id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('item', 'collection')),
  entity_id text NOT NULL CHECK (char_length(entity_id) BETWEEN 1 AND 128),
  deleted_version bigint NOT NULL CHECK (deleted_version >= 1),
  deleted_seq bigint NOT NULL CHECK (deleted_seq >= 1),
  deleted_at timestamptz NOT NULL DEFAULT now(),
  origin_device_id text NOT NULL CHECK (char_length(origin_device_id) BETWEEN 1 AND 128),
  PRIMARY KEY (user_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_tombstones_user_deleted_seq
  ON private.entity_tombstones(user_id, deleted_seq);

CREATE TABLE IF NOT EXISTS private.sync_changes (
  user_id uuid NOT NULL REFERENCES public.accounts(user_id) ON DELETE CASCADE,
  seq bigint NOT NULL CHECK (seq >= 1),
  entity_type text NOT NULL CHECK (entity_type IN ('item', 'collection', 'asset')),
  entity_id text NOT NULL CHECK (char_length(entity_id) BETWEEN 1 AND 128),
  entity_version bigint NOT NULL CHECK (entity_version >= 1),
  kind text NOT NULL CHECK (kind IN ('upsert', 'delete')),
  payload jsonb NOT NULL,
  mutation_id uuid,
  origin_device_id text NOT NULL CHECK (char_length(origin_device_id) BETWEEN 1 AND 128),
  server_at timestamptz NOT NULL DEFAULT now(),
  retain_until timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  PRIMARY KEY (user_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_sync_changes_retention
  ON private.sync_changes(retain_until, user_id, seq);

CREATE TABLE IF NOT EXISTS private.processed_mutations (
  user_id uuid NOT NULL REFERENCES public.accounts(user_id) ON DELETE CASCADE,
  mutation_id uuid NOT NULL,
  protocol_version integer NOT NULL CHECK (protocol_version >= 1),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  result_payload jsonb NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mutation_id)
);

CREATE TABLE IF NOT EXISTS private.bootstrap_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.accounts(user_id) ON DELETE CASCADE,
  snapshot_head_seq bigint NOT NULL CHECK (snapshot_head_seq >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS idx_bootstrap_sessions_expiry
  ON private.bootstrap_sessions(expires_at);

CREATE TABLE IF NOT EXISTS private.bootstrap_entries (
  session_id uuid NOT NULL REFERENCES private.bootstrap_sessions(id) ON DELETE CASCADE,
  ordinal bigint NOT NULL CHECK (ordinal >= 1),
  entity_type text NOT NULL CHECK (entity_type IN ('item', 'collection', 'asset')),
  entity_id text NOT NULL CHECK (char_length(entity_id) BETWEEN 1 AND 128),
  payload jsonb NOT NULL,
  PRIMARY KEY (session_id, ordinal),
  UNIQUE (session_id, entity_type, entity_id)
);

-- ---------------------------------------------------------------------------
-- RLS: exposed user-owned tables. Synchronization mutations still use RPCs.
-- ---------------------------------------------------------------------------
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accounts_select_own ON public.accounts;
CREATE POLICY accounts_select_own ON public.accounts
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS assets_select_own ON public.assets;
CREATE POLICY assets_select_own ON public.assets
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS collections_select_own ON public.collections;
CREATE POLICY collections_select_own ON public.collections
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS items_select_own ON public.items;
CREATE POLICY items_select_own ON public.items
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS item_tags_select_own ON public.item_tags;
CREATE POLICY item_tags_select_own ON public.item_tags
  FOR SELECT TO authenticated USING (user_id = auth.uid());

REVOKE ALL ON public.accounts, public.assets, public.collections, public.items, public.item_tags
  FROM anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Internal normalization / validation helpers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.identifier_valid(p_value text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT p_value IS NOT NULL
    AND char_length(btrim(p_value)) >= 1
    AND char_length(p_value) <= 128
    AND p_value !~ '[[:cntrl:]]'
$$;

CREATE OR REPLACE FUNCTION private.normalize_comparable_text(p_value text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT btrim(regexp_replace(normalize(COALESCE(p_value, ''), NFKC), '\s+', ' ', 'g'))
$$;

CREATE OR REPLACE FUNCTION private.collection_name_key(p_value text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT lower(private.normalize_comparable_text(p_value))
$$;

CREATE OR REPLACE FUNCTION private.jsonb_has_exact_keys(p_value jsonb, p_keys text[])
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, private
AS $$
  SELECT CASE
    WHEN p_value IS NULL OR jsonb_typeof(p_value) <> 'object' THEN false
    ELSE (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_value) key)
         = (SELECT array_agg(key ORDER BY key) FROM unnest(p_keys) key)
  END
$$;

CREATE OR REPLACE FUNCTION private.jsonb_is_nonnegative_safe_integer(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
DECLARE
  v_numeric numeric;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'number' THEN RETURN false; END IF;
  BEGIN v_numeric := (p_value #>> '{}')::numeric; EXCEPTION WHEN others THEN RETURN false; END;
  RETURN trunc(v_numeric) = v_numeric AND v_numeric BETWEEN 0 AND 9007199254740991;
END
$$;

CREATE OR REPLACE FUNCTION private.jsonb_is_positive_safe_integer(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, private
AS $$
BEGIN
  IF NOT private.jsonb_is_nonnegative_safe_integer(p_value) THEN RETURN false; END IF;
  RETURN (p_value #>> '{}')::numeric >= 1;
END
$$;

CREATE OR REPLACE FUNCTION private.normalized_tags(p_tags jsonb)
RETURNS TABLE(tag_key text, display text, ordinal integer)
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, private
AS $$
  WITH raw AS (
    SELECT private.normalize_comparable_text(value) AS display, ordinality::integer AS first_ordinal
    FROM jsonb_array_elements_text(COALESCE(p_tags, '[]'::jsonb)) WITH ORDINALITY AS e(value, ordinality)
  ), keyed AS (
    SELECT lower(display) AS tag_key, display, first_ordinal
    FROM raw
    WHERE display <> ''
  ), dedup AS (
    SELECT DISTINCT ON (tag_key) tag_key, display, first_ordinal
    FROM keyed
    ORDER BY tag_key, first_ordinal
  )
  SELECT tag_key, display, row_number() OVER (ORDER BY first_ordinal)::integer - 1
  FROM dedup
  ORDER BY first_ordinal
$$;

CREATE OR REPLACE FUNCTION private.normalize_tags_json(p_tags jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, private
AS $$
  SELECT COALESCE(jsonb_agg(display ORDER BY ordinal), '[]'::jsonb)
  FROM private.normalized_tags(p_tags)
$$;

CREATE OR REPLACE FUNCTION private.merge_tags_three_way(p_base jsonb, p_current jsonb, p_local jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, private
AS $$
  WITH b AS (SELECT * FROM private.normalized_tags(p_base)),
       c AS (SELECT * FROM private.normalized_tags(p_current)),
       l AS (SELECT * FROM private.normalized_tags(p_local)),
       removed AS (
         SELECT b.tag_key FROM b LEFT JOIN c USING(tag_key) WHERE c.tag_key IS NULL
         UNION
         SELECT b.tag_key FROM b LEFT JOIN l USING(tag_key) WHERE l.tag_key IS NULL
       ),
       kept_current AS (
         SELECT c.tag_key, c.display, c.ordinal::bigint AS ord, 0 AS source
         FROM c LEFT JOIN removed r USING(tag_key) WHERE r.tag_key IS NULL
       ),
       added_local AS (
         SELECT l.tag_key, l.display, l.ordinal::bigint AS ord, 1 AS source
         FROM l
         LEFT JOIN removed r USING(tag_key)
         LEFT JOIN kept_current c USING(tag_key)
         WHERE r.tag_key IS NULL AND c.tag_key IS NULL
       ),
       merged AS (
         SELECT * FROM kept_current
         UNION ALL
         SELECT * FROM added_local
       )
  SELECT COALESCE(jsonb_agg(display ORDER BY source, ord), '[]'::jsonb) FROM merged
$$;

CREATE OR REPLACE FUNCTION private.item_tags_json(p_user_id uuid, p_item_id text)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(jsonb_agg(t.display ORDER BY t.ordinal), '[]'::jsonb)
  FROM public.item_tags t
  WHERE t.user_id = p_user_id AND t.item_id = p_item_id
$$;

CREATE OR REPLACE FUNCTION private.item_snapshot(p_user_id uuid, p_item_id text)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = pg_catalog, public, private
AS $$
  SELECT jsonb_build_object(
    'entityType', 'item',
    'entity', jsonb_build_object(
      'id', i.id,
      'type', i.type,
      'title', i.title,
      'body', to_jsonb(i.body),
      'url', to_jsonb(i.url),
      'assetId', to_jsonb(i.asset_id),
      'tags', private.item_tags_json(i.user_id, i.id),
      'collectionId', to_jsonb(i.collection_id),
      'pinned', i.pinned,
      'archived', i.archived,
      'createdAt', i.created_at,
      'updatedAt', i.updated_at,
      'version', i.version
    )
  )
  FROM public.items i
  WHERE i.user_id = p_user_id AND i.id = p_item_id
$$;

CREATE OR REPLACE FUNCTION private.collection_snapshot(p_user_id uuid, p_collection_id text)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'entityType', 'collection',
    'entity', jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'nameKey', c.name_key,
      'createdAt', c.created_at,
      'updatedAt', c.updated_at,
      'version', c.version
    )
  )
  FROM public.collections c
  WHERE c.user_id = p_user_id AND c.id = p_collection_id
$$;

CREATE OR REPLACE FUNCTION private.asset_snapshot(p_user_id uuid, p_asset_id text)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'entityType', 'asset',
    'entity', jsonb_build_object(
      'id', a.id,
      'mimeType', a.mime_type,
      'byteSize', a.byte_size,
      'remoteState', a.state,
      'version', a.version
    )
  )
  FROM public.assets a
  WHERE a.user_id = p_user_id AND a.id = p_asset_id
$$;

CREATE OR REPLACE FUNCTION private.tombstone_payload(
  p_entity_type text,
  p_entity_id text,
  p_deleted_version bigint,
  p_deleted_seq bigint,
  p_origin_device_id text
)
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT jsonb_build_object(
    'entityType', p_entity_type,
    'entityId', p_entity_id,
    'deletedVersion', p_deleted_version,
    'deletedSequence', p_deleted_seq,
    'originDeviceId', p_origin_device_id
  )
$$;

CREATE OR REPLACE FUNCTION private.write_item_tags(p_user_id uuid, p_item_id text, p_tags jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public, private
AS $$
BEGIN
  DELETE FROM public.item_tags WHERE user_id = p_user_id AND item_id = p_item_id;
  INSERT INTO public.item_tags(user_id, item_id, tag_key, display, ordinal)
  SELECT p_user_id, p_item_id, t.tag_key, t.display, t.ordinal
  FROM private.normalized_tags(p_tags) t;
END
$$;

CREATE OR REPLACE FUNCTION private.allocate_change_seq(p_user_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = pg_catalog, private
AS $$
DECLARE v_seq bigint;
BEGIN
  UPDATE private.account_sync_heads
  SET head_seq = head_seq + 1
  WHERE user_id = p_user_id
  RETURNING head_seq INTO v_seq;
  IF v_seq IS NULL THEN RAISE EXCEPTION 'Tuck account sync head missing'; END IF;
  RETURN v_seq;
END
$$;

CREATE OR REPLACE FUNCTION private.append_upsert_change(
  p_user_id uuid,
  p_snapshot jsonb,
  p_mutation_id uuid,
  p_origin_device_id text
)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = pg_catalog, private
AS $$
DECLARE
  v_seq bigint;
  v_type text := p_snapshot->>'entityType';
  v_entity jsonb := p_snapshot->'entity';
BEGIN
  v_seq := private.allocate_change_seq(p_user_id);
  INSERT INTO private.sync_changes(
    user_id, seq, entity_type, entity_id, entity_version, kind,
    payload, mutation_id, origin_device_id
  ) VALUES (
    p_user_id, v_seq, v_type, v_entity->>'id', (v_entity->>'version')::bigint, 'upsert',
    p_snapshot, p_mutation_id, p_origin_device_id
  );
  RETURN v_seq;
END
$$;

CREATE OR REPLACE FUNCTION private.append_delete_change(
  p_user_id uuid,
  p_entity_type text,
  p_entity_id text,
  p_deleted_version bigint,
  p_mutation_id uuid,
  p_origin_device_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, private
AS $$
DECLARE
  v_seq bigint;
  v_payload jsonb;
BEGIN
  v_seq := private.allocate_change_seq(p_user_id);
  v_payload := private.tombstone_payload(p_entity_type, p_entity_id, p_deleted_version, v_seq, p_origin_device_id);
  INSERT INTO private.entity_tombstones(
    user_id, entity_type, entity_id, deleted_version, deleted_seq, origin_device_id
  ) VALUES (
    p_user_id, p_entity_type, p_entity_id, p_deleted_version, v_seq, p_origin_device_id
  );
  INSERT INTO private.sync_changes(
    user_id, seq, entity_type, entity_id, entity_version, kind,
    payload, mutation_id, origin_device_id
  ) VALUES (
    p_user_id, v_seq, p_entity_type, p_entity_id, p_deleted_version, 'delete',
    v_payload, p_mutation_id, p_origin_device_id
  );
  RETURN v_payload;
END
$$;

CREATE OR REPLACE FUNCTION private.accepted_result(
  p_mutation_id text,
  p_canonical jsonb,
  p_server_version bigint,
  p_change_sequence bigint,
  p_changed boolean,
  p_warnings jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT jsonb_build_object(
    'kind', 'accepted',
    'mutationId', p_mutation_id,
    'canonical', p_canonical,
    'serverVersion', p_server_version,
    'changeSequence', to_jsonb(p_change_sequence),
    'changed', p_changed,
    'warnings', COALESCE(p_warnings, '[]'::jsonb)
  )
$$;

CREATE OR REPLACE FUNCTION private.conflict_result(
  p_mutation_id text,
  p_reason text,
  p_fields jsonb,
  p_current jsonb,
  p_current_version bigint
)
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT jsonb_build_object(
    'kind', 'conflict',
    'mutationId', p_mutation_id,
    'reason', p_reason,
    'conflictFields', COALESCE(p_fields, '[]'::jsonb),
    'current', p_current,
    'currentServerVersion', p_current_version
  )
$$;

CREATE OR REPLACE FUNCTION private.rejected_result(p_mutation_id text, p_code text, p_message text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT jsonb_build_object('kind', 'rejected', 'mutationId', p_mutation_id, 'code', p_code, 'message', p_message)
$$;

CREATE OR REPLACE FUNCTION private.validate_mutation_v1(p_mutation jsonb, p_account_id text)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, private
AS $$
DECLARE
  v_mid text := COALESCE(p_mutation->>'mutationId', 'malformed');
  v_entity_type text;
  v_action text;
  v_changed jsonb;
  v_base jsonb;
  v_new jsonb;
  v_field text;
  v_allowed text[];
  v_create_fields text[];
  v_create_keys text[];
BEGIN
  IF NOT private.jsonb_has_exact_keys(p_mutation, ARRAY[
    'protocolVersion','accountId','mutationId','originDeviceId','entityType','entityId','action',
    'baseServerVersion','changedFields','baseValues','newValues'
  ]) THEN
    RETURN private.rejected_result(v_mid, 'MALFORMED_MUTATION', 'Mutation object shape is invalid.');
  END IF;
  IF p_mutation->'protocolVersion' <> '1'::jsonb THEN
    RETURN private.rejected_result(v_mid, 'UNSUPPORTED_PROTOCOL_VERSION', 'Unsupported mutation protocol version.');
  END IF;
  IF v_mid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RETURN private.rejected_result(v_mid, 'MALFORMED_MUTATION', 'mutationId must be a canonical UUID.');
  END IF;
  IF NOT private.identifier_valid(p_mutation->>'accountId')
     OR NOT private.identifier_valid(p_mutation->>'originDeviceId')
     OR NOT private.identifier_valid(p_mutation->>'entityId') THEN
    RETURN private.rejected_result(v_mid, 'MALFORMED_MUTATION', 'Identifiers must be 1..128 code units with no control characters.');
  END IF;
  IF p_mutation->>'accountId' <> p_account_id THEN
    RETURN private.rejected_result(v_mid, 'WRONG_ACCOUNT', 'Mutation account does not match request account.');
  END IF;

  v_entity_type := p_mutation->>'entityType';
  v_action := p_mutation->>'action';
  IF v_entity_type NOT IN ('item','collection') THEN
    RETURN private.rejected_result(v_mid, 'MALFORMED_MUTATION', 'Invalid entity type.');
  END IF;
  IF v_action NOT IN ('create','patch','delete') THEN
    RETURN private.rejected_result(v_mid, 'MALFORMED_MUTATION', 'Invalid mutation action.');
  END IF;
  IF jsonb_typeof(p_mutation->'changedFields') <> 'array'
     OR jsonb_typeof(p_mutation->'baseValues') <> 'object'
     OR jsonb_typeof(p_mutation->'newValues') <> 'object' THEN
    RETURN private.rejected_result(v_mid, 'MALFORMED_MUTATION', 'Mutation action/entity payload shape is invalid.');
  END IF;

  v_changed := p_mutation->'changedFields'; v_base := p_mutation->'baseValues'; v_new := p_mutation->'newValues';
  v_allowed := CASE WHEN v_entity_type='item'
    THEN ARRAY['title','body','url','assetId','tags','collectionId','pinned','archived','updatedAt']
    ELSE ARRAY['name','updatedAt'] END;

  IF v_action = 'delete' THEN
    IF NOT private.jsonb_is_positive_safe_integer(p_mutation->'baseServerVersion')
       OR jsonb_array_length(v_changed) <> 0 OR v_base <> '{}'::jsonb OR v_new <> '{}'::jsonb THEN
      RETURN private.rejected_result(v_mid, 'MALFORMED_MUTATION', 'Mutation action/entity payload shape is invalid.');
    END IF;
    RETURN NULL;
  END IF;

  IF v_action = 'create' THEN
    IF p_mutation->'baseServerVersion' <> 'null'::jsonb THEN
      RETURN private.rejected_result(v_mid, 'MALFORMED_MUTATION', 'Mutation action/entity payload shape is invalid.');
    END IF;
    v_create_fields := CASE WHEN v_entity_type='item'
      THEN ARRAY['title','body','url','assetId','tags','collectionId','pinned','archived','updatedAt']
      ELSE ARRAY['name','updatedAt'] END;
    v_create_keys := CASE WHEN v_entity_type='item'
      THEN ARRAY['type','title','body','url','assetId','tags','collectionId','pinned','archived','createdAt','updatedAt']
      ELSE ARRAY['name','createdAt','updatedAt'] END;

    -- Exact field set and no duplicates.
    IF jsonb_array_length(v_changed) <> cardinality(v_create_fields)
       OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(v_changed)) <> cardinality(v_create_fields)
       OR EXISTS (SELECT 1 FROM unnest(v_create_fields) f WHERE NOT v_changed ? f)
       OR NOT private.jsonb_has_exact_keys(v_new, v_create_keys)
       OR v_base <> '{}'::jsonb THEN
      RETURN private.rejected_result(v_mid, 'MALFORMED_MUTATION', 'Mutation action/entity payload shape is invalid.');
    END IF;
    IF NOT private.jsonb_is_nonnegative_safe_integer(v_new->'createdAt')
       OR NOT private.jsonb_is_nonnegative_safe_integer(v_new->'updatedAt') THEN
      RETURN private.rejected_result(v_mid, 'MALFORMED_MUTATION', 'Mutation action/entity payload shape is invalid.');
    END IF;
    IF v_entity_type='item' THEN
      IF v_new->>'type' NOT IN ('note','link','image')
         OR jsonb_typeof(v_new->'title') <> 'string'
         OR (jsonb_typeof(v_new->'body') NOT IN ('string','null'))
         OR (jsonb_typeof(v_new->'url') NOT IN ('string','null'))
         OR (jsonb_typeof(v_new->'assetId') NOT IN ('string','null'))
         OR jsonb_typeof(v_new->'tags') <> 'array'
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_new->'tags') x WHERE jsonb_typeof(x) <> 'string')
         OR (jsonb_typeof(v_new->'collectionId') NOT IN ('string','null'))
         OR jsonb_typeof(v_new->'pinned') <> 'boolean'
         OR jsonb_typeof(v_new->'archived') <> 'boolean'
         OR (jsonb_typeof(v_new->'assetId')='string' AND NOT private.identifier_valid(v_new->>'assetId'))
         OR (jsonb_typeof(v_new->'collectionId')='string' AND NOT private.identifier_valid(v_new->>'collectionId')) THEN
        RETURN private.rejected_result(v_mid, 'MALFORMED_MUTATION', 'Mutation action/entity payload shape is invalid.');
      END IF;
    ELSE
      IF jsonb_typeof(v_new->'name') <> 'string' THEN
        RETURN private.rejected_result(v_mid, 'MALFORMED_MUTATION', 'Mutation action/entity payload shape is invalid.');
      END IF;
    END IF;
    RETURN NULL;
  END IF;

  -- patch
  IF NOT private.jsonb_is_positive_safe_integer(p_mutation->'baseServerVersion')
     OR jsonb_array_length(v_changed) = 0
     OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(v_changed)) <> jsonb_array_length(v_changed)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_changed) f WHERE NOT (f = ANY(v_allowed)))
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_changed) f WHERE f <> 'updatedAt')
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_new) k WHERE NOT v_changed ? k)
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_base) k WHERE k='updatedAt' OR NOT v_changed ? k) THEN
    RETURN private.rejected_result(v_mid, 'MALFORMED_MUTATION', 'Mutation action/entity payload shape is invalid.');
  END IF;

  FOR v_field IN SELECT value FROM jsonb_array_elements_text(v_changed) LOOP
    IF NOT v_new ? v_field OR (v_field <> 'updatedAt' AND NOT v_base ? v_field) THEN
      RETURN private.rejected_result(v_mid, 'MALFORMED_MUTATION', 'Mutation action/entity payload shape is invalid.');
    END IF;
    IF v_field='updatedAt' AND NOT private.jsonb_is_nonnegative_safe_integer(v_new->v_field) THEN
      RETURN private.rejected_result(v_mid, 'MALFORMED_MUTATION', 'Mutation action/entity payload shape is invalid.');
    ELSIF v_field IN ('title','body','url','name') THEN
      IF v_field IN ('title','name') THEN
        IF jsonb_typeof(v_new->v_field) <> 'string' OR jsonb_typeof(v_base->v_field) <> 'string' THEN
          RETURN private.rejected_result(v_mid, 'MALFORMED_MUTATION', 'Mutation action/entity payload shape is invalid.');
        END IF;
      ELSE
        IF jsonb_typeof(v_new->v_field) NOT IN ('string','null') OR jsonb_typeof(v_base->v_field) NOT IN ('string','null') THEN
          RETURN private.rejected_result(v_mid, 'MALFORMED_MUTATION', 'Mutation action/entity payload shape is invalid.');
        END IF;
      END IF;
    ELSIF v_field IN ('assetId','collectionId') THEN
      IF jsonb_typeof(v_new->v_field) NOT IN ('string','null')
         OR jsonb_typeof(v_base->v_field) NOT IN ('string','null')
         OR (jsonb_typeof(v_new->v_field)='string' AND NOT private.identifier_valid(v_new->>v_field))
         OR (jsonb_typeof(v_base->v_field)='string' AND NOT private.identifier_valid(v_base->>v_field)) THEN
        RETURN private.rejected_result(v_mid, 'MALFORMED_MUTATION', 'Mutation action/entity payload shape is invalid.');
      END IF;
    ELSIF v_field='tags' THEN
      IF jsonb_typeof(v_new->v_field) <> 'array' OR jsonb_typeof(v_base->v_field) <> 'array'
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_new->v_field) x WHERE jsonb_typeof(x)<>'string')
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_base->v_field) x WHERE jsonb_typeof(x)<>'string') THEN
        RETURN private.rejected_result(v_mid, 'MALFORMED_MUTATION', 'Mutation action/entity payload shape is invalid.');
      END IF;
    ELSIF v_field IN ('pinned','archived') THEN
      IF jsonb_typeof(v_new->v_field) <> 'boolean' OR jsonb_typeof(v_base->v_field) <> 'boolean' THEN
        RETURN private.rejected_result(v_mid, 'MALFORMED_MUTATION', 'Mutation action/entity payload shape is invalid.');
      END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END
$$;

-- ---------------------------------------------------------------------------
-- Mutation implementation. All valid first-seen mutations serialize through
-- the per-account head row before reading mutable canonical state.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.process_mutation_v1(p_user_id uuid, p_mutation jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public, private, extensions
AS $$
DECLARE
  v_validation jsonb;
  v_mid_text text := COALESCE(p_mutation->>'mutationId','malformed');
  v_mid uuid;
  v_hash text;
  v_processed private.processed_mutations%ROWTYPE;
  v_result jsonb;
  v_entity_type text;
  v_action text;
  v_entity_id text;
  v_device text;
  v_current jsonb;
  v_tomb private.entity_tombstones%ROWTYPE;
  v_current_version bigint;
  v_base_version bigint;
  v_seq bigint;
  v_warnings jsonb := '[]'::jsonb;
  v_collection_id text;
  v_tags jsonb;
  v_name text;
  v_name_key text;
  v_changed boolean;
  v_requested_updated bigint;
  v_fields jsonb;
  v_field text;
  v_conflicts jsonb := '[]'::jsonb;
  v_values jsonb;
  v_base jsonb;
  v_new jsonb;
  v_current_mutable jsonb;
  v_next_mutable jsonb;
  v_next_semantic jsonb;
  v_current_semantic jsonb;
  v_item public.items%ROWTYPE;
  v_collection public.collections%ROWTYPE;
  v_asset_state text;
  v_deleted jsonb;
  r_item public.items%ROWTYPE;
BEGIN
  v_validation := private.validate_mutation_v1(p_mutation, p_user_id::text);
  IF v_validation IS NOT NULL THEN RETURN v_validation; END IF;

  v_mid := (p_mutation->>'mutationId')::uuid;
  v_hash := encode(extensions.digest(convert_to(p_mutation::text, 'UTF8'), 'sha256'), 'hex');

  -- This lock is the account-scoped serialization point. It is deliberately
  -- acquired before canonical reads/merge decisions, not only before seq write.
  PERFORM head_seq FROM private.account_sync_heads WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN private.rejected_result(v_mid_text,'NOT_FOUND','Tuck account was not initialized.'); END IF;

  SELECT * INTO v_processed
  FROM private.processed_mutations
  WHERE user_id=p_user_id AND mutation_id=v_mid;
  IF FOUND THEN
    IF v_processed.request_hash <> v_hash THEN
      RETURN private.rejected_result(v_mid_text,'MUTATION_ID_REUSE','Mutation ID was already used for a different payload.');
    END IF;
    RETURN v_processed.result_payload;
  END IF;

  v_entity_type := p_mutation->>'entityType';
  v_action := p_mutation->>'action';
  v_entity_id := p_mutation->>'entityId';
  v_device := p_mutation->>'originDeviceId';
  v_base_version := CASE WHEN p_mutation->'baseServerVersion'='null'::jsonb THEN NULL ELSE (p_mutation->>'baseServerVersion')::bigint END;
  v_fields := p_mutation->'changedFields';
  v_base := p_mutation->'baseValues';
  v_new := p_mutation->'newValues';

  SELECT * INTO v_tomb FROM private.entity_tombstones
  WHERE user_id=p_user_id AND entity_type=v_entity_type AND entity_id=v_entity_id;

  IF v_entity_type='item' AND v_action='create' THEN
    IF FOUND THEN
      v_result := private.rejected_result(v_mid_text,'ENTITY_ID_REUSED_AFTER_DELETE','A deleted entity ID cannot be reused.');
    ELSIF EXISTS (SELECT 1 FROM public.items WHERE user_id=p_user_id AND id=v_entity_id) THEN
      v_current := private.item_snapshot(p_user_id,v_entity_id);
      v_result := private.conflict_result(v_mid_text,'ENTITY_ID_COLLISION','[]'::jsonb,v_current,(v_current#>>'{entity,version}')::bigint);
    ELSE
      v_collection_id := CASE WHEN v_new->'collectionId'='null'::jsonb THEN NULL ELSE v_new->>'collectionId' END;
      IF v_collection_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.collections WHERE user_id=p_user_id AND id=v_collection_id) THEN
        v_collection_id := NULL;
        v_warnings := '["COLLECTION_DELETED_COERCED_TO_UNFILED"]'::jsonb;
      END IF;
      v_tags := private.normalize_tags_json(v_new->'tags');
      IF char_length(btrim(v_new->>'title'))=0 OR char_length(v_new->>'title')>480
         OR EXISTS (SELECT 1 FROM private.normalized_tags(v_tags) t WHERE char_length(t.display)>192)
         OR (v_new->>'type'='note' AND NOT (jsonb_typeof(v_new->'body')='string' AND v_new->'url'='null'::jsonb AND v_new->'assetId'='null'::jsonb))
         OR (v_new->>'type'='link' AND NOT (v_new->'body'='null'::jsonb AND jsonb_typeof(v_new->'url')='string' AND char_length(btrim(v_new->>'url'))>0 AND v_new->'assetId'='null'::jsonb))
         OR (v_new->>'type'='image' AND NOT (jsonb_typeof(v_new->'body') IN ('string','null') AND v_new->'url'='null'::jsonb AND jsonb_typeof(v_new->'assetId')='string')) THEN
        v_result := private.rejected_result(v_mid_text,'INVALID_ENTITY','Item create payload is invalid.');
      ELSE
        IF v_new->>'type'='image' THEN
          SELECT state INTO v_asset_state FROM public.assets
          WHERE user_id=p_user_id AND id=v_new->>'assetId';
          IF v_asset_state IS DISTINCT FROM 'ready' THEN
            v_result := private.rejected_result(v_mid_text,'INVALID_ENTITY','Item create payload is invalid.');
          END IF;
        END IF;
        IF v_result IS NULL THEN
          INSERT INTO public.items(user_id,id,type,title,body,url,asset_id,collection_id,pinned,archived,created_at,updated_at,version)
          VALUES (
            p_user_id,v_entity_id,v_new->>'type',v_new->>'title',
            CASE WHEN v_new->'body'='null'::jsonb THEN NULL ELSE v_new->>'body' END,
            CASE WHEN v_new->'url'='null'::jsonb THEN NULL ELSE v_new->>'url' END,
            CASE WHEN v_new->'assetId'='null'::jsonb THEN NULL ELSE v_new->>'assetId' END,
            v_collection_id,(v_new->>'pinned')::boolean,(v_new->>'archived')::boolean,
            (v_new->>'createdAt')::bigint,(v_new->>'updatedAt')::bigint,1
          );
          PERFORM private.write_item_tags(p_user_id,v_entity_id,v_tags);
          v_current := private.item_snapshot(p_user_id,v_entity_id);
          v_seq := private.append_upsert_change(p_user_id,v_current,v_mid,v_device);
          v_result := private.accepted_result(v_mid_text,v_current,1,v_seq,true,v_warnings);
        END IF;
      END IF;
    END IF;

  ELSIF v_entity_type='item' AND v_action='patch' THEN
    IF FOUND THEN
      v_current := private.tombstone_payload(v_tomb.entity_type,v_tomb.entity_id,v_tomb.deleted_version,v_tomb.deleted_seq,v_tomb.origin_device_id);
      v_result := private.conflict_result(v_mid_text,'REMOTE_DELETED',v_fields,v_current,v_tomb.deleted_version);
    ELSE
      SELECT * INTO v_item FROM public.items WHERE user_id=p_user_id AND id=v_entity_id;
      IF NOT FOUND THEN
        v_result := private.rejected_result(v_mid_text,'NOT_FOUND','Item was not found.');
      ELSE
        v_current_mutable := jsonb_build_object(
          'title',v_item.title,'body',to_jsonb(v_item.body),'url',to_jsonb(v_item.url),'assetId',to_jsonb(v_item.asset_id),
          'tags',private.item_tags_json(p_user_id,v_item.id),'collectionId',to_jsonb(v_item.collection_id),
          'pinned',v_item.pinned,'archived',v_item.archived,'updatedAt',v_item.updated_at
        );
        v_next_mutable := v_current_mutable;
        v_requested_updated := NULL;
        FOR v_field IN SELECT value FROM jsonb_array_elements_text(v_fields) LOOP
          IF v_field='updatedAt' THEN
            v_requested_updated := (v_new->>v_field)::bigint;
          ELSIF v_field='tags' THEN
            IF v_current_mutable->v_field = v_new->v_field THEN NULL;
            ELSIF v_current_mutable->v_field = v_base->v_field THEN
              v_next_mutable := jsonb_set(v_next_mutable,ARRAY[v_field],v_new->v_field,true);
            ELSE
              v_next_mutable := jsonb_set(v_next_mutable,ARRAY[v_field],private.merge_tags_three_way(v_base->v_field,v_current_mutable->v_field,v_new->v_field),true);
            END IF;
          ELSIF v_field IN ('title','body','url','assetId') THEN
            IF v_current_mutable->v_field = v_new->v_field THEN NULL;
            ELSIF v_current_mutable->v_field IS DISTINCT FROM v_base->v_field THEN
              v_conflicts := v_conflicts || jsonb_build_array(v_field);
            ELSE
              v_next_mutable := jsonb_set(v_next_mutable,ARRAY[v_field],v_new->v_field,true);
            END IF;
          ELSIF v_field IN ('collectionId','pinned','archived') THEN
            v_next_mutable := jsonb_set(v_next_mutable,ARRAY[v_field],v_new->v_field,true);
          END IF;
        END LOOP;
        IF jsonb_array_length(v_conflicts)>0 THEN
          v_current := private.item_snapshot(p_user_id,v_entity_id);
          v_result := private.conflict_result(v_mid_text,'AUTHORED_FIELD_CONFLICT',v_conflicts,v_current,v_item.version);
        ELSE
          v_collection_id := CASE WHEN v_next_mutable->'collectionId'='null'::jsonb THEN NULL ELSE v_next_mutable->>'collectionId' END;
          IF v_collection_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.collections WHERE user_id=p_user_id AND id=v_collection_id) THEN
            v_collection_id := NULL;
            v_next_mutable := jsonb_set(v_next_mutable,'{collectionId}','null'::jsonb,true);
            v_warnings := '["COLLECTION_DELETED_COERCED_TO_UNFILED"]'::jsonb;
          END IF;
          v_tags := private.normalize_tags_json(v_next_mutable->'tags');
          v_next_mutable := jsonb_set(v_next_mutable,'{tags}',v_tags,true);
          IF char_length(btrim(v_next_mutable->>'title'))=0 OR char_length(v_next_mutable->>'title')>480
             OR EXISTS (SELECT 1 FROM private.normalized_tags(v_tags) t WHERE char_length(t.display)>192)
             OR (v_item.type='note' AND NOT (jsonb_typeof(v_next_mutable->'body')='string' AND v_next_mutable->'url'='null'::jsonb AND v_next_mutable->'assetId'='null'::jsonb))
             OR (v_item.type='link' AND NOT (v_next_mutable->'body'='null'::jsonb AND jsonb_typeof(v_next_mutable->'url')='string' AND char_length(btrim(v_next_mutable->>'url'))>0 AND v_next_mutable->'assetId'='null'::jsonb))
             OR (v_item.type='image' AND NOT (jsonb_typeof(v_next_mutable->'body') IN ('string','null') AND v_next_mutable->'url'='null'::jsonb AND jsonb_typeof(v_next_mutable->'assetId')='string')) THEN
            v_result := private.rejected_result(v_mid_text,'INVALID_ENTITY','Item patch would create invalid canonical state.');
          ELSE
            IF v_item.type='image' THEN
              SELECT state INTO v_asset_state FROM public.assets WHERE user_id=p_user_id AND id=v_next_mutable->>'assetId';
              IF v_asset_state IS DISTINCT FROM 'ready' THEN
                v_result := private.rejected_result(v_mid_text,'INVALID_ENTITY','Item patch would create invalid canonical state.');
              END IF;
            END IF;
            IF v_result IS NULL THEN
              v_current_semantic := v_current_mutable - 'updatedAt';
              v_next_semantic := v_next_mutable - 'updatedAt';
              v_changed := v_current_semantic IS DISTINCT FROM v_next_semantic;
              IF NOT v_changed THEN
                v_current := private.item_snapshot(p_user_id,v_entity_id);
                v_result := private.accepted_result(v_mid_text,v_current,v_item.version,NULL,false,v_warnings);
              ELSE
                IF v_requested_updated IS NOT NULL THEN
                  v_next_mutable := jsonb_set(v_next_mutable,'{updatedAt}',to_jsonb(v_requested_updated),true);
                ELSE
                  v_next_mutable := jsonb_set(v_next_mutable,'{updatedAt}',to_jsonb(v_item.updated_at),true);
                END IF;
                UPDATE public.items SET
                  title=v_next_mutable->>'title',
                  body=CASE WHEN v_next_mutable->'body'='null'::jsonb THEN NULL ELSE v_next_mutable->>'body' END,
                  url=CASE WHEN v_next_mutable->'url'='null'::jsonb THEN NULL ELSE v_next_mutable->>'url' END,
                  asset_id=CASE WHEN v_next_mutable->'assetId'='null'::jsonb THEN NULL ELSE v_next_mutable->>'assetId' END,
                  collection_id=v_collection_id,
                  pinned=(v_next_mutable->>'pinned')::boolean,
                  archived=(v_next_mutable->>'archived')::boolean,
                  updated_at=(v_next_mutable->>'updatedAt')::bigint,
                  version=version+1
                WHERE user_id=p_user_id AND id=v_entity_id
                RETURNING version INTO v_current_version;
                PERFORM private.write_item_tags(p_user_id,v_entity_id,v_tags);
                v_current := private.item_snapshot(p_user_id,v_entity_id);
                v_seq := private.append_upsert_change(p_user_id,v_current,v_mid,v_device);
                v_result := private.accepted_result(v_mid_text,v_current,v_current_version,v_seq,true,v_warnings);
              END IF;
            END IF;
          END IF;
        END IF;
      END IF;
    END IF;

  ELSIF v_entity_type='item' AND v_action='delete' THEN
    IF FOUND THEN
      v_current := private.tombstone_payload(v_tomb.entity_type,v_tomb.entity_id,v_tomb.deleted_version,v_tomb.deleted_seq,v_tomb.origin_device_id);
      v_result := private.accepted_result(v_mid_text,v_current,v_tomb.deleted_version,NULL,false,'[]'::jsonb);
    ELSE
      SELECT * INTO v_item FROM public.items WHERE user_id=p_user_id AND id=v_entity_id;
      IF NOT FOUND THEN
        v_result := private.rejected_result(v_mid_text,'NOT_FOUND','Item was not found.');
      ELSIF v_base_version <> v_item.version THEN
        v_current := private.item_snapshot(p_user_id,v_entity_id);
        v_result := private.conflict_result(v_mid_text,'STALE_DELETE','[]'::jsonb,v_current,v_item.version);
      ELSE
        DELETE FROM public.items WHERE user_id=p_user_id AND id=v_entity_id;
        v_deleted := private.append_delete_change(p_user_id,'item',v_entity_id,v_item.version+1,v_mid,v_device);
        v_result := private.accepted_result(v_mid_text,v_deleted,v_item.version+1,(v_deleted->>'deletedSequence')::bigint,true,'[]'::jsonb);
      END IF;
    END IF;

  ELSIF v_entity_type='collection' AND v_action='create' THEN
    IF FOUND THEN
      v_result := private.rejected_result(v_mid_text,'ENTITY_ID_REUSED_AFTER_DELETE','A deleted entity ID cannot be reused.');
    ELSIF EXISTS (SELECT 1 FROM public.collections WHERE user_id=p_user_id AND id=v_entity_id) THEN
      v_current := private.collection_snapshot(p_user_id,v_entity_id);
      v_result := private.conflict_result(v_mid_text,'ENTITY_ID_COLLISION','[]'::jsonb,v_current,(v_current#>>'{entity,version}')::bigint);
    ELSE
      v_name := private.normalize_comparable_text(v_new->>'name');
      v_name_key := lower(v_name);
      IF v_name='' OR char_length(v_name)>60 THEN
        v_result := private.rejected_result(v_mid_text,'INVALID_ENTITY','Collection create payload is invalid.');
      ELSIF EXISTS (SELECT 1 FROM public.collections WHERE user_id=p_user_id AND name_key=v_name_key) THEN
        v_result := private.rejected_result(v_mid_text,'DUPLICATE_COLLECTION_NAME','Collection name already exists.');
      ELSE
        INSERT INTO public.collections(user_id,id,name,name_key,created_at,updated_at,version)
        VALUES(p_user_id,v_entity_id,v_name,v_name_key,(v_new->>'createdAt')::bigint,(v_new->>'updatedAt')::bigint,1);
        v_current := private.collection_snapshot(p_user_id,v_entity_id);
        v_seq := private.append_upsert_change(p_user_id,v_current,v_mid,v_device);
        v_result := private.accepted_result(v_mid_text,v_current,1,v_seq,true,'[]'::jsonb);
      END IF;
    END IF;

  ELSIF v_entity_type='collection' AND v_action='patch' THEN
    IF FOUND THEN
      v_current := private.tombstone_payload(v_tomb.entity_type,v_tomb.entity_id,v_tomb.deleted_version,v_tomb.deleted_seq,v_tomb.origin_device_id);
      v_result := private.conflict_result(v_mid_text,'REMOTE_DELETED',v_fields,v_current,v_tomb.deleted_version);
    ELSE
      SELECT * INTO v_collection FROM public.collections WHERE user_id=p_user_id AND id=v_entity_id;
      IF NOT FOUND THEN
        v_result := private.rejected_result(v_mid_text,'NOT_FOUND','Collection was not found.');
      ELSE
        v_changed := false;
        IF v_fields ? 'name' THEN
          IF v_collection.name <> (v_base->>'name') AND v_collection.name <> (v_new->>'name') THEN
            v_result := private.conflict_result(v_mid_text,'COLLECTION_RENAME_CONFLICT','["name"]'::jsonb,private.collection_snapshot(p_user_id,v_entity_id),v_collection.version);
          ELSE
            v_changed := (v_new->>'name') <> v_collection.name;
            v_name := private.normalize_comparable_text(v_new->>'name');
            v_name_key := lower(v_name);
            IF v_name='' OR char_length(v_name)>60 THEN
              v_result := private.rejected_result(v_mid_text,'INVALID_ENTITY','Collection name is invalid.');
            ELSIF EXISTS (SELECT 1 FROM public.collections WHERE user_id=p_user_id AND name_key=v_name_key AND id<>v_entity_id) THEN
              v_result := private.rejected_result(v_mid_text,'DUPLICATE_COLLECTION_NAME','Collection name already exists.');
            END IF;
          END IF;
        ELSE
          v_name := v_collection.name; v_name_key := v_collection.name_key;
        END IF;
        IF v_result IS NULL THEN
          IF NOT v_changed THEN
            v_current := private.collection_snapshot(p_user_id,v_entity_id);
            v_result := private.accepted_result(v_mid_text,v_current,v_collection.version,NULL,false,'[]'::jsonb);
          ELSE
            UPDATE public.collections SET
              name=v_name,name_key=v_name_key,
              updated_at=CASE WHEN v_fields ? 'updatedAt' THEN (v_new->>'updatedAt')::bigint ELSE updated_at END,
              version=version+1
            WHERE user_id=p_user_id AND id=v_entity_id
            RETURNING version INTO v_current_version;
            v_current := private.collection_snapshot(p_user_id,v_entity_id);
            v_seq := private.append_upsert_change(p_user_id,v_current,v_mid,v_device);
            v_result := private.accepted_result(v_mid_text,v_current,v_current_version,v_seq,true,'[]'::jsonb);
          END IF;
        END IF;
      END IF;
    END IF;

  ELSE -- collection delete
    IF FOUND THEN
      v_current := private.tombstone_payload(v_tomb.entity_type,v_tomb.entity_id,v_tomb.deleted_version,v_tomb.deleted_seq,v_tomb.origin_device_id);
      v_result := private.accepted_result(v_mid_text,v_current,v_tomb.deleted_version,NULL,false,'[]'::jsonb);
    ELSE
      SELECT * INTO v_collection FROM public.collections WHERE user_id=p_user_id AND id=v_entity_id;
      IF NOT FOUND THEN
        v_result := private.rejected_result(v_mid_text,'NOT_FOUND','Collection was not found.');
      ELSIF v_base_version <> v_collection.version THEN
        v_current := private.collection_snapshot(p_user_id,v_entity_id);
        v_result := private.conflict_result(v_mid_text,'STALE_DELETE','[]'::jsonb,v_current,v_collection.version);
      ELSE
        -- Atomic Collection deletion: unfile deterministic Item order, preserve
        -- domain updatedAt, bump Item versions, then tombstone/delete Collection.
        FOR r_item IN SELECT * FROM public.items
          WHERE user_id=p_user_id AND collection_id=v_entity_id ORDER BY id
        LOOP
          UPDATE public.items SET collection_id=NULL, version=version+1
          WHERE user_id=p_user_id AND id=r_item.id;
          v_current := private.item_snapshot(p_user_id,r_item.id);
          PERFORM private.append_upsert_change(p_user_id,v_current,v_mid,v_device);
        END LOOP;
        DELETE FROM public.collections WHERE user_id=p_user_id AND id=v_entity_id;
        v_deleted := private.append_delete_change(p_user_id,'collection',v_entity_id,v_collection.version+1,v_mid,v_device);
        v_result := private.accepted_result(v_mid_text,v_deleted,v_collection.version+1,(v_deleted->>'deletedSequence')::bigint,true,'[]'::jsonb);
      END IF;
    END IF;
  END IF;

  INSERT INTO private.processed_mutations(user_id,mutation_id,protocol_version,request_hash,result_payload)
  VALUES(p_user_id,v_mid,1,v_hash,v_result);
  RETURN v_result;
END
$$;

-- ---------------------------------------------------------------------------
-- Public RPCs. SECURITY DEFINER + fixed search_path + authenticated identity.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tuck_push_mutations(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_results jsonb := '[]'::jsonb;
  v_mutation jsonb;
  v_head bigint;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('kind','error','code','UNAUTHENTICATED','message','Authenticated account is required.');
  END IF;
  IF NOT private.jsonb_has_exact_keys(p_request,ARRAY['protocolVersion','accountId','mutations']) THEN
    RETURN jsonb_build_object('kind','error','code','MALFORMED_REQUEST','message','Push request shape is invalid.');
  END IF;
  IF p_request->'protocolVersion' <> '1'::jsonb THEN
    RETURN jsonb_build_object('kind','error','code','UNSUPPORTED_PROTOCOL_VERSION','message','Unsupported sync protocol version.');
  END IF;
  IF NOT private.identifier_valid(p_request->>'accountId') OR jsonb_typeof(p_request->'mutations')<>'array' THEN
    RETURN jsonb_build_object('kind','error','code','MALFORMED_REQUEST','message','Push request shape is invalid.');
  END IF;
  IF p_request->>'accountId' <> v_uid::text THEN
    RETURN jsonb_build_object('kind','error','code','WRONG_ACCOUNT','message','Request account does not match the authenticated account.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE user_id=v_uid AND status='active') THEN
    RETURN jsonb_build_object('kind','error','code','UNAUTHENTICATED','message','Active Tuck account is required.');
  END IF;

  FOR v_mutation IN SELECT value FROM jsonb_array_elements(p_request->'mutations') LOOP
    v_results := v_results || jsonb_build_array(private.process_mutation_v1(v_uid,v_mutation));
  END LOOP;
  SELECT head_seq INTO v_head FROM private.account_sync_heads WHERE user_id=v_uid;
  RETURN jsonb_build_object(
    'kind','ok','protocolVersion',1,'accountId',v_uid::text,'results',v_results,'headSequence',v_head
  );
END
$$;

CREATE OR REPLACE FUNCTION public.tuck_pull_changes(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_after bigint;
  v_limit integer;
  v_target bigint;
  v_head bigint;
  v_floor bigint;
  v_has_more boolean;
  v_next bigint;
  v_changes jsonb;
  v_count bigint;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('kind','error','code','UNAUTHENTICATED','message','Authenticated account is required.'); END IF;
  IF NOT private.jsonb_has_exact_keys(p_request,ARRAY['protocolVersion','accountId','afterSequence','limit','targetHeadSequence'])
     AND NOT private.jsonb_has_exact_keys(p_request,ARRAY['protocolVersion','accountId','afterSequence','limit']) THEN
    RETURN jsonb_build_object('kind','error','code','MALFORMED_REQUEST','message','Pull request shape is invalid.');
  END IF;
  IF p_request->'protocolVersion'<>'1'::jsonb THEN RETURN jsonb_build_object('kind','error','code','UNSUPPORTED_PROTOCOL_VERSION','message','Unsupported sync protocol version.'); END IF;
  IF p_request->>'accountId'<>v_uid::text THEN RETURN jsonb_build_object('kind','error','code','WRONG_ACCOUNT','message','Request account does not match the authenticated account.'); END IF;
  IF NOT private.jsonb_is_nonnegative_safe_integer(p_request->'afterSequence') OR NOT private.jsonb_is_positive_safe_integer(p_request->'limit') THEN
    RETURN jsonb_build_object('kind','error','code','MALFORMED_REQUEST','message','Invalid pull cursor or limit.');
  END IF;
  v_after := (p_request->>'afterSequence')::bigint; v_limit := (p_request->>'limit')::integer;
  IF v_limit<1 OR v_limit>500 THEN RETURN jsonb_build_object('kind','error','code','MALFORMED_REQUEST','message','Invalid pull cursor or limit.'); END IF;
  SELECT h.head_seq,a.change_retention_floor_seq INTO v_head,v_floor
  FROM private.account_sync_heads h JOIN public.accounts a USING(user_id)
  WHERE h.user_id=v_uid AND a.status='active';
  IF NOT FOUND THEN RETURN jsonb_build_object('kind','error','code','UNAUTHENTICATED','message','Active Tuck account is required.'); END IF;
  IF v_after < v_floor-1 THEN
    RETURN jsonb_build_object('kind','rebootstrap_required','protocolVersion',1,'accountId',v_uid::text,
      'minimumRetainedSequence',v_floor,'serverHeadSequence',v_head);
  END IF;
  IF p_request ? 'targetHeadSequence' AND p_request->'targetHeadSequence' <> 'null'::jsonb THEN
    IF NOT private.jsonb_is_nonnegative_safe_integer(p_request->'targetHeadSequence') THEN
      RETURN jsonb_build_object('kind','error','code','MALFORMED_REQUEST','message','Invalid targetHeadSequence.');
    END IF;
    v_target := (p_request->>'targetHeadSequence')::bigint;
  ELSE v_target := v_head; END IF;
  IF v_target<v_after OR v_target>v_head THEN RETURN jsonb_build_object('kind','error','code','MALFORMED_REQUEST','message','Invalid targetHeadSequence.'); END IF;

  WITH candidate AS (
    SELECT c.*, row_number() OVER (ORDER BY c.seq) rn
    FROM private.sync_changes c
    WHERE c.user_id=v_uid AND c.seq>v_after AND c.seq<=v_target
    ORDER BY c.seq
    LIMIT v_limit+1
  ), page AS (SELECT * FROM candidate WHERE rn<=v_limit)
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'sequence',seq,'entityType',entity_type,'entityId',entity_id,'entityVersion',entity_version,
      'kind',kind,'payload',payload,'mutationId',to_jsonb(mutation_id::text),
      'originDeviceId',origin_device_id,'serverEpochMs',floor(extract(epoch FROM server_at)*1000)::bigint
    ) ORDER BY seq),'[]'::jsonb),
    (SELECT count(*) FROM candidate),
    COALESCE(max(seq),v_after)
  INTO v_changes,v_count,v_next FROM page;
  v_has_more := v_count>v_limit;
  IF NOT v_has_more THEN v_next:=v_target; END IF;
  RETURN jsonb_build_object('kind','page','protocolVersion',1,'accountId',v_uid::text,'changes',v_changes,
    'nextAfterSequence',v_next,'targetHeadSequence',v_target,'minimumRetainedSequence',v_floor,'hasMore',v_has_more);
END
$$;

CREATE OR REPLACE FUNCTION public.tuck_bootstrap(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_page_size integer;
  v_after bigint := 0;
  v_session uuid;
  v_snapshot_head bigint;
  v_expires timestamptz;
  v_entries jsonb;
  v_next bigint;
  v_has_more boolean;
  v_count bigint;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('kind','error','code','UNAUTHENTICATED','message','Authenticated account is required.'); END IF;
  IF jsonb_typeof(p_request)<>'object' OR NOT (p_request ? 'protocolVersion' AND p_request ? 'accountId' AND p_request ? 'pageSize')
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_request) k WHERE k NOT IN ('protocolVersion','accountId','pageSize','sessionId','afterOrdinal')) THEN
    RETURN jsonb_build_object('kind','error','code','MALFORMED_REQUEST','message','Bootstrap request shape is invalid.');
  END IF;
  IF p_request->'protocolVersion'<>'1'::jsonb THEN RETURN jsonb_build_object('kind','error','code','UNSUPPORTED_PROTOCOL_VERSION','message','Unsupported sync protocol version.'); END IF;
  IF p_request->>'accountId'<>v_uid::text THEN RETURN jsonb_build_object('kind','error','code','WRONG_ACCOUNT','message','Request account does not match the authenticated account.'); END IF;
  IF NOT private.jsonb_is_positive_safe_integer(p_request->'pageSize') THEN RETURN jsonb_build_object('kind','error','code','MALFORMED_REQUEST','message','pageSize must be between 1 and 500.'); END IF;
  v_page_size:=(p_request->>'pageSize')::integer;
  IF v_page_size<1 OR v_page_size>500 THEN RETURN jsonb_build_object('kind','error','code','MALFORMED_REQUEST','message','pageSize must be between 1 and 500.'); END IF;
  IF p_request ? 'afterOrdinal' THEN
    IF NOT private.jsonb_is_nonnegative_safe_integer(p_request->'afterOrdinal') THEN RETURN jsonb_build_object('kind','error','code','MALFORMED_REQUEST','message','afterOrdinal must be a non-negative integer.'); END IF;
    v_after := (p_request->>'afterOrdinal')::bigint;
  END IF;

  IF p_request ? 'sessionId' AND p_request->'sessionId'<>'null'::jsonb THEN
    BEGIN v_session := (p_request->>'sessionId')::uuid; EXCEPTION WHEN others THEN v_session:=NULL; END;
    SELECT snapshot_head_seq,expires_at INTO v_snapshot_head,v_expires
    FROM private.bootstrap_sessions WHERE id=v_session AND user_id=v_uid;
    IF NOT FOUND OR v_expires<=now() THEN
      IF v_session IS NOT NULL THEN DELETE FROM private.bootstrap_sessions WHERE id=v_session AND user_id=v_uid; END IF;
      RETURN jsonb_build_object('kind','bootstrap_expired','protocolVersion',1,'accountId',v_uid::text,
        'message','Bootstrap snapshot expired; restart bootstrap from the first page.');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE user_id=v_uid AND status='active') THEN
      RETURN jsonb_build_object('kind','error','code','UNAUTHENTICATED','message','Active Tuck account is required.');
    END IF;
    v_session := gen_random_uuid();
    -- IMPORTANT: every data-bearing read below (head + Collections + Items +
    -- Assets/tags) is part of ONE SQL statement, hence ONE PostgreSQL MVCC
    -- statement snapshot even when PostgREST's outer transaction is READ COMMITTED.
    -- This preserves the frozen paired-visibility race: an uncommitted writer is
    -- invisible together with its head; a writer committed before this statement
    -- is visible together with its entity effects.
    WITH snapshot_head AS MATERIALIZED (
      SELECT h.head_seq
      FROM private.account_sync_heads h JOIN public.accounts a USING(user_id)
      WHERE h.user_id=v_uid AND a.status='active'
    ), snapshots AS MATERIALIZED (
      SELECT 1 AS kind_order,c.id AS entity_id,private.collection_snapshot(v_uid,c.id) AS payload
      FROM public.collections c WHERE c.user_id=v_uid
      UNION ALL
      SELECT 2,i.id,private.item_snapshot(v_uid,i.id) FROM public.items i WHERE i.user_id=v_uid
      UNION ALL
      SELECT 3,a.id,private.asset_snapshot(v_uid,a.id) FROM public.assets a WHERE a.user_id=v_uid AND a.state='ready'
    ), numbered AS MATERIALIZED (
      SELECT row_number() OVER (ORDER BY kind_order,entity_id)::bigint ordinal,
             entity_id,payload,payload->>'entityType' entity_type
      FROM snapshots
    ), ins_session AS (
      INSERT INTO private.bootstrap_sessions(id,user_id,snapshot_head_seq,expires_at)
      SELECT v_session,v_uid,head_seq,now()+interval '1 hour' FROM snapshot_head
      RETURNING id,snapshot_head_seq,expires_at
    ), ins_entries AS (
      INSERT INTO private.bootstrap_entries(session_id,ordinal,entity_type,entity_id,payload)
      SELECT s.id,n.ordinal,n.entity_type,n.entity_id,n.payload FROM ins_session s CROSS JOIN numbered n
      RETURNING ordinal
    )
    SELECT s.snapshot_head_seq,s.expires_at INTO v_snapshot_head,v_expires FROM ins_session s;
    IF NOT FOUND THEN RETURN jsonb_build_object('kind','error','code','UNAUTHENTICATED','message','Active Tuck account is required.'); END IF;
  END IF;

  WITH candidate AS (
    SELECT e.*,row_number() OVER (ORDER BY e.ordinal) rn
    FROM private.bootstrap_entries e
    WHERE e.session_id=v_session AND e.ordinal>v_after
    ORDER BY e.ordinal LIMIT v_page_size+1
  ), page AS (SELECT * FROM candidate WHERE rn<=v_page_size)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('ordinal',ordinal,'snapshot',payload) ORDER BY ordinal),'[]'::jsonb),
         (SELECT count(*) FROM candidate),COALESCE(max(ordinal),v_after)
  INTO v_entries,v_count,v_next FROM page;
  v_has_more:=v_count>v_page_size;
  IF NOT v_has_more THEN v_next:=NULL; END IF;
  RETURN jsonb_build_object('kind','page','protocolVersion',1,'accountId',v_uid::text,'sessionId',v_session::text,
    'snapshotHeadSequence',v_snapshot_head,'entries',v_entries,'nextAfterOrdinal',to_jsonb(v_next),
    'expiresAtEpochMs',floor(extract(epoch FROM v_expires)*1000)::bigint);
END
$$;

-- ---------------------------------------------------------------------------
-- Account lifecycle + asset lifecycle RPCs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.initialize_tuck_account()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
BEGIN
  INSERT INTO public.accounts(user_id) VALUES(NEW.id) ON CONFLICT(user_id) DO NOTHING;
  INSERT INTO private.account_sync_heads(user_id,head_seq) VALUES(NEW.id,0) ON CONFLICT(user_id) DO NOTHING;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_initialize_tuck ON auth.users;
CREATE TRIGGER on_auth_user_created_initialize_tuck
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION private.initialize_tuck_account();

-- Backfill accounts for already-existing auth users when this migration is first applied.
INSERT INTO public.accounts(user_id)
SELECT id FROM auth.users ON CONFLICT(user_id) DO NOTHING;
INSERT INTO private.account_sync_heads(user_id,head_seq)
SELECT user_id,0 FROM public.accounts ON CONFLICT(user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.tuck_request_account_deletion()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_uid uuid:=auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('kind','error','code','UNAUTHENTICATED'); END IF;
  UPDATE public.accounts SET status='deleting' WHERE user_id=v_uid;
  RETURN jsonb_build_object('kind','ok','accountId',v_uid::text,'status','deleting');
END
$$;

CREATE OR REPLACE FUNCTION public.tuck_create_asset_staging(
  p_asset_id text, p_mime_type text, p_byte_size bigint
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_uid uuid:=auth.uid(); v_ext text; v_path text; v_existing public.assets%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('kind','error','code','UNAUTHENTICATED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE user_id=v_uid AND status='active') THEN
    RETURN jsonb_build_object('kind','error','code','UNAUTHENTICATED');
  END IF;
  IF NOT private.identifier_valid(p_asset_id) OR p_mime_type NOT IN ('image/jpeg','image/png','image/webp')
     OR p_byte_size<0 OR p_byte_size>10485760 THEN
    RETURN jsonb_build_object('kind','error','code','INVALID_ASSET');
  END IF;
  v_ext:=CASE p_mime_type WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' ELSE 'webp' END;
  v_path:=v_uid::text||'/'||p_asset_id||'/original.'||v_ext;
  SELECT * INTO v_existing FROM public.assets WHERE user_id=v_uid AND id=p_asset_id;
  IF FOUND THEN
    RETURN jsonb_build_object('kind','existing','assetId',v_existing.id,'storagePath',v_existing.storage_path,
      'state',v_existing.state,'version',v_existing.version);
  END IF;
  INSERT INTO public.assets(user_id,id,storage_path,mime_type,byte_size,state,version)
  VALUES(v_uid,p_asset_id,v_path,p_mime_type,p_byte_size,'staging',1);
  RETURN jsonb_build_object('kind','staging','assetId',p_asset_id,'storagePath',v_path,'version',1);
END
$$;

CREATE OR REPLACE FUNCTION public.tuck_finalize_asset(p_asset_id text, p_origin_device_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private, storage
AS $$
DECLARE
  v_uid uuid:=auth.uid(); v_asset public.assets%ROWTYPE; v_seq bigint; v_snapshot jsonb; v_obj storage.objects%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('kind','error','code','UNAUTHENTICATED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE user_id=v_uid AND status='active') THEN
    RETURN jsonb_build_object('kind','error','code','UNAUTHENTICATED');
  END IF;
  IF NOT private.identifier_valid(p_asset_id) OR NOT private.identifier_valid(p_origin_device_id) THEN
    RETURN jsonb_build_object('kind','error','code','INVALID_ASSET');
  END IF;
  PERFORM head_seq FROM private.account_sync_heads WHERE user_id=v_uid FOR UPDATE;
  SELECT * INTO v_asset FROM public.assets WHERE user_id=v_uid AND id=p_asset_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('kind','error','code','NOT_FOUND'); END IF;
  IF v_asset.state='ready' THEN RETURN jsonb_build_object('kind','ready','asset',private.asset_snapshot(v_uid,p_asset_id),'changeSequence',NULL); END IF;
  SELECT * INTO v_obj FROM storage.objects WHERE bucket_id='tuck-assets' AND name=v_asset.storage_path;
  IF NOT FOUND THEN RETURN jsonb_build_object('kind','error','code','OBJECT_NOT_UPLOADED'); END IF;
  IF COALESCE((v_obj.metadata->>'size')::bigint,-1)<>v_asset.byte_size THEN
    RETURN jsonb_build_object('kind','error','code','ASSET_SIZE_MISMATCH');
  END IF;
  IF COALESCE(v_obj.metadata->>'mimetype','')<>v_asset.mime_type THEN
    RETURN jsonb_build_object('kind','error','code','ASSET_MIME_MISMATCH');
  END IF;
  UPDATE public.assets SET state='ready',ready_at=now(),version=version+1 WHERE user_id=v_uid AND id=p_asset_id;
  v_snapshot:=private.asset_snapshot(v_uid,p_asset_id);
  v_seq:=private.append_upsert_change(v_uid,v_snapshot,NULL,p_origin_device_id);
  RETURN jsonb_build_object('kind','ready','asset',v_snapshot,'changeSequence',v_seq);
END
$$;

-- Admin-only/manual retention helper; no destructive cron is installed in 6B.
CREATE OR REPLACE FUNCTION private.prune_expired_sync_changes(p_user_id uuid, p_now timestamptz DEFAULT now())
RETURNS bigint
LANGUAGE plpgsql
SET search_path = pg_catalog, public, private
AS $$
DECLARE v_head bigint; v_floor bigint;
BEGIN
  PERFORM head_seq FROM private.account_sync_heads WHERE user_id=p_user_id FOR UPDATE;
  DELETE FROM private.sync_changes WHERE user_id=p_user_id AND retain_until<=p_now;
  SELECT head_seq INTO v_head FROM private.account_sync_heads WHERE user_id=p_user_id;
  SELECT COALESCE(min(seq),v_head+1) INTO v_floor FROM private.sync_changes WHERE user_id=p_user_id;
  UPDATE public.accounts SET change_retention_floor_seq=v_floor WHERE user_id=p_user_id;
  RETURN v_floor;
END
$$;

-- ---------------------------------------------------------------------------
-- Private Storage bucket and ownership policies.
-- Object names are server-derived: <auth.uid()>/<assetId>/original.<ext>.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('tuck-assets','tuck-assets',false,10485760,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=EXCLUDED.file_size_limit,allowed_mime_types=EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS tuck_assets_select_own ON storage.objects;
CREATE POLICY tuck_assets_select_own ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='tuck-assets' AND (storage.foldername(name))[1]=auth.uid()::text);
DROP POLICY IF EXISTS tuck_assets_insert_own ON storage.objects;
CREATE POLICY tuck_assets_insert_own ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='tuck-assets' AND (storage.foldername(name))[1]=auth.uid()::text);
-- Protocol-v1 ready Assets are immutable. Client roles may create an object once
-- under their own prefix and read it, but cannot overwrite or delete it. Staging
-- orphan cleanup / eventual GC remains a privileged server operation in a later gate.
DROP POLICY IF EXISTS tuck_assets_update_own ON storage.objects;
DROP POLICY IF EXISTS tuck_assets_delete_own ON storage.objects;

-- ---------------------------------------------------------------------------
-- Function owner / privileges.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public, private, auth, storage, extensions TO tuck_rpc_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounts, public.assets, public.collections, public.items, public.item_tags TO tuck_rpc_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON private.account_sync_heads, private.entity_tombstones, private.sync_changes,
  private.processed_mutations, private.bootstrap_sessions, private.bootstrap_entries TO tuck_rpc_owner;
GRANT SELECT ON auth.users, storage.objects TO tuck_rpc_owner;
GRANT CREATE ON SCHEMA public, private TO tuck_rpc_owner;

ALTER FUNCTION public.tuck_push_mutations(jsonb) OWNER TO tuck_rpc_owner;
ALTER FUNCTION public.tuck_pull_changes(jsonb) OWNER TO tuck_rpc_owner;
ALTER FUNCTION public.tuck_bootstrap(jsonb) OWNER TO tuck_rpc_owner;
ALTER FUNCTION public.tuck_request_account_deletion() OWNER TO tuck_rpc_owner;
ALTER FUNCTION public.tuck_create_asset_staging(text,text,bigint) OWNER TO tuck_rpc_owner;
ALTER FUNCTION public.tuck_finalize_asset(text,text) OWNER TO tuck_rpc_owner;
ALTER FUNCTION private.initialize_tuck_account() OWNER TO tuck_rpc_owner;
REVOKE CREATE ON SCHEMA public, private FROM tuck_rpc_owner;

REVOKE EXECUTE ON FUNCTION public.tuck_push_mutations(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tuck_pull_changes(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tuck_bootstrap(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tuck_request_account_deletion() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tuck_create_asset_staging(text,text,bigint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tuck_finalize_asset(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tuck_push_mutations(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tuck_pull_changes(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tuck_bootstrap(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tuck_request_account_deletion() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tuck_create_asset_staging(text,text,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tuck_finalize_asset(text,text) TO authenticated;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO tuck_rpc_owner;

COMMENT ON FUNCTION public.tuck_bootstrap(jsonb) IS
'Protocol-v1 bootstrap. Initial materialization reads account head and canonical entities in one SQL statement/MVCC snapshot, then serves immutable one-hour pages.';
COMMENT ON FUNCTION public.tuck_push_mutations(jsonb) IS
'Protocol-v1 push. Valid first-seen mutations serialize per account through private.account_sync_heads and store lifetime idempotency results.';
COMMENT ON FUNCTION public.tuck_pull_changes(jsonb) IS
'Protocol-v1 bounded pull over retained immutable per-account sync_changes.';
