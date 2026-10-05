/**
 * Waves Acquisition OS — Design Tokens
 * Palantir-level precision + Ollama minimalism + Waves brand identity
 * Centralized visual language for the entire intelligence console.
 *
 * This file is the single source of truth for:
 * - typography (families, sizes, weights, line-heights, tracking)
 * - spacing, radii, borders, surfaces, text, accents, shadows, glows, motion
 *
 * All components must import from here or use the CSS variables it defines.
 * Do not hardcode visual values in individual pages.
 */

// --- Font families (loaded via next/font in layout.tsx) ---
export const fontFamilies = {
  display: "var(--font-display)", // Instrument Sans — headings, page titles
  sans: "var(--font-sans)",       // Geist Sans — UI, body, navigation
  mono: "var(--font-mono)",       // Geist Mono — data, numbers, labels, tables
  numbers: "var(--font-mono)",    // tabular numbers always mono
} as const;

// --- Type scale (sharp, technical, restrained) ---
export const typeScale = {
  // Display — page titles, hero numbers
  display: {
    fontFamily: fontFamilies.display,
    fontSize: "1.875rem", // 30px
    lineHeight: "1.1",
    fontWeight: 600,
    letterSpacing: "-0.02em",
  },
  // Page titles (Command Center etc.)
  pageTitle: {
    fontFamily: fontFamilies.display,
    fontSize: "1.5rem", // 24px
    lineHeight: "1.15",
    fontWeight: 600,
    letterSpacing: "-0.018em",
  },
  // Section labels (ACQUISITION, AUTOMATION)
  sectionLabel: {
    fontFamily: fontFamilies.mono,
    fontSize: "0.6875rem", // 11px
    lineHeight: "1.4",
    fontWeight: 500,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
  },
  // KPI numbers — especially clean and technical
  kpi: {
    fontFamily: fontFamilies.mono,
    fontSize: "1.625rem", // 26px
    lineHeight: "1",
    fontWeight: 500,
    letterSpacing: "-0.02em",
    fontVariantNumeric: "tabular-nums",
  },
  // KPI numbers — large (hero)
  kpiLarge: {
    fontFamily: fontFamilies.mono,
    fontSize: "2rem", // 32px
    lineHeight: "1",
    fontWeight: 500,
    letterSpacing: "-0.025em",
    fontVariantNumeric: "tabular-nums",
  },
  // Metadata — timestamps, checked at, last updated
  meta: {
    fontFamily: fontFamilies.mono,
    fontSize: "0.6875rem", // 11px
    lineHeight: "1.5",
    fontWeight: 400,
    letterSpacing: "0.02em",
  },
  // Status labels — LIVE, CONNECTED
  status: {
    fontFamily: fontFamilies.mono,
    fontSize: "0.6875rem", // 11px
    lineHeight: "1",
    fontWeight: 500,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
  },
  // Navigation
  nav: {
    fontFamily: fontFamilies.sans,
    fontSize: "0.8125rem", // 13px
    lineHeight: "1.5",
    fontWeight: 500,
    letterSpacing: "-0.01em",
  },
  navActive: {
    fontFamily: fontFamilies.sans,
    fontSize: "0.8125rem",
    lineHeight: "1.5",
    fontWeight: 600,
    letterSpacing: "-0.01em",
  },
  // Table / data
  tableHeader: {
    fontFamily: fontFamilies.mono,
    fontSize: "0.6875rem", // 11px
    lineHeight: "1.5",
    fontWeight: 500,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
  },
  tableCell: {
    fontFamily: fontFamilies.sans,
    fontSize: "0.8125rem", // 13px
    lineHeight: "1.5",
    fontWeight: 400,
    letterSpacing: "-0.01em",
  },
  tableCellMono: {
    fontFamily: fontFamilies.mono,
    fontSize: "0.8125rem",
    lineHeight: "1.5",
    fontWeight: 400,
    letterSpacing: "-0.005em",
    fontVariantNumeric: "tabular-nums",
  },
  // Buttons
  button: {
    fontFamily: fontFamilies.sans,
    fontSize: "0.8125rem", // 13px
    lineHeight: "1",
    fontWeight: 500,
    letterSpacing: "-0.01em",
  },
  buttonSmall: {
    fontFamily: fontFamilies.mono,
    fontSize: "0.6875rem", // 11px
    lineHeight: "1",
    fontWeight: 500,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
  },
  // Body / description
  body: {
    fontFamily: fontFamilies.sans,
    fontSize: "0.875rem", // 14px
    lineHeight: "1.6",
    fontWeight: 400,
    letterSpacing: "-0.01em",
  },
  bodySmall: {
    fontFamily: fontFamilies.sans,
    fontSize: "0.8125rem", // 13px
    lineHeight: "1.6",
    fontWeight: 400,
    letterSpacing: "-0.01em",
  },
  // Card titles
  cardTitle: {
    fontFamily: fontFamilies.sans,
    fontSize: "0.9375rem", // 15px
    lineHeight: "1.4",
    fontWeight: 600,
    letterSpacing: "-0.012em",
  },
} as const;

