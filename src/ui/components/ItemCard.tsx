import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ItemCardProps, SavedItem } from '../../contracts';
import { colors, minimumTouchSize, radii, space } from '../../theme/tokens';
import { getImagePresentation } from './imagePresentation';

function itemPreview(item: SavedItem): string {
  if (item.type === 'note') return item.body;
  if (item.type === 'link') return item.url;
  return item.body ?? 'Saved image';
}

const typeLabels = { note: 'Note', link: 'Link', image: 'Image' } as const;

export function ItemCard({ row, onPress }: ItemCardProps) {
  const { item, image } = row;
  const uri = image.kind === 'available' ? image.uri : null;
  const [renderFailed, setRenderFailed] = useState(false);
  useEffect(() => setRenderFailed(false), [uri]);
  const imagePresentation = getImagePresentation(image, renderFailed);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${typeLabels[item.type]}: ${item.title}`}
      accessibilityHint="Opens item details"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {item.type === 'image' ? (
        imagePresentation.kind === 'image' ? (
          <Image
            source={{ uri: imagePresentation.uri }}
            resizeMode="cover"
            accessibilityLabel={`${item.title} preview`}
            onError={() => setRenderFailed(true)}
            style={styles.image}
          />
        ) : (
          <View style={styles.imagePlaceholder} accessibilityLabel={imagePresentation.title}>
            <Text style={styles.imagePlaceholderText}>{imagePresentation.title}</Text>
          </View>
        )
      ) : null}
      <View style={styles.content}>
        <View style={styles.metaRow}>
          <Text style={styles.type}>{typeLabels[item.type]}</Text>
          {item.archived ? <Text style={styles.archived}>Archived</Text> : null}
        </View>
        <Text style={styles.title}>{item.title}</Text>
        <Text numberOfLines={2} style={styles.preview}>{itemPreview(item)}</Text>
        {item.tags.length > 0 ? (
          <View style={styles.tags} accessibilityLabel={`Tags: ${item.tags.join(', ')}`}>
            {item.tags.map(tag => <Text key={tag.toLowerCase()} style={styles.tag}>#{tag}</Text>)}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: minimumTouchSize,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  pressed: { opacity: 0.76 },
  image: { width: '100%', minHeight: 180, backgroundColor: colors.background },
  imagePlaceholder: { minHeight: 132, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  imagePlaceholderText: { color: colors.secondaryText, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  content: { padding: space.lg, gap: space.sm },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
  type: { color: colors.primary, fontSize: 12, lineHeight: 18, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  archived: { color: colors.secondaryText, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  title: { color: colors.text, fontSize: 20, lineHeight: 27, fontWeight: '700' },
  preview: { color: colors.secondaryText, fontSize: 15, lineHeight: 22 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tag: { color: colors.primary, fontSize: 13, lineHeight: 19, fontWeight: '600' },
});
