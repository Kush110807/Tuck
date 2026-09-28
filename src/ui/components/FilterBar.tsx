import { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { FilterBarProps, ItemType } from '../../contracts';
import { colors, minimumTouchSize, radii, space } from '../../theme/tokens';
import { AppIcon } from './AppIcon';
import { IconButton } from './IconButton';
import { TagChip } from './TagChip';
import { TypeChip } from './TypeChip';

const types: readonly (ItemType | 'all')[] = ['all', 'note', 'link', 'image'];

export function FilterBar({ type, tagKey, availableTags, onTypeChange, onTagChange }: FilterBarProps) {
  const [tagSheetOpen, setTagSheetOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const selectedTag = tagKey
    ? availableTags.find(tag => tag.toLowerCase() === tagKey.toLowerCase()) ?? tagKey
    : null;
  const canFilterTags = availableTags.length > 0 || tagKey !== null;

  return (
    <View style={styles.container} accessibilityLabel="Item filters">
      <View style={styles.primaryRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.typeRow}
          style={styles.typeScroll}
        >
          {types.map(value => (
            <TypeChip key={value} type={value} selected={type === value} onPress={() => onTypeChange(value)} />
          ))}
        </ScrollView>
        {canFilterTags ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tagKey ? 'Tag filter, 1 active' : 'Filter by tag'}
            accessibilityState={{ selected: tagKey !== null }}
            onPress={() => setTagSheetOpen(true)}
            style={({ pressed }) => [styles.filterButton, tagKey && styles.filterButtonActive, pressed && styles.pressed]}
          >
            <AppIcon name="options" size={19} color={tagKey ? colors.primary : colors.secondaryText} />
            <Text style={[styles.filterText, tagKey && styles.filterTextActive]}>Filter{tagKey ? ' • 1' : ''}</Text>
          </Pressable>
        ) : null}
      </View>

      {selectedTag ? (
        <View style={styles.activeFilters}>
          <Text style={styles.activeLabel}>Active</Text>
          <TagChip label={selectedTag} selected onRemove={() => onTagChange(null)} />
        </View>
      ) : null}

      <Modal
        visible={tagSheetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setTagSheetOpen(false)}
        statusBarTranslucent
      >
        <View style={styles.backdrop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close tag filters"
            onPress={() => setTagSheetOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: space.xl + insets.bottom }]}>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetCopy}>
                <Text accessibilityRole="header" style={styles.sheetTitle}>Filter by tag</Text>
                <Text style={styles.sheetSubtitle}>Show items related to one tag.</Text>
              </View>
              <IconButton icon="close" label="Close tag filters" onPress={() => setTagSheetOpen(false)} />
            </View>
            <ScrollView style={styles.tagScroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.tagList}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Show all tags"
                accessibilityState={{ selected: tagKey === null }}
                onPress={() => {
                  onTagChange(null);
                  setTagSheetOpen(false);
                }}
                style={({ pressed }) => [styles.tagOption, tagKey === null && styles.tagOptionSelected, pressed && styles.pressed]}
              >
                <Text style={[styles.tagOptionText, tagKey === null && styles.tagOptionSelectedText]}>All tags</Text>
                {tagKey === null ? <AppIcon name="check" size={20} color={colors.primary} /> : null}
              </Pressable>
              {availableTags.map(tag => {
                const key = tag.toLowerCase();
                const selected = tagKey === key;
                return (
                  <Pressable
                    key={key}
                    accessibilityRole="button"
                    accessibilityLabel={`Filter by tag ${tag}`}
                    accessibilityState={{ selected }}
                    onPress={() => {
                      onTagChange(key);
                      setTagSheetOpen(false);
                    }}
                    style={({ pressed }) => [styles.tagOption, selected && styles.tagOptionSelected, pressed && styles.pressed]}
                  >
                    <Text style={[styles.tagOptionText, selected && styles.tagOptionSelectedText]}>{tag}</Text>
                    {selected ? <AppIcon name="check" size={20} color={colors.primary} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space.sm },
  primaryRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  typeScroll: { flex: 1 },
  typeRow: { gap: space.xs, paddingRight: space.sm },
  filterButton: {
    minHeight: minimumTouchSize,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radii.pill,
    paddingHorizontal: space.md,
  },
  filterButtonActive: { backgroundColor: colors.primarySoft },
  filterText: { color: colors.secondaryText, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  filterTextActive: { color: colors.primary },
  pressed: { backgroundColor: colors.surfaceMuted },
  activeFilters: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  activeLabel: { color: colors.tertiaryText, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  sheet: {
    maxHeight: '76%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xl,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, marginBottom: space.md },
  sheetCopy: { flex: 1, minWidth: 0, gap: space.xs },
  sheetTitle: { color: colors.text, fontSize: 22, lineHeight: 29, fontWeight: '800' },
  sheetSubtitle: { color: colors.secondaryText, fontSize: 14, lineHeight: 20 },
  tagScroll: { flexShrink: 1 },
  tagList: { gap: space.xs, paddingBottom: space.md },
  tagOption: {
    minHeight: minimumTouchSize,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radii.control,
  },
  tagOptionSelected: { backgroundColor: colors.primarySoft },
  tagOptionText: { flex: 1, minWidth: 0, color: colors.text, fontSize: 16, lineHeight: 22, fontWeight: '600' },
  tagOptionSelectedText: { color: colors.primary, fontWeight: '800' },
});
