import { describe, expect, it } from 'vitest';
import { fixtureSpec } from '../../src/contracts/fixtureSpec';
import type { SavedItem } from '../../src/contracts';
import { createInboxController } from '../../src/controllers';
import { createMutationMailbox } from '../../src/navigation/MutationMailbox';
import { deferred, flushAsync, MockImageStore, MockItemRepository, MockMailbox, MockNavigation } from '../mocks/controllerMocks';

const note: SavedItem = { ...fixtureSpec.note, url: null, imagePath: null };
const image: SavedItem = { ...fixtureSpec.image, url: null };

describe('InboxController', () => {
  it('builds list rows with resolved image state and keeps metadata for a missing file', async () => {
    const repository = new MockItemRepository();
    repository.listImpl = async () => ({ ok: true, value: [image, note] });
    const images = new MockImageStore();
    images.resolveImpl = async () => ({ ok: true, value: { kind: 'missing' } });
    const controller = createInboxController(repository, images, new MockMailbox(), new MockNavigation());

    await controller.refresh();

    expect(controller.props.state.kind).toBe('ready');
    if (controller.props.state.kind !== 'ready') throw new Error('expected ready');
    expect(controller.props.state.rows).toHaveLength(2);
    expect(controller.props.state.rows[0]).toEqual({ item: image, image: { kind: 'missing' } });
    expect(controller.props.state.rows[1]).toEqual({ item: note, image: { kind: 'none' } });
    expect(controller.props.state.availableTags).toEqual(['Ideas', 'Study']);
  });

  it('ignores a stale search response that finishes after a newer query', async () => {
    const repository = new MockItemRepository();
    const oldResult = deferred<Awaited<ReturnType<typeof repository.list>>>();
    const newResult = deferred<Awaited<ReturnType<typeof repository.list>>>();
    repository.listImpl = query => query.text === 'old' ? oldResult.promise : newResult.promise;
    const controller = createInboxController(repository, new MockImageStore(), new MockMailbox(), new MockNavigation());

    controller.props.onQueryChange({ archived: false, text: 'old', type: 'all', tagKey: null });
    controller.props.onQueryChange({ archived: false, text: 'new', type: 'all', tagKey: null });

    newResult.resolve({ ok: true, value: [note] });
    await flushAsync();
    expect(controller.props.state.kind).toBe('ready');
    if (controller.props.state.kind !== 'ready') throw new Error('expected ready');
    expect(controller.props.state.query.text).toBe('new');
    expect(controller.props.state.rows[0].item.id).toBe(note.id);

    oldResult.resolve({ ok: true, value: [] });
    await flushAsync();
    expect(controller.props.state.kind).toBe('ready');
    if (controller.props.state.kind !== 'ready') throw new Error('expected ready');
    expect(controller.props.state.query.text).toBe('new');
    expect(controller.props.state.rows).toHaveLength(1);
  });

  it('consumes success feedback once but refreshes on every focus', async () => {
    const repository = new MockItemRepository();
    repository.listImpl = async () => ({ ok: true, value: [note] });
    const mailbox = createMutationMailbox();
    mailbox.publish({ destination: 'Inbox', operation: 'archive', itemId: note.id,
      feedback: { kind: 'success', message: 'Item archived.' } });
    const controller = createInboxController(repository, new MockImageStore(), mailbox, new MockNavigation());

    await controller.onFocus();
    expect(repository.listCalls).toHaveLength(1);
    expect(controller.props.feedback).toEqual({ kind: 'success', message: 'Item archived.' });

    await controller.onFocus();
    expect(repository.listCalls).toHaveLength(2);
    expect(mailbox.consume('Inbox')).toEqual([]);
  });

  it('enforces the inbox archived flag even if a caller supplies the wrong value', async () => {
    const repository = new MockItemRepository();
    const controller = createInboxController(repository, new MockImageStore(), new MockMailbox(), new MockNavigation());
    controller.props.onQueryChange({ archived: true, text: '', type: 'all', tagKey: null });
    await flushAsync();
    expect(repository.listCalls[0]?.archived).toBe(false);
  });

  it('keeps the selected tag visible and clearable when another filter produces zero matches', async () => {
    const repository = new MockItemRepository();
    repository.listImpl = async query => {
      if (query.text === 'nothing') return { ok: true, value: [] };
      return { ok: true, value: [note] };
    };
    const controller = createInboxController(repository, new MockImageStore(), new MockMailbox(), new MockNavigation());

    await controller.refresh();
    if (controller.props.state.kind !== 'ready') throw new Error('expected ready');
    const selectedTag = controller.props.state.availableTags[0];
    expect(selectedTag).toBe('Study');

    controller.props.onQueryChange({ archived: false, text: '', type: 'all', tagKey: 'study' });
    await flushAsync();
    controller.props.onQueryChange({ archived: false, text: 'nothing', type: 'all', tagKey: 'study' });
    await flushAsync();
    if (controller.props.state.kind !== 'ready') throw new Error('expected ready');
    expect(controller.props.state.rows).toEqual([]);
    expect(controller.props.state.query.tagKey).toBe('study');
    expect(controller.props.state.availableTags).toContain('Study');

    controller.props.onQueryChange({ ...controller.props.state.query, tagKey: null });
    await flushAsync();
    expect(repository.listCalls.at(-1)?.tagKey).toBeNull();
    controller.props.onQueryChange({ archived: false, text: '', type: 'all', tagKey: null });
    await flushAsync();
    if (controller.props.state.kind !== 'ready') throw new Error('expected ready');
    expect(controller.props.state.rows[0]?.item.id).toBe(note.id);
  });
});
