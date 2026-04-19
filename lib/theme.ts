'use client';

/**
 * Lightweight theme hook that maps design-system CSS variables to
 * inline-style-friendly values.  Used by artifact components that
 * need dynamic colours (dark-mode support for ForecastChart, ExecutionPlan, etc.).
 *
 * All values come from the CSS variables defined in globals.css so there is
 * one source of truth for the colour palette.
 */

export interface ThemeValues {
  /** Card / panel surface colour */
  surface: string;
  /** Secondary surface (slightly tinted bg) */
  surface2: string;
  /** Primary foreground text */
  text: string;
  /** Muted / secondary text */
  textMuted: string;
  /** Very subtle hint text */
  textSubtle: string;
  /** Border colour */
  border: string;
  /** Page background */
  background: string;
}

/**
 * Returns Veracity design-system colour values as plain CSS strings.
 * Reads from CSS variables so both light and future dark-mode variants
 * are handled automatically.
 *
 * Falls back to the design-system defaults when called server-side
 * (where `getComputedStyle` and CSS vars aren't available).
 */
export function useTheme(): ThemeValues {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    // SSR / server-component fallback — use hard-coded light-mode defaults
    return LIGHT_DEFAULTS;
  }

  const style = getComputedStyle(document.documentElement);

  function cssVar(name: string, fallback: string): string {
    const val = style.getPropertyValue(name).trim();
    return val || fallback;
  }

  return {
    surface:    cssVar('--card',       '#FFFFFF'),
    surface2:   cssVar('--muted',      '#F1F5F9'),
    text:       cssVar('--foreground', '#0F172A'),
    textMuted:  cssVar('--muted-foreground', '#64748B'),
    textSubtle: cssVar('--muted-foreground', '#94A3B8'),
    border:     cssVar('--border',     '#E2E8F0'),
    background: cssVar('--background', '#FAFAFA'),
  };
}

const LIGHT_DEFAULTS: ThemeValues = {
  surface:    '#FFFFFF',
  surface2:   '#F1F5F9',
  text:       '#0F172A',
  textMuted:  '#64748B',
  textSubtle: '#94A3B8',
  border:     '#E2E8F0',
  background: '#FAFAFA',
};
