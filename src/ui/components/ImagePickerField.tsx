import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ImagePickerFieldProps } from '../../contracts';
import { colors, minimumTouchSize, radii, space } from '../../theme/tokens';

export function ImagePickerField({ image, error, disabled, onPick }: ImagePickerFieldProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>Image</Text>
      <View style={[styles.preview, error && styles.previewError]}>
        {image.kind === 'available' ? (
          <Image
            source={{ uri: image.uri }}
            resizeMode="cover"
            accessibilityLabel="Selected image preview"
            style={styles.image}
          />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderTitle}>{image.kind === 'missing' ? 'Image file missing' : 'No image selected'}</Text>
            <Text style={styles.placeholderMessage}>
              {image.kind === 'missing'
                ? 'The saved image cannot be found. You can choose a replacement.'
                : 'Choose a JPEG, PNG or WebP image.'}
            </Text>
          </View>
        )}
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={image.kind === 'none' ? 'Choose image' : 'Replace image'}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPick}
        style={({ pressed }) => [styles.button, disabled && styles.disabled, pressed && !disabled && styles.pressed]}
      >
        <Text style={styles.buttonText}>{image.kind === 'none' ? 'Choose image' : 'Replace image'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space.sm },
  label: { color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: '700' },
  preview: {
    minHeight: 180,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  previewError: { borderColor: colors.error },
  image: { width: '100%', minHeight: 220, backgroundColor: colors.background },
  placeholder: { minHeight: 180, padding: space.xl, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  placeholderTitle: { color: colors.text, fontSize: 17, lineHeight: 24, fontWeight: '700', textAlign: 'center' },
  placeholderMessage: { color: colors.secondaryText, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  error: { color: colors.error, fontSize: 14, lineHeight: 20 },
  button: {
    minHeight: minimumTouchSize,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radii.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  buttonText: { color: colors.primary, fontSize: 16, lineHeight: 22, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.7 },
});
