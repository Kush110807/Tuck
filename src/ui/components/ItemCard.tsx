import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ItemCardProps, SavedItem } from '../../contracts';
import { colors, minimumTouchSize, radii, space } from '../../theme/tokens';
import { AppIcon, type AppIconName } from './AppIcon';
import { getImagePresentation } from './imagePresentation';
import { formatRelativeTime } from './itemCardModel';
function itemPreview(item: SavedItem): string {
  if (item.type === 'note') return item.body;
  if (item.type === 'link') return item.url;
  return item.body ?? 'Saved image';
}

const typeLabels = { note: 'Note', link: 'Link', image: 'Image' } as const;
const typeIcons: Record<SavedItem['type'], AppIconName> = { note: 'note', link: 'link', image: 'image' };


export function ItemCard({ row, onPress }: ItemCardProps) {
  const { item } = row;
  const uri = row.image.kind === 'available' ? row.image.uri : null;
  const [renderFailed, setRenderFailed] = useState(false);
  useEffect(() => setRenderFailed(false), [uri]);
  const imagePresentation = getImagePresentation(row.image, renderFailed);
  const visibleTags = item.tags.slice(0, 2);
  const remainingTags = Math.max(0, item.tags.length - visibleTags.length);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${typeLabels[item.type]}: ${item.title}`}
      accessibilityHint="Opens item details"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.mainRow}>
        <View style={styles.content}>
          <View style={styles.eyebrowRow}>
            <AppIcon name={typeIcons[item.type]} size={15} color={colors.primary} />
            <Text style={styles.type}>{typeLabels[item.type]}</Text>
            {item.archived ? <Text style={styles.archived}>Archived</Text> : null}
            <Text style={styles.dot}>•</Text>
            <Text style={styles.time}>{formatRelativeTime(item.updatedAt)}</Text>
          </View>
          <Text style={styles.title}>{item.title}</Text>
          <Text numberOfLines={2} style={styles.preview}>{itemPreview(item)}</Text>
          {item.tags.length > 0 ? (
            <View style={styles.tags} accessibilityLabel={`Tags: ${item.tags.join(', ')}`}>
              {visibleTags.map(tag => <Text key={tag.toLowerCase()} style={styles.tag}>#{tag}</Text>)}
              {remainingTags > 0 ? <Text style={styles.moreTags}>+{remainingTags}</Text> : null}
            </View>
          ) : null}
        </View>

        {item.type === 'image' ? (
          imagePresentation.kind === 'image' ? (
            <Image
              source={{ uri: imagePresentation.uri }}
              resizeMode="cover"
              accessibilityLabel={`${item.title} preview`}
              onError={() => setRenderFailed(true)}
              style={styles.thumbnail}
            />
          ) : (
            <View style={styles.thumbnailFallback} accessibilityLabel={imagePresentation.title}>
              <AppIcon name="image" size={24} color={colors.tertiaryText} />
            </View>
          )
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: minimumTouchSize,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    padding: space.lg,
  },
  pressed: { backgroundColor: colors.surfaceMuted },
  mainRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  content: { flex: 1, minWidth: 0, gap: space.xs },
  eyebrowRow: { minHeight: 20, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5 },
  type: { color: colors.primary, fontSize: 11, lineHeight: 16, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  archived: { color: colors.secondaryText, fontSize: 11, lineHeight: 16, fontWeight: '700' },
  dot: { color: colors.tertiaryText, fontSize: 11, lineHeight: 16 },
  time: { color: colors.tertiaryText, fontSize: 11, lineHeight: 16, fontWeight: '600' },
  title: { color: colors.text, fontSize: 18, lineHeight: 24, fontWeight: '700' },
  preview: { color: colors.secondaryText, fontSize: 14, lineHeight: 20 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, paddingTop: 2 },
  tag: { color: colors.primary, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  moreTags: { color: colors.tertiaryText, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  thumbnail: { width: 76, height: 76, borderRadius: 13, backgroundColor: colors.surfaceMuted },
  thumbnailFallback: {
    width: 76,
    height: 76,
    borderRadius: 13,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
