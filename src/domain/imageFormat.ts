import type { SupportedImageMimeType } from '../contracts';

export type DetectedImageFormat = Readonly<{
  mimeType: SupportedImageMimeType;
  extension: 'jpg' | 'png' | 'webp';
}>;

function ascii(bytes: Uint8Array, offset: number, value: string): boolean {
  if (offset + value.length > bytes.length) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
}

/**
 * Detects only formats Tuck supports. This establishes byte-level format identity,
 * not decodability; the native image decoder is probed separately before commit.
 */
export function detectSupportedImageFormat(bytes: Uint8Array): DetectedImageFormat | null {
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a &&
    ascii(bytes, 12, 'IHDR')
  ) {
    return { mimeType: 'image/png', extension: 'png' };
  }

  if (
    bytes.length >= 4 &&
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff &&
    bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9
  ) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }

  if (
    bytes.length >= 16 && ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP') &&
    (ascii(bytes, 12, 'VP8 ') || ascii(bytes, 12, 'VP8L') || ascii(bytes, 12, 'VP8X'))
  ) {
    const declaredSize = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24);
    if (declaredSize >= 8 && declaredSize + 8 <= bytes.length) {
      return { mimeType: 'image/webp', extension: 'webp' };
    }
  }

  return null;
}
