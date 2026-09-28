import { useEffect, useState, type ReactNode } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { DetailScreenProps, SavedItem } from '../../contracts';
import { colors, radii, space } from '../../theme/tokens';
import { ActionButton } from '../components/ActionButton';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FeedbackBanner } from '../components/FeedbackBanner';
import { IconButton } from '../components/IconButton';
import { getImagePresentation } from '../components/imagePresentation';
import { ScreenHeader } from '../components/ScreenHeader';
import { ErrorPanel, InlineError, LoadingPanel } from '../components/ScreenStates';
import { TagChip } from '../components/TagChip';

function TypeContent({ item, onOpenLink }: { item: SavedItem; onOpenLink(): void }) {
  if (item.type === 'note') return <Text style={styles.body}>{item.body}</Text>;
  if (item.type === 'link') {
    return (
      <View style={styles.linkBlock}>
        <Text selectable style={styles.linkText}>{item.url}</Text>
        <ActionButton label="Open link" onPress={onOpenLink} style={styles.openLink} />
      </View>
    );
  }
  return item.body ? <Text style={styles.body}>{item.body}</Text> : <Text style={styles.muted}>No caption.</Text>;
}

const typeLabels = { note: 'Note', link: 'Link', image: 'Image' } as const;

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
            <Text style={styles.pendingText}>
              {mutation.operation === 'delete' ? 'Deleting item…' : mutation.operation === 'restore' ? 'Restoring item…' : mutation.operation === 'archive' ? 'Archiving item…' : 'Saving changes…'}
            </Text>
          </View>
        ) : null}

        <View style={styles.article}>
          <Text style={styles.type}>{typeLabels[item.type]}</Text>
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

        <View style={styles.divider} />
        <View style={styles.actions}>
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
        <ScreenHeader
          title="Details"
          size="compact"
          leading={<IconButton icon="back" label="Back" onPress={onBack} disabled={pending} />}
          trailing={state.kind === 'ready' ? <IconButton icon="edit" label="Edit item" onPress={onEdit} disabled={pending} tone="primary" /> : undefined}
        />
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
  screen: { flexGrow: 1, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xxl, gap: space.lg },
  statePanel: { paddingVertical: space.xxxl, paddingHorizontal: space.xl, gap: space.sm, alignItems: 'center' },
  stateTitle: { color: colors.text, fontSize: 22, lineHeight: 30, fontWeight: '800', textAlign: 'center' },
  pending: { borderRadius: radii.control, backgroundColor: colors.primarySoft, padding: space.md },
  pendingText: { color: colors.primary, fontSize: 14, lineHeight: 21, fontWeight: '600' },
  article: { gap: space.lg },
  type: { color: colors.primary, fontSize: 12, lineHeight: 18, fontWeight: '800', letterSpacing: 0.7, textTransform: 'uppercase' },
  title: { color: colors.text, fontSize: 32, lineHeight: 40, fontWeight: '800', letterSpacing: -0.5 },
  body: { color: colors.text, fontSize: 17, lineHeight: 28 },
  muted: { color: colors.secondaryText, fontSize: 15, lineHeight: 23, textAlign: 'center' },
  linkBlock: { gap: space.md },
  linkText: { color: colors.primary, fontSize: 16, lineHeight: 25 },
  openLink: { alignSelf: 'flex-start' },
  image: { width: '100%', minHeight: 280, maxHeight: 560, backgroundColor: colors.surfaceMuted, borderRadius: radii.card },
  imageMissing: { minHeight: 220, borderRadius: radii.card, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.sm },
  imageMissingTitle: { color: colors.text, fontSize: 18, lineHeight: 25, fontWeight: '700', textAlign: 'center' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  meta: { color: colors.tertiaryText, fontSize: 12, lineHeight: 18 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  action: { flexGrow: 1, minWidth: 132 },
});
