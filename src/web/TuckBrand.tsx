import { StyleSheet, Text, View } from 'react-native';

const brand = {
  forest: '#1F3D32',
  forestFront: '#2E4A3A',
  sage: '#C8D4C7',
  ivory: '#FAF8F2',
  charcoal: '#1F1F1E',
} as const;

function FoldedNoteMark({ size }: { size: number }) {
  const cardWidth = size * 0.42;
  const cardHeight = size * 0.68;
  const foldSize = size * 0.105;
  return (
    <View accessible={false} style={{ width: size, height: size }}>
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: size * 0.13,
          bottom: 0,
          borderRadius: size * 0.2,
          backgroundColor: brand.forest,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: size * 0.01,
          left: (size - cardWidth) / 2,
          width: cardWidth,
          height: cardHeight,
          borderRadius: size * 0.065,
          backgroundColor: brand.ivory,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            width: foldSize,
            height: foldSize,
            backgroundColor: brand.sage,
            transform: [{ rotate: '45deg' }, { translateX: foldSize * 0.3 }, { translateY: -foldSize * 0.3 }],
          }}
        />
      </View>
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: size * 0.52,
          bottom: 0,
          borderRadius: size * 0.2,
          backgroundColor: brand.forestFront,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: size * 0.17,
          right: size * 0.17,
          top: size * 0.52,
          height: size * 0.095,
          backgroundColor: brand.forestFront,
        }}
      />
    </View>
  );
}

export function TuckBrand({ compact = false, mobile = false }: { compact?: boolean; mobile?: boolean }) {
  const markSize = compact ? 30 : mobile ? 26 : 30;
  return (
    <View accessible={compact} accessibilityLabel={compact ? 'Tuck' : undefined} style={[styles.lockup, compact && styles.compactLockup]}>
      <FoldedNoteMark size={markSize} />
      {!compact ? <Text style={[styles.wordmark, mobile && styles.wordmarkMobile]}>Tuck</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  lockup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  compactLockup: {
    justifyContent: 'center',
  },
  wordmark: {
    color: brand.charcoal,
    fontFamily: 'system-ui',
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '750' as never,
    letterSpacing: -0.8,
  },
  wordmarkMobile: {
    fontSize: 24,
    lineHeight: 28,
    letterSpacing: -0.65,
  },
});
