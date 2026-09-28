import type {
  AppError,
  ImageStore,
  ImageViewState,
  ItemListRow,
  SavedItem,
} from '../contracts';

export function unexpectedRepositoryError(message = 'The local item store could not be reached.'): AppError {
  return { code: 'DB_FAILED', message };
}

export function normalizeTagDisplay(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

export function tagKey(value: string): string {
  return normalizeTagDisplay(value).toLowerCase();
}

export function collectAvailableTags(items: readonly SavedItem[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    for (const tag of item.tags) {
      const display = normalizeTagDisplay(tag);
      const key = display.toLowerCase();
      if (!display || seen.has(key)) continue;
      seen.add(key);
      result.push(display);
    }
  }
  return result;
}

export async function resolveImageState(
  item: SavedItem,
  imageStore: ImageStore,
  degradeResolutionFailureToMissing = false,
): Promise<{ ok: true; value: ImageViewState } | { ok: false; error: AppError }> {
  if (item.type !== 'image') return { ok: true, value: { kind: 'none' } };
  try {
    const result = await imageStore.resolve(item.imagePath);
    if (!result.ok) {
      if (degradeResolutionFailureToMissing) return { ok: true, value: { kind: 'missing' } };
      return result;
    }
    return result.value.kind === 'available'
      ? { ok: true, value: { kind: 'available', uri: result.value.uri } }
      : { ok: true, value: { kind: 'missing' } };
  } catch {
    const error: AppError = { code: 'INVALID_IMAGE_PATH', message: 'The saved image could not be resolved.' };
    return degradeResolutionFailureToMissing ? { ok: true, value: { kind: 'missing' } } : { ok: false, error };
  }
}

export async function buildListRows(
  items: readonly SavedItem[],
  imageStore: ImageStore,
): Promise<readonly ItemListRow[]> {
  return Promise.all(items.map(async item => {
    const image = await resolveImageState(item, imageStore, true);
    return { item, image: image.ok ? image.value : { kind: 'missing' } } as ItemListRow;
  }));
}
