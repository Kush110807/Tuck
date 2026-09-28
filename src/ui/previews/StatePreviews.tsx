import { Image } from 'react-native';
import type {
  ArchiveScreenProps,
  DetailScreenProps,
  EditorScreenProps,
  InboxScreenProps,
  ItemListRow,
  ItemQuery,
} from '../../contracts';
import { previewItems } from '../../preview/previewData';
import { BootGate } from '../components/BootGate';
import { ArchiveScreen } from '../screens/ArchiveScreen';
import { DetailScreen } from '../screens/DetailScreen';
import { EditorScreen } from '../screens/EditorScreen';
import { InboxScreen } from '../screens/InboxScreen';

/** Isolated visual-development doubles. This file is never imported by App.tsx. */
const noOp = () => {};
const noOpValue = (_value: string) => {};
const noOpQuery = (_query: ItemQuery) => {};
const noOpType = (_type: 'note' | 'link' | 'image') => {};

const previewImageUri = Image.resolveAssetSource(
  require('../../../assets/fixtures/fixture-card.png'),
).uri;

const inboxRows: readonly ItemListRow[] = previewItems
  .filter(item => !item.archived)
  .map(item => ({
    item,
    image: item.type === 'image' ? { kind: 'available' as const, uri: previewImageUri } : { kind: 'none' as const },
  }));

const archiveRows: readonly ItemListRow[] = previewItems
  .filter(item => item.archived)
  .map(item => ({ item, image: { kind: 'none' as const } }));

const inboxQuery: ItemQuery = { archived: false, text: '', type: 'all', tagKey: null };
const archiveQuery: ItemQuery = { archived: true, text: '', type: 'all', tagKey: null };
const previewError = { code: 'DB_FAILED' as const, message: 'Preview read failed. Try again.' };

export function BootInitializingPreview() {
  return <BootGate state={{ kind: 'initializing' }} onRetry={noOp} />;
}

export function BootFailedPreview() {
  return <BootGate state={{ kind: 'failed', error: { code: 'INIT_FAILED', message: 'Preview initialization failed.' } }} onRetry={noOp} />;
}

const inboxBase: Omit<InboxScreenProps, 'state' | 'feedback'> = {
  onQueryChange: noOpQuery,
  onOpen: noOpValue,
  onAdd: noOpType,
  onOpenArchive: noOp,
  onRetry: noOp,
  onDismissFeedback: noOp,
};

export function InboxReadyPreview() {
  return <InboxScreen {...inboxBase} state={{ kind: 'ready', query: inboxQuery, rows: inboxRows, availableTags: ['Study', 'Reading', 'Build', 'Ideas'] }} feedback={null} />;
}

export function InboxImageMissingPreview() {
  const rows = inboxRows.map(row =>
    row.item.type === 'image' ? { ...row, image: { kind: 'missing' as const } } : row,
  );
  return <InboxScreen {...inboxBase} state={{ kind: 'ready', query: inboxQuery, rows, availableTags: ['Study', 'Reading', 'Build', 'Ideas'] }} feedback={{ kind: 'info', message: 'One image file is unavailable; its item is still listed.' }} />;
}

export function InboxEmptyPreview() {
  return <InboxScreen {...inboxBase} state={{ kind: 'ready', query: inboxQuery, rows: [], availableTags: [] }} feedback={null} />;
}

export function InboxNoMatchPreview() {
  return <InboxScreen {...inboxBase} state={{ kind: 'ready', query: { ...inboxQuery, text: 'no match' }, rows: [], availableTags: ['Study'] }} feedback={null} />;
}

export function InboxLoadingPreview() {
  return <InboxScreen {...inboxBase} state={{ kind: 'loading', query: inboxQuery, previousRows: inboxRows }} feedback={null} />;
}

export function InboxFailedPreview() {
  return <InboxScreen {...inboxBase} state={{ kind: 'failed', query: inboxQuery, previousRows: inboxRows, error: previewError }} feedback={{ kind: 'info', message: 'Your last confirmed save is complete.' }} />;
}

