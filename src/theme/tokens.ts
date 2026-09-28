/** Master-owned design tokens. Phase 1 teams request changes through master. */
export const colors = {
  background: '#F7F5F0',
  text: '#1F2937',
  primary: '#314D3A',
  secondaryText: '#596574',
  border: '#D2D8D2',
  error: '#A92336',
  surface: '#FFFFFF',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const minimumTouchSize = 44;
export const radii = { card: 16, control: 10, pill: 100 } as const;
