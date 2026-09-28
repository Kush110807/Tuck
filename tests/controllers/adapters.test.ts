import { describe, expect, it, vi } from 'vitest';
import { ExpoImagePickerAdapter, ReactNativeLinkOpener } from '../../src/controllers';

describe('controller adapters', () => {
  it('maps image-picker cancellation separately from failure', async () => {
    const adapter = new ExpoImagePickerAdapter({
      launchImageLibraryAsync: async () => ({ canceled: true, assets: null }),
    });
    await expect(adapter.pickOne()).resolves.toEqual({ kind: 'cancelled' });
  });

  it('launches the system library picker without gating on media-library permission', async () => {
    const requestPermission = vi.fn(async () => ({ granted: false }));
    const launch = vi.fn(async () => ({
      canceled: false,
      assets: [{ uri: 'file:///tmp/photo.webp', mimeType: 'image/webp', fileSize: 1234 }],
    }));
    const adapter = new ExpoImagePickerAdapter({
      requestMediaLibraryPermissionsAsync: requestPermission,
      launchImageLibraryAsync: launch,
    });

    await expect(adapter.pickOne()).resolves.toEqual({
      kind: 'selected',
      selection: { temporaryUri: 'file:///tmp/photo.webp', mimeType: 'image/webp', reportedBytes: 1234 },
    });
    expect(requestPermission).not.toHaveBeenCalled();
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('keeps a valid picker result when MIME metadata is unavailable so byte validation can decide format', async () => {
    const adapter = new ExpoImagePickerAdapter({
      launchImageLibraryAsync: async () => ({
        canceled: false,
        assets: [{ uri: 'content://provider/photo/42', mimeType: null, fileSize: 4321 }],
      }),
    });

    await expect(adapter.pickOne()).resolves.toEqual({
      kind: 'selected',
      selection: { temporaryUri: 'content://provider/photo/42', mimeType: null, reportedBytes: 4321 },
    });
  });

  it('maps picker/provider launch errors to PICKER_FAILED without inventing a permission failure', async () => {
    const adapter = new ExpoImagePickerAdapter({
      launchImageLibraryAsync: async () => { throw new Error('provider failed'); },
    });
    const result = await adapter.pickOne();
    expect(result.kind).toBe('failed');
    if (result.kind !== 'failed') throw new Error('expected failure');
    expect(result.error.code).toBe('PICKER_FAILED');
  });

  it('opens only http(s) URLs and maps native failures to OPEN_FAILED', async () => {
    const opened: string[] = [];
    const opener = new ReactNativeLinkOpener(async url => { opened.push(url); });
    await expect(opener.openHttpUrl('https://example.com')).resolves.toEqual({ ok: true, value: undefined });
    expect(opened).toEqual(['https://example.com']);
    const malformed = await opener.openHttpUrl('https://');
    expect(malformed.ok).toBe(false);
    const blocked = await opener.openHttpUrl('file:///etc/passwd');
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe('OPEN_FAILED');

    const failing = new ReactNativeLinkOpener(async () => { throw new Error('native fail'); });
    const result = await failing.openHttpUrl('http://example.com');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('OPEN_FAILED');
  });
});
