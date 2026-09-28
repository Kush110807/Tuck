import { normalizeTags, validateCollectionName } from '../../domain';
import { collectionNameKey, mergeCollectionPatch, mergeItemPatch } from '../merge';
import {
  SYNC_PROTOCOL_VERSION,
  type AccountId,
  type BootstrapEntry,
  type BootstrapRequest,
  type BootstrapResponse,
  type CanonicalAsset,
  type CanonicalCollection,
  type CanonicalEntitySnapshot,
  type CanonicalItem,
  type ChangeSequence,
  type CollectionCreateMutation,
  type CollectionDeleteMutation,
  type CollectionPatchMutation,
  type EntityTombstone,
  type ItemCreateMutation,
  type ItemDeleteMutation,
  type ItemPatchMutation,
  type MutationAccepted,
  type MutationConflict,
  type MutationRejected,
  type MutationWarningCode,
  type PullChangesRequest,
  type PullChangesResponse,
  type PushMutationResult,
  type PushMutationsRequest,
  type PushMutationsResponse,
  type SyncChange,
  type SyncMutation,
} from '../protocol';
import { validatePushRequestV1, validateSyncMutationV1 } from '../validation';
import { AccountHeadReferenceModel } from './AccountHeadReferenceModel';

type ProcessedMutation = Readonly<{ requestHash: string; result: PushMutationResult }>;
type BootstrapSession = Readonly<{
  id: string;
  accountId: string;
  snapshotHeadSequence: number;
  expiresAtEpochMs: number;
  entries: readonly Readonly<{ ordinal: number; snapshot: BootstrapEntry }>[];
}>;

