import { Pressable, StyleSheet, View } from 'react-native';
import { colors, fabSize, space } from '../../theme/tokens';
import { AppIcon } from './AppIcon';

export function FloatingAddButton({ onPress }: { onPress(): void }) {
  return (
    <View pointerEvents="box-none" style={styles.layer}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add to Tuck"
        accessibilityHint="Choose whether to add a note, link, or image"
        hitSlop={4}
        onPress={onPress}
        style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
      >
        <AppIcon name="add" size={31} color={colors.surface} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFillObject, alignItems: 'flex-end', justifyContent: 'flex-end', paddingRight: space.lg, paddingBottom: space.lg },
  fab: {
    width: fabSize,
    height: fabSize,
    borderRadius: fabSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    elevation: 4,
    shadowColor: '#000000',
    shadowOpacity: 0.14,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
  },
  pressed: { backgroundColor: colors.primaryPressed, transform: [{ scale: 0.98 }] },
});
