import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, space } from '../../theme/tokens';

type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  size?: 'large' | 'compact';
};

export function ScreenHeader({ title, subtitle, leading, trailing, size = 'large' }: ScreenHeaderProps) {
  return (
    <View style={styles.header}>
      {leading ? <View style={styles.edge}>{leading}</View> : null}
      <View style={styles.copy}>
        <Text accessibilityRole="header" style={[styles.title, size === 'compact' && styles.compactTitle]}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {trailing ? <View style={[styles.edge, styles.trailing]}>{trailing}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  edge: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  trailing: { alignItems: 'flex-end' },
  copy: { flex: 1, minWidth: 0, gap: space.xs, paddingTop: 2 },
  title: { color: colors.text, fontSize: 31, lineHeight: 38, fontWeight: '800', letterSpacing: -0.55 },
  compactTitle: { fontSize: 24, lineHeight: 31, letterSpacing: -0.25 },
  subtitle: { color: colors.secondaryText, fontSize: 15, lineHeight: 22 },
});
