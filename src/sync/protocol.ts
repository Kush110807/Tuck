/**
 * Phase 6A frozen sync protocol types.
 *
 * These contracts are intentionally transport-agnostic. Nothing in this file
 * opens a network connection or imports a Supabase client.
 */

export const SYNC_PROTOCOL_VERSION = 1 as const;
export const DESIGNED_LOCAL_SCHEMA_VERSION = 3 as const;

export type SyncProtocolVersion = typeof SYNC_PROTOCOL_VERSION;
export type AccountId = string;
export type DeviceId = string;
export type MutationId = string;
export type AssetId = string;
export type ServerVersion = number;
export type ChangeSequence = number;

export type SyncEntityType = 'item' | 'collection';
export type ChangeEntityType = SyncEntityType | 'asset';
export type MutationAction = 'create' | 'patch' | 'delete';

export type ItemKind = 'note' | 'link' | 'image';
export type ItemSyncField =
  | 'title'
  | 'body'
  | 'url'
  | 'assetId'
  | 'tags'
  | 'collectionId'
  | 'pinned'
  | 'archived'
  | 'updatedAt';
export type CollectionSyncField = 'name' | 'updatedAt';

export type CanonicalItem = Readonly<{
  id: string;
  type: ItemKind;
  title: string;
  body: string | null;
  url: string | null;
  assetId: AssetId | null;
  tags: readonly string[];
  collectionId: string | null;
  pinned: boolean;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  version: ServerVersion;
}>;

export type CanonicalCollection = Readonly<{
  id: string;
  name: string;
  nameKey: string;
  createdAt: number;
  updatedAt: number;
  version: ServerVersion;
}>;

export type CanonicalAsset = Readonly<{
  id: AssetId;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  byteSize: number;
  remoteState: 'staging' | 'ready';
  version: ServerVersion;
}>;

export type CanonicalEntitySnapshot =
  | Readonly<{ entityType: 'item'; entity: CanonicalItem }>
  | Readonly<{ entityType: 'collection'; entity: CanonicalCollection }>
  | Readonly<{ entityType: 'asset'; entity: CanonicalAsset }>;

export type EntityTombstone = Readonly<{
  entityType: SyncEntityType;
  entityId: string;
  deletedVersion: ServerVersion;
  deletedSequence: ChangeSequence;
  originDeviceId: DeviceId;
}>;

export type ItemMutableValues = Readonly<{
  title: string;
  body: string | null;
  url: string | null;
  assetId: AssetId | null;
  tags: readonly string[];
  collectionId: string | null;
  pinned: boolean;
  archived: boolean;
  updatedAt: number;
}>;

export type CollectionMutableValues = Readonly<{
  name: string;
  updatedAt: number;
}>;

export type ItemCreateValues = Readonly<{
  type: ItemKind;
  title: string;
  body: string | null;
  url: string | null;
  assetId: AssetId | null;
  tags: readonly string[];
  collectionId: string | null;
  pinned: boolean;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}>;

export type CollectionCreateValues = Readonly<{
  name: string;
  createdAt: number;
  updatedAt: number;
}>;

export type ItemCreateMutation = Readonly<{
  protocolVersion: SyncProtocolVersion;
  accountId: AccountId;
  mutationId: MutationId;
  originDeviceId: DeviceId;
  entityType: 'item';
  entityId: string;
  action: 'create';
  baseServerVersion: null;
  changedFields: readonly ItemSyncField[];
  baseValues: Readonly<Record<string, never>>;
  newValues: ItemCreateValues;
}>;

export type ItemPatchMutation = Readonly<{
  protocolVersion: SyncProtocolVersion;
  accountId: AccountId;
  mutationId: MutationId;
  originDeviceId: DeviceId;
  entityType: 'item';
  entityId: string;
  action: 'patch';
  baseServerVersion: ServerVersion;
  changedFields: readonly ItemSyncField[];
  /** Base values are required for every changed field except updatedAt. */
  baseValues: Partial<ItemMutableValues>;
  newValues: Partial<ItemMutableValues>;
}>;

export type ItemDeleteMutation = Readonly<{
  protocolVersion: SyncProtocolVersion;
  accountId: AccountId;
  mutationId: MutationId;
  originDeviceId: DeviceId;
  entityType: 'item';
  entityId: string;
  action: 'delete';
  baseServerVersion: ServerVersion;
  changedFields: readonly [];
  baseValues: Readonly<Record<string, never>>;
  newValues: Readonly<Record<string, never>>;
}>;

export type CollectionCreateMutation = Readonly<{
  protocolVersion: SyncProtocolVersion;
  accountId: AccountId;
  mutationId: MutationId;
  originDeviceId: DeviceId;
  entityType: 'collection';
  entityId: string;
  action: 'create';
  baseServerVersion: null;
  changedFields: readonly CollectionSyncField[];
  baseValues: Readonly<Record<string, never>>;
  newValues: CollectionCreateValues;
}>;

export type CollectionPatchMutation = Readonly<{
  protocolVersion: SyncProtocolVersion;
  accountId: AccountId;
  mutationId: MutationId;
  originDeviceId: DeviceId;
  entityType: 'collection';
  entityId: string;
  action: 'patch';
  baseServerVersion: ServerVersion;
  changedFields: readonly CollectionSyncField[];
  baseValues: Partial<CollectionMutableValues>;
  newValues: Partial<CollectionMutableValues>;
}>;

export type CollectionDeleteMutation = Readonly<{
  protocolVersion: SyncProtocolVersion;
  accountId: AccountId;
  mutationId: MutationId;
  originDeviceId: DeviceId;
  entityType: 'collection';
  entityId: string;
  action: 'delete';
  baseServerVersion: ServerVersion;
  changedFields: readonly [];
  baseValues: Readonly<Record<string, never>>;
  newValues: Readonly<Record<string, never>>;
}>;

