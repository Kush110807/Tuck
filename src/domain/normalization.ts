const INTERNAL_WHITESPACE = /\s+/gu;

/** Normalization shared by tag storage, tag comparison, and free-text search. */
export function normalizeComparableText(value: string): string {
  return value.normalize('NFKC').trim().replace(INTERNAL_WHITESPACE, ' ');
}

export function toComparisonKey(value: string): string {
  return normalizeComparableText(value).toLowerCase();
}

export type NormalizedTag = Readonly<{ key: string; display: string }>;

/**
 * Empty tags are ignored and duplicate comparison keys keep the first
 * normalized display spelling, exactly as required by CONTRACT_RULES.md.
 */
export function normalizeTags(values: readonly string[]): readonly NormalizedTag[] {
  const seen = new Set<string>();
  const tags: NormalizedTag[] = [];

  for (const raw of values) {
    const display = normalizeComparableText(raw);
    if (!display) continue;

    const key = display.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    tags.push({ key, display });
  }

  return tags;
}
