import { StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, minimumTouchSize, radii, space } from '../../theme/tokens';
import { ActionButton } from './ActionButton';
import { TagChip } from './TagChip';

export function TagEditor({
  tags,
  entry,
  error,
  disabled,
  onEntryChange,
  onAdd,
  onRemove,
}: {
  tags: readonly string[];
  entry: string;
  error?: string;
  disabled: boolean;
  onEntryChange(value: string): void;
  onAdd(): void;
  onRemove(tagKey: string): void;
}) {
  return (
    <View style={styles.container}>
      <View style={styles.headingRow}>
        <Text style={styles.label}>Tags</Text>
        <Text style={styles.helper}>Optional · up to 8</Text>
      </View>
      {tags.length > 0 ? (
        <View style={styles.tags}>
          {tags.map(tag => (
            <TagChip key={tag.toLowerCase()} label={tag} onRemove={disabled ? undefined : () => onRemove(tag.toLowerCase())} />
          ))}
        </View>
      ) : null}
      <View style={styles.entryRow}>
        <TextInput
          accessibilityLabel="New tag"
          accessibilityHint="Enter a tag, then use Add tag"
          placeholder="Add a tag"
          placeholderTextColor={colors.tertiaryText}
          value={entry}
          onChangeText={onEntryChange}
          editable={!disabled}
          maxLength={48}
          returnKeyType="done"
          onSubmitEditing={onAdd}
          style={[styles.input, error && styles.inputError]}
        />
        <ActionButton label="Add" accessibilityLabel="Add tag" onPress={onAdd} variant="secondary" disabled={disabled} />
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Text style={styles.helper}>24 characters maximum per tag.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space.sm },
  headingRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm },
  label: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  entryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'stretch' },
  input: {
    flexGrow: 1,
    flexBasis: 180,
    minHeight: minimumTouchSize,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    borderRadius: radii.control,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  inputError: { borderColor: colors.error },
  error: { color: colors.error, fontSize: 13, lineHeight: 19 },
  helper: { color: colors.tertiaryText, fontSize: 12, lineHeight: 18 },
});
