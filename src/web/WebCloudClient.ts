import type { SupabaseAssetTransport } from '../sync/transport/SupabaseAssetTransport';
import type { SupabaseSyncTransport } from '../sync/transport/SupabaseSyncTransport';
import {
  SYNC_PROTOCOL_VERSION,
  canonicalMutableCollectionValues,
  canonicalMutableItemValues,
  type AccountId,
  type CanonicalAsset,
  type CanonicalCollection,
  type CanonicalEntitySnapshot,
  type CanonicalItem,
  type EntityTombstone,
  type ItemSyncField,
  type PushMutationResult,
  type SyncChange,
  type SyncMutation,
} from '../sync/protocol';

export type WebCloudSnapshot = Readonly<{
  loading: boolean;
  syncing: boolean;
  error: string | null;
  items: readonly CanonicalItem[];
  collections: readonly CanonicalCollection[];
  revision: number;
}>;

type Listener = () => void;

function uuid(): string {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject?.randomUUID) return cryptoObject.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, token => {
    const random = Math.floor(Math.random() * 16);
    return (token === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function storagePath(accountId: string, asset: CanonicalAsset): string {
  const ext = asset.mimeType === 'image/jpeg' ? 'jpg' : asset.mimeType === 'image/png' ? 'png' : 'webp';
  return `${accountId}/${asset.id}/original.${ext}`;
}

export class WebCloudClient {
  private readonly items = new Map<string, CanonicalItem>();
  private readonly collections = new Map<string, CanonicalCollection>();
  private readonly assetsById = new Map<string, CanonicalAsset>();
  private readonly assetUrls = new Map<string, string>();
  private readonly listeners = new Set<Listener>();
  private cursor = 0;
  private revision = 0;
  private loading = true;
  private initialized = false;
  private syncing = false;
  private error: string | null = null;

  constructor(
    readonly accountId: AccountId,
    private readonly deviceId: string,
    private readonly transport: SupabaseSyncTransport,
    private readonly assets: SupabaseAssetTransport,
  ) {}

  snapshot(): WebCloudSnapshot {
    return {
      loading: this.loading,
      syncing: this.syncing,
      error: this.error,
      items: [...this.items.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)),
      collections: [...this.collections.values()].sort((a, b) => a.name.localeCompare(b.name)),
      revision: this.revision,
    };
  }

  subscribe(listener: Listener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  async initialLoad(): Promise<void> {
    this.loading = true; this.initialized = false; this.error = null; this.emit();
    try {
      await this.bootstrapSnapshot();
      await this.pullFinite();
      this.initialized = true; this.loading = false; this.error = null; this.bump();
    } catch (error) {
      this.loading = false; this.error = error instanceof Error ? error.message : 'Could not load Tuck.'; this.emit();
    }
  }

  async refresh(): Promise<void> {
    if (this.syncing || this.loading) return;
    this.syncing = true; this.error = null; this.emit();
    try {
      if (!this.initialized) {
        await this.bootstrapSnapshot();
        await this.pullFinite();
        this.initialized = true;
      } else {
        await this.pullFinite();
      }
      this.error = null;
    }
    catch (error) { this.error = error instanceof Error ? error.message : 'Could not refresh.'; }
    finally { this.syncing = false; this.emit(); }
  }

  async createNote(title: string, body: string, tags: readonly string[] = [], collectionId: string | null = null): Promise<void> {
    const now = Date.now();
    await this.push({
      protocolVersion: SYNC_PROTOCOL_VERSION, accountId: this.accountId, mutationId: uuid(), originDeviceId: this.deviceId,
      entityType: 'item', entityId: uuid(), action: 'create', baseServerVersion: null,
      changedFields: ['title','body','url','assetId','tags','collectionId','pinned','archived','updatedAt'], baseValues: {},
      newValues: { type: 'note', title, body, url: null, assetId: null, tags: [...tags], collectionId, pinned: false, archived: false, createdAt: now, updatedAt: now },
    });
  }

  async createLink(title: string, url: string, tags: readonly string[] = [], collectionId: string | null = null): Promise<void> {
    const now = Date.now();
    await this.push({
      protocolVersion: SYNC_PROTOCOL_VERSION, accountId: this.accountId, mutationId: uuid(), originDeviceId: this.deviceId,
      entityType: 'item', entityId: uuid(), action: 'create', baseServerVersion: null,
      changedFields: ['title','body','url','assetId','tags','collectionId','pinned','archived','updatedAt'], baseValues: {},
      newValues: { type: 'link', title, body: null, url, assetId: null, tags: [...tags], collectionId, pinned: false, archived: false, createdAt: now, updatedAt: now },
    });
  }

  async patchItem(itemId: string, changes: Partial<Pick<CanonicalItem, 'title'|'body'|'url'|'tags'|'collectionId'|'pinned'|'archived'>>): Promise<void> {
    const item = this.items.get(itemId); if (!item) throw new Error('Item no longer exists.');
    const fields = Object.keys(changes) as Array<keyof typeof changes>;
    if (!fields.length) return;
    const base = canonicalMutableItemValues(item);
    const changedFields: ItemSyncField[] = [...fields, 'updatedAt'];
    const baseValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = { updatedAt: Date.now() };
    for (const field of fields) { baseValues[field] = base[field]; newValues[field] = changes[field]; }
    await this.push({
      protocolVersion: SYNC_PROTOCOL_VERSION, accountId: this.accountId, mutationId: uuid(), originDeviceId: this.deviceId,
      entityType: 'item', entityId: item.id, action: 'patch', baseServerVersion: item.version,
      changedFields, baseValues, newValues,
    });
  }

  async deleteItem(itemId: string): Promise<void> {
    const item = this.items.get(itemId); if (!item) return;
    await this.push({ protocolVersion: SYNC_PROTOCOL_VERSION, accountId: this.accountId, mutationId: uuid(), originDeviceId: this.deviceId,
      entityType: 'item', entityId: item.id, action: 'delete', baseServerVersion: item.version, changedFields: [], baseValues: {}, newValues: {} });
  }

  async createCollection(name: string): Promise<void> {
    const now = Date.now();
    await this.push({ protocolVersion: SYNC_PROTOCOL_VERSION, accountId: this.accountId, mutationId: uuid(), originDeviceId: this.deviceId,
      entityType: 'collection', entityId: uuid(), action: 'create', baseServerVersion: null, changedFields: ['name','updatedAt'], baseValues: {},
      newValues: { name: name.trim(), createdAt: now, updatedAt: now } });
  }

  async renameCollection(id: string, name: string): Promise<void> {
    const collection = this.collections.get(id); if (!collection) throw new Error('Collection no longer exists.');
    const base = canonicalMutableCollectionValues(collection);
    await this.push({ protocolVersion: SYNC_PROTOCOL_VERSION, accountId: this.accountId, mutationId: uuid(), originDeviceId: this.deviceId,
      entityType: 'collection', entityId: id, action: 'patch', baseServerVersion: collection.version, changedFields: ['name','updatedAt'],
      baseValues: { name: base.name }, newValues: { name: name.trim(), updatedAt: Date.now() } });
  }

  async deleteCollection(id: string): Promise<void> {
    const collection = this.collections.get(id); if (!collection) return;
    await this.push({ protocolVersion: SYNC_PROTOCOL_VERSION, accountId: this.accountId, mutationId: uuid(), originDeviceId: this.deviceId,
      entityType: 'collection', entityId: id, action: 'delete', baseServerVersion: collection.version, changedFields: [], baseValues: {}, newValues: {} });
  }

  async imageUrl(assetId: string): Promise<string | null> {
    const cached = this.assetUrls.get(assetId); if (cached) return cached;
    const asset = this.assetsById.get(assetId); if (!asset || asset.remoteState !== 'ready') return null;
    const downloaded = await this.assets.download(storagePath(this.accountId, asset));
    const blob = new Blob([downloaded.bytes as unknown as BlobPart], { type: asset.mimeType });
    const url = URL.createObjectURL(blob); this.assetUrls.set(assetId, url); return url;
  }

  dispose(): void { for (const url of this.assetUrls.values()) URL.revokeObjectURL(url); this.assetUrls.clear(); }

  private async push(mutation: SyncMutation): Promise<void> {
    if (!this.initialized) throw new Error('Cloud library is still loading. Refresh and try again.');
    this.syncing = true; this.error = null; this.emit();
    try {
      const response = await this.transport.pushMutations({ protocolVersion: SYNC_PROTOCOL_VERSION, accountId: this.accountId, mutations: [mutation] });
      if (response.kind !== 'ok') throw new Error(response.message);
      const result = response.results[0]; if (!result) throw new Error('Server returned no mutation result.');
      this.applyPushResult(result);
      if (result.kind === 'conflict') throw new Error('This item changed on another device. Refresh and try again; the server version was kept.');
      if (result.kind === 'rejected') throw new Error(result.message);
      await this.pullFinite();
      this.error = null;
    } catch (error) { this.error = error instanceof Error ? error.message : 'Could not save to cloud.'; throw error; }
    finally { this.syncing = false; this.emit(); }
  }

  private applyPushResult(result: PushMutationResult): void {
    if (result.kind === 'accepted') this.applySnapshot(result.canonical);
    else if (result.kind === 'conflict') this.applySnapshot(result.current);
    this.bump();
  }

  private applySnapshot(snapshot: CanonicalEntitySnapshot | EntityTombstone): void {
    if ('deletedVersion' in snapshot) {
      if (snapshot.entityType === 'item') this.items.delete(snapshot.entityId); else this.collections.delete(snapshot.entityId);
      return;
    }
    if (snapshot.entityType === 'item') this.items.set(snapshot.entity.id, snapshot.entity);
    else if (snapshot.entityType === 'collection') this.collections.set(snapshot.entity.id, snapshot.entity);
    else this.assetsById.set(snapshot.entity.id, snapshot.entity);
  }

  private applyChange(change: SyncChange): void { this.applySnapshot(change.payload); }

  private async bootstrapSnapshot(): Promise<void> {
    this.items.clear();
    this.collections.clear();
    this.assetsById.clear();
    this.cursor = 0;
    let sessionId: string | undefined;
    let afterOrdinal: number | undefined;
    let snapshotHead = 0;
    for (;;) {
      const response = await this.transport.bootstrap({
        protocolVersion: SYNC_PROTOCOL_VERSION,
        accountId: this.accountId,
        pageSize: 300,
        ...(sessionId ? { sessionId } : {}),
        ...(afterOrdinal !== undefined ? { afterOrdinal } : {}),
      });
      if (response.kind === 'bootstrap_expired') {
        sessionId = undefined;
        afterOrdinal = undefined;
        this.items.clear();
        this.collections.clear();
        this.assetsById.clear();
        continue;
      }
      if (response.kind !== 'page') throw new Error(response.message);
      sessionId = response.sessionId;
      snapshotHead = response.snapshotHeadSequence;
      for (const entry of response.entries) this.applySnapshot(entry.snapshot);
      if (response.nextAfterOrdinal === null) break;
      afterOrdinal = response.nextAfterOrdinal;
    }
    this.cursor = snapshotHead;
  }

  private async pullFinite(): Promise<void> {
    let target: number | null = null;
    let rebootstrapAttempted = false;
    for (;;) {
      const response = await this.transport.pullChanges({ protocolVersion: SYNC_PROTOCOL_VERSION, accountId: this.accountId, afterSequence: this.cursor, limit: 300, targetHeadSequence: target });
      if (response.kind === 'rebootstrap_required') {
        if (rebootstrapAttempted) throw new Error('Cloud history changed while reloading. Try again.');
        rebootstrapAttempted = true;
        target = null;
        await this.bootstrapSnapshot();
        continue;
      }
      if (response.kind !== 'page') throw new Error(response.message);
      target = response.targetHeadSequence;
      for (const change of response.changes) this.applyChange(change);
      this.cursor = response.nextAfterSequence;
      if (!response.hasMore || this.cursor >= response.targetHeadSequence) { if (response.changes.length) this.bump(); return; }
    }
  }

  private bump(): void { this.revision += 1; this.emit(); }
  private emit(): void { for (const listener of this.listeners) listener(); }
}