export type FakeSyncServerOptions = Readonly<{
  now?: () => number;
  bootstrapTtlMs?: number;
}>;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeEpoch(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validItemShape(item: Omit<CanonicalItem, 'version'>): boolean {
  if (!nonEmptyString(item.id) || !nonEmptyString(item.title)) return false;
  if (!safeEpoch(item.createdAt) || !safeEpoch(item.updatedAt)) return false;
  if (!Array.isArray(item.tags) || !item.tags.every(tag => typeof tag === 'string')) return false;
  if (typeof item.pinned !== 'boolean' || typeof item.archived !== 'boolean') return false;
  if (item.collectionId !== null && !nonEmptyString(item.collectionId)) return false;
  if (item.type === 'note') return typeof item.body === 'string' && item.url === null && item.assetId === null;
  if (item.type === 'link') return item.body === null && nonEmptyString(item.url) && item.assetId === null;
  if (item.type === 'image') {
    return (item.body === null || typeof item.body === 'string') && item.url === null && nonEmptyString(item.assetId);
  }
  return false;
}

function itemSnapshot(item: CanonicalItem): CanonicalEntitySnapshot {
  return { entityType: 'item', entity: clone(item) };
}

function collectionSnapshot(collection: CanonicalCollection): CanonicalEntitySnapshot {
  return { entityType: 'collection', entity: clone(collection) };
}

function assetSnapshot(asset: CanonicalAsset): CanonicalEntitySnapshot {
  return { entityType: 'asset', entity: clone(asset) };
}

export class FakeSyncServer {
  private readonly items = new Map<string, CanonicalItem>();
  private readonly collections = new Map<string, CanonicalCollection>();
  private readonly assets = new Map<string, CanonicalAsset>();
  private readonly tombstones = new Map<string, EntityTombstone>();
  private readonly processedMutations = new Map<string, ProcessedMutation>();
  private readonly changes: SyncChange[] = [];
  private readonly bootstrapSessions = new Map<string, BootstrapSession>();
  private readonly now: () => number;
  private readonly bootstrapTtlMs: number;
  private readonly accountHead = new AccountHeadReferenceModel(0);
  private changeOwnerCounter = 0;
  private minimumRetainedSequence = 1;
  private bootstrapCounter = 0;

  constructor(readonly accountId: AccountId, options: FakeSyncServerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.bootstrapTtlMs = options.bootstrapTtlMs ?? 60 * 60 * 1000;
  }

  getHeadSequence(): number {
    return this.accountHead.getCommittedHead();
  }

  getMinimumRetainedSequence(): number {
    return this.minimumRetainedSequence;
  }

  getItem(id: string): CanonicalItem | null {
    const item = this.items.get(id);
    return item ? clone(item) : null;
  }

  getCollection(id: string): CanonicalCollection | null {
    const collection = this.collections.get(id);
    return collection ? clone(collection) : null;
  }

  getTombstone(entityType: 'item' | 'collection', id: string): EntityTombstone | null {
    const tombstone = this.tombstones.get(`${entityType}:${id}`);
    return tombstone ? clone(tombstone) : null;
  }

  seedCollection(collection: CanonicalCollection): void {
    this.collections.set(collection.id, clone(collection));
  }

  seedItem(item: CanonicalItem): void {
    this.items.set(item.id, clone(item));
  }

  seedAsset(asset: CanonicalAsset): void {
    this.assets.set(asset.id, clone(asset));
  }

  /** Test-only retention control. Tombstones are deliberately untouched. */
  pruneChangesBefore(minimumRetainedSequence: number): void {
    if (!Number.isSafeInteger(minimumRetainedSequence) || minimumRetainedSequence < 1) {
      throw new Error('minimumRetainedSequence must be >= 1');
    }
    this.minimumRetainedSequence = minimumRetainedSequence;
    while (this.changes.length > 0 && this.changes[0].sequence < minimumRetainedSequence) {
      this.changes.shift();
    }
  }

  bootstrap(request: BootstrapRequest, callerAccountId: string = request.accountId): BootstrapResponse {
    const requestError = this.validateRequest(request.protocolVersion, request.accountId, callerAccountId);
    if (requestError) return requestError;
    if (!Number.isSafeInteger(request.pageSize) || request.pageSize < 1 || request.pageSize > 500) {
      return { kind: 'error', code: 'MALFORMED_REQUEST', message: 'pageSize must be between 1 and 500.' };
    }

    let session: BootstrapSession | undefined;
    if (request.sessionId) {
      session = this.bootstrapSessions.get(request.sessionId);
      if (!session || session.accountId !== this.accountId || session.expiresAtEpochMs <= this.now()) {
        if (session) this.bootstrapSessions.delete(session.id);
        return {
          kind: 'bootstrap_expired',
          protocolVersion: SYNC_PROTOCOL_VERSION,
          accountId: this.accountId,
          message: 'Bootstrap snapshot expired; restart bootstrap from the first page.',
        };
      }
    } else {
      session = this.createBootstrapSession();
    }

    const afterOrdinal = request.afterOrdinal ?? 0;
    if (!Number.isSafeInteger(afterOrdinal) || afterOrdinal < 0) {
      return { kind: 'error', code: 'MALFORMED_REQUEST', message: 'afterOrdinal must be a non-negative integer.' };
    }
    const candidates = session.entries.filter(entry => entry.ordinal > afterOrdinal);
    const entries = candidates.slice(0, request.pageSize);
    const last = entries.at(-1)?.ordinal ?? afterOrdinal;
    const hasMore = candidates.length > entries.length;

    return {
      kind: 'page',
      protocolVersion: SYNC_PROTOCOL_VERSION,
      accountId: this.accountId,
      sessionId: session.id,
      snapshotHeadSequence: session.snapshotHeadSequence,
      entries: clone(entries),
      nextAfterOrdinal: hasMore ? last : null,
      expiresAtEpochMs: session.expiresAtEpochMs,
    };
  }

  pull(request: PullChangesRequest, callerAccountId: string = request.accountId): PullChangesResponse {
    const requestError = this.validateRequest(request.protocolVersion, request.accountId, callerAccountId);
    if (requestError) return requestError;
    if (!Number.isSafeInteger(request.afterSequence) || request.afterSequence < 0 ||
        !Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 500) {
      return { kind: 'error', code: 'MALFORMED_REQUEST', message: 'Invalid pull cursor or limit.' };
    }
    if (request.afterSequence < this.minimumRetainedSequence - 1) {
      return {
        kind: 'rebootstrap_required',
        protocolVersion: SYNC_PROTOCOL_VERSION,
        accountId: this.accountId,
        minimumRetainedSequence: this.minimumRetainedSequence,
        serverHeadSequence: this.accountHead.getCommittedHead(),
      };
    }

    const currentHead = this.accountHead.getCommittedHead();
    const target = request.targetHeadSequence ?? currentHead;
    if (!Number.isSafeInteger(target) || target < request.afterSequence || target > currentHead) {
      return { kind: 'error', code: 'MALFORMED_REQUEST', message: 'Invalid targetHeadSequence.' };
    }

    const available = this.changes.filter(change => change.sequence > request.afterSequence && change.sequence <= target);
    const changes = available.slice(0, request.limit);
    const hasMore = available.length > changes.length;
    const nextAfterSequence = hasMore
      ? changes.at(-1)?.sequence ?? request.afterSequence
      : target;

    return {
      kind: 'page',
      protocolVersion: SYNC_PROTOCOL_VERSION,
      accountId: this.accountId,
      changes: clone(changes),
      nextAfterSequence,
      targetHeadSequence: target,
      minimumRetainedSequence: this.minimumRetainedSequence,
      hasMore,
    };
  }

  push(request: PushMutationsRequest, callerAccountId: string = request.accountId): PushMutationsResponse {
    const validation = validatePushRequestV1(request, callerAccountId);
    if ('code' in validation) return { kind: 'error', code: validation.code, message: validation.message };
    if (validation.value.accountId !== this.accountId) {
      return { kind: 'error', code: 'WRONG_ACCOUNT', message: 'Request account does not match server account.' };
    }

    const results: PushMutationResult[] = [];
    for (const mutation of validation.value.mutations) {
      results.push(this.processMutation(mutation, validation.value.accountId));
    }
    return {
      kind: 'ok',
      protocolVersion: SYNC_PROTOCOL_VERSION,
      accountId: this.accountId,
      results,
      headSequence: this.accountHead.getCommittedHead(),
    };
  }

  private validateRequest(protocolVersion: number, accountId: string, callerAccountId: string) {
    if (protocolVersion !== SYNC_PROTOCOL_VERSION) {
      return { kind: 'error', code: 'UNSUPPORTED_PROTOCOL_VERSION', message: 'Unsupported sync protocol version.' } as const;
    }
    if (!nonEmptyString(callerAccountId)) {
      return { kind: 'error', code: 'UNAUTHENTICATED', message: 'Authenticated account is required.' } as const;
    }
    if (accountId !== callerAccountId || accountId !== this.accountId) {
      return { kind: 'error', code: 'WRONG_ACCOUNT', message: 'Request account does not match the authenticated account.' } as const;
    }
    return null;
  }

  private createBootstrapSession(): BootstrapSession {
    const entries: Array<Readonly<{ ordinal: number; snapshot: BootstrapEntry }>> = [];
    const snapshots: BootstrapEntry[] = [
      ...[...this.collections.values()].sort((a, b) => a.id.localeCompare(b.id)).map(collectionSnapshot),
      ...[...this.items.values()].sort((a, b) => a.id.localeCompare(b.id)).map(itemSnapshot),
      ...[...this.assets.values()].sort((a, b) => a.id.localeCompare(b.id)).map(assetSnapshot),
    ];
    snapshots.forEach((snapshot, index) => entries.push({ ordinal: index + 1, snapshot: clone(snapshot) }));
    const session: BootstrapSession = {
      id: `bootstrap-${++this.bootstrapCounter}`,
      accountId: this.accountId,
      snapshotHeadSequence: this.accountHead.getCommittedHead(),
      expiresAtEpochMs: this.now() + this.bootstrapTtlMs,
      entries,
    };
    this.bootstrapSessions.set(session.id, session);
    return session;
  }

  private processMutation(mutation: SyncMutation, requestAccountId: string): PushMutationResult {
    const validation = validateSyncMutationV1(mutation, requestAccountId);
    if ('code' in validation) {
      return this.rejected(validation.mutationId, validation.code, validation.message);
    }
    mutation = validation.value;
    if (mutation.accountId !== this.accountId) {
      return this.rejected(mutation.mutationId, 'WRONG_ACCOUNT', 'Mutation account does not match server account.');
    }

    const requestHash = stableStringify(mutation);
    const processed = this.processedMutations.get(mutation.mutationId);
    if (processed) {
      if (processed.requestHash !== requestHash) {
        return this.rejected(mutation.mutationId, 'MUTATION_ID_REUSE', 'Mutation ID was already used for a different payload.');
      }
      return clone(processed.result);
    }

    let result: PushMutationResult;
    if (mutation.entityType === 'item') {
      if (mutation.action === 'create') result = this.createItem(mutation);
      else if (mutation.action === 'patch') result = this.patchItem(mutation);
      else result = this.deleteItem(mutation);
    } else {
      if (mutation.action === 'create') result = this.createCollection(mutation);
      else if (mutation.action === 'patch') result = this.patchCollection(mutation);
      else result = this.deleteCollection(mutation);
    }

    // Even deterministic conflicts/rejections are remembered for a valid
    // mutation ID. Retrying the same logical request returns the same result.
    this.processedMutations.set(mutation.mutationId, { requestHash, result: clone(result) });
    return result;
  }


  private createItem(mutation: ItemCreateMutation): PushMutationResult {
    const tombstone = this.tombstones.get(`item:${mutation.entityId}`);
    if (tombstone) {
      return this.rejected(mutation.mutationId, 'ENTITY_ID_REUSED_AFTER_DELETE', 'A deleted entity ID cannot be reused.');
    }
    const current = this.items.get(mutation.entityId);
    if (current) {
      return this.conflict(mutation.mutationId, 'ENTITY_ID_COLLISION', [], itemSnapshot(current), current.version);
    }

    const warnings: MutationWarningCode[] = [];
    let collectionId = mutation.newValues.collectionId;
    if (collectionId !== null && !this.collections.has(collectionId)) {
      collectionId = null;
      warnings.push('COLLECTION_DELETED_COERCED_TO_UNFILED');
    }
    const tags = normalizeTags(mutation.newValues.tags).map(tag => tag.display);
    const itemWithoutVersion: Omit<CanonicalItem, 'version'> = {
      id: mutation.entityId,
      ...mutation.newValues,
      tags,
      collectionId,
    };
    if (!validItemShape(itemWithoutVersion) || !this.assetReferenceReady(itemWithoutVersion)) {
      return this.rejected(mutation.mutationId, 'INVALID_ENTITY', 'Item create payload is invalid.');
    }

    const item: CanonicalItem = { ...itemWithoutVersion, version: 1 };
    this.items.set(item.id, item);
    const sequence = this.recordUpsert(itemSnapshot(item), mutation.mutationId, mutation.originDeviceId);
    return this.accepted(mutation.mutationId, itemSnapshot(item), item.version, sequence, true, warnings);
  }

  private patchItem(mutation: ItemPatchMutation): PushMutationResult {
    const tombstone = this.tombstones.get(`item:${mutation.entityId}`);
    if (tombstone) {
      return this.conflict(
        mutation.mutationId,
        'REMOTE_DELETED',
        mutation.changedFields,
        tombstone,
        tombstone.deletedVersion,
      );
    }
    const current = this.items.get(mutation.entityId);
    if (!current) return this.rejected(mutation.mutationId, 'NOT_FOUND', 'Item was not found.');

    const merged = mergeItemPatch(current, mutation);
    if (merged.kind === 'conflict') {
      return this.conflict(
        mutation.mutationId,
        'AUTHORED_FIELD_CONFLICT',
        merged.conflictFields,
        itemSnapshot(current),
        current.version,
      );
    }

    const warnings: MutationWarningCode[] = [];
    let collectionId = merged.values.collectionId;
    if (collectionId !== null && !this.collections.has(collectionId)) {
      collectionId = null;
      warnings.push('COLLECTION_DELETED_COERCED_TO_UNFILED');
    }
    const { version: _currentVersion, ...currentWithoutVersion } = current;
    const nextWithoutVersion: Omit<CanonicalItem, 'version'> = {
      ...currentWithoutVersion,
      ...merged.values,
      collectionId,
      tags: normalizeTags(merged.values.tags).map(tag => tag.display),
    };

    if (!validItemShape(nextWithoutVersion) || !this.assetReferenceReady(nextWithoutVersion)) {
      return this.rejected(mutation.mutationId, 'INVALID_ENTITY', 'Item patch would create invalid canonical state.');
    }

    const { updatedAt: _currentUpdatedAt, ...currentSemantic } = currentWithoutVersion;
    const { updatedAt: _nextUpdatedAt, ...nextSemantic } = nextWithoutVersion;
    const semanticChanged = stableStringify(currentSemantic) !== stableStringify(nextSemantic);
    if (!semanticChanged) {
      return this.accepted(mutation.mutationId, itemSnapshot(current), current.version, null, false, warnings);
    }

    const next: CanonicalItem = { ...nextWithoutVersion, version: current.version + 1 };
    this.items.set(next.id, next);
    const sequence = this.recordUpsert(itemSnapshot(next), mutation.mutationId, mutation.originDeviceId);
    return this.accepted(mutation.mutationId, itemSnapshot(next), next.version, sequence, true, warnings);
  }

  private deleteItem(mutation: ItemDeleteMutation): PushMutationResult {
    const existingTombstone = this.tombstones.get(`item:${mutation.entityId}`);
    if (existingTombstone) {
      return this.accepted(
        mutation.mutationId,
        existingTombstone,
        existingTombstone.deletedVersion,
        null,
        false,
        [],
      );
    }
    const current = this.items.get(mutation.entityId);
    if (!current) return this.rejected(mutation.mutationId, 'NOT_FOUND', 'Item was not found.');
    if (mutation.baseServerVersion !== current.version) {
      return this.conflict(mutation.mutationId, 'STALE_DELETE', [], itemSnapshot(current), current.version);
    }

    this.items.delete(current.id);
    const tombstone = this.recordDelete('item', current.id, current.version + 1, mutation.mutationId, mutation.originDeviceId);
    return this.accepted(
      mutation.mutationId,
      tombstone,
      tombstone.deletedVersion,
      tombstone.deletedSequence,
      true,
      [],
    );
  }

  private createCollection(mutation: CollectionCreateMutation): PushMutationResult {
    const tombstone = this.tombstones.get(`collection:${mutation.entityId}`);
    if (tombstone) {
      return this.rejected(mutation.mutationId, 'ENTITY_ID_REUSED_AFTER_DELETE', 'A deleted entity ID cannot be reused.');
    }
    const current = this.collections.get(mutation.entityId);
    if (current) {
      return this.conflict(mutation.mutationId, 'ENTITY_ID_COLLISION', [], collectionSnapshot(current), current.version);
    }
    const validated = validateCollectionName(mutation.newValues.name);
    if (!validated.ok || !safeEpoch(mutation.newValues.createdAt) || !safeEpoch(mutation.newValues.updatedAt)) {
      return this.rejected(mutation.mutationId, 'INVALID_ENTITY', 'Collection create payload is invalid.');
    }
    if (this.collectionNameInUse(validated.value.nameKey)) {
      return this.rejected(mutation.mutationId, 'DUPLICATE_COLLECTION_NAME', 'Collection name already exists.');
    }
    const collection: CanonicalCollection = {
      id: mutation.entityId,
      name: validated.value.name,
      nameKey: validated.value.nameKey,
      createdAt: mutation.newValues.createdAt,
      updatedAt: mutation.newValues.updatedAt,
      version: 1,
    };
    this.collections.set(collection.id, collection);
    const sequence = this.recordUpsert(collectionSnapshot(collection), mutation.mutationId, mutation.originDeviceId);
    return this.accepted(mutation.mutationId, collectionSnapshot(collection), 1, sequence, true, []);
  }

  private patchCollection(mutation: CollectionPatchMutation): PushMutationResult {
    const tombstone = this.tombstones.get(`collection:${mutation.entityId}`);
    if (tombstone) {
      return this.conflict(
        mutation.mutationId,
        'REMOTE_DELETED',
        mutation.changedFields,
        tombstone,
        tombstone.deletedVersion,
      );
    }
    const current = this.collections.get(mutation.entityId);
    if (!current) return this.rejected(mutation.mutationId, 'NOT_FOUND', 'Collection was not found.');

    const merged = mergeCollectionPatch(current, mutation);
    if (merged.kind === 'conflict') {
      return this.conflict(
        mutation.mutationId,
        'COLLECTION_RENAME_CONFLICT',
        merged.conflictFields,
        collectionSnapshot(current),
        current.version,
      );
    }
    if (!merged.changed) {
      return this.accepted(mutation.mutationId, collectionSnapshot(current), current.version, null, false, []);
    }

    const validated = validateCollectionName(merged.name);
    if (!validated.ok) return this.rejected(mutation.mutationId, 'INVALID_ENTITY', 'Collection name is invalid.');
    if (this.collectionNameInUse(validated.value.nameKey, current.id)) {
      return this.rejected(mutation.mutationId, 'DUPLICATE_COLLECTION_NAME', 'Collection name already exists.');
    }
    const next: CanonicalCollection = {
      ...current,
      name: validated.value.name,
      nameKey: validated.value.nameKey,
      updatedAt: merged.updatedAt,
      version: current.version + 1,
    };
    this.collections.set(next.id, next);
    const sequence = this.recordUpsert(collectionSnapshot(next), mutation.mutationId, mutation.originDeviceId);
    return this.accepted(mutation.mutationId, collectionSnapshot(next), next.version, sequence, true, []);
  }

  private deleteCollection(mutation: CollectionDeleteMutation): PushMutationResult {
    const existingTombstone = this.tombstones.get(`collection:${mutation.entityId}`);
    if (existingTombstone) {
      return this.accepted(
        mutation.mutationId,
        existingTombstone,
        existingTombstone.deletedVersion,
        null,
        false,
        [],
      );
    }
    const current = this.collections.get(mutation.entityId);
    if (!current) return this.rejected(mutation.mutationId, 'NOT_FOUND', 'Collection was not found.');
    if (mutation.baseServerVersion !== current.version) {
      return this.conflict(mutation.mutationId, 'STALE_DELETE', [], collectionSnapshot(current), current.version);
    }

    // Unfile affected items first so change replay never needs a deleted
    // collection to satisfy the item snapshot.
    for (const item of [...this.items.values()].filter(item => item.collectionId === current.id).sort((a, b) => a.id.localeCompare(b.id))) {
      const next: CanonicalItem = { ...item, collectionId: null, version: item.version + 1 };
      this.items.set(next.id, next);
      this.recordUpsert(itemSnapshot(next), mutation.mutationId, mutation.originDeviceId);
    }

    this.collections.delete(current.id);
    const tombstone = this.recordDelete(
      'collection',
      current.id,
      current.version + 1,
      mutation.mutationId,
      mutation.originDeviceId,
    );
    return this.accepted(
      mutation.mutationId,
      tombstone,
      tombstone.deletedVersion,
      tombstone.deletedSequence,
      true,
      [],
    );
  }

  private collectionNameInUse(nameKey: string, exceptId?: string): boolean {
    for (const collection of this.collections.values()) {
      if (collection.id !== exceptId && collection.nameKey === nameKey) return true;
    }
    return false;
  }

  private assetReferenceReady(item: Omit<CanonicalItem, 'version'>): boolean {
    if (item.type !== 'image') return true;
    if (!item.assetId) return false;
    return this.assets.get(item.assetId)?.remoteState === 'ready';
  }

  private recordUpsert(snapshot: CanonicalEntitySnapshot, mutationId: string | null, originDeviceId: string): number {
    const sequence = this.accountHead.commitImmediate(`change-${++this.changeOwnerCounter}`);
    this.changes.push({
      sequence,
      entityType: snapshot.entityType,
      entityId: snapshot.entity.id,
      entityVersion: snapshot.entity.version,
      kind: 'upsert',
      payload: clone(snapshot),
      mutationId,
      originDeviceId,
      serverEpochMs: this.now(),
    });
    return sequence;
  }

  private recordDelete(
    entityType: 'item' | 'collection',
    entityId: string,
    deletedVersion: number,
    mutationId: string,
    originDeviceId: string,
  ): EntityTombstone {
    const sequence = this.accountHead.commitImmediate(`change-${++this.changeOwnerCounter}`);
    const tombstone: EntityTombstone = {
      entityType,
      entityId,
      deletedVersion,
      deletedSequence: sequence,
      originDeviceId,
    };
    this.tombstones.set(`${entityType}:${entityId}`, tombstone);
    this.changes.push({
      sequence,
      entityType,
      entityId,
      entityVersion: deletedVersion,
      kind: 'delete',
      payload: clone(tombstone),
      mutationId,
      originDeviceId,
      serverEpochMs: this.now(),
    });
    return tombstone;
  }

  private accepted(
    mutationId: string,
    canonical: CanonicalEntitySnapshot | EntityTombstone,
    serverVersion: number,
    changeSequence: number | null,
    changed: boolean,
    warnings: readonly MutationWarningCode[],
  ): MutationAccepted {
    return { kind: 'accepted', mutationId, canonical: clone(canonical), serverVersion, changeSequence, changed, warnings };
  }

  private conflict(
    mutationId: string,
    reason: MutationConflict['reason'],
    conflictFields: readonly string[],
    current: CanonicalEntitySnapshot | EntityTombstone,
    currentServerVersion: number,
  ): MutationConflict {
    return { kind: 'conflict', mutationId, reason, conflictFields, current: clone(current), currentServerVersion };
  }

  private rejected(mutationId: string, code: MutationRejected['code'], message: string): MutationRejected {
    return { kind: 'rejected', mutationId, code, message };
  }
}
