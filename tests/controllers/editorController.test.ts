import { describe, expect, it } from 'vitest';
import { fixtureSpec } from '../../src/contracts/fixtureSpec';
import type { Result, SavedItem } from '../../src/contracts';
import { createEditorController } from '../../src/controllers';
import { deferred, flushAsync, MockImagePicker, MockImageStore, MockItemRepository, MockMailbox, MockNavigation } from '../mocks/controllerMocks';

const note: SavedItem = { ...fixtureSpec.note, url: null, imagePath: null };
const image: SavedItem = { ...fixtureSpec.image, url: null };

describe('EditorController', () => {

  it('uses domain tag length semantics for multi-code-unit Unicode characters', () => {
    const controller = createEditorController(
      { mode: 'create', type: 'note', origin: 'Inbox' },
      new MockItemRepository(), new MockImageStore(), new MockImagePicker(), new MockMailbox(), new MockNavigation(),
    );
    const tag = '😀'.repeat(24);
    controller.props.onTagEntryChange(tag);
    controller.props.onAddTag();
    if (controller.props.state.kind !== 'ready') throw new Error('expected ready');
    expect(controller.props.state.fieldErrors.tags).toBeUndefined();
    expect(controller.props.state.draft.tags).toEqual([tag]);
  });
  it('tracks dirty state and requires confirmation before discarding', () => {
    const navigation = new MockNavigation();
    const controller = createEditorController(
      { mode: 'create', type: 'note', origin: 'Inbox' },
      new MockItemRepository(), new MockImageStore(), new MockImagePicker(), new MockMailbox(), navigation,
    );

    expect(controller.props.state.kind).toBe('ready');
    controller.props.onTitleChange('Draft');
    if (controller.props.state.kind !== 'ready') throw new Error('expected ready');
    expect(controller.props.state.isDirty).toBe(true);

    controller.props.onCancel();
    if (controller.props.state.kind !== 'ready') throw new Error('expected ready');
    expect(controller.props.state.discardConfirmationOpen).toBe(true);
    expect(navigation.calls).toHaveLength(0);

    controller.props.onKeepEditing();
    if (controller.props.state.kind !== 'ready') throw new Error('expected ready');
    expect(controller.props.state.discardConfirmationOpen).toBe(false);

    controller.props.onCancel();
    controller.props.onConfirmDiscard();
    expect(navigation.calls).toEqual([{ name: 'goBackOrInbox', args: [] }]);
  });

  it('treats picker cancellation as no draft change and selection as dirty with a temporary preview', async () => {
    const picker = new MockImagePicker();
    const controller = createEditorController(
      { mode: 'create', type: 'image', origin: 'Inbox' },
      new MockItemRepository(), new MockImageStore(), picker, new MockMailbox(), new MockNavigation(),
    );

    picker.outcome = { kind: 'cancelled' };
    controller.props.onPickImage();
    await flushAsync();
    if (controller.props.state.kind !== 'ready') throw new Error('expected ready');
    expect(controller.props.state.isDirty).toBe(false);
    expect(controller.props.state.draft.type === 'image' && controller.props.state.draft.image.kind).toBe('none');

    picker.outcome = { kind: 'selected', selection: { temporaryUri: 'file:///tmp/new.png', mimeType: 'image/png', reportedBytes: 42 } };
    controller.props.onPickImage();
    await flushAsync();
    if (controller.props.state.kind !== 'ready') throw new Error('expected ready');
    expect(controller.props.state.isDirty).toBe(true);
    expect(controller.props.state.imagePreview).toEqual({ kind: 'available', uri: 'file:///tmp/new.png' });
  });

  it('synchronously guards duplicate save taps and publishes only after confirmed create', async () => {
    const repository = new MockItemRepository();
    const pending = deferred<Result<SavedItem>>();
    repository.createImpl = () => pending.promise;
    const mailbox = new MockMailbox();
    const navigation = new MockNavigation();
    const controller = createEditorController(
      { mode: 'create', type: 'note', origin: 'Inbox' }, repository,
      new MockImageStore(), new MockImagePicker(), mailbox, navigation,
    );
    controller.props.onTitleChange('Saved title');
    controller.props.onBodyChange('Saved body');

    controller.props.onSave();
    controller.props.onSave();
    expect(repository.createCalls).toHaveLength(1);
    expect(mailbox.published).toHaveLength(0);
    expect(navigation.calls).toHaveLength(0);

    const saved: SavedItem = { ...note, title: 'Saved title', body: 'Saved body', updatedAt: note.updatedAt + 1 };
    pending.resolve({ ok: true, value: saved });
    await flushAsync();
    expect(mailbox.published).toHaveLength(1);
    expect(mailbox.published[0]).toMatchObject({ destination: 'Detail', operation: 'create', itemId: saved.id });
    expect(navigation.calls).toEqual([{ name: 'completeCreate', args: [saved.id] }]);
  });

  it('preserves the draft after conflict and requires explicit overwrite confirmation', async () => {
    const repository = new MockItemRepository();
    const latest: SavedItem = { ...note, body: 'Changed on another screen.', updatedAt: note.updatedAt + 100 };
    let getAttempt = 0;
    repository.getImpl = async () => ({ ok: true, value: ++getAttempt === 1 ? note : latest });
    let updateAttempt = 0;
    repository.updateImpl = async input => {
      updateAttempt += 1;
      if (updateAttempt === 1) return { ok: false, error: { code: 'CONFLICT', message: 'Stale timestamp.' } };
      return { ok: true, value: { ...latest, title: input.changes.title ?? latest.title, updatedAt: latest.updatedAt + 1 } };
    };
    const navigation = new MockNavigation();
    const mailbox = new MockMailbox();
    const controller = createEditorController(
      { mode: 'edit', id: note.id, origin: 'Inbox' }, repository,
      new MockImageStore(), new MockImagePicker(), mailbox, navigation,
    );

    await controller.load();
    controller.props.onTitleChange('My local title');
    controller.props.onSave();
    await flushAsync();

    if (controller.props.state.kind !== 'ready' || controller.props.state.draft.type !== 'note') throw new Error('expected note ready');
    expect(controller.props.state.mutation.kind).toBe('failed');
    expect(controller.props.state.conflictConfirmationOpen).toBe(true);
    expect(controller.props.state.draft.title).toBe('My local title');
    expect(controller.props.state.draft.body).toBe(note.body);

    controller.props.onSave();
    controller.props.onTitleChange('Should be ignored while deciding');
    await flushAsync();
    expect(repository.updateCalls).toHaveLength(1);
    if (controller.props.state.kind !== 'ready' || controller.props.state.draft.type !== 'note') throw new Error('expected note ready');
    expect(controller.props.state.draft.title).toBe('My local title');
    expect(navigation.calls).toHaveLength(0);

    controller.props.onConfirmConflictOverwrite();
    await flushAsync();
    expect(repository.updateCalls).toHaveLength(2);
    expect(repository.updateCalls[1]).toEqual({
      id: note.id,
      type: 'note',
      expectedUpdatedAt: latest.updatedAt,
      changes: { title: 'My local title' },
    });
    expect(mailbox.published[0]).toMatchObject({ destination: 'Detail', operation: 'edit', itemId: note.id });
    expect(navigation.calls.at(-1)).toEqual({ name: 'completeEdit', args: [note.id, 'Inbox'] });
  });

  it('can decline a conflict overwrite without losing the local draft', async () => {
    const repository = new MockItemRepository();
    repository.getImpl = async () => ({ ok: true, value: note });
    repository.updateImpl = async () => ({ ok: false, error: { code: 'CONFLICT', message: 'Stale timestamp.' } });
    const controller = createEditorController(
      { mode: 'edit', id: note.id, origin: 'Inbox' }, repository,
      new MockImageStore(), new MockImagePicker(), new MockMailbox(), new MockNavigation(),
    );

    await controller.load();
    controller.props.onTitleChange('Keep this draft');
    controller.props.onSave();
    await flushAsync();
    controller.props.onCancelConflictOverwrite();

    if (controller.props.state.kind !== 'ready') throw new Error('expected ready');
    expect(controller.props.state.conflictConfirmationOpen).toBe(false);
    expect(controller.props.state.draft.title).toBe('Keep this draft');
    expect(controller.props.state.isDirty).toBe(true);
  });

  it('requires another explicit confirmation if the item changes again before confirmed overwrite', async () => {
    const repository = new MockItemRepository();
    const second: SavedItem = { ...note, title: 'Server v2', updatedAt: note.updatedAt + 100 };
    const third: SavedItem = { ...second, title: 'Server v3', updatedAt: second.updatedAt + 100 };
    let getAttempt = 0;
    repository.getImpl = async () => ({ ok: true, value: [note, second, third][Math.min(getAttempt++, 2)] });
    let updateAttempt = 0;
    repository.updateImpl = async input => {
      updateAttempt += 1;
      if (updateAttempt <= 2) return { ok: false, error: { code: 'CONFLICT', message: 'Stale timestamp.' } };
      return { ok: true, value: { ...third, title: input.changes.title ?? third.title, updatedAt: third.updatedAt + 1 } };
    };
    const navigation = new MockNavigation();
    const controller = createEditorController(
      { mode: 'edit', id: note.id, origin: 'Inbox' }, repository,
      new MockImageStore(), new MockImagePicker(), new MockMailbox(), navigation,
    );

    await controller.load();
    controller.props.onTitleChange('Local draft');
    controller.props.onSave();
    await flushAsync();
    if (controller.props.state.kind !== 'ready') throw new Error('expected ready');
    expect(controller.props.state.conflictConfirmationOpen).toBe(true);

    controller.props.onConfirmConflictOverwrite();
    await flushAsync();
    await flushAsync();
    if (controller.props.state.kind !== 'ready') throw new Error('expected ready');
    expect(controller.props.state.draft.title).toBe('Local draft');
    expect(controller.props.state.conflictConfirmationOpen).toBe(true);
    expect(repository.updateCalls.map(call => call.expectedUpdatedAt)).toEqual([note.updatedAt, second.updatedAt]);
    expect(navigation.calls).toHaveLength(0);

    controller.props.onConfirmConflictOverwrite();
    await flushAsync();
    expect(repository.updateCalls.map(call => call.expectedUpdatedAt)).toEqual([note.updatedAt, second.updatedAt, third.updatedAt]);
    expect(navigation.calls.at(-1)).toEqual({ name: 'completeEdit', args: [note.id, 'Inbox'] });
  });

  it('returns a missing initial edit target to Inbox with one explanatory notice', async () => {
    const repository = new MockItemRepository();
    repository.getImpl = async () => ({ ok: false, error: { code: 'NOT_FOUND', message: 'Gone.' } });
    const mailbox = new MockMailbox();
    const navigation = new MockNavigation();
    const controller = createEditorController(
      { mode: 'edit', id: note.id, origin: 'Inbox' }, repository,
      new MockImageStore(), new MockImagePicker(), mailbox, navigation,
    );
    await controller.load();
    expect(controller.props.state).toEqual({ kind: 'missing' });
    expect(mailbox.published).toHaveLength(1);
    expect(mailbox.published[0]).toMatchObject({ destination: 'Inbox', operation: 'edit', itemId: note.id });
    expect(navigation.calls).toEqual([{ name: 'returnToList', args: ['Inbox'] }]);

    await controller.load();
    expect(mailbox.published).toHaveLength(1);
    expect(navigation.calls).toHaveLength(1);
  });

  it('returns to Inbox once when the edit target disappears during save, without claiming success', async () => {
    const repository = new MockItemRepository();
    repository.getImpl = async () => ({ ok: true, value: note });
    repository.updateImpl = async () => ({ ok: false, error: { code: 'NOT_FOUND', message: 'Gone.' } });
    const mailbox = new MockMailbox();
    const navigation = new MockNavigation();
    const controller = createEditorController(
      { mode: 'edit', id: note.id, origin: 'Inbox' }, repository,
      new MockImageStore(), new MockImagePicker(), mailbox, navigation,
    );
    await controller.load();
    controller.props.onTitleChange('Unsaved local draft');
    controller.props.onSave();
    await flushAsync();

    expect(controller.props.state).toEqual({ kind: 'missing' });
    expect(mailbox.published).toHaveLength(1);
    expect(mailbox.published[0].feedback.kind).toBe('info');
    expect(mailbox.published.some(notice => notice.feedback.kind === 'success')).toBe(false);
    expect(navigation.calls).toEqual([{ name: 'returnToList', args: ['Inbox'] }]);
  });

  it('does not treat a transient database failure as a deleted edit target', async () => {
    const repository = new MockItemRepository();
    repository.getImpl = async () => ({ ok: true, value: note });
    repository.updateImpl = async () => ({ ok: false, error: { code: 'DB_FAILED', message: 'Temporary DB failure.' } });
    const mailbox = new MockMailbox();
    const navigation = new MockNavigation();
    const controller = createEditorController(
      { mode: 'edit', id: note.id, origin: 'Inbox' }, repository,
      new MockImageStore(), new MockImagePicker(), mailbox, navigation,
    );
    await controller.load();
    controller.props.onTitleChange('Keep local draft');
    controller.props.onSave();
    await flushAsync();

    expect(controller.props.state.kind).toBe('ready');
    expect(mailbox.published).toHaveLength(0);
    expect(navigation.calls).toHaveLength(0);
  });

  it('loads an image editor even when the underlying image file is missing', async () => {
    const repository = new MockItemRepository();
    repository.getImpl = async () => ({ ok: true, value: image });
    const images = new MockImageStore();
    images.resolveImpl = async () => ({ ok: true, value: { kind: 'missing' } });
    const controller = createEditorController(
      { mode: 'edit', id: image.id, origin: 'Inbox' }, repository,
      images, new MockImagePicker(), new MockMailbox(), new MockNavigation(),
    );
    await controller.load();
    expect(controller.props.state.kind).toBe('ready');
    if (controller.props.state.kind !== 'ready') throw new Error('expected ready');
    expect(controller.props.state.imagePreview).toEqual({ kind: 'missing' });
  });

  it('keeps the image edit draft usable on resolution failure and retries image resolution without losing edits', async () => {
    const repository = new MockItemRepository();
    repository.getImpl = async () => ({ ok: true, value: image });
    const images = new MockImageStore();
    let attempts = 0;
    images.resolveImpl = async () => ++attempts === 1
      ? ({ ok: false, error: { code: 'OPEN_FAILED', message: 'Storage unavailable.', field: 'image' } } as const)
      : ({ ok: true, value: { kind: 'available', uri: 'file:///images/recovered.png' } } as const);
    const controller = createEditorController(
      { mode: 'edit', id: image.id, origin: 'Inbox' }, repository,
      images, new MockImagePicker(), new MockMailbox(), new MockNavigation(),
    );

    await controller.load();
    if (controller.props.state.kind !== 'ready' || controller.props.state.draft.type !== 'image') throw new Error('expected image ready');
    expect(controller.props.state.draft.title).toBe(image.title);
    expect(controller.props.state.draft.caption).toBe(image.body ?? '');
    expect(controller.props.state.imagePreview).toEqual({
      kind: 'unavailable',
      error: { code: 'OPEN_FAILED', message: 'Storage unavailable.', field: 'image' },
    });

    controller.props.onTitleChange('Edited while image unavailable');
    controller.props.onRetryImage();
    await flushAsync();
    if (controller.props.state.kind !== 'ready' || controller.props.state.draft.type !== 'image') throw new Error('expected image ready');
    expect(controller.props.state.draft.title).toBe('Edited while image unavailable');
    expect(controller.props.state.draft.image).toEqual({ kind: 'existing', path: image.imagePath });
    expect(controller.props.state.imagePreview).toEqual({ kind: 'available', uri: 'file:///images/recovered.png' });
  });
});
