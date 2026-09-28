import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { AppError } from '../../contracts';
import { colors, radii, space } from '../../theme/tokens';
import { ActionButton } from './ActionButton';

export function LoadingPanel({ label = 'Loading…', compact = false }: { label?: string; compact?: boolean }) {
  return (
    <View style={[styles.panel, compact && styles.compactPanel]} accessibilityLiveRegion="polite">
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.message}>{label}</Text>
    </View>
  );
}

export function ErrorPanel({
  title,
  error,
  onRetry,
  compact = false,
}: {
  title: string;
  error: AppError;
  onRetry(): void;
  compact?: boolean;
}) {
  return (
    <View style={[styles.panel, styles.errorPanel, compact && styles.compactPanel]} accessibilityLiveRegion="assertive">
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
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    padding: space.xl,
    alignItems: 'center',
    gap: space.md,
  },
  compactPanel: { alignItems: 'flex-start', paddingVertical: space.md, paddingHorizontal: space.lg },
  errorPanel: { backgroundColor: colors.errorSoft },
  title: { color: colors.text, fontSize: 19, lineHeight: 27, fontWeight: '800', textAlign: 'center' },
  message: { flexShrink: 1, color: colors.secondaryText, fontSize: 15, lineHeight: 23, textAlign: 'center' },
  inlineError: { borderRadius: radii.control, padding: space.md, backgroundColor: colors.errorSoft },
  errorText: { color: colors.error, fontSize: 14, lineHeight: 21 },
});