const archiveBase: Omit<ArchiveScreenProps, 'state' | 'feedback'> = {
  onQueryChange: noOpQuery,
  onOpen: noOpValue,
  onBack: noOp,
  onRetry: noOp,
  onDismissFeedback: noOp,
};

export function ArchiveReadyPreview() {
  return <ArchiveScreen {...archiveBase} state={{ kind: 'ready', query: archiveQuery, rows: archiveRows, availableTags: ['Study'] }} feedback={null} />;
}

export function ArchiveEmptyPreview() {
  return <ArchiveScreen {...archiveBase} state={{ kind: 'ready', query: archiveQuery, rows: [], availableTags: [] }} feedback={null} />;
}

export function ArchiveNoMatchPreview() {
  return <ArchiveScreen {...archiveBase} state={{ kind: 'ready', query: { ...archiveQuery, type: 'image' }, rows: [], availableTags: ['Study'] }} feedback={null} />;
}

export function ArchiveLoadingPreview() {
  return <ArchiveScreen {...archiveBase} state={{ kind: 'loading', query: archiveQuery, previousRows: archiveRows }} feedback={null} />;
}

export function ArchiveFailedPreview() {
  return <ArchiveScreen {...archiveBase} state={{ kind: 'failed', query: archiveQuery, previousRows: archiveRows, error: previewError }} feedback={{ kind: 'error', message: 'Archive refresh failed.' }} />;
}

const editorBase: Omit<EditorScreenProps, 'state' | 'mode'> = {
  onTitleChange: noOpValue,
  onBodyChange: noOpValue,
  onUrlChange: noOpValue,
  onCaptionChange: noOpValue,
  onTagEntryChange: noOpValue,
  onAddTag: noOp,
  onRemoveTag: noOpValue,
  onPickImage: noOp,
  onSave: noOp,
  onCancel: noOp,
  onRetry: noOp,
  onRetryImage: noOp,
  onConfirmDiscard: noOp,
  onKeepEditing: noOp,
  onConfirmConflictOverwrite: noOp,
  onCancelConflictOverwrite: noOp,
  onBackToInbox: noOp,
};

const noteDraft = {
  type: 'note' as const,
  title: 'Lecture thought',
  body: 'Revise the wave equation before Friday.',
  tags: ['Study'] as const,
  tagEntry: '',
};

export function EditorReadyPreview() {
  return <EditorScreen {...editorBase} mode="edit" state={{ kind: 'ready', draft: noteDraft, fieldErrors: {}, mutation: { kind: 'idle' }, screenError: null, imagePreview: { kind: 'none' }, isDirty: true, discardConfirmationOpen: false, conflictConfirmationOpen: false }} />;
}

export function EditorPendingPreview() {
  return <EditorScreen {...editorBase} mode="edit" state={{ kind: 'ready', draft: noteDraft, fieldErrors: {}, mutation: { kind: 'pending', operation: 'edit' }, screenError: null, imagePreview: { kind: 'none' }, isDirty: true, discardConfirmationOpen: false, conflictConfirmationOpen: false }} />;
}

export function EditorValidationAndFailurePreview() {
  return <EditorScreen {...editorBase} mode="edit" state={{ kind: 'ready', draft: { ...noteDraft, title: '' }, fieldErrors: { title: 'Title is required.' }, mutation: { kind: 'failed', operation: 'edit', error: { code: 'DB_FAILED', message: 'Could not save changes.' } }, screenError: { code: 'DB_FAILED', message: 'Could not save changes.' }, imagePreview: { kind: 'none' }, isDirty: true, discardConfirmationOpen: false, conflictConfirmationOpen: false }} />;
}

export function EditorDiscardConfirmationPreview() {
  return <EditorScreen {...editorBase} mode="edit" state={{ kind: 'ready', draft: noteDraft, fieldErrors: {}, mutation: { kind: 'idle' }, screenError: null, imagePreview: { kind: 'none' }, isDirty: true, discardConfirmationOpen: true, conflictConfirmationOpen: false }} />;
}

