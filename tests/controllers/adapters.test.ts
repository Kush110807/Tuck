import { describe, expect, it } from 'vitest';
import { ExpoImagePickerAdapter, ReactNativeLinkOpener } from '../../src/controllers';

describe('controller adapters', () => {
  it('maps image-picker cancellation separately from failure', async () => {
    const adapter = new ExpoImagePickerAdapter({
      requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
      launchImageLibraryAsync: async () => ({ canceled: true, assets: null }),
    });
    await expect(adapter.pickOne()).resolves.toEqual({ kind: 'cancelled' });
  });

  it('maps supported picker assets to ImageSelection and rejects denied permission', async () => {
    const selected = new ExpoImagePickerAdapter({
      requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
      launchImageLibraryAsync: async () => ({
        canceled: false,
        assets: [{ uri: 'file:///tmp/photo.webp', mimeType: 'image/webp', fileSize: 1234 }],
      }),
    });
    await expect(selected.pickOne()).resolves.toEqual({
      kind: 'selected',
      selection: { temporaryUri: 'file:///tmp/photo.webp', mimeType: 'image/webp', reportedBytes: 1234 },
    });

    const denied = new ExpoImagePickerAdapter({
      requestMediaLibraryPermissionsAsync: async () => ({ granted: false }),
      launchImageLibraryAsync: async () => ({ canceled: true, assets: null }),
    });
    expect((await denied.pickOne()).kind).toBe('failed');
  });

  it('opens only http(s) URLs and maps native failures to OPEN_FAILED', async () => {
    const opened: string[] = [];
    const opener = new ReactNativeLinkOpener(async url => { opened.push(url); });
    await expect(opener.openHttpUrl('https://example.com')).resolves.toEqual({ ok: true, value: undefined });
    expect(opened).toEqual(['https://example.com']);
    const blocked = await opener.openHttpUrl('file:///etc/passwd');
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe('OPEN_FAILED');

    const failing = new ReactNativeLinkOpener(async () => { throw new Error('native fail'); });
    const result = await failing.openHttpUrl('http://example.com');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('OPEN_FAILED');
  });
});
