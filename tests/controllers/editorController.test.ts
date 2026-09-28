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
    await flushAsync();
    expect(repository.updateCalls).toHaveLength(1);
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

  it('maps a missing edit target to the missing editor state', async () => {
    const repository = new MockItemRepository();
    repository.getImpl = async () => ({ ok: false, error: { code: 'NOT_FOUND', message: 'Gone.' } });
    const controller = createEditorController(
      { mode: 'edit', id: note.id, origin: 'Inbox' }, repository,
      new MockImageStore(), new MockImagePicker(), new MockMailbox(), new MockNavigation(),
    );
    await controller.load();
    expect(controller.props.state).toEqual({ kind: 'missing' });
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
});