// --- Spacing scale (4px base, precise) ---
export const spacing = {
  px: "1px",
  hairline: "0.5px",
  0: "0",
  1: "0.25rem", // 4
  2: "0.5rem",  // 8
  3: "0.75rem", // 12
  4: "1rem",    // 16
  5: "1.25rem", // 20
  6: "1.5rem",  // 24
  8: "2rem",    // 32
  10: "2.5rem", // 40
  12: "3rem",   // 48
  16: "4rem",   // 64
} as const;

// --- Radii (restrained, not excessive) ---
export const radii = {
  none: "0",
  sm: "4px",
  md: "6px",
  lg: "8px",
  xl: "10px",
  "2xl": "12px",
  full: "9999px",
} as const;

// --- Borders ---
export const borders = {
  hairline: "0.5px solid hsl(var(--border))",
  default: "1px solid hsl(var(--border))",
  strong: "1px solid hsl(var(--border-strong))",
} as const;

// --- Surfaces (dark intelligence console) ---
export const surfaces = {
  background: "hsl(var(--background))",
  card: "hsl(var(--card))",
  cardHover: "hsl(var(--card-hover))",
  elevated: "hsl(var(--surface-elevated))",
  overlay: "hsl(var(--surface-overlay))",
  muted: "hsl(var(--muted))",
} as const;

// --- Text hierarchy ---
export const textColors = {
  primary: "hsl(var(--foreground))",
  secondary: "hsl(var(--text-secondary))",
  muted: "hsl(var(--muted-foreground))",
  faint: "hsl(var(--text-faint))",
  inverse: "hsl(var(--primary-foreground))",
} as const;

// --- Accents (Waves brand, restrained) ---
export const accents = {
  primary: "hsl(var(--accent))", // Waves teal
  primaryForeground: "hsl(var(--accent-foreground))",
  secondary: "hsl(var(--accent-secondary))", // restrained violet for glow
  glow: "hsl(var(--accent) / 0.15)",
  glowStrong: "hsl(var(--accent) / 0.25)",
} as const;

// --- Shadows & glows (subtle, cinematic) ---
export const shadows = {
  card: "0 1px 2px hsl(222 47% 2% / 0.08), 0 4px 12px hsl(222 47% 2% / 0.06)",
  cardHover: "0 4px 16px hsl(222 47% 2% / 0.12), 0 1px 3px hsl(222 47% 2% / 0.08)",
  glow: "0 0 20px hsl(var(--accent) / 0.15)",
  glowStrong: "0 0 24px hsl(var(--accent) / 0.25)",
} as const;

// --- Motion (extremely subtle) ---
export const motion = {
  durationFast: "150ms",
  durationNormal: "200ms",
  durationSlow: "300ms",
  easeDefault: "cubic-bezier(0.16, 1, 0.3, 1)", // ease-out-expo, operational
  easeInOut: "cubic-bezier(0.4, 0, 0.2, 1)",
} as const;

// --- Grid ---
export const grid = {
  maxWidth: "1280px",
  sidebarWidth: "220px",
  topbarHeight: "56px",
} as const;
