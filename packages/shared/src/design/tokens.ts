// Canonical design tokens — referenced by Specs/design.md.
// Web mirrors these in apps/web/src/index.css :root block.

export const color = {
  primary: '#b25500',
  onPrimary: '#ffffff',
  primaryContainer: '#ffe0c8',
  onPrimaryContainer: '#5a2a00',
  surface: '#fffbf8',
  onSurface: '#1f1b16',
  surfaceVariant: '#f3ece5',
  onSurfaceVariant: '#514440',
  outline: '#847872',
  success: '#1e7a3a',
  warning: '#a67700',
  error: '#ba1a1a',
  info: '#0064a5',
  // 0.12 alpha tints for badges
  successTint: '#e8f3ec',
  warningTint: '#fff3d1',
  errorTint: '#fde4e4',
  overlay: 'rgba(0,0,0,0.4)',
} as const;

export const space = {
  s1: 4,
  s2: 8,
  s3: 12,
  s4: 16,
  s5: 24,
  s6: 32,
  s8: 48,
  s10: 64,
} as const;

export const radius = {
  sm: 6,
  md: 8,
  lg: 12,
  pill: 999,
} as const;

export const type = {
  display: { size: 32, line: 40, weight: '800' as const },
  h1: { size: 24, line: 32, weight: '700' as const },
  h2: { size: 18, line: 24, weight: '600' as const },
  body: { size: 14, line: 20, weight: '400' as const },
  bodyStrong: { size: 14, line: 20, weight: '600' as const },
  caption: { size: 12, line: 16, weight: '500' as const },
} as const;
