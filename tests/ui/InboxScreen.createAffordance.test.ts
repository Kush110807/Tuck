import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const inboxSource = readFileSync(new URL('../../src/ui/screens/InboxScreen.tsx', import.meta.url), 'utf8');
const listSource = readFileSync(new URL('../../src/ui/screens/ListScreenView.tsx', import.meta.url), 'utf8');

function expectPersistentCreateControls(): void {
  expect(inboxSource).toContain('headerActions={(');
  expect(inboxSource).toContain('label="Add note"');
  expect(inboxSource).toContain("onAdd('note')");
  expect(inboxSource).toContain('label="Add link"');
  expect(inboxSource).toContain("onAdd('link')");
  expect(inboxSource).toContain('label="Add image"');
  expect(inboxSource).toContain("onAdd('image')");
  expect(inboxSource).not.toContain('emptyAction=');

  const headerRender = listSource.indexOf('<View style={styles.headerActions}>{headerActions}</View>');
  const firstListStateBranch = listSource.indexOf("state.kind === 'loading'");
  expect(headerRender).toBeGreaterThan(-1);
  expect(firstListStateBranch).toBeGreaterThan(-1);
  expect(headerRender).toBeLessThan(firstListStateBranch);
}

describe('Inbox persistent create affordance', () => {
  it('is available when Inbox is empty', () => {
    expectPersistentCreateControls();
  });

  it('remains available when one or more active items are rendered', () => {
    expectPersistentCreateControls();
    expect(inboxSource).not.toContain('rows.length === 0');
  });

  it('does not disappear after item 1 is created and saved before item 2 is started', () => {
    expectPersistentCreateControls();
    expect(inboxSource).not.toContain("state.kind === 'ready'");
  });

  it.each(['all', 'note', 'image'])('keeps the general creation path under the %s type filter', () => {
    expectPersistentCreateControls();
    expect(inboxSource).not.toContain('query.type');
  });
});
