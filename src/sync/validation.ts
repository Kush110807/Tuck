import {
  SYNC_PROTOCOL_VERSION,
  type CollectionSyncField,
  type ItemSyncField,
  type PushMutationsRequest,
  type SyncMutation,
} from './protocol';

export type ProtocolValidationCode =
  | 'MALFORMED_MUTATION'
  | 'UNSUPPORTED_PROTOCOL_VERSION'
  | 'WRONG_ACCOUNT';

export type ProtocolValidationResult =
  | Readonly<{ ok: true; value: SyncMutation }>
  | Readonly<{ ok: false; code: ProtocolValidationCode; message: string; mutationId: string }>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/u;
const ITEM_FIELDS = new Set<ItemSyncField>([
  'title', 'body', 'url', 'assetId', 'tags', 'collectionId', 'pinned', 'archived', 'updatedAt',
]);
const COLLECTION_FIELDS = new Set<CollectionSyncField>(['name', 'updatedAt']);
const ITEM_CREATE_FIELDS = ['title', 'body', 'url', 'assetId', 'tags', 'collectionId', 'pinned', 'archived', 'updatedAt'] as const;
const COLLECTION_CREATE_FIELDS = ['name', 'updatedAt'] as const;
const ITEM_CREATE_KEYS = new Set([
  'type', 'title', 'body', 'url', 'assetId', 'tags', 'collectionId', 'pinned', 'archived', 'createdAt', 'updatedAt',
]);
const COLLECTION_CREATE_KEYS = new Set(['name', 'createdAt', 'updatedAt']);
const PUSH_KEYS = new Set(['protocolVersion', 'accountId', 'mutations']);
const TOP_LEVEL_KEYS = new Set([
  'protocolVersion', 'accountId', 'mutationId', 'originDeviceId', 'entityType', 'entityId', 'action',
  'baseServerVersion', 'changedFields', 'baseValues', 'newValues',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every(key => allowed.has(key));
}

function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.length <= 128 && !CONTROL_RE.test(value);
}

export function isCanonicalMutationUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}


