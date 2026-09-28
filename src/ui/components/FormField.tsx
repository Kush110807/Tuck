import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { FormFieldProps } from '../../contracts';
import { colors, minimumTouchSize, radii, space } from '../../theme/tokens';

export function FormField({ label, value, onChangeText, error, multiline = false, maxLength }: FormFieldProps) {
  const characterCount = Array.from(value).length;
  const handleChangeText = (next: string) => {
    if (maxLength === undefined) {
      onChangeText(next);
      return;
    }
    onChangeText(Array.from(next).slice(0, maxLength).join(''));
  };
  const errorId = error ? `${label.replace(/\s+/g, '-').toLowerCase()}-error` : undefined;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={error ? `Error: ${error}` : undefined}
        value={value}
        onChangeText={handleChangeText}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[styles.input, multiline && styles.multiline, error && styles.inputError]}
      />
      <View style={styles.supportRow}>
        {error ? <Text nativeID={errorId} accessibilityRole="alert" style={styles.error}>{error}</Text> : <View style={styles.supportSpacer} />}
        {maxLength ? <Text style={styles.count}>{characterCount.toLocaleString()} / {maxLength.toLocaleString()}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space.xs },
  label: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  input: {
    minHeight: 50,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    borderRadius: radii.control,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 16,
    lineHeight: 24,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  multiline: { minHeight: Math.max(148, minimumTouchSize) },
  inputError: { borderColor: colors.error },
  supportRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  supportSpacer: { flex: 1 },
  error: { flex: 1, color: colors.error, fontSize: 13, lineHeight: 19 },
  count: { color: colors.tertiaryText, fontSize: 12, lineHeight: 18, textAlign: 'right' },
});
