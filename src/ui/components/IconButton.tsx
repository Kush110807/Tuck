import { Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { colors, minimumTouchSize, radii } from '../../theme/tokens';
import { AppIcon, type AppIconName } from './AppIcon';

type IconButtonProps = {
  icon: AppIconName;
  label: string;
  onPress(): void;
  disabled?: boolean;
  tone?: 'default' | 'primary' | 'danger';
  style?: ViewStyle;
};

export function IconButton({ icon, label, onPress, disabled = false, tone = 'default', style }: IconButtonProps) {
  const iconColor = tone === 'danger' ? colors.error : tone === 'primary' ? colors.primary : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        tone === 'primary' && styles.primary,
        tone === 'danger' && styles.danger,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}
    >
      <AppIcon name={icon} size={22} color={iconColor} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: minimumTouchSize, height: minimumTouchSize, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  primary: { backgroundColor: colors.primarySoft },
  danger: { backgroundColor: colors.errorSoft },
  disabled: { opacity: 0.45 },
  pressed: { backgroundColor: colors.surfacePressed },
});
