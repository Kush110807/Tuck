export const WEB_LOCAL_DB_NAME = 'tuck-web-local';
export const WEB_LOCAL_SCHEMA_VERSION = 1;

export type WebItemKind = 'note' | 'link' | 'image';
export type WebLocalItem = Readonly<{
  id: string;
  kind: WebItemKind;
  title: string;
  body: string;
  url: string;
  imageId: string | null;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  pinned: boolean;
  collectionId: string | null;
  tags: readonly string[];
}>;

export type WebLocalCollection = Readonly<{
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}>;

export type WebLocalImage = Readonly<{
  id: string;
  blob: Blob;
  mimeType: string;
  fileName: string | null;
  createdAt: number;
}>;

export type WebLocalSnapshot = Readonly<{
  items: readonly WebLocalItem[];
  collections: readonly WebLocalCollection[];
  schemaVersion: number;
  seeded: boolean;
}>;

export type WebLocalItemPatch = Partial<Pick<WebLocalItem,
  'title' | 'body' | 'url' | 'archived' | 'pinned' | 'collectionId' | 'tags'
>>;

type StoreName = 'items' | 'collections' | 'images' | 'meta';
type TxMode = 'readonly' | 'readwrite';
type MetaRecord = { key: string; value: unknown };

export interface WebLocalTransaction {
  get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined>;
  getAll<T>(store: StoreName): Promise<T[]>;
  put<T>(store: StoreName, value: T): Promise<void>;
  delete(store: StoreName, key: IDBValidKey): Promise<void>;
}

export interface WebLocalDatabase {
  initialize(): Promise<void>;
  run<T>(stores: readonly StoreName[], mode: TxMode, work: (tx: WebLocalTransaction) => Promise<T>): Promise<T>;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

class IndexedDbTransaction implements WebLocalTransaction {
  constructor(private readonly transaction: IDBTransaction) {}

  async get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    return requestResult(this.transaction.objectStore(store).get(key)) as Promise<T | undefined>;
  }
  async getAll<T>(store: StoreName): Promise<T[]> {
    return requestResult(this.transaction.objectStore(store).getAll()) as Promise<T[]>;
  }
  async put<T>(store: StoreName, value: T): Promise<void> {
    await requestResult(this.transaction.objectStore(store).put(value));
  }
  async delete(store: StoreName, key: IDBValidKey): Promise<void> {
    await requestResult(this.transaction.objectStore(store).delete(key));
  }
}

export class IndexedDbWebLocalDatabase implements WebLocalDatabase {
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly name = WEB_LOCAL_DB_NAME,
    private readonly factory: IDBFactory | undefined = globalThis.indexedDB,
  ) {}

  initialize(): Promise<void> {
    return this.open().then(() => undefined);
  }

  async run<T>(stores: readonly StoreName[], mode: TxMode, work: (tx: WebLocalTransaction) => Promise<T>): Promise<T> {
    const database = await this.open();
    const transaction = database.transaction([...stores], mode);
    const completion = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    });
    try {
      const result = await work(new IndexedDbTransaction(transaction));
      await completion;
      return result;
    } catch (error) {
      try { transaction.abort(); } catch { /* transaction may already be inactive */ }
      throw error;
    }
  }

  private open(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    if (!this.factory) return Promise.reject(new Error('IndexedDB is not available in this browser.'));
    this.databasePromise = new Promise((resolve, reject) => {
      const request = this.factory!.open(this.name, WEB_LOCAL_SCHEMA_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('collections')) db.createObjectStore('collections', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Could not open Tuck browser storage.'));
      request.onblocked = () => reject(new Error('Tuck storage upgrade is blocked by another open tab.'));
    });
    return this.databasePromise;
  }
}

/** Small deterministic backend used by focused repository tests; competition runtime uses IndexedDB. */
export class MemoryWebLocalDatabase implements WebLocalDatabase {
  private stores: Record<StoreName, Map<IDBValidKey, unknown>> = {
    items: new Map(), collections: new Map(), images: new Map(), meta: new Map(),
  };

  async initialize(): Promise<void> {}

  async run<T>(stores: readonly StoreName[], mode: TxMode, work: (tx: WebLocalTransaction) => Promise<T>): Promise<T> {
    const working = mode === 'readwrite'
      ? Object.fromEntries((Object.keys(this.stores) as StoreName[]).map(name => [name, new Map(this.stores[name])])) as Record<StoreName, Map<IDBValidKey, unknown>>
      : this.stores;
    const tx: WebLocalTransaction = {
      get: async <V>(store: StoreName, key: IDBValidKey) => working[store].get(key) as V | undefined,
      getAll: async <V>(store: StoreName) => [...working[store].values()] as V[],
      put: async <V>(store: StoreName, value: V) => {
        const record = value as { id?: IDBValidKey; key?: IDBValidKey };
        const key = record.id ?? record.key;
        if (key === undefined) throw new Error(`Missing key for ${store}.`);
        working[store].set(key, value);
      },
      delete: async (store: StoreName, key: IDBValidKey) => { working[store].delete(key); },
    };
    const result = await work(tx);
    if (mode === 'readwrite') this.stores = working;
    return result;
  }
}

