import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, minimumTouchSize, radii, space } from '../theme/tokens';

type Action = { label: string; onPress(): void };
export function PlaceholderScreen({ title, subtitle, actions }: {
  title: string; subtitle: string; actions: readonly Action[];
}) {
  return <ScrollView contentContainerStyle={styles.screen}>
    <Text style={styles.overline}>TUCK · PHASE 1A</Text>
    <Text style={styles.title}>{title}</Text>
    <Text style={styles.description}>{subtitle}</Text>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Scaffold placeholder</Text>
      <Text style={styles.description}>This route is ready for its Phase 1 screen. Saving, search, images, and persistence are not implemented yet.</Text>
    </View>
    {actions.map(action => <Pressable key={action.label} accessibilityRole="button"
      onPress={action.onPress} style={styles.button}>
      <Text style={styles.buttonText}>{action.label}</Text>
    </Pressable>)}
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: space.xl, backgroundColor: colors.background, gap: space.lg },
  overline: { color: colors.primary, fontWeight: '700', letterSpacing: 1 },
  title: { fontSize: 32, fontWeight: '700', color: colors.text },
  description: { fontSize: 16, lineHeight: 24, color: colors.secondaryText },
  card: { padding: space.xl, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.card, backgroundColor: colors.surface, gap: space.sm },
  cardTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  button: { minHeight: minimumTouchSize, padding: space.md, backgroundColor: colors.primary,
    borderRadius: radii.control, justifyContent: 'center' },
  buttonText: { color: colors.surface, fontWeight: '700', textAlign: 'center' },
});
