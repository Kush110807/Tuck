import { describe, expect, it } from 'vitest';
import { detectSupportedImageFormat } from '../../src/domain/imageFormat';

function pngBytes(): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  return bytes;
}

function jpegBytes(): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0xff, 0xd9]);
}

function webpBytes(): Uint8Array {
  const bytes = new Uint8Array(20);
  bytes.set([0x52, 0x49, 0x46, 0x46, 12, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
  return bytes;
}

describe('detectSupportedImageFormat', () => {
  it('detects the supported formats from bytes rather than filename or MIME metadata', () => {
    expect(detectSupportedImageFormat(pngBytes())).toEqual({ mimeType: 'image/png', extension: 'png' });
    expect(detectSupportedImageFormat(jpegBytes())).toEqual({ mimeType: 'image/jpeg', extension: 'jpg' });
    expect(detectSupportedImageFormat(webpBytes())).toEqual({ mimeType: 'image/webp', extension: 'webp' });
  });

  it('rejects unsupported and obviously truncated signatures', () => {
    expect(detectSupportedImageFormat(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBeNull();
    expect(detectSupportedImageFormat(pngBytes().slice(0, 12))).toBeNull();
    expect(detectSupportedImageFormat(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
  });
});
