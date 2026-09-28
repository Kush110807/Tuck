import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { FilterBarProps, ItemType } from '../../contracts';
import { colors, space } from '../../theme/tokens';
import { TagChip } from './TagChip';
import { TypeChip } from './TypeChip';

const types: readonly (ItemType | 'all')[] = ['all', 'note', 'link', 'image'];

export function FilterBar({ type, tagKey, availableTags, onTypeChange, onTagChange }: FilterBarProps) {
  return (
    <View style={styles.container} accessibilityLabel="Item filters">
      <Text style={styles.label}>Type</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {types.map(value => (
          <TypeChip key={value} type={value} selected={type === value} onPress={() => onTypeChange(value)} />
        ))}
      </ScrollView>
      {availableTags.length > 0 ? (
        <>
          <Text style={styles.label}>Tags</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          >
            <TagChip label="All tags" selected={tagKey === null} onPress={() => onTagChange(null)} />
            {availableTags.map(tag => {
              const key = tag.toLowerCase();
              return (
                <TagChip
                  key={key}
                  label={tag}
                  selected={tagKey === key}
                  onPress={() => onTagChange(key)}
                />
              );
            })}
          </ScrollView>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space.sm },
  label: { color: colors.secondaryText, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  row: { gap: space.sm, paddingRight: space.xl },
});
