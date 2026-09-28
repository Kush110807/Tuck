import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, minimumTouchSize, radii, space } from '../../theme/tokens';
import { AppIcon, type AppIconName } from './AppIcon';

type MenuItem = { key: string; label: string; icon: AppIconName; onPress(): void };

export function OverflowMenu({ visible, onClose, items }: { visible: boolean; onClose(): void; items: readonly MenuItem[] }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.backdrop, { paddingTop: Math.max(64, insets.top + 48) }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close menu" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={styles.menu}>
          {items.map(item => (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              onPress={() => { onClose(); item.onPress(); }}
              style={({ pressed }) => [styles.item, pressed && styles.pressed]}
            >
              <AppIcon name={item.icon} size={20} color={colors.text} />
              <Text style={styles.label}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'flex-end', paddingTop: 64, paddingRight: space.lg },
  menu: {
    minWidth: 190,
    maxWidth: '84%',
    backgroundColor: colors.surface,
    borderRadius: radii.control,
    padding: space.xs,
    elevation: 8,
    shadowColor: '#000000',
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  item: { minHeight: minimumTouchSize, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: 10 },
  pressed: { backgroundColor: colors.surfaceMuted },
  label: { color: colors.text, fontSize: 16, lineHeight: 22, fontWeight: '600', flexShrink: 1 },
});
