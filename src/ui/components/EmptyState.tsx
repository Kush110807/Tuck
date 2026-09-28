import { StyleSheet, Text, View } from 'react-native';
import type { EmptyStateProps } from '../../contracts';
import { colors, radii, space } from '../../theme/tokens';
import { ActionButton } from './ActionButton';

export function EmptyState({ title, message, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.container} accessibilityRole="summary">
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {actionLabel && onAction ? <ActionButton label={actionLabel} onPress={onAction} variant="secondary" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: space.xl,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    alignItems: 'center',
    gap: space.md,
  },
  title: { color: colors.text, fontSize: 20, lineHeight: 28, fontWeight: '700', textAlign: 'center' },
  message: { color: colors.secondaryText, fontSize: 16, lineHeight: 24, textAlign: 'center' },
});
