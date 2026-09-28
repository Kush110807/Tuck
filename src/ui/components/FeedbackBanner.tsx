import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { FeedbackBannerProps } from '../../contracts';
import { colors, minimumTouchSize, radii, space } from '../../theme/tokens';
import { AppIcon } from './AppIcon';

export function FeedbackBanner({ feedback, onDismiss }: FeedbackBannerProps) {
  const isError = feedback.kind === 'error';
  return (
    <View
      accessibilityLiveRegion={isError ? 'assertive' : 'polite'}
      accessibilityRole={isError ? 'alert' : undefined}
      style={[styles.banner, isError && styles.errorBanner]}
    >
      <AppIcon
        name={isError ? 'alert' : feedback.kind === 'success' ? 'success' : 'info'}
        size={20}
        color={isError ? colors.error : colors.primary}
      />
      <Text style={[styles.message, isError && styles.errorText]}>{feedback.message}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss message"
        onPress={onDismiss}
        style={({ pressed }) => [styles.dismiss, pressed && styles.pressed]}
      >
        <AppIcon name="close" size={19} color={isError ? colors.error : colors.secondaryText} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.primarySoft,
    borderRadius: radii.control,
    paddingLeft: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  errorBanner: { backgroundColor: colors.errorSoft },
  message: { flex: 1, color: colors.text, fontSize: 14, lineHeight: 21, paddingVertical: space.md },
  errorText: { color: colors.error },
  dismiss: { minHeight: minimumTouchSize, minWidth: minimumTouchSize, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
});
