import { describe, expect, it } from 'vitest';
import type { ItemQuery, ItemType, SavedItem } from '../../src/contracts';
import { fixtureSpec } from '../../src/contracts/fixtureSpec';
import { createInboxController } from '../../src/controllers/listControllers';
import { createMutationMailbox } from '../../src/navigation/MutationMailbox';
import { flushAsync, MockImageStore, MockItemRepository, MockNavigation } from '../mocks/controllerMocks';

const items: SavedItem[] = [
  { ...fixtureSpec.note, url: null, imagePath: null },
  { ...fixtureSpec.link, body: null, imagePath: null },
  { ...fixtureSpec.image, url: null },
];

function matchesQuery(item: SavedItem, query: ItemQuery): boolean {
  if (item.archived !== query.archived) return false;
  if (query.type !== 'all' && item.type !== query.type) return false;
  if (query.tagKey && !item.tags.some(tag => tag.toLowerCase() === query.tagKey)) return false;
  if (query.text.trim()) {
    const haystack = [item.title, item.type === 'note' ? item.body : '', item.type === 'link' ? item.url : '', item.type === 'image' ? item.body ?? '' : '', ...item.tags]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(query.text.trim().toLowerCase())) return false;
  }
  return true;
}

function expectCreateRoutes(navigation: MockNavigation, onAdd: (type: ItemType) => void): void {
  for (const type of ['note', 'link', 'image'] as const) {
    navigation.calls.length = 0;
    onAdd(type);
    expect(navigation.calls).toEqual([{ name: 'openEditor', args: [{ mode: 'create', type, origin: 'Inbox' }] }]);
  }
}

describe('Inbox NEW-01 create reachability', () => {
  it('keeps all create types reachable through loading, empty, populated, filtered, no-match and failed states', async () => {
    const repository = new MockItemRepository();
    const imageStore = new MockImageStore();
    const navigation = new MockNavigation();
    const mailbox = createMutationMailbox();
    let visibleItems: readonly SavedItem[] = [];
    let fail = false;

    repository.listImpl = async query => fail
      ? ({ ok: false, error: { code: 'DB_FAILED', message: 'Recoverable list failure.' } })
      : ({ ok: true, value: visibleItems.filter(item => matchesQuery(item, query)) });

    const controller = createInboxController(repository, imageStore, mailbox, navigation);

    // Initial loading state before the first repository result.
    expect(controller.props.state.kind).toBe('loading');
    expectCreateRoutes(navigation, controller.props.onAdd);

    // Empty ready state.
    await controller.onFocus();
    expect(controller.props.state.kind).toBe('ready');
    expectCreateRoutes(navigation, controller.props.onAdd);

    // One active item.
    visibleItems = items.slice(0, 1);
    await controller.refresh();
    expect(controller.props.state.kind === 'ready' ? controller.props.state.rows.length : -1).toBe(1);
    expectCreateRoutes(navigation, controller.props.onAdd);

    // Multiple active items: the exact NEW-01 regression case.
    visibleItems = items;
    await controller.refresh();
    expect(controller.props.state.kind === 'ready' ? controller.props.state.rows.length : -1).toBe(3);
    expectCreateRoutes(navigation, controller.props.onAdd);

    // Search with results.
    controller.props.onQueryChange({ ...controller.props.state.query, text: 'Expo' });
    await flushAsync();
    expect(controller.props.state.kind === 'ready' ? controller.props.state.rows.length : -1).toBe(1);
    expectCreateRoutes(navigation, controller.props.onAdd);

    // Search with zero results.
    controller.props.onQueryChange({ ...controller.props.state.query, text: 'definitely-not-present' });
    await flushAsync();
    expect(controller.props.state.kind === 'ready' ? controller.props.state.rows.length : -1).toBe(0);
    expectCreateRoutes(navigation, controller.props.onAdd);

    // Every existing type filter.
    for (const type of ['all', 'note', 'link', 'image'] as const) {
      controller.props.onQueryChange({ ...controller.props.state.query, text: '', type, tagKey: null });
      await flushAsync();
      expectCreateRoutes(navigation, controller.props.onAdd);
    }

    // Selected tag.
    controller.props.onQueryChange({ ...controller.props.state.query, type: 'all', tagKey: 'study' });
    await flushAsync();
    expect(controller.props.state.kind === 'ready' ? controller.props.state.rows.length : -1).toBe(1);
    expectCreateRoutes(navigation, controller.props.onAdd);

    // Recoverable list failure with previous rows retained.
    fail = true;
    await controller.refresh();
    expect(controller.props.state.kind).toBe('failed');
    expectCreateRoutes(navigation, controller.props.onAdd);
  });
});
