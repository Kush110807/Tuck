import { StyleSheet, Text, type TextStyle } from 'react-native';

export type AppIconName =
  | 'add'
  | 'close'
  | 'more'
  | 'back'
  | 'note'
  | 'link'
  | 'image'
  | 'archive'
  | 'chevron'
  | 'edit'
  | 'search'
  | 'options'
  | 'check'
  | 'alert'
  | 'success'
  | 'info'
  | 'bookmark';

const glyphs: Record<AppIconName, string> = {
  add: '+',
  close: '×',
  more: '•••',
  back: '←',
  note: '≡',
  link: '↗',
  image: '▧',
  archive: '↓',
  chevron: '›',
  edit: '✎',
  search: '⌕',
  options: '☷',
  check: '✓',
  alert: '!',
  success: '✓',
  info: 'i',
  bookmark: '⌑',
};

export function AppIcon({ name, size = 22, color, style }: {
  name: AppIconName;
  size?: number;
  color: string;
  style?: TextStyle;
}) {
  return (
    <Text
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      allowFontScaling={false}
      style={[styles.icon, { color, fontSize: size, lineHeight: Math.ceil(size * 1.05) }, style]}
    >
      {glyphs[name]}
    </Text>
  );
}

const styles = StyleSheet.create({
  icon: { fontWeight: '700', textAlign: 'center', includeFontPadding: false },
});
