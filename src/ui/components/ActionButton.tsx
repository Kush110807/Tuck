import { Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import { colors, minimumTouchSize, radii, space } from '../../theme/tokens';

type ActionButtonProps = {
  label: string;
  onPress(): void;
  variant?: 'primary' | 'secondary' | 'danger' | 'text';
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: ViewStyle;
};

export function ActionButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  accessibilityLabel,
  style,
}: ActionButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'danger' && styles.danger,
        variant === 'text' && styles.textButton,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}
    >
      <Text
        style={[
          styles.label,
          variant === 'primary' && styles.primaryLabel,
          variant === 'secondary' && styles.secondaryLabel,
          variant === 'danger' && styles.dangerLabel,
          variant === 'text' && styles.textLabel,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: minimumTouchSize,
    minWidth: minimumTouchSize,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radii.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.surfaceMuted },
  danger: { backgroundColor: colors.error },
  textButton: { backgroundColor: 'transparent', paddingHorizontal: space.sm },
  label: { fontSize: 15, lineHeight: 21, fontWeight: '700', textAlign: 'center' },
  primaryLabel: { color: colors.surface },
  secondaryLabel: { color: colors.text },
  dangerLabel: { color: colors.surface },
  textLabel: { color: colors.primary },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.76 },
});
