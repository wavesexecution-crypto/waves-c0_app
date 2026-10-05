/**
 * Waves Design System — Canonical Tokens
 * Single source for wavesco.in, dev.wavesco.in, and app.wavesco.in
 * Mirrors apps/web/lib/design-tokens.ts and is re-exported for sharing.
 *
 * This file is the canonical Waves brand DNA:
 * - Dark intelligence console foundation (OS) + light marketing fallback
 * - Palantir-inspired hierarchy + Ollama minimalism
 * - Precise mono/data typography, restrained borders, cinematic surfaces
 */

export const wavesTokens = {
  colors: {
    // Dark — truth for OS
    background: "222 47% 3.5%",
    foreground: "38 12% 96%",
    card: "222 36% 7.5%",
    cardHover: "222 30% 10.5%",
    popover: "222 36% 7.5%",
    surfaceElevated: "222 30% 10.5%",
    surfaceOverlay: "222 28% 13%",
    primary: "38 12% 96%",
    primaryForeground: "222 47% 3.5%",
    secondary: "222 30% 10.5%",
    muted: "222 28% 12%",
    mutedForeground: "222 10% 58%",
    textSecondary: "222 10% 62%",
    textFaint: "222 6% 38%",
    accent: "173 84% 42%",
    accentForeground: "222 47% 3.5%",
    accentSecondary: "262 83% 62%",
    border: "222 16% 14%",
    borderStrong: "222 16% 18%",
    glow: "173 84% 42%",
    // Light fallback
    light: {
      background: "36 33% 98%",
      foreground: "222 47% 7%",
      card: "0 0% 100%",
      border: "222 14% 88%",
      accent: "173 80% 40%",
    },
  },
  fonts: {
    display: "Instrument Sans",
    sans: "Geist",
    mono: "Geist Mono",
    fallbacks: {
      display: 'var(--font-display), system-ui, sans-serif',
      sans: 'var(--font-sans), system-ui, sans-serif',
      mono: 'var(--font-mono), ui-monospace, monospace',
    },
  },
  radii: {
    sm: "4px",
    md: "6px",
    lg: "8px",
    xl: "10px",
    "2xl": "12px",
  },
  spacing: {
    hairline: "0.5px",
  },
} as const;
