import { useRef } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AccessibilityInfo,
  findNodeHandle,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { ItemType } from '../../contracts';
import { colors, minimumTouchSize, radii, space } from '../../theme/tokens';
import { AppIcon } from './AppIcon';
import { createOptions } from './createMenuModel';
import { IconButton } from './IconButton';

export function CreateMenuSheet({
  visible,
  onClose,
  onChoose,
}: {
  visible: boolean;
  onClose(): void;
  onChoose(type: ItemType): void;
}) {
  const titleRef = useRef<View>(null);
  const insets = useSafeAreaInsets();

  const focusTitle = () => {
    const node = findNodeHandle(titleRef.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onShow={focusTitle} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close add menu" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: space.xl + insets.bottom }]}>
          <View style={styles.handle} importantForAccessibility="no-hide-descendants" />
          <View style={styles.header}>
            <View ref={titleRef} accessible accessibilityRole="header" style={styles.headerCopy}>
              <Text style={styles.title}>Add to Tuck</Text>
              <Text style={styles.subtitle}>What would you like to save?</Text>
            </View>
            <IconButton icon="close" label="Close add menu" onPress={onClose} />
          </View>
          <ScrollView style={styles.optionScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.options}>
            {createOptions.map(option => (
              <Pressable
                key={option.type}
                accessibilityRole="button"
                accessibilityLabel={`Add ${option.label.toLowerCase()}`}
                accessibilityHint={option.description}
                onPress={() => onChoose(option.type)}
                style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
              >
                <View style={styles.iconWrap} importantForAccessibility="no-hide-descendants">
                  <AppIcon name={option.icon} size={23} color={colors.primary} />
                </View>
                <View style={styles.optionCopy}>
                  <Text style={styles.optionTitle}>{option.label}</Text>
                  <Text style={styles.optionDescription}>{option.description}</Text>
                </View>
                <AppIcon name="chevron" size={24} color={colors.tertiaryText} />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  sheet: {
    maxHeight: '82%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.xl,
    elevation: 10,
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: space.md },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, marginBottom: space.sm },
  headerCopy: { flex: 1, minWidth: 0, gap: space.xs, paddingVertical: space.xs },
  title: { color: colors.text, fontSize: 22, lineHeight: 29, fontWeight: '800' },
  subtitle: { color: colors.secondaryText, fontSize: 14, lineHeight: 21 },
  optionScroll: { flexShrink: 1 },
  options: { gap: space.xs, paddingBottom: space.sm },
  option: {
    minHeight: Math.max(68, minimumTouchSize),
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.sm,
    borderRadius: radii.control,
  },
  optionPressed: { backgroundColor: colors.surfaceMuted },
  iconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  optionCopy: { flex: 1, minWidth: 0, gap: 2 },
  optionTitle: { color: colors.text, fontSize: 17, lineHeight: 24, fontWeight: '700' },
  optionDescription: { color: colors.secondaryText, fontSize: 14, lineHeight: 20 },
});
