import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from '../../src/ui/components/itemCardModel';

describe('compact ItemCard time presentation', () => {
  const now = 2_000_000_000_000;

  it.each([
    [now - 15_000, 'now'],
    [now - 5 * 60_000, '5m'],
    [now - 3 * 60 * 60_000, '3h'],
    [now - 2 * 24 * 60 * 60_000, '2d'],
    [now - 14 * 24 * 60 * 60_000, '2w'],
  ])('formats %s as %s', (timestamp, expected) => {
    expect(formatRelativeTime(timestamp, now)).toBe(expected);
  });
});
