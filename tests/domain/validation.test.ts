import { describe, expect, it } from 'vitest';
import { validateCreateInput, validateQuery, validateUpdateInput } from '../../src/domain';

describe('domain validation and normalization', () => {
  it('trims persisted type-specific text while preserving URL schemes and normalizing tags', () => {
    const note = validateCreateInput({
      type: 'note', title: '  Title  ', body: '  Body text  ', tags: ['  Work  ', 'work', '  Deep   Focus  '],
    });
    expect(note).toEqual({
      ok: true,
      value: {
        type: 'note', title: 'Title', body: 'Body text',
        tags: {
          display: ['Work', 'Deep Focus'],
          records: [{ key: 'work', display: 'Work' }, { key: 'deep focus', display: 'Deep Focus' }],
        },
      },
    });

    const link = validateCreateInput({ type: 'link', title: ' Link ', url: '  https://example.com/a  ', tags: [] });
    expect(link.ok && link.value.type === 'link' ? link.value.url : null).toBe('https://example.com/a');

    const image = validateCreateInput({
      type: 'image', title: ' Photo ', caption: '   ', tags: [],
      image: { temporaryUri: 'file:///tmp/a.jpg', mimeType: 'image/jpeg' },
    });
    expect(image.ok && image.value.type === 'image' ? image.value.caption : 'wrong').toBeNull();
  });

  it('applies the same normalized comparison key to search and tag filters', () => {
    const query = validateQuery({ archived: false, text: '  DEEP   Focus ', type: 'all', tagKey: '  WoRK ' });
    expect(query).toEqual({ ok: true, value: { archived: false, textKey: 'deep focus', type: 'all', tagKey: 'work' } });
  });

  it('counts Unicode limits by code point rather than UTF-16 code unit', () => {
    const accepted = validateCreateInput({
      type: 'note', title: '😀'.repeat(120), body: 'Body', tags: ['😀'.repeat(24)],
    });
    expect(accepted.ok).toBe(true);

    const rejectedTitle = validateCreateInput({
      type: 'note', title: '😀'.repeat(121), body: 'Body', tags: [],
    });
    expect(rejectedTitle.ok).toBe(false);
    if (!rejectedTitle.ok) expect(rejectedTitle.error.field).toBe('title');

    const rejectedTag = validateCreateInput({
      type: 'note', title: 'Title', body: 'Body', tags: ['😀'.repeat(25)],
    });
    expect(rejectedTag.ok).toBe(false);
    if (!rejectedTag.ok) expect(rejectedTag.error.field).toBe('tags');
  });

  it('normalizes update values without changing omitted fields', () => {
    const result = validateUpdateInput({
      id: 'id-1', type: 'image', expectedUpdatedAt: 1,
      changes: { title: '  New title ', caption: '  Caption  ' },
    });
    expect(result).toEqual({
      ok: true,
      value: { id: 'id-1', type: 'image', expectedUpdatedAt: 1, changes: { title: 'New title', caption: 'Caption' } },
    });
  });
});
