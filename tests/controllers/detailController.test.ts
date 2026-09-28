import { describe, expect, it } from 'vitest';
import { fixtureSpec } from '../../src/contracts/fixtureSpec';
import type { Result, SavedItem } from '../../src/contracts';
import { createDetailController } from '../../src/controllers';
import { deferred, flushAsync, MockImageStore, MockItemRepository, MockLinkOpener, MockMailbox, MockNavigation } from '../mocks/controllerMocks';

const note: SavedItem = { ...fixtureSpec.note, url: null, imagePath: null };
const link: SavedItem = { ...fixtureSpec.link, body: null, imagePath: null };
const image: SavedItem = { ...fixtureSpec.image, url: null };

describe('DetailController', () => {
  it('shows image metadata with a missing image state', async () => {
    const repository = new MockItemRepository();
    repository.getImpl = async () => ({ ok: true, value: image });
    const images = new MockImageStore();
    images.resolveImpl = async () => ({ ok: true, value: { kind: 'missing' } });
    const controller = createDetailController(image.id, 'Inbox', repository, images,
      new MockLinkOpener(), new MockMailbox(), new MockNavigation());

    await controller.refresh();
    expect(controller.props.state).toEqual({ kind: 'ready', item: image, image: { kind: 'missing' } });
  });

  it('keeps image metadata usable on resolution failure and recovers on retry', async () => {
    const repository = new MockItemRepository();
    repository.getImpl = async () => ({ ok: true, value: image });
    const images = new MockImageStore();
    let attempts = 0;
    images.resolveImpl = async () => ++attempts === 1
      ? ({ ok: false, error: { code: 'OPEN_FAILED', message: 'Storage temporarily unavailable.', field: 'image' } } as const)
      : ({ ok: true, value: { kind: 'available', uri: 'file:///images/recovered.jpg' } } as const);
    const controller = createDetailController(image.id, 'Inbox', repository, images,
      new MockLinkOpener(), new MockMailbox(), new MockNavigation());

    await controller.refresh();
    expect(controller.props.state).toEqual({
      kind: 'ready',
      item: image,
      image: { kind: 'unavailable', error: { code: 'OPEN_FAILED', message: 'Storage temporarily unavailable.', field: 'image' } },
    });

    controller.props.onRetry();
    await flushAsync();
    await flushAsync();
    expect(controller.props.state).toEqual({
      kind: 'ready',
      item: image,
      image: { kind: 'available', uri: 'file:///images/recovered.jpg' },
    });
  });

  it('guards duplicate delete confirmation taps and publishes after repository success', async () => {
    const repository = new MockItemRepository();
    repository.getImpl = async () => ({ ok: true, value: note });
    const pending = deferred<Result<void>>();
    repository.removeImpl = () => pending.promise;
    const mailbox = new MockMailbox();
    const navigation = new MockNavigation();
    const controller = createDetailController(note.id, 'Inbox', repository, new MockImageStore(),
      new MockLinkOpener(), mailbox, navigation);
    await controller.refresh();

    controller.props.onRequestDelete();
    expect(controller.props.deleteConfirmationOpen).toBe(true);
    controller.props.onConfirmDelete();
    controller.props.onConfirmDelete();
    expect(repository.removeCalls).toHaveLength(1);
    expect(controller.props.mutation).toEqual({ kind: 'pending', operation: 'delete' });
    expect(mailbox.published).toHaveLength(0);

    pending.resolve({ ok: true, value: undefined });
    await flushAsync();
    expect(mailbox.published[0]).toMatchObject({ destination: 'Inbox', operation: 'delete', itemId: note.id });
    expect(navigation.calls.at(-1)).toEqual({ name: 'returnToList', args: ['Inbox'] });
  });

  it('blocks back navigation and duplicate archive taps while a mutation is pending', async () => {
    const repository = new MockItemRepository();
    repository.getImpl = async () => ({ ok: true, value: note });
    const pending = deferred<Result<SavedItem>>();
    repository.setArchivedImpl = () => pending.promise;
    const mailbox = new MockMailbox();
    const navigation = new MockNavigation();
    const controller = createDetailController(note.id, 'Inbox', repository, new MockImageStore(),
      new MockLinkOpener(), mailbox, navigation);
    await controller.refresh();

    controller.props.onArchiveOrRestore();
    controller.props.onArchiveOrRestore();
    controller.props.onBack();
    expect(repository.setArchivedCalls).toHaveLength(1);
    expect(navigation.calls).toHaveLength(0);

    const archived: SavedItem = { ...note, archived: true, updatedAt: note.updatedAt + 1 };
    pending.resolve({ ok: true, value: archived });
    await flushAsync();
    expect(mailbox.published[0]).toMatchObject({ destination: 'Inbox', operation: 'archive', itemId: note.id });
    expect(navigation.calls).toEqual([{ name: 'returnToList', args: ['Inbox'] }]);
  });

  it('shows conflict feedback, reloads latest metadata, and retains failed mutation state', async () => {
    const repository = new MockItemRepository();
    const latest: SavedItem = { ...note, title: 'Latest title', updatedAt: note.updatedAt + 1 };
    let gets = 0;
    repository.getImpl = async () => ({ ok: true, value: ++gets === 1 ? note : latest });
    repository.setArchivedImpl = async () => ({ ok: false, error: { code: 'CONFLICT', message: 'Stale.' } });
    const controller = createDetailController(note.id, 'Inbox', repository, new MockImageStore(),
      new MockLinkOpener(), new MockMailbox(), new MockNavigation());
    await controller.refresh();

    controller.props.onArchiveOrRestore();
    await flushAsync();
    expect(controller.props.state.kind).toBe('ready');
    if (controller.props.state.kind !== 'ready') throw new Error('expected ready');
    expect(controller.props.state.item.title).toBe('Latest title');
    expect(controller.props.mutation.kind).toBe('failed');
    expect(controller.props.feedback?.kind).toBe('error');
  });

  it('surfaces external-link adapter failure as feedback', async () => {
    const repository = new MockItemRepository();
    repository.getImpl = async () => ({ ok: true, value: link });
    const opener = new MockLinkOpener();
    opener.result = { ok: false, error: { code: 'OPEN_FAILED', message: 'No browser.' } };
    const controller = createDetailController(link.id, 'Inbox', repository, new MockImageStore(),
      opener, new MockMailbox(), new MockNavigation());
    await controller.refresh();

    controller.props.onOpenLink();
    await flushAsync();
    expect(opener.calls).toEqual([link.url]);
    expect(controller.props.feedback).toEqual({ kind: 'error', message: 'No browser.' });
  });
});