function uuid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `tuck-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizedTags(tags: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/^#/, '');
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

function seedImageBlob(): Blob {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ede6d8"/><stop offset="1" stop-color="#cbd6c7"/></linearGradient></defs><rect width="1200" height="760" fill="url(#g)"/><circle cx="900" cy="170" r="150" fill="#fffaf0" opacity=".75"/><path d="M0 620 C180 480 320 520 470 420 C620 320 760 420 900 330 C1040 240 1110 290 1200 210 V760 H0Z" fill="#66816d"/><path d="M0 675 C220 555 360 630 560 520 C760 410 940 520 1200 390 V760 H0Z" fill="#3f5a45" opacity=".9"/><text x="72" y="112" font-family="Arial, sans-serif" font-size="38" fill="#30342f">A visual worth keeping</text></svg>`;
  return new Blob([svg], { type: 'image/svg+xml' });
}

export class WebLocalRepository {
  private readonly listeners = new Set<() => void>();
  private readonly objectUrls = new Map<string, string>();

  constructor(private readonly database: WebLocalDatabase = new IndexedDbWebLocalDatabase()) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async initialize(): Promise<void> {
    await this.database.initialize();
    await this.seedOnce();
  }

  async snapshot(): Promise<WebLocalSnapshot> {
    return this.database.run(['items', 'collections', 'meta'], 'readonly', async tx => {
      const [items, collections, schema, seeded] = await Promise.all([
        tx.getAll<WebLocalItem>('items'),
        tx.getAll<WebLocalCollection>('collections'),
        tx.get<MetaRecord>('meta', 'schemaVersion'),
        tx.get<MetaRecord>('meta', 'seeded'),
      ]);
      return {
        items: items.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt),
        collections: collections.sort((a, b) => a.name.localeCompare(b.name)),
        schemaVersion: Number(schema?.value ?? WEB_LOCAL_SCHEMA_VERSION),
        seeded: seeded?.value === true,
      };
    });
  }

  async createNote(title = '', body = '', tags: readonly string[] = [], collectionId: string | null = null): Promise<WebLocalItem> {
    return this.createItem({ kind: 'note', title, body, url: '', imageId: null, tags, collectionId });
  }

  async createLink(title = '', url = '', tags: readonly string[] = [], collectionId: string | null = null): Promise<WebLocalItem> {
    return this.createItem({ kind: 'link', title, body: '', url, imageId: null, tags, collectionId });
  }

  async createImage(blob: Blob, fileName: string | null, title = '', tags: readonly string[] = [], collectionId: string | null = null): Promise<WebLocalItem> {
    const now = Date.now();
    const imageId = uuid();
    const item: WebLocalItem = {
      id: uuid(), kind: 'image', title: title.trim() || fileName?.replace(/\.[^.]+$/, '') || 'Untitled image', body: '', url: '', imageId,
      tags: normalizedTags(tags), collectionId, pinned: false, archived: false, createdAt: now, updatedAt: now,
    };
    const image: WebLocalImage = { id: imageId, blob, mimeType: blob.type || 'application/octet-stream', fileName, createdAt: now };
    await this.database.run(['items', 'images'], 'readwrite', async tx => { await tx.put('images', image); await tx.put('items', item); });
    this.emit();
    return item;
  }

  async patchItem(id: string, patch: WebLocalItemPatch): Promise<WebLocalItem> {
    const item = await this.database.run(['items'], 'readwrite', async tx => {
      const existing = await tx.get<WebLocalItem>('items', id);
      if (!existing) throw new Error('This item no longer exists.');
      const next: WebLocalItem = {
        ...existing,
        ...patch,
        title: patch.title === undefined ? existing.title : patch.title.trim(),
        tags: patch.tags === undefined ? existing.tags : normalizedTags(patch.tags),
        updatedAt: Date.now(),
      };
      await tx.put('items', next);
      return next;
    });
    this.emit();
    return item;
  }

  async replaceImage(itemId: string, blob: Blob, fileName: string | null): Promise<WebLocalItem> {
    let oldImageId: string | null = null;
    const next = await this.database.run(['items', 'images'], 'readwrite', async tx => {
      const item = await tx.get<WebLocalItem>('items', itemId);
      if (!item || item.kind !== 'image') throw new Error('Image item not found.');
      oldImageId = item.imageId;
      const imageId = uuid();
      const image: WebLocalImage = { id: imageId, blob, mimeType: blob.type || 'application/octet-stream', fileName, createdAt: Date.now() };
      const updated: WebLocalItem = { ...item, imageId, updatedAt: Date.now() };
      await tx.put('images', image);
      await tx.put('items', updated);
      if (oldImageId) await tx.delete('images', oldImageId);
      return updated;
    });
    if (oldImageId) this.revokeObjectUrl(oldImageId);
    this.emit();
    return next;
  }

  async deleteItem(id: string): Promise<void> {
    let imageId: string | null = null;
    await this.database.run(['items', 'images'], 'readwrite', async tx => {
      const item = await tx.get<WebLocalItem>('items', id);
      if (!item) return;
      imageId = item.imageId;
      await tx.delete('items', id);
      if (imageId) await tx.delete('images', imageId);
    });
    if (imageId) this.revokeObjectUrl(imageId);
    this.emit();
  }

  async createCollection(name: string): Promise<WebLocalCollection> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Collection name is required.');
    const now = Date.now();
    const collection: WebLocalCollection = { id: uuid(), name: trimmed, createdAt: now, updatedAt: now };
    await this.database.run(['collections'], 'readwrite', tx => tx.put('collections', collection));
    this.emit();
    return collection;
  }

  async renameCollection(id: string, name: string): Promise<WebLocalCollection> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Collection name is required.');
    const result = await this.database.run(['collections'], 'readwrite', async tx => {
      const current = await tx.get<WebLocalCollection>('collections', id);
      if (!current) throw new Error('Collection not found.');
      const next = { ...current, name: trimmed, updatedAt: Date.now() };
      await tx.put('collections', next);
      return next;
    });
    this.emit();
    return result;
  }

  async deleteCollection(id: string): Promise<void> {
    await this.database.run(['collections', 'items'], 'readwrite', async tx => {
      await tx.delete('collections', id);
      const items = await tx.getAll<WebLocalItem>('items');
      for (const item of items) {
        if (item.collectionId !== id) continue;
        await tx.put('items', { ...item, collectionId: null, updatedAt: Date.now() });
      }
    });
    this.emit();
  }

  async imageUrl(imageId: string): Promise<string | null> {
    const cached = this.objectUrls.get(imageId);
    if (cached) return cached;
    const image = await this.database.run(['images'], 'readonly', tx => tx.get<WebLocalImage>('images', imageId));
    if (!image) return null;
    const url = URL.createObjectURL(image.blob);
    this.objectUrls.set(imageId, url);
    return url;
  }

  dispose(): void {
    for (const url of this.objectUrls.values()) URL.revokeObjectURL(url);
    this.objectUrls.clear();
    this.listeners.clear();
  }

  private async createItem(input: Pick<WebLocalItem, 'kind' | 'title' | 'body' | 'url' | 'imageId' | 'tags' | 'collectionId'>): Promise<WebLocalItem> {
    const now = Date.now();
    const item: WebLocalItem = {
      ...input, id: uuid(), title: input.title.trim(), tags: normalizedTags(input.tags), pinned: false, archived: false, createdAt: now, updatedAt: now,
    };
    await this.database.run(['items'], 'readwrite', tx => tx.put('items', item));
    this.emit();
    return item;
  }

  private async seedOnce(): Promise<void> {
    await this.database.run(['items', 'collections', 'images', 'meta'], 'readwrite', async tx => {
      const seeded = await tx.get<MetaRecord>('meta', 'seeded');
      if (seeded?.value === true) return;
      const base = Date.now() - 6 * 60_000;
      const ideas: WebLocalCollection = { id: 'seed-ideas', name: 'Ideas', createdAt: base, updatedAt: base };
      const imageId = 'seed-image-blob';
      const samples: WebLocalItem[] = [
        {
          id: 'seed-welcome', kind: 'note', title: 'Welcome to Tuck', body: 'Keep the thoughts, links and references you want to find again.', url: '', imageId: null,
          tags: ['start-here'], collectionId: 'seed-ideas', pinned: true, archived: false, createdAt: base, updatedAt: base + 1,
        },
        {
          id: 'seed-link', kind: 'link', title: 'A place worth revisiting', body: '', url: 'https://www.are.na/', imageId: null,
          tags: ['inspiration'], collectionId: 'seed-ideas', pinned: false, archived: false, createdAt: base + 2, updatedAt: base + 2,
        },
        {
          id: 'seed-image', kind: 'image', title: 'Visual reference', body: '', url: '', imageId,
          tags: ['moodboard'], collectionId: null, pinned: false, archived: false, createdAt: base + 3, updatedAt: base + 3,
        },
      ];
      await tx.put('collections', ideas);
      await tx.put('images', { id: imageId, blob: seedImageBlob(), mimeType: 'image/svg+xml', fileName: 'visual-reference.svg', createdAt: base + 3 } satisfies WebLocalImage);
      for (const item of samples) await tx.put('items', item);
      await tx.put('meta', { key: 'schemaVersion', value: WEB_LOCAL_SCHEMA_VERSION } satisfies MetaRecord);
      await tx.put('meta', { key: 'seeded', value: true } satisfies MetaRecord);
    });
    this.emit();
  }

  private revokeObjectUrl(imageId: string): void {
    const url = this.objectUrls.get(imageId);
    if (!url) return;
    URL.revokeObjectURL(url);
    this.objectUrls.delete(imageId);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
