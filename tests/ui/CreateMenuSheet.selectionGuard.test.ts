import { describe, expect, it, vi } from 'vitest';
import type { ItemType } from '../../src/contracts';
import { createSelectionGuard } from '../../src/ui/components/createSelectionGuard';

const types: readonly ItemType[] = ['note', 'link', 'image'];

describe('CreateMenuSheet synchronous selection guard', () => {
  it.each(types)('allows one %s selection and ignores immediate repeated activation', type => {
    const guard = createSelectionGuard();
    const onChoose = vi.fn();

    guard.reset(); // mirrors Modal onShow for a fresh sheet presentation
    expect(guard.choose(type, onChoose)).toBe(true);
    expect(guard.choose(type, onChoose)).toBe(false);

    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose).toHaveBeenCalledWith(type);
  });

  it('blocks a different option after the first selection, then allows one new selection after reopen', () => {
    const guard = createSelectionGuard();
    const onChoose = vi.fn();

    guard.reset();
    expect(guard.choose('note', onChoose)).toBe(true);
    expect(guard.choose('image', onChoose)).toBe(false);
    expect(onChoose.mock.calls).toEqual([['note']]);

    guard.reset(); // mirrors showing the create sheet again later
    expect(guard.choose('image', onChoose)).toBe(true);
    expect(guard.choose('link', onChoose)).toBe(false);
    expect(onChoose.mock.calls).toEqual([['note'], ['image']]);
  });
});
