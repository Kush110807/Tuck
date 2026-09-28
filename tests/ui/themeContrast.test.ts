import { describe, expect, it } from 'vitest';
import { colors } from '../../src/theme/tokens';

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/.{2}/g)?.map(value => parseInt(value, 16) / 255) ?? [];
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground: string, background: string): number {
  const first = luminance(foreground);
  const second = luminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

const semanticSurfaces = [colors.background, colors.surface, colors.surfaceMuted] as const;

describe('small semantic text contrast', () => {
  it.each(semanticSurfaces)('keeps tertiaryText at 4.5:1 or better on %s', background => {
    expect(contrastRatio(colors.tertiaryText, background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(semanticSurfaces)('keeps secondaryText at 4.5:1 or better on %s', background => {
    expect(contrastRatio(colors.secondaryText, background)).toBeGreaterThanOrEqual(4.5);
  });
});
