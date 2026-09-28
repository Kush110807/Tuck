import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { EditorScreenProps } from '../../contracts';
import { colors, radii, space } from '../../theme/tokens';
import { ActionButton } from '../components/ActionButton';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FormField } from '../components/FormField';
import { IconButton } from '../components/IconButton';
import { ImagePickerField } from '../components/ImagePickerField';
import { ScreenHeader } from '../components/ScreenHeader';
import { ErrorPanel, InlineError, LoadingPanel } from '../components/ScreenStates';
import { TagEditor } from '../components/TagEditor';

const typeLabels = { note: 'note', link: 'link', image: 'image' } as const;

export function EditorScreen(props: EditorScreenProps) {
  const { state, mode, onRetry, onBackToInbox } = props;

  if (state.kind === 'loading') {
    return <View style={styles.centerScreen}><LoadingPanel label="Loading item…" /></View>;
  }

  if (state.kind === 'missing') {
    return (
      <View style={styles.centerScreen}>
        <Text accessibilityRole="header" style={styles.stateTitle}>Item not found</Text>
        <Text style={styles.stateMessage}>This item may have been deleted or is no longer available.</Text>
        <ActionButton label="Back to Inbox" onPress={onBackToInbox} />
      </View>
    );
  }

  if (state.kind === 'failed') {
    return (
      <View style={styles.centerScreen}>
        <ErrorPanel title="Couldn’t load editor" error={state.error} onRetry={onRetry} />
        <ActionButton label="Back to Inbox" onPress={onBackToInbox} variant="text" />
      </View>
    );
  }

  const {
    draft, fieldErrors, mutation, screenError, imagePreview, isDirty,
    discardConfirmationOpen, conflictConfirmationOpen,
  } = state;
  const pending = mutation.kind === 'pending';
  const title = mode === 'create' ? `New ${typeLabels[draft.type]}` : `Edit ${typeLabels[draft.type]}`;
  const saveLabel = pending ? 'Saving…' : mode === 'create' ? 'Save item' : 'Save changes';

  return (
    <>
      <KeyboardAvoidingView style={styles.keyboardAvoider} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.screen}
          style={styles.scroll}
        >
          <ScreenHeader
            title={title}
            size="compact"
            subtitle={isDirty ? 'Unsaved changes' : mode === 'create' ? 'Add the details below.' : 'Everything is saved.'}
            leading={<IconButton icon="close" label="Cancel editing" onPress={props.onCancel} disabled={pending} />}
          />

          {screenError ? <InlineError message={screenError.message} /> : null}
          {mutation.kind === 'failed' ? <InlineError message={mutation.error.message} /> : null}
          {pending ? (
            <View style={styles.pending} accessibilityLiveRegion="polite">
              <Text style={styles.pendingText}>Saving your changes. Please keep this screen open.</Text>
            </View>
          ) : null}

          <View style={styles.form}>
            <FormField label="Title" value={draft.title} onChangeText={props.onTitleChange} error={fieldErrors.title} maxLength={120} />

            {draft.type === 'note' ? (
              <FormField label="Note" value={draft.body} onChangeText={props.onBodyChange} error={fieldErrors.body} multiline maxLength={10000} />
            ) : null}

            {draft.type === 'link' ? (
              <FormField label="URL" value={draft.url} onChangeText={props.onUrlChange} error={fieldErrors.url} maxLength={2000} />
            ) : null}

            {draft.type === 'image' ? (
              <>
                <ImagePickerField
                  image={imagePreview}
                  error={fieldErrors.image}
                  disabled={pending}
                  onPick={props.onPickImage}
                  onRetry={props.onRetryImage}
                />
                <FormField label="Caption" value={draft.caption} onChangeText={props.onCaptionChange} error={fieldErrors.caption} multiline maxLength={10000} />
              </>
            ) : null}

            <TagEditor
              tags={draft.tags}
              entry={draft.tagEntry}
              error={fieldErrors.tags}
              disabled={pending}
              onEntryChange={props.onTagEntryChange}
              onAdd={props.onAddTag}
              onRemove={props.onRemoveTag}
            />
          </View>
        </ScrollView>

        <View style={styles.saveBar}>
          <ActionButton label={saveLabel} onPress={props.onSave} disabled={pending} style={styles.saveButton} />
        </View>
      </KeyboardAvoidingView>

      <ConfirmDialog
        visible={discardConfirmationOpen}
        title="Discard changes?"
        message="Your unsaved changes will be lost."
        confirmLabel="Discard"
        destructive
        onConfirm={props.onConfirmDiscard}
        onCancel={props.onKeepEditing}
      />
      <ConfirmDialog
        visible={conflictConfirmationOpen}
        title="Newer version found"
        message="This item changed after you opened it. Your draft is preserved. Overwrite the newer saved version with the fields you changed?"
        confirmLabel="Overwrite newer version"
        destructive
        onConfirm={props.onConfirmConflictOverwrite}
        onCancel={props.onCancelConflictOverwrite}
      />
    </>
  );
}

const styles = StyleSheet.create({
  keyboardAvoider: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1, backgroundColor: colors.background },
  screen: { flexGrow: 1, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xl, gap: space.lg },
  centerScreen: { flex: 1, backgroundColor: colors.background, padding: space.xl, justifyContent: 'center', gap: space.lg },
  stateTitle: { color: colors.text, fontSize: 24, lineHeight: 32, fontWeight: '800', textAlign: 'center' },
  stateMessage: { color: colors.secondaryText, fontSize: 16, lineHeight: 24, textAlign: 'center' },
  pending: { borderRadius: radii.control, backgroundColor: colors.primarySoft, padding: space.md },
  pendingText: { color: colors.primary, fontSize: 14, lineHeight: 21, fontWeight: '600' },
  form: { gap: space.xl },
  saveBar: {
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.md,
  },
  saveButton: { width: '100%' },
});
