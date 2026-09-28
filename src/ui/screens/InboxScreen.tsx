import { StyleSheet, View } from 'react-native';
import type { InboxScreenProps } from '../../contracts';
import { space } from '../../theme/tokens';
import { ActionButton } from '../components/ActionButton';
import { HeaderButton, ListScreenView } from './ListScreenView';

export function InboxScreen({
  state,
  feedback,
  onQueryChange,
  onOpen,
  onAdd,
  onOpenArchive,
  onRetry,
  onDismissFeedback,
}: InboxScreenProps) {
  return (
    <ListScreenView
      title="Inbox"
      subtitle="Notes, links and images you want to keep close."
      state={state}
      feedback={feedback}
      emptyTitle="Your inbox is empty"
      emptyMessage="Save a note, link or image to start building your collection."
      onQueryChange={onQueryChange}
      onOpen={onOpen}
      onRetry={onRetry}
      onDismissFeedback={onDismissFeedback}
      headerActions={<HeaderButton label="Archive" onPress={onOpenArchive} />}
      emptyAction={(
        <View style={styles.addRow}>
          <ActionButton label="Add note" onPress={() => onAdd('note')} />
          <ActionButton label="Add link" onPress={() => onAdd('link')} variant="secondary" />
          <ActionButton label="Add image" onPress={() => onAdd('image')} variant="secondary" />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  addRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, justifyContent: 'center' },
});
