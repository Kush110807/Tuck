import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { ImagePickerFieldProps } from '../../contracts';
import { colors, radii, space } from '../../theme/tokens';
import { ActionButton } from './ActionButton';
import { AppIcon } from './AppIcon';
import { getImagePresentation } from './imagePresentation';

export function ImagePickerField({ image, error, disabled, onPick, onRetry }: ImagePickerFieldProps) {
  const uri = image.kind === 'available' ? image.uri : null;
  const [renderFailed, setRenderFailed] = useState(false);
  useEffect(() => setRenderFailed(false), [uri]);

  const presentation = getImagePresentation(image, renderFailed);
  const retry = image.kind === 'unavailable' ? onRetry : renderFailed ? () => setRenderFailed(false) : undefined;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Image</Text>
      <View style={[styles.preview, error && styles.previewError]}>
        {presentation.kind === 'image' ? (
          <Image
            source={{ uri: presentation.uri }}
            resizeMode="cover"
            accessibilityLabel="Selected image preview"
            onError={() => setRenderFailed(true)}
            style={styles.image}
          />
        ) : (
          <View style={styles.placeholder}>
            <View style={styles.iconWrap} importantForAccessibility="no-hide-descendants">
              <AppIcon name="image" size={25} color={colors.primary} />
            </View>
            <Text style={styles.placeholderTitle}>{presentation.title}</Text>
            <Text style={styles.placeholderMessage}>{presentation.message}</Text>
          </View>
        )}
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <View style={styles.actions}>
        {retry ? <ActionButton label="Retry image" onPress={retry} variant="secondary" disabled={disabled} style={styles.action} /> : null}
        <ActionButton
          label={image.kind === 'none' ? 'Choose image' : 'Replace image'}
          onPress={onPick}
          variant="secondary"
          disabled={disabled}
          style={styles.action}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space.sm },
  label: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  preview: { minHeight: 180, borderRadius: radii.card, overflow: 'hidden', backgroundColor: colors.surfaceMuted },
  previewError: { borderWidth: 1, borderColor: colors.error },
  image: { width: '100%', minHeight: 230, backgroundColor: colors.surfaceMuted },
  placeholder: { minHeight: 180, padding: space.xl, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  iconWrap: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  placeholderTitle: { color: colors.text, fontSize: 17, lineHeight: 24, fontWeight: '700', textAlign: 'center' },
  placeholderMessage: { color: colors.secondaryText, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  error: { color: colors.error, fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  action: { flexGrow: 1 },
});
