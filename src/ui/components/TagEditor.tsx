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
      <Text style={styles.label}>Tags</Text>
      {tags.length > 0 ? (
        <View style={styles.tags}>
          {tags.map(tag => (
            <TagChip key={tag.toLowerCase()} label={tag} onRemove={disabled ? undefined : () => onRemove(tag.toLowerCase())} />
          ))}
        </View>
      ) : <Text style={styles.helper}>No tags added.</Text>}
      <View style={styles.entryRow}>
        <TextInput
          accessibilityLabel="New tag"
          accessibilityHint="Enter a tag, then use Add tag"
          value={entry}
          onChangeText={onEntryChange}
          editable={!disabled}
          maxLength={48}
          returnKeyType="done"
          onSubmitEditing={onAdd}
          style={[styles.input, error && styles.inputError]}
        />
        <ActionButton label="Add tag" onPress={onAdd} variant="secondary" disabled={disabled} />
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Text style={styles.helper}>Up to 8 tags, 24 characters each.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space.sm },
  label: { color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: '700' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  entryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'stretch' },
  input: {
    flexGrow: 1,
    flexBasis: 180,
    minHeight: minimumTouchSize,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.control,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  inputError: { borderColor: colors.error },
  error: { color: colors.error, fontSize: 14, lineHeight: 20 },
  helper: { color: colors.secondaryText, fontSize: 13, lineHeight: 19 },
});
