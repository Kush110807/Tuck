/** Shared visual tokens for Tuck's warm, quiet consumer UI. */
export const colors = {
  background: '#F6F3EC',
  surface: '#FFFEFB',
  surfaceMuted: '#EEEAE0',
  surfacePressed: '#E7E2D6',
  text: '#232622',
  secondaryText: '#596057',
  tertiaryText: '#62695F',
  primary: '#3F5A45',
  primaryPressed: '#334B39',
  primarySoft: '#E4EBE2',
  border: '#DCD8CE',
  divider: '#E7E2D8',
  error: '#9F3340',
  errorSoft: '#F7E7E9',
  overlay: 'rgba(28, 31, 27, 0.44)',
} as const;

export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 40,
} as const;

export const minimumTouchSize = 44;
export const fabSize = 56;
export const radii = { card: 18, control: 14, sheet: 24, pill: 100 } as const;
