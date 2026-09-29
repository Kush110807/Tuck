import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ItemCardProps, SavedItem } from '../../contracts';
import { colors, minimumTouchSize, radii, space } from '../../theme/tokens';
import { AppIcon, type AppIconName } from './AppIcon';
import { getItemCardPresentation } from './itemCardModel';
const typeIcons: Record<SavedItem['type'], AppIconName> = { note: 'note', link: 'link', image: 'image' };


export function ItemCard({ row, onPress }: ItemCardProps) {
  const { item } = row;
  const uri = row.image.kind === 'available' ? row.image.uri : null;
  const [renderFailed, setRenderFailed] = useState(false);
  useEffect(() => setRenderFailed(false), [uri]);
  const presentation = getItemCardPresentation(row, renderFailed);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={presentation.accessibilityLabel}
      accessibilityHint="Opens item details"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.mainRow}>
        <View style={styles.content}>
          <View style={styles.eyebrowRow}>
            <AppIcon name={typeIcons[item.type]} size={15} color={colors.primary} />
            <Text style={styles.type}>{presentation.typeLabel}</Text>
            {item.archived ? <Text style={styles.archived}>Archived</Text> : null}
            <Text style={styles.dot}>•</Text>
            <Text style={styles.time}>{presentation.relativeTime}</Text>
            {item.pinned ? <View style={styles.pinWrap}><AppIcon name="bookmark" size={13} color={colors.primary} /></View> : null}
          </View>
          <Text style={styles.title}>{item.title}</Text>
          <Text numberOfLines={2} style={styles.preview}>{presentation.preview}</Text>
          {item.tags.length > 0 ? (
            <View style={styles.tags} accessibilityLabel={`Tags: ${item.tags.join(', ')}`}>
              {presentation.visibleTags.map(tag => <Text key={tag.toLowerCase()} style={styles.tag}>#{tag}</Text>)}
              {presentation.remainingTags > 0 ? <Text style={styles.moreTags}>+{presentation.remainingTags}</Text> : null}
            </View>
          ) : null}
        </View>

        {item.type === 'image' && presentation.image ? (
          presentation.image.kind === 'image' ? (
            <Image
              source={{ uri: presentation.image.uri }}
              resizeMode="cover"
              accessibilityLabel={`${item.title} preview`}
              onError={() => setRenderFailed(true)}
              style={styles.thumbnail}
            />
          ) : (
            <View style={styles.thumbnailFallback} accessibilityLabel={presentation.image.title}>
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
    paddingHorizontal: space.lg,
    paddingVertical: 18,
    elevation: 1,
    shadowColor: '#20241F',
    shadowOpacity: 0.035,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  pressed: { backgroundColor: colors.surfaceMuted },
  mainRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  content: { flex: 1, minWidth: 0, gap: space.xs },
  eyebrowRow: { minHeight: 18, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5 },
  type: { color: colors.primary, fontSize: 10, lineHeight: 15, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.65 },
  archived: { color: colors.secondaryText, fontSize: 11, lineHeight: 16, fontWeight: '700' },
  dot: { color: colors.tertiaryText, fontSize: 11, lineHeight: 16 },
  time: { color: colors.tertiaryText, fontSize: 10, lineHeight: 15, fontWeight: '600' },
  pinWrap: { marginLeft: 'auto', width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontSize: 18, lineHeight: 24, fontWeight: '800', letterSpacing: -0.15 },
  preview: { color: colors.secondaryText, fontSize: 14, lineHeight: 20 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, paddingTop: 2 },
  tag: { color: colors.primary, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  moreTags: { color: colors.tertiaryText, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  thumbnail: { width: 88, height: 88, borderRadius: 15, backgroundColor: colors.surfaceMuted },
  thumbnailFallback: {
    width: 88,
    height: 88,
    borderRadius: 15,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
