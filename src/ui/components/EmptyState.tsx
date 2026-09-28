import { StyleSheet, Text, View } from 'react-native';
import type { EmptyStateProps } from '../../contracts';
import { colors, space } from '../../theme/tokens';
import { ActionButton } from './ActionButton';
import { AppIcon } from './AppIcon';

export function EmptyState({ title, message, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.container} accessibilityRole="summary">
      <View style={styles.iconWrap} importantForAccessibility="no-hide-descendants">
        <AppIcon name="bookmark" size={24} color={colors.primary} />
      </View>
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {actionLabel && onAction ? <ActionButton label={actionLabel} onPress={onAction} variant="secondary" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingVertical: space.xxxl, paddingHorizontal: space.xl, alignItems: 'center', gap: space.md },
  iconWrap: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontSize: 20, lineHeight: 28, fontWeight: '800', textAlign: 'center' },
  message: { maxWidth: 360, color: colors.secondaryText, fontSize: 15, lineHeight: 23, textAlign: 'center' },
});
