import type { SavedItem } from '../contracts';
import { fixtureSpec } from '../contracts/fixtureSpec';

/** PREVIEW ONLY. App.tsx must never import this module. */
export const previewItems: readonly SavedItem[] = [
  { ...fixtureSpec.note, url: null, imagePath: null },
  { ...fixtureSpec.link, body: null, imagePath: null },
  { ...fixtureSpec.image, url: null },
  { ...fixtureSpec.archivedNote, url: null, imagePath: null },
];
