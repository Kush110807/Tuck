import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixtureSpec } from '../../src/contracts/fixtureSpec';

describe('frozen shared fixture', () => {
  it('has distinct identifiers, stable timestamps and a bundled PNG', () => {
    const items = [fixtureSpec.note, fixtureSpec.link, fixtureSpec.image, fixtureSpec.archivedNote];
    expect(new Set(items.map(item => item.id)).size).toBe(4);
    expect(items.every(item => item.updatedAt > item.createdAt)).toBe(true);
    const bytes = readFileSync(resolve(process.cwd(), fixtureSpec.bundledTestImage));
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });
});
