import type { ItemType } from '../../contracts';
export type CreateOption = {
  type: ItemType;
  label: string;
  description: string;
  icon: 'note' | 'link' | 'image';
};

export const createOptions: readonly CreateOption[] = [
  { type: 'note', label: 'Note', description: 'Save a thought or piece of text', icon: 'note' },
  { type: 'link', label: 'Link', description: 'Keep a website for later', icon: 'link' },
  { type: 'image', label: 'Image', description: 'Save a photo with context', icon: 'image' },
];
