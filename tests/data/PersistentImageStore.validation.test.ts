import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = vi.hoisted(() => ({
  files: new Map<string, { bytes: Uint8Array; sizeOverride?: number }>(),
}));

vi.mock('expo-file-system', () => {
  class FakeDirectory {
    uri: string;
    constructor(base: string | FakeDirectory, child?: string) {
      const root = typeof base === 'string' ? base : base.uri;
      this.uri = child ? `${root.replace(/\/$/, '')}/${child}` : root;
    }
    create() {}
    list() {
      const prefix = `${this.uri.replace(/\/$/, '')}/`;
      return [...memory.files.keys()]
        .filter(uri => uri.startsWith(prefix) && !uri.slice(prefix.length).includes('/'))
        .map(uri => new FakeFile(uri));
    }
  }

  class FakeFile {
    uri: string;
    name: string;
    constructor(base: string | FakeDirectory, child?: string) {
      const root = typeof base === 'string' ? base : base.uri;
      this.uri = child ? `${root.replace(/\/$/, '')}/${child}` : root;
      this.name = this.uri.split('/').at(-1) ?? '';
    }
    get exists() { return memory.files.has(this.uri); }
    get size() {
      const record = memory.files.get(this.uri);
      return record ? record.sizeOverride ?? record.bytes.byteLength : 0;
    }
    async bytes() {
      const record = memory.files.get(this.uri);
      if (!record) throw new Error('missing');
      return record.bytes;
    }
    async copy(destination: FakeFile) {
      const record = memory.files.get(this.uri);
      if (!record) throw new Error('missing');
      memory.files.set(destination.uri, { bytes: record.bytes.slice(), ...(record.sizeOverride === undefined ? {} : { sizeOverride: record.sizeOverride }) });
    }
    delete() { memory.files.delete(this.uri); }
  }

  return { Directory: FakeDirectory, File: FakeFile, Paths: { document: 'file:///docs' } };
});

vi.mock('react-native', () => ({ Image: { getSize: vi.fn() } }));

import { MAX_IMAGE_BYTES } from '../../src/domain/validation';
import { PersistentImageStore } from '../../src/data/PersistentImageStore';

function pngBytes(): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  return bytes;
}

function jpegBytes(): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0xff, 0xd9]);
}

describe('PersistentImageStore content validation', () => {
  beforeEach(() => memory.files.clear());

  it('accepts a supported decodable image when picker MIME metadata agrees with the bytes', async () => {
    const uri = 'file:///tmp/photo.jpg';
    memory.files.set(uri, { bytes: jpegBytes() });
    const decode = vi.fn(async () => ({ width: 40, height: 30 }));
    const store = new PersistentImageStore(decode);

    const result = await store.copySelected({ temporaryUri: uri, mimeType: 'image/jpeg' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected accepted image');
    expect(result.value).toMatch(/^images\/.+\.jpg$/);
  });

  it('accepts a supported decodable image when picker MIME metadata is missing', async () => {
    const uri = 'content://provider/photo/1';
    memory.files.set(uri, { bytes: pngBytes() });
    const decode = vi.fn(async () => ({ width: 32, height: 24 }));
    const store = new PersistentImageStore(decode);

    const result = await store.copySelected({ temporaryUri: uri, mimeType: null });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected accepted image');
    expect(result.value).toMatch(/^images\/.+\.png$/);
    expect(decode).toHaveBeenCalledTimes(2); // source and copied app-owned file
  });

  it('uses actual bytes and rejects a supported MIME label that does not match the file contents', async () => {
    const uri = 'file:///tmp/mislabeled.jpg';
    memory.files.set(uri, { bytes: pngBytes() });
    const store = new PersistentImageStore(async () => ({ width: 32, height: 24 }));

    const result = await store.copySelected({ temporaryUri: uri, mimeType: 'image/jpeg' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected rejection');
    expect(result.error.code).toBe('IMAGE_UNSUPPORTED');
  });

  it('rejects truncated bytes and signature-valid input that the native decoder cannot decode', async () => {
    const truncated = 'file:///tmp/truncated.png';
    memory.files.set(truncated, { bytes: pngBytes().slice(0, 12) });
    const store = new PersistentImageStore(async () => ({ width: 1, height: 1 }));
    const truncatedResult = await store.copySelected({ temporaryUri: truncated, mimeType: 'image/png' });
    expect(truncatedResult.ok).toBe(false);
    if (!truncatedResult.ok) expect(truncatedResult.error.code).toBe('IMAGE_UNSUPPORTED');

    const corrupt = 'file:///tmp/corrupt.png';
    memory.files.set(corrupt, { bytes: pngBytes() });
    const corruptStore = new PersistentImageStore(async () => { throw new Error('decoder rejected'); });
    const corruptResult = await corruptStore.copySelected({ temporaryUri: corrupt, mimeType: 'image/png' });
    expect(corruptResult.ok).toBe(false);
    if (!corruptResult.ok) expect(corruptResult.error.code).toBe('IMAGE_UNSUPPORTED');
  });

  it('preserves the actual 10 MiB limit before copying', async () => {
    const uri = 'file:///tmp/huge.jpg';
    memory.files.set(uri, { bytes: jpegBytes(), sizeOverride: MAX_IMAGE_BYTES + 1 });
    const decode = vi.fn(async () => ({ width: 1, height: 1 }));
    const store = new PersistentImageStore(decode);

    const result = await store.copySelected({ temporaryUri: uri, mimeType: 'image/jpeg', reportedBytes: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected oversized rejection');
    expect(result.error.code).toBe('IMAGE_TOO_LARGE');
    expect(decode).not.toHaveBeenCalled();
  });
});
