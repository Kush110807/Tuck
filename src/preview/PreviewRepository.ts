import type { SavedItem } from '../contracts';
import { previewItems } from './previewData';

/** PREVIEW ONLY: static data for A's visual states, not a persistence implementation. */
export function getPreviewItems(): readonly SavedItem[] { return previewItems; }
