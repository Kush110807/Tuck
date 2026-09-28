import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import type { SearchFieldProps } from '../../contracts';
import { colors, minimumTouchSize, radii, space } from '../../theme/tokens';
import { AppIcon } from './AppIcon';

export function SearchField({ value, onChangeText, onClear }: SearchFieldProps) {
  return (
    <View style={styles.container}>
      <View style={styles.searchIcon} importantForAccessibility="no-hide-descendants">
        <AppIcon name="search" size={20} color={colors.secondaryText} />
      </View>
      <TextInput
        accessibilityLabel="Search saved items"
        placeholder="Search your Tuck"
        placeholderTextColor={colors.tertiaryText}
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
          <AppIcon name="close" size={21} color={colors.secondaryText} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 50,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    borderRadius: radii.control,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchIcon: { width: 42, minHeight: minimumTouchSize, alignItems: 'flex-end', justifyContent: 'center' },
  input: {
    flex: 1,
    minHeight: minimumTouchSize,
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
  },
  clear: { minWidth: minimumTouchSize, minHeight: minimumTouchSize, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.58 },
});
