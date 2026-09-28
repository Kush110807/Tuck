import { useEffect, useState, type ReactNode } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { DetailScreenProps, SavedItem } from '../../contracts';
import { colors, radii, space } from '../../theme/tokens';
import { ActionButton } from '../components/ActionButton';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FeedbackBanner } from '../components/FeedbackBanner';
import { getImagePresentation } from '../components/imagePresentation';
import { ErrorPanel, InlineError, LoadingPanel } from '../components/ScreenStates';
import { TagChip } from '../components/TagChip';

function TypeContent({ item, onOpenLink }: { item: SavedItem; onOpenLink(): void }) {
  if (item.type === 'note') {
    return <Text style={styles.body}>{item.body}</Text>;
  }
  if (item.type === 'link') {
    return (
      <View style={styles.linkBox}>
        <Text selectable style={styles.linkText}>{item.url}</Text>
        <ActionButton label="Open link" onPress={onOpenLink} />
      </View>
    );
  }
  return item.body ? <Text style={styles.body}>{item.body}</Text> : <Text style={styles.muted}>No caption.</Text>;
}

export function DetailScreen({
  state,
  mutation,
  feedback,
  deleteConfirmationOpen,
  onOpenLink,
  onEdit,
  onArchiveOrRestore,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  onBack,
  onRetry,
  onDismissFeedback,
}: DetailScreenProps) {
  const pending = mutation.kind === 'pending';
  const resolvedUri = state.kind === 'ready' && state.image.kind === 'available' ? state.image.uri : null;
  const [imageRenderFailed, setImageRenderFailed] = useState(false);
  useEffect(() => setImageRenderFailed(false), [resolvedUri]);

  let content: ReactNode;
  if (state.kind === 'loading') {
    content = <LoadingPanel label="Loading item…" />;
  } else if (state.kind === 'missing') {
    content = (
      <View style={styles.statePanel}>
        <Text accessibilityRole="header" style={styles.stateTitle}>Item not found</Text>
        <Text style={styles.muted}>This item may have been deleted or is no longer available.</Text>
      </View>
    );
  } else if (state.kind === 'failed') {
    content = <ErrorPanel title="Couldn’t load item" error={state.error} onRetry={onRetry} />;
  } else {
    const { item, image } = state;
    const imagePresentation = getImagePresentation(image, imageRenderFailed);
    content = (
      <>
        {mutation.kind === 'failed' ? <InlineError message={mutation.error.message} /> : null}
        {pending ? (
          <View style={styles.pending} accessibilityLiveRegion="polite">
            <Text style={styles.pendingText}>{mutation.operation === 'delete' ? 'Deleting item…' : mutation.operation === 'restore' ? 'Restoring item…' : mutation.operation === 'archive' ? 'Archiving item…' : 'Saving changes…'}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.type}>{item.type.toUpperCase()}</Text>
          <Text accessibilityRole="header" style={styles.title}>{item.title}</Text>

          {item.type === 'image' ? (
            imagePresentation.kind === 'image' ? (
              <Image
                source={{ uri: imagePresentation.uri }}
                resizeMode="contain"
                accessibilityLabel={`${item.title} image`}
                onError={() => setImageRenderFailed(true)}
                style={styles.image}
              />
            ) : (
              <View style={styles.imageMissing}>
                <Text style={styles.imageMissingTitle}>{imagePresentation.title}</Text>
                <Text style={styles.muted}>{imagePresentation.message}</Text>
                {imagePresentation.reason === 'render-failed' ? (
                  <ActionButton label="Retry image" onPress={() => setImageRenderFailed(false)} variant="secondary" />
                ) : imagePresentation.reason === 'unavailable' ? (
                  <ActionButton label="Retry image" onPress={onRetry} variant="secondary" />
                ) : null}
              </View>
            )
          ) : null}

          <TypeContent item={item} onOpenLink={onOpenLink} />

          {item.tags.length > 0 ? (
            <View style={styles.tags} accessibilityLabel={`Tags: ${item.tags.join(', ')}`}>
              {item.tags.map(tag => <TagChip key={tag.toLowerCase()} label={tag} />)}
            </View>
          ) : null}

          <Text style={styles.meta}>Updated {new Date(item.updatedAt).toLocaleString()}</Text>
        </View>

        <View style={styles.actions}>
          <ActionButton label="Edit" onPress={onEdit} variant="secondary" disabled={pending} style={styles.action} />
          <ActionButton
            label={item.archived ? 'Restore' : 'Archive'}
            onPress={onArchiveOrRestore}
            variant="secondary"
            disabled={pending}
            style={styles.action}
          />
          <ActionButton label="Delete" onPress={onRequestDelete} variant="danger" disabled={pending} style={styles.action} />
        </View>
      </>
    );
  }

  return (
    <>
      <ScrollView contentContainerStyle={styles.screen} style={styles.scroll}>
        <View style={styles.topRow}>
          <ActionButton label="Back" onPress={onBack} variant="text" disabled={pending} />
        </View>
        {feedback ? <FeedbackBanner feedback={feedback} onDismiss={onDismissFeedback} /> : null}
        {content}
      </ScrollView>
      <ConfirmDialog
        visible={deleteConfirmationOpen}
        title="Delete this item?"
        message="This permanently removes the saved item. This action cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={onConfirmDelete}
        onCancel={onCancelDelete}
      />
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  screen: { flexGrow: 1, padding: space.lg, gap: space.lg },
  topRow: { alignItems: 'flex-start' },
  statePanel: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.card, backgroundColor: colors.surface, padding: space.xl, gap: space.sm, alignItems: 'center' },
  stateTitle: { color: colors.text, fontSize: 22, lineHeight: 30, fontWeight: '800', textAlign: 'center' },
  pending: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.control, backgroundColor: colors.surface, padding: space.md },
  pendingText: { color: colors.secondaryText, fontSize: 14, lineHeight: 21 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.card, backgroundColor: colors.surface, padding: space.xl, gap: space.lg },
  type: { color: colors.primary, fontSize: 12, lineHeight: 18, fontWeight: '800', letterSpacing: 0.6 },
  title: { color: colors.text, fontSize: 30, lineHeight: 39, fontWeight: '800' },
  body: { color: colors.text, fontSize: 17, lineHeight: 27 },
  muted: { color: colors.secondaryText, fontSize: 15, lineHeight: 23 },
  linkBox: { gap: space.md },
  linkText: { color: colors.primary, fontSize: 16, lineHeight: 24 },
  image: { width: '100%', minHeight: 260, maxHeight: 520, backgroundColor: colors.background, borderRadius: radii.control },
  imageMissing: { minHeight: 180, borderWidth: 1, borderColor: colors.border, borderRadius: radii.control, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.sm },
  imageMissingTitle: { color: colors.text, fontSize: 18, lineHeight: 25, fontWeight: '700', textAlign: 'center' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  meta: { color: colors.secondaryText, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  action: { flexGrow: 1 },
});
