// Design tokens for the light-only v1 palette (SPEC.md - Styling and
// theming). Plain StyleSheet consumes these; identical pixels on both
// platforms keeps success criterion #1 mechanical.

export const colors = {
  // Brand blues seeded from the splash/adaptive-icon assets.
  primary: '#208AEF',
  primaryLight: '#E6F4FE',
  primaryDark: '#1668B8',

  background: '#FFFFFF',
  surface: '#F7F9FB',
  border: '#E2E8F0',

  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#94A3B8',
  textOnPrimary: '#FFFFFF',

  danger: '#DC2626',
  dangerLight: '#FEE2E2',
  warning: '#B45309',
  warningLight: '#FEF3C7',
  success: '#15803D',
  successLight: '#DCFCE7',

  // Dimmed retraction state for retried drafts (SPEC.md - Live assembly
  // motion): rows desaturate to ~60% opacity over this wash.
  dimmedOverlay: 'rgba(255, 255, 255, 0.4)',
  recording: '#EF4444',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
} as const;

export const type = {
  title: { fontSize: 28, fontWeight: '700' },
  heading: { fontSize: 20, fontWeight: '600' },
  body: { fontSize: 16, fontWeight: '400' },
  bodyBold: { fontSize: 16, fontWeight: '600' },
  caption: { fontSize: 13, fontWeight: '400' },
  captionBold: { fontSize: 13, fontWeight: '600' },
  mono: { fontSize: 12, fontFamily: 'monospace' },
} as const;