function safeEpoch(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validItemFieldValue(field: string, value: unknown): boolean {
  switch (field) {
    case 'title': return typeof value === 'string';
    case 'body': return value === null || typeof value === 'string';
    case 'url': return value === null || typeof value === 'string';
    case 'assetId': return value === null || isBoundedIdentifier(value);
    case 'tags': return Array.isArray(value) && value.every(tag => typeof tag === 'string');
    case 'collectionId': return value === null || isBoundedIdentifier(value);
    case 'pinned':
    case 'archived': return typeof value === 'boolean';
    case 'updatedAt': return safeEpoch(value);
    default: return false;
  }
}

function validCollectionFieldValue(field: string, value: unknown): boolean {
  if (field === 'name') return typeof value === 'string';
  if (field === 'updatedAt') return safeEpoch(value);
  return false;
}

function sameFieldSet(actual: readonly unknown[], expected: readonly string[]): boolean {
  if (actual.length !== expected.length || new Set(actual).size !== actual.length) return false;
  const expectedSet = new Set(expected);
  return actual.every(value => typeof value === 'string' && expectedSet.has(value));
}

function validPatchShape(
  mutation: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
  fieldValueValid: (field: string, value: unknown) => boolean,
): boolean {
  if (!Number.isSafeInteger(mutation.baseServerVersion) || (mutation.baseServerVersion as number) < 1) return false;
  if (!Array.isArray(mutation.changedFields) || mutation.changedFields.length === 0) return false;
  if (new Set(mutation.changedFields).size !== mutation.changedFields.length) return false;
  if (!mutation.changedFields.every(field => typeof field === 'string' && allowedFields.has(field))) return false;
  if (!mutation.changedFields.some(field => field !== 'updatedAt')) return false;
  if (!isRecord(mutation.baseValues) || !isRecord(mutation.newValues)) return false;

  const changed = new Set(mutation.changedFields as string[]);
  if (!Object.keys(mutation.newValues).every(key => changed.has(key))) return false;
  if (!Object.keys(mutation.baseValues).every(key => changed.has(key) && key !== 'updatedAt')) return false;

  for (const field of mutation.changedFields as string[]) {
    if (!(field in mutation.newValues) || !fieldValueValid(field, mutation.newValues[field])) return false;
    if (field !== 'updatedAt' && (!(field in mutation.baseValues) || !fieldValueValid(field, mutation.baseValues[field]))) return false;
  }
  return true;
}

function validCreateShape(
  mutation: Record<string, unknown>,
  createFields: readonly string[],
  createKeys: ReadonlySet<string>,
): boolean {
  return mutation.baseServerVersion === null &&
    Array.isArray(mutation.changedFields) &&
    sameFieldSet(mutation.changedFields, createFields) &&
    isRecord(mutation.baseValues) && Object.keys(mutation.baseValues).length === 0 &&
    isRecord(mutation.newValues) &&
    hasOnlyKeys(mutation.newValues, createKeys) && Object.keys(mutation.newValues).length === createKeys.size;
}

function validDeleteShape(mutation: Record<string, unknown>): boolean {
  return Number.isSafeInteger(mutation.baseServerVersion) && (mutation.baseServerVersion as number) >= 1 &&
    Array.isArray(mutation.changedFields) && mutation.changedFields.length === 0 &&
    isRecord(mutation.baseValues) && Object.keys(mutation.baseValues).length === 0 &&
    isRecord(mutation.newValues) && Object.keys(mutation.newValues).length === 0;
}

export type PushRequestValidationResult =
  | Readonly<{ ok: true; value: PushMutationsRequest }>
  | Readonly<{ ok: false; code: 'UNSUPPORTED_PROTOCOL_VERSION' | 'UNAUTHENTICATED' | 'WRONG_ACCOUNT' | 'MALFORMED_REQUEST'; message: string }>;

/** Validates the frozen outer push request before per-mutation validation. */
export function validatePushRequestV1(value: unknown, callerAccountId: string): PushRequestValidationResult {
  if (!isRecord(value) || !hasOnlyKeys(value, PUSH_KEYS) || Object.keys(value).length !== PUSH_KEYS.size ||
      ![...PUSH_KEYS].every(key => key in value)) {
    return { ok: false, code: 'MALFORMED_REQUEST', message: 'Push request shape is invalid.' };
  }
  if (value.protocolVersion !== SYNC_PROTOCOL_VERSION) {
    return { ok: false, code: 'UNSUPPORTED_PROTOCOL_VERSION', message: 'Unsupported sync protocol version.' };
  }
  if (!isBoundedIdentifier(callerAccountId)) {
    return { ok: false, code: 'UNAUTHENTICATED', message: 'Authenticated account is required.' };
  }
  if (!isBoundedIdentifier(value.accountId)) {
    return { ok: false, code: 'MALFORMED_REQUEST', message: 'Account identifier is malformed.' };
  }
  if (value.accountId !== callerAccountId) {
    return { ok: false, code: 'WRONG_ACCOUNT', message: 'Request account does not match the authenticated account.' };
  }
  if (!Array.isArray(value.mutations)) {
    return { ok: false, code: 'MALFORMED_REQUEST', message: 'mutations must be an array.' };
  }
  return { ok: true, value: value as unknown as PushMutationsRequest };
}

/** Shared protocol-v1 mutation validator used by the executable fake server. */
export function validateSyncMutationV1(value: unknown, requestAccountId: string): ProtocolValidationResult {
  const mutationId = isRecord(value) && typeof value.mutationId === 'string' ? value.mutationId : 'malformed';
  if (!isRecord(value) || !hasOnlyKeys(value, TOP_LEVEL_KEYS) || Object.keys(value).length !== TOP_LEVEL_KEYS.size ||
      ![...TOP_LEVEL_KEYS].every(key => key in value)) {
    return { ok: false, code: 'MALFORMED_MUTATION', message: 'Mutation object shape is invalid.', mutationId };
  }
  if (value.protocolVersion !== SYNC_PROTOCOL_VERSION) {
    return { ok: false, code: 'UNSUPPORTED_PROTOCOL_VERSION', message: 'Unsupported mutation protocol version.', mutationId };
  }
  if (!isCanonicalMutationUuid(value.mutationId)) {
    return { ok: false, code: 'MALFORMED_MUTATION', message: 'mutationId must be a canonical UUID.', mutationId };
  }
  if (!isBoundedIdentifier(value.accountId) || !isBoundedIdentifier(value.originDeviceId) || !isBoundedIdentifier(value.entityId)) {
    return { ok: false, code: 'MALFORMED_MUTATION', message: 'Identifiers must be 1..128 code units with no control characters.', mutationId: value.mutationId };
  }
  if (value.accountId !== requestAccountId) {
    return { ok: false, code: 'WRONG_ACCOUNT', message: 'Mutation account does not match request account.', mutationId: value.mutationId };
  }
  if (value.entityType !== 'item' && value.entityType !== 'collection') {
    return { ok: false, code: 'MALFORMED_MUTATION', message: 'Invalid entity type.', mutationId: value.mutationId };
  }
  if (value.action !== 'create' && value.action !== 'patch' && value.action !== 'delete') {
    return { ok: false, code: 'MALFORMED_MUTATION', message: 'Invalid mutation action.', mutationId: value.mutationId };
  }

  let valid = false;
  if (value.action === 'delete') valid = validDeleteShape(value);
  else if (value.action === 'patch') {
    valid = value.entityType === 'item'
      ? validPatchShape(value, ITEM_FIELDS, validItemFieldValue)
      : validPatchShape(value, COLLECTION_FIELDS, validCollectionFieldValue);
  } else if (value.entityType === 'item') {
    valid = validCreateShape(value, ITEM_CREATE_FIELDS, ITEM_CREATE_KEYS);
    if (valid && isRecord(value.newValues)) {
      const newValues = value.newValues;
      valid = (newValues.type === 'note' || newValues.type === 'link' || newValues.type === 'image') &&
        safeEpoch(newValues.createdAt) && ITEM_CREATE_FIELDS.every(field => validItemFieldValue(field, newValues[field]));
    }
  } else {
    valid = validCreateShape(value, COLLECTION_CREATE_FIELDS, COLLECTION_CREATE_KEYS);
    if (valid && isRecord(value.newValues)) {
      const newValues = value.newValues;
      valid = safeEpoch(newValues.createdAt) && COLLECTION_CREATE_FIELDS.every(field => validCollectionFieldValue(field, newValues[field]));
    }
  }

  if (!valid) {
    return { ok: false, code: 'MALFORMED_MUTATION', message: 'Mutation action/entity payload shape is invalid.', mutationId: value.mutationId };
  }
  return { ok: true, value: value as unknown as SyncMutation };
}
