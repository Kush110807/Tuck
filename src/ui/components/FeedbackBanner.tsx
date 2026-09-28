import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { FeedbackBannerProps } from '../../contracts';
import { colors, minimumTouchSize, radii, space } from '../../theme/tokens';

export function FeedbackBanner({ feedback, onDismiss }: FeedbackBannerProps) {
  const isError = feedback.kind === 'error';
  return (
    <View
      accessibilityLiveRegion={isError ? 'assertive' : 'polite'}
      accessibilityRole={isError ? 'alert' : undefined}
      style={[styles.banner, isError && styles.errorBanner]}
    >
      <Text style={[styles.message, isError && styles.errorText]}>{feedback.message}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss message"
        onPress={onDismiss}
        style={({ pressed }) => [styles.dismiss, pressed && styles.pressed]}
      >
        <Text style={[styles.dismissText, isError && styles.errorText]}>Dismiss</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radii.control,
    paddingLeft: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  errorBanner: { borderColor: colors.error },
  message: { flex: 1, color: colors.text, fontSize: 15, lineHeight: 22, paddingVertical: space.md },
  errorText: { color: colors.error },
  dismiss: {
    minHeight: minimumTouchSize,
    minWidth: minimumTouchSize,
    paddingHorizontal: space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: { color: colors.primary, fontSize: 15, lineHeight: 20, fontWeight: '700' },
  pressed: { opacity: 0.65 },
});
