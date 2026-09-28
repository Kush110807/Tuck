import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { FormFieldProps } from '../../contracts';
import { colors, minimumTouchSize, radii, space } from '../../theme/tokens';

export function FormField({ label, value, onChangeText, error, multiline = false, maxLength }: FormFieldProps) {
  const errorId = error ? `${label.replace(/\s+/g, '-').toLowerCase()}-error` : undefined;
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={error ? `Error: ${error}` : undefined}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        maxLength={maxLength}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[styles.input, multiline && styles.multiline, error && styles.inputError]}
      />
      {error ? <Text nativeID={errorId} accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {maxLength ? <Text style={styles.count}>{value.length.toLocaleString()} / {maxLength.toLocaleString()}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space.xs },
  label: { color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: '700' },
  input: {
    minHeight: minimumTouchSize,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.control,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 16,
    lineHeight: 23,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  multiline: { minHeight: 132 },
  inputError: { borderColor: colors.error },
  error: { color: colors.error, fontSize: 14, lineHeight: 20 },
  count: { color: colors.secondaryText, fontSize: 12, lineHeight: 18, textAlign: 'right' },
});
