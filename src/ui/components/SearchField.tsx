import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { SearchFieldProps } from '../../contracts';
import { colors, minimumTouchSize, radii, space } from '../../theme/tokens';

export function SearchField({ value, onChangeText, onClear }: SearchFieldProps) {
  return (
    <View style={styles.container}>
      <TextInput
        accessibilityLabel="Search saved items"
        placeholder="Search title, content, URL or tag"
        placeholderTextColor={colors.secondaryText}
        value={value}
        onChangeText={onChangeText}
        autoCorrect={false}
        returnKeyType="search"
        style={styles.input}
      />
      {value.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={onClear}
          style={({ pressed }) => [styles.clear, pressed && styles.pressed]}
        >
          <Text style={styles.clearText}>×</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: minimumTouchSize,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.control,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    minHeight: minimumTouchSize,
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  clear: { minWidth: minimumTouchSize, minHeight: minimumTouchSize, alignItems: 'center', justifyContent: 'center' },
  clearText: { color: colors.secondaryText, fontSize: 24, lineHeight: 26 },
  pressed: { opacity: 0.62 },
});