export function EditorConflictConfirmationPreview() {
  const conflict = { code: 'CONFLICT' as const, message: 'This item changed since it was opened.' };
  return <EditorScreen {...editorBase} mode="edit" state={{ kind: 'ready', draft: noteDraft, fieldErrors: {}, mutation: { kind: 'failed', operation: 'edit', error: conflict }, screenError: null, imagePreview: { kind: 'none' }, isDirty: true, discardConfirmationOpen: false, conflictConfirmationOpen: true }} />;
}

export function EditorImageMissingPreview() {
  return <EditorScreen {...editorBase} mode="edit" state={{ kind: 'ready', draft: { type: 'image', title: 'Colour study', caption: 'Muted green and ivory.', tags: ['Ideas'], tagEntry: '', image: { kind: 'existing', path: 'images/fixture-card.png' } }, fieldErrors: {}, mutation: { kind: 'idle' }, screenError: null, imagePreview: { kind: 'missing' }, isDirty: false, discardConfirmationOpen: false, conflictConfirmationOpen: false }} />;
}

export function EditorLoadingPreview() {
  return <EditorScreen {...editorBase} mode="edit" state={{ kind: 'loading' }} />;
}

export function EditorMissingPreview() {
  return <EditorScreen {...editorBase} mode="edit" state={{ kind: 'missing' }} />;
}

export function EditorFailedPreview() {
  return <EditorScreen {...editorBase} mode="edit" state={{ kind: 'failed', error: previewError }} />;
}

const detailBase: Omit<DetailScreenProps, 'state' | 'mutation' | 'feedback' | 'deleteConfirmationOpen'> = {
  onOpenLink: noOp,
  onEdit: noOp,
  onArchiveOrRestore: noOp,
  onRequestDelete: noOp,
  onConfirmDelete: noOp,
  onCancelDelete: noOp,
  onBack: noOp,
  onRetry: noOp,
  onDismissFeedback: noOp,
};

const previewLink = previewItems.find(item => item.type === 'link')!;
const previewImage = previewItems.find(item => item.type === 'image')!;

export function DetailReadyPreview() {
  return <DetailScreen {...detailBase} state={{ kind: 'ready', item: previewLink, image: { kind: 'none' } }} mutation={{ kind: 'idle' }} feedback={null} deleteConfirmationOpen={false} />;
}

export function DetailImageMissingPreview() {
  return <DetailScreen {...detailBase} state={{ kind: 'ready', item: previewImage, image: { kind: 'missing' } }} mutation={{ kind: 'idle' }} feedback={null} deleteConfirmationOpen={false} />;
}

export function DetailPendingPreview() {
  return <DetailScreen {...detailBase} state={{ kind: 'ready', item: previewLink, image: { kind: 'none' } }} mutation={{ kind: 'pending', operation: 'archive' }} feedback={null} deleteConfirmationOpen={false} />;
}

export function DetailMutationFailedPreview() {
  return <DetailScreen {...detailBase} state={{ kind: 'ready', item: previewLink, image: { kind: 'none' } }} mutation={{ kind: 'failed', operation: 'delete', error: previewError }} feedback={null} deleteConfirmationOpen={false} />;
}

export function DetailDeleteConfirmationPreview() {
  return <DetailScreen {...detailBase} state={{ kind: 'ready', item: previewLink, image: { kind: 'none' } }} mutation={{ kind: 'idle' }} feedback={null} deleteConfirmationOpen />;
}

export function DetailRefreshFailedAfterSuccessPreview() {
  return <DetailScreen {...detailBase} state={{ kind: 'failed', error: previewError }} mutation={{ kind: 'idle' }} feedback={{ kind: 'success', message: 'Changes saved.' }} deleteConfirmationOpen={false} />;
}

export function DetailLoadingPreview() {
  return <DetailScreen {...detailBase} state={{ kind: 'loading' }} mutation={{ kind: 'idle' }} feedback={null} deleteConfirmationOpen={false} />;
}

export function DetailMissingPreview() {
  return <DetailScreen {...detailBase} state={{ kind: 'missing' }} mutation={{ kind: 'idle' }} feedback={null} deleteConfirmationOpen={false} />;
}

export function DetailFailedPreview() {
  return <DetailScreen {...detailBase} state={{ kind: 'failed', error: previewError }} mutation={{ kind: 'idle' }} feedback={null} deleteConfirmationOpen={false} />;
}
