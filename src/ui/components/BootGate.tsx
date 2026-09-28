import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { BootGateProps } from '../../contracts';
import { colors, space } from '../../theme/tokens';
import { ActionButton } from './ActionButton';

export function BootGate({ state, onRetry }: BootGateProps) {
  if (state.kind === 'ready') return null;

  if (state.kind === 'initializing') {
    return (
      <View style={styles.container} accessibilityLiveRegion="polite">
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.title}>Opening Tuck…</Text>
        <Text style={styles.message}>Getting your saved items ready.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} accessibilityLiveRegion="assertive">
      <Text accessibilityRole="header" style={styles.title}>Tuck couldn’t start</Text>
      <Text style={styles.message}>{state.error.message}</Text>
      <ActionButton label="Retry" onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: space.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
  },
  title: { color: colors.text, fontSize: 24, lineHeight: 32, fontWeight: '700', textAlign: 'center' },
  message: { color: colors.secondaryText, fontSize: 16, lineHeight: 24, textAlign: 'center' },
});
