import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { TagChipProps } from '../../contracts';
import { colors, minimumTouchSize, radii, space } from '../../theme/tokens';

export function TagChip({ label, selected = false, onPress, onRemove }: TagChipProps) {
  const content = <Text style={[styles.label, selected && styles.selectedLabel]}>{label}</Text>;

  return (
    <View style={[styles.chip, selected && styles.selected]}>
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Filter by tag ${label}`}
          accessibilityState={{ selected }}
          onPress={onPress}
          style={({ pressed }) => [styles.mainPressable, pressed && styles.pressed]}
        >
          {content}
        </Pressable>
      ) : (
        <View accessible accessibilityLabel={`Tag ${label}`} style={styles.mainStatic}>{content}</View>
      )}
      {onRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove tag ${label}`}
          onPress={onRemove}
          style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
        >
          <Text style={[styles.removeText, selected && styles.selectedLabel]}>×</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: minimumTouchSize,
    maxWidth: '100%',
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  selected: { backgroundColor: colors.primarySoft },
  mainPressable: { minWidth: minimumTouchSize, minHeight: minimumTouchSize, justifyContent: 'center', paddingHorizontal: space.md },
  mainStatic: { minHeight: minimumTouchSize, justifyContent: 'center', paddingHorizontal: space.md },
  label: { color: colors.secondaryText, fontSize: 13, lineHeight: 19, fontWeight: '600', flexShrink: 1 },
  selectedLabel: { color: colors.primary },
  remove: { minWidth: minimumTouchSize, minHeight: minimumTouchSize, alignItems: 'center', justifyContent: 'center' },
  removeText: { color: colors.secondaryText, fontSize: 21, lineHeight: 23 },
  pressed: { opacity: 0.62 },
});
