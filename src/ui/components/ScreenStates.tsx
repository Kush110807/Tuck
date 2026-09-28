import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { AppError } from '../../contracts';
import { colors, radii, space } from '../../theme/tokens';
import { ActionButton } from './ActionButton';

export function LoadingPanel({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.panel} accessibilityLiveRegion="polite">
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.message}>{label}</Text>
    </View>
  );
}

export function ErrorPanel({ title, error, onRetry }: { title: string; error: AppError; onRetry(): void }) {
  return (
    <View style={styles.panel} accessibilityLiveRegion="assertive">
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      <Text style={styles.message}>{error.message}</Text>
      <ActionButton label="Retry" onPress={onRetry} variant="secondary" />
    </View>
  );
}

export function InlineError({ message }: { message: string }) {
  return (
    <View accessibilityRole="alert" style={styles.inlineError}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    padding: space.xl,
    alignItems: 'center',
    gap: space.md,
  },
  title: { color: colors.text, fontSize: 20, lineHeight: 28, fontWeight: '700', textAlign: 'center' },
  message: { color: colors.secondaryText, fontSize: 16, lineHeight: 24, textAlign: 'center' },
  inlineError: { borderWidth: 1, borderColor: colors.error, borderRadius: radii.control, padding: space.md, backgroundColor: colors.surface },
  errorText: { color: colors.error, fontSize: 14, lineHeight: 21 },
});
