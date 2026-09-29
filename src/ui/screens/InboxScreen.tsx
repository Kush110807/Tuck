import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { InboxScreenProps, ItemType } from '../../contracts';
import { space } from '../../theme/tokens';
import { CreateMenuSheet } from '../components/CreateMenuSheet';
import { FloatingAddButton } from '../components/FloatingAddButton';
import { IconButton } from '../components/IconButton';
import { OverflowMenu } from '../components/OverflowMenu';
import { ListScreenView } from './ListScreenView';

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
  const [createOpen, setCreateOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const chooseCreateType = (type: ItemType) => {
    setCreateOpen(false);
    onAdd(type);
  };

  return (
    <View style={styles.root}>
      <ListScreenView
        title="Tuck"
        subtitle="Save anything. Find it again."
        state={state}
        feedback={feedback}
        emptyTitle="Nothing tucked yet"
        emptyMessage="Save a thought, a link, or an image."
        onQueryChange={onQueryChange}
        onOpen={onOpen}
        onRetry={onRetry}
        onDismissFeedback={onDismissFeedback}
        contentBottomInset={space.xxxl + 72}
        headerActions={<IconButton icon="more" label="Open Inbox menu" onPress={() => setMenuOpen(true)} />}
      />

      {/* Intentionally outside ListScreenView and every list-state branch: NEW-01 cannot hide creation. */}
      <FloatingAddButton onPress={() => setCreateOpen(true)} />

      <CreateMenuSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onChoose={chooseCreateType}
      />
      <OverflowMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={[{ key: 'archive', label: 'Archive', icon: 'archive', onPress: onOpenArchive }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