export type SyncMutation =
  | ItemCreateMutation
  | ItemPatchMutation
  | ItemDeleteMutation
  | CollectionCreateMutation
  | CollectionPatchMutation
  | CollectionDeleteMutation;

export type MutationWarningCode = 'COLLECTION_DELETED_COERCED_TO_UNFILED';

export type MutationAccepted = Readonly<{
  kind: 'accepted';
  mutationId: MutationId;
  canonical: CanonicalEntitySnapshot | EntityTombstone;
  serverVersion: ServerVersion;
  changeSequence: ChangeSequence | null;
  changed: boolean;
  warnings: readonly MutationWarningCode[];
}>;

export type MutationConflictReason =
  | 'AUTHORED_FIELD_CONFLICT'
  | 'COLLECTION_RENAME_CONFLICT'
  | 'REMOTE_DELETED'
  | 'STALE_DELETE'
  | 'ENTITY_ID_COLLISION';

export type MutationConflict = Readonly<{
  kind: 'conflict';
  mutationId: MutationId;
  reason: MutationConflictReason;
  conflictFields: readonly string[];
  current: CanonicalEntitySnapshot | EntityTombstone;
  currentServerVersion: ServerVersion;
}>;

export type MutationRejectCode =
  | 'MALFORMED_MUTATION'
  | 'UNSUPPORTED_PROTOCOL_VERSION'
  | 'WRONG_ACCOUNT'
  | 'NOT_FOUND'
  | 'INVALID_ENTITY'
  | 'DUPLICATE_COLLECTION_NAME'
  | 'ENTITY_ID_REUSED_AFTER_DELETE'
  | 'MUTATION_ID_REUSE';

export type MutationRejected = Readonly<{
  kind: 'rejected';
  mutationId: MutationId;
  code: MutationRejectCode;
  message: string;
}>;

export type PushMutationResult = MutationAccepted | MutationConflict | MutationRejected;

export type PushMutationsRequest = Readonly<{
  protocolVersion: SyncProtocolVersion;
  accountId: AccountId;
  mutations: readonly SyncMutation[];
}>;

export type ProtocolRequestError = Readonly<{
  kind: 'error';
  code: 'UNSUPPORTED_PROTOCOL_VERSION' | 'UNAUTHENTICATED' | 'WRONG_ACCOUNT' | 'MALFORMED_REQUEST';
  message: string;
}>;

export type PushMutationsResponse =
  | Readonly<{
      kind: 'ok';
      protocolVersion: SyncProtocolVersion;
      accountId: AccountId;
      results: readonly PushMutationResult[];
      headSequence: ChangeSequence;
    }>
  | ProtocolRequestError;

export type SyncChange = Readonly<{
  sequence: ChangeSequence;
  entityType: ChangeEntityType;
  entityId: string;
  entityVersion: ServerVersion;
  kind: 'upsert' | 'delete';
  payload: CanonicalEntitySnapshot | EntityTombstone;
  mutationId: MutationId | null;
  originDeviceId: DeviceId;
  serverEpochMs: number;
}>;

export type BootstrapEntry = CanonicalEntitySnapshot;

export type BootstrapRequest = Readonly<{
  protocolVersion: SyncProtocolVersion;
  accountId: AccountId;
  pageSize: number;
  sessionId?: string;
  afterOrdinal?: number;
}>;

export type BootstrapResponse =
  | Readonly<{
      kind: 'page';
      protocolVersion: SyncProtocolVersion;
      accountId: AccountId;
      sessionId: string;
      snapshotHeadSequence: ChangeSequence;
      entries: readonly Readonly<{ ordinal: number; snapshot: BootstrapEntry }>[];
      nextAfterOrdinal: number | null;
      expiresAtEpochMs: number;
    }>
  | Readonly<{
      kind: 'bootstrap_expired';
      protocolVersion: SyncProtocolVersion;
      accountId: AccountId;
      message: string;
    }>
  | ProtocolRequestError;

export type PullChangesRequest = Readonly<{
  protocolVersion: SyncProtocolVersion;
  accountId: AccountId;
  afterSequence: ChangeSequence;
  limit: number;
  /** Null/omitted captures a finite target head for this pull cycle. */
  targetHeadSequence?: ChangeSequence | null;
}>;

export type PullChangesResponse =
  | Readonly<{
      kind: 'page';
      protocolVersion: SyncProtocolVersion;
      accountId: AccountId;
      changes: readonly SyncChange[];
      nextAfterSequence: ChangeSequence;
      targetHeadSequence: ChangeSequence;
      minimumRetainedSequence: ChangeSequence;
      hasMore: boolean;
    }>
  | Readonly<{
      kind: 'rebootstrap_required';
      protocolVersion: SyncProtocolVersion;
      accountId: AccountId;
      minimumRetainedSequence: ChangeSequence;
      serverHeadSequence: ChangeSequence;
    }>
  | ProtocolRequestError;

export type InitialSyncState =
  | 'not_started'
  | 'bootstrapping'
  | 'catching_up'
  | 'complete'
  | 'rebootstrap_required';

export function canonicalMutableItemValues(item: CanonicalItem): ItemMutableValues {
  return {
    title: item.title,
    body: item.body,
    url: item.url,
    assetId: item.assetId,
    tags: [...item.tags],
    collectionId: item.collectionId,
    pinned: item.pinned,
    archived: item.archived,
    updatedAt: item.updatedAt,
  };
}

export function canonicalMutableCollectionValues(collection: CanonicalCollection): CollectionMutableValues {
  return { name: collection.name, updatedAt: collection.updatedAt };
}
