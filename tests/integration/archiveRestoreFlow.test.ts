import { describe, expect, it } from 'vitest';
import type { SavedItem } from '../../src/contracts';
import { createArchiveController, createDetailController, createInboxController } from '../../src/controllers';
import { createMutationMailbox } from '../../src/navigation/MutationMailbox';
import { fixtureSpec } from '../../src/contracts/fixtureSpec';
import { MockImageStore, MockItemRepository, MockLinkOpener, MockNavigation } from '../mocks/controllerMocks';

const activeNote: SavedItem = { ...fixtureSpec.note, url: null, imagePath: null, archived: false };

describe('archive/restore integrated controller flow', () => {
  it('keeps both mounted lists current on revisit while success feedback remains one-shot', async () => {
    const repository = new MockItemRepository();
    const imageStore = new MockImageStore();
    const mailbox = createMutationMailbox();
    const navigation = new MockNavigation();
    let stored: SavedItem = activeNote;

    repository.getImpl = async () => ({ ok: true, value: stored });
    repository.listImpl = async query => ({
      ok: true,
      value: stored.archived === query.archived ? [stored] : [],
    });
    repository.setArchivedImpl = async (_id, archived) => {
      stored = { ...stored, archived, updatedAt: stored.updatedAt + 1 } as SavedItem;
      return { ok: true, value: stored };
    };

    const inbox = createInboxController(repository, imageStore, mailbox, navigation);
    const archive = createArchiveController(repository, imageStore, mailbox, navigation);

    await inbox.onFocus();
    expect(inbox.props.state.kind === 'ready' ? inbox.props.state.rows.length : -1).toBe(1);

    const activeDetail = createDetailController(
      stored.id, 'Inbox', repository, imageStore, new MockLinkOpener(), mailbox, navigation,
    );
    await activeDetail.onFocus();
    activeDetail.props.onArchiveOrRestore();
    await new Promise<void>(resolve => setTimeout(resolve, 0));

    await inbox.onFocus();
    expect(inbox.props.feedback?.message).toBe('Item archived.');
    expect(inbox.props.state.kind === 'ready' ? inbox.props.state.rows.length : -1).toBe(0);

    await archive.onFocus();
    expect(archive.props.state.kind === 'ready' ? archive.props.state.rows.length : -1).toBe(1);

    const archivedDetail = createDetailController(
      stored.id, 'Archive', repository, imageStore, new MockLinkOpener(), mailbox, navigation,
    );
    await archivedDetail.onFocus();
    archivedDetail.props.onArchiveOrRestore();
    await new Promise<void>(resolve => setTimeout(resolve, 0));

    await archive.onFocus();
    expect(archive.props.feedback?.message).toBe('Item restored.');
    expect(archive.props.state.kind === 'ready' ? archive.props.state.rows.length : -1).toBe(0);

    // Inbox receives no restore success notice, but focus refresh still makes it current.
    await inbox.onFocus();
    expect(inbox.props.feedback?.message).toBe('Item archived.');
    expect(inbox.props.state.kind === 'ready' ? inbox.props.state.rows.length : -1).toBe(1);

    // Notices were consumed already, so later focuses do not replay new success feedback.
    const previousArchiveFeedback = archive.props.feedback;
    await archive.onFocus();
    expect(archive.props.feedback).toEqual(previousArchiveFeedback);
    expect(mailbox.consume('Archive')).toEqual([]);
  });
});
