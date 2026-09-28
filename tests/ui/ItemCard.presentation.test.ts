import { describe, expect, it } from 'vitest';
import type { ItemListRow, SavedItem } from '../../src/contracts';
import { getItemCardPresentation } from '../../src/ui/components/itemCardModel';

const now = 2_000_000_000_000;

function imageItem(overrides: Partial<SavedItem> = {}): SavedItem {
  return {
    id: 'image-1',
    type: 'image',
    title: 'Reference image',
    body: 'Warm counter layout',
    url: null,
    imagePath: 'images/reference.png',
    tags: ['Design', 'Cafe', 'Lighting', 'Mumbai'],
    createdAt: now - 10_000,
    updatedAt: now - 5 * 60_000,
    archived: false,
    ...overrides,
  } as SavedItem;
}

describe('compact ItemCard presentation model', () => {
  it('uses a compact image thumbnail model and truncates visible tags with a +N count', () => {
    const row: ItemListRow = {
      item: imageItem(),
      image: { kind: 'available', uri: 'file:///reference.png' },
    };

    const presentation = getItemCardPresentation(row, false, now);

    expect(presentation.image).toEqual({ kind: 'image', uri: 'file:///reference.png' });
    expect(presentation.visibleTags).toEqual(['Design', 'Cafe']);
    expect(presentation.remainingTags).toBe(2);
    expect(presentation.relativeTime).toBe('5m');
  });

  it('keeps semantic item metadata when the backing image is missing', () => {
    const row: ItemListRow = {
      item: imageItem(),
      image: { kind: 'missing' },
    };

    const presentation = getItemCardPresentation(row, false, now);

    expect(presentation.typeLabel).toBe('Image');
    expect(presentation.preview).toBe('Warm counter layout');
    expect(presentation.visibleTags).toEqual(['Design', 'Cafe']);
    expect(presentation.remainingTags).toBe(2);
    expect(presentation.image).toMatchObject({
      kind: 'fallback',
      reason: 'missing',
      title: 'Image file missing',
    });
    expect(presentation.accessibilityLabel).toContain('Image: Reference image');
    expect(presentation.accessibilityLabel).toContain('Image file missing');
    expect(presentation.accessibilityLabel).toContain('Tags: Design, Cafe, Lighting, Mumbai');
  });

  it('includes archived status in the accessible card label without removing content', () => {
    const row: ItemListRow = {
      item: imageItem({ archived: true }),
      image: { kind: 'missing' },
    };

    const presentation = getItemCardPresentation(row, false, now);

    expect(presentation.accessibilityLabel).toContain('Archived');
    expect(presentation.accessibilityLabel).toContain('Reference image');
  });
});
