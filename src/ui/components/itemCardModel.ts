import type { ItemListRow, SavedItem } from '../../contracts';
import { getImagePresentation, type ImagePresentation } from './imagePresentation';

const typeLabels = { note: 'Note', link: 'Link', image: 'Image' } as const;

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  return new Date(timestamp).toLocaleDateString();
}

export function getItemPreview(item: SavedItem): string {
  if (item.type === 'note') return item.body;
  if (item.type === 'link') return item.url;
  return item.body ?? 'Saved image';
}

export type ItemCardPresentation = {
  typeLabel: 'Note' | 'Link' | 'Image';
  preview: string;
  relativeTime: string;
  visibleTags: readonly string[];
  remainingTags: number;
  accessibilityLabel: string;
  image: ImagePresentation | null;
};

/** Pure view-model for compact card content and accessibility semantics. */
export function getItemCardPresentation(
  row: ItemListRow,
  renderFailed = false,
  now = Date.now(),
): ItemCardPresentation {
  const { item } = row;
  const typeLabel = typeLabels[item.type];
  const preview = getItemPreview(item);
  const visibleTags = item.tags.slice(0, 2);
  const remainingTags = Math.max(0, item.tags.length - visibleTags.length);
  const image = item.type === 'image' ? getImagePresentation(row.image, renderFailed) : null;
  const tagLabel = item.tags.length > 0 ? ` Tags: ${item.tags.join(', ')}.` : '';
  const imageStatusLabel = image?.kind === 'fallback' && image.reason !== 'none' ? ` ${image.title}.` : '';
  const archiveLabel = item.archived ? ' Archived.' : '';

  return {
    typeLabel,
    preview,
    relativeTime: formatRelativeTime(item.updatedAt, now),
    visibleTags,
    remainingTags,
    accessibilityLabel: `${typeLabel}: ${item.title}.${imageStatusLabel}${tagLabel}${archiveLabel}`,
    image,
  };
}
