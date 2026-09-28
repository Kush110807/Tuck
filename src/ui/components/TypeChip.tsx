import { Pressable, StyleSheet, Text } from 'react-native';
import type { TypeChipProps } from '../../contracts';
import { colors, minimumTouchSize, radii, space } from '../../theme/tokens';

const labels = { all: 'All', note: 'Notes', link: 'Links', image: 'Images' } as const;

export function TypeChip({ type, selected, onPress }: TypeChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Filter by ${labels[type]}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.selected, pressed && styles.pressed]}
    >
      <Text style={[styles.label, selected && styles.selectedLabel]}>{labels[type]}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: minimumTouchSize,
    paddingHorizontal: space.lg,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  selected: { backgroundColor: colors.primary, borderColor: colors.primary },
  label: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '600' },
  selectedLabel: { color: colors.surface },
  pressed: { opacity: 0.72 },
});
