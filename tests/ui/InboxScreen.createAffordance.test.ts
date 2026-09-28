import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createOptions } from '../../src/ui/components/createMenuModel';

const inboxSource = readFileSync(new URL('../../src/ui/screens/InboxScreen.tsx', import.meta.url), 'utf8');

/**
 * Supplemental structural guard. Behavioural reachability across list states lives in
 * tests/controllers/inboxCreateReachability.test.ts; this test only protects the UI
 * placement that makes NEW-01 structurally difficult to reintroduce.
 */
describe('Inbox persistent create affordance structure', () => {
  it('offers exactly the three approved create types', () => {
    expect(createOptions.map(option => option.type)).toEqual(['note', 'link', 'image']);
  });

  it('renders the FAB as an Inbox sibling rather than inside ListScreenView state rendering', () => {
    const listClose = inboxSource.indexOf('/>\n\n      {/* Intentionally outside ListScreenView');
    const fab = inboxSource.indexOf('<FloatingAddButton');
    expect(listClose).toBeGreaterThan(-1);
    expect(fab).toBeGreaterThan(listClose);
    expect(inboxSource).not.toContain('rows.length === 0');
    expect(inboxSource).not.toContain("state.kind === 'ready'");
    expect(inboxSource).not.toContain('query.type');
  });
});
