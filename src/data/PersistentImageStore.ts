import { Directory, File, Paths } from 'expo-file-system';
import { Image } from 'react-native';
import type { AppError, ImageSelection, ImageStore, RelativeImagePath, Result } from '../contracts';
import { detectSupportedImageFormat } from '../domain/imageFormat';
import { MAX_IMAGE_BYTES, validateImageSelectionShape } from '../domain/validation';

const IMAGE_DIRECTORY = 'images';
const SAFE_IMAGE_PATH = /^images\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpg|jpeg|png|webp)$/i;

type ImageDecoder = (uri: string) => Promise<{ width: number; height: number }>;

function imageError(code: AppError['code'], message: string): AppError {
  return { code, message, field: 'image' };
}

function createUuid(): string {
  const cryptoObject = (globalThis as typeof globalThis & { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoObject?.randomUUID) return cryptoObject.randomUUID();

  // Hermes environments without randomUUID still need collision-resistant local names.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, token => {
    const random = Math.floor(Math.random() * 16);
    const value = token === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function isSafeAppImagePath(path: string): path is RelativeImagePath {
  if (!SAFE_IMAGE_PATH.test(path)) return false;
  if (path.includes('..') || path.includes('\\') || path.includes('%') || path.includes('?') || path.includes('#')) return false;
  return true;
}

async function isNativeDecodable(uri: string, decodeImage: ImageDecoder): Promise<boolean> {
  try {
    const dimensions = await decodeImage(uri);
    return Number.isFinite(dimensions.width) && dimensions.width > 0 &&
      Number.isFinite(dimensions.height) && dimensions.height > 0;
  } catch {
    return false;
  }
}

/** Persistent, app-owned image storage rooted at the Expo document directory. */
export class PersistentImageStore implements ImageStore {
  private readonly imagesDirectory: Directory;

  constructor(
    private readonly decodeImage: ImageDecoder = uri => Image.getSize(uri),
    storageNamespace: string | null = null,
  ) {
    this.imagesDirectory = storageNamespace
      ? new Directory(Paths.document, 'profiles', storageNamespace, IMAGE_DIRECTORY)
      : new Directory(Paths.document, IMAGE_DIRECTORY);
  }

  /** B-internal startup hook used by SQLiteItemRepository before reconciliation. */
  prepare(): Result<void> {
    try {
      this.imagesDirectory.create({ idempotent: true, intermediates: true });
      return { ok: true, value: undefined };
    } catch {
      return { ok: false, error: imageError('IMAGE_COPY_FAILED', 'Could not prepare app image storage.') };
    }
  }

  async copySelected(selection: ImageSelection): Promise<Result<RelativeImagePath>> {
    const shape = validateImageSelectionShape(selection);
    if (!shape.ok) return shape;

    const prepared = this.prepare();
    if (!prepared.ok) return prepared;

    let source: File;
    let bytes: Uint8Array;
    try {
      source = new File(selection.temporaryUri);
      if (!source.exists) {
        return { ok: false, error: imageError('IMAGE_COPY_FAILED', 'The selected image is no longer available.') };
      }
      if (typeof source.size === 'number' && source.size > MAX_IMAGE_BYTES) {
        return {
          ok: false,
          error: imageError('IMAGE_TOO_LARGE', `Image must be 10 MiB or smaller; selected file is ${source.size} bytes.`),
        };
      }
      bytes = await source.bytes();
      if (bytes.byteLength > MAX_IMAGE_BYTES) {
        return {
          ok: false,
          error: imageError('IMAGE_TOO_LARGE', `Image must be 10 MiB or smaller; selected file is ${bytes.byteLength} bytes.`),
        };
      }
    } catch {
      return { ok: false, error: imageError('IMAGE_COPY_FAILED', 'Could not read the selected image.') };
    }

    const detected = detectSupportedImageFormat(bytes);
    if (!detected) {
      return { ok: false, error: imageError('IMAGE_UNSUPPORTED', 'The selected file is not a valid JPEG, PNG or WebP image.') };
    }
    if (selection.mimeType && selection.mimeType !== detected.mimeType) {
      return { ok: false, error: imageError('IMAGE_UNSUPPORTED', 'The selected image type does not match its file contents.') };
    }
    if (!(await isNativeDecodable(source.uri, this.decodeImage))) {
      return { ok: false, error: imageError('IMAGE_UNSUPPORTED', 'The selected image is corrupt or cannot be decoded.') };
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const filename = `${createUuid()}.${detected.extension}`;
      const relativePath = `${IMAGE_DIRECTORY}/${filename}` as RelativeImagePath;
      const destination = new File(this.imagesDirectory, filename);
      if (destination.exists) continue;

      try {
        await source.copy(destination);
        if (!destination.exists) throw new Error('Image copy did not create a destination file.');
        if (typeof destination.size === 'number' && destination.size > MAX_IMAGE_BYTES) {
          try { destination.delete(); } catch { /* best effort; repository reconciliation catches leftovers */ }
          return { ok: false, error: imageError('IMAGE_TOO_LARGE', 'Image must be 10 MiB or smaller.') };
        }
        if (!(await isNativeDecodable(destination.uri, this.decodeImage))) {
          try { destination.delete(); } catch { /* reconciliation catches a failed cleanup */ }
          return { ok: false, error: imageError('IMAGE_UNSUPPORTED', 'The copied image could not be decoded.') };
        }
        return { ok: true, value: relativePath };
      } catch {
        try {
          if (destination.exists) destination.delete();
        } catch {
          // An interrupted/failed copy can be reconciled as unreferenced on next successful startup.
        }
        return { ok: false, error: imageError('IMAGE_COPY_FAILED', 'Could not copy the selected image into app storage.') };
      }
    }

    return { ok: false, error: imageError('IMAGE_COPY_FAILED', 'Could not allocate a unique app image filename.') };
  }

  async resolve(path: RelativeImagePath): Promise<Result<{ kind: 'available'; uri: string } | { kind: 'missing' }>> {
    if (!isSafeAppImagePath(path)) {
      return { ok: false, error: imageError('INVALID_IMAGE_PATH', 'Stored image path is outside app image storage.') };
    }

    try {
      const filename = path.slice(`${IMAGE_DIRECTORY}/`.length);
      const file = new File(this.imagesDirectory, filename);
      if (!file.exists) return { ok: true, value: { kind: 'missing' } };
      return { ok: true, value: { kind: 'available', uri: file.uri } };
    } catch {
      return { ok: false, error: imageError('OPEN_FAILED', 'Could not resolve the stored image.') };
    }
  }

  async removeFile(path: RelativeImagePath): Promise<Result<void>> {
    if (!isSafeAppImagePath(path)) {
      return { ok: false, error: imageError('INVALID_IMAGE_PATH', 'Stored image path is outside app image storage.') };
    }

    try {
      const filename = path.slice(`${IMAGE_DIRECTORY}/`.length);
      const file = new File(this.imagesDirectory, filename);
      if (file.exists) file.delete();
      return { ok: true, value: undefined };
    } catch {
      return { ok: false, error: imageError('OPEN_FAILED', 'Could not remove the stored image.') };
    }
  }

  /** B-internal enumeration for interrupted-create reconciliation. */
  listOwnedRelativePaths(): Result<readonly RelativeImagePath[]> {
    const prepared = this.prepare();
    if (!prepared.ok) return prepared;

    try {
      const paths: RelativeImagePath[] = [];
      for (const entry of this.imagesDirectory.list()) {
        if (!(entry instanceof File)) continue;
        const path = `${IMAGE_DIRECTORY}/${entry.name}`;
        if (isSafeAppImagePath(path)) paths.push(path);
      }
      paths.sort();
      return { ok: true, value: paths };
    } catch {
      return { ok: false, error: imageError('OPEN_FAILED', 'Could not inspect app image storage.') };
    }
  }
}
