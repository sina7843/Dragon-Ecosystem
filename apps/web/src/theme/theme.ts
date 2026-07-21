/**
 * Theme selection (Requirements section 23.2, PAGE-015).
 *
 * The user picks light, dark, or system. Only the resolved value reaches the
 * document, and resolution is a pure function so it can be tested directly.
 */

export const THEME_MODES = ['light', 'dark', 'system'] as const;

export type ThemeMode = (typeof THEME_MODES)[number];
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'dragon.theme';
export const DEFAULT_THEME_MODE: ThemeMode = 'system';

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (THEME_MODES as readonly string[]).includes(value);
}

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return prefersDark ? 'dark' : 'light';
  return mode;
}

/** Reads a stored preference, falling back to the system default. */
export function readStoredThemeMode(stored: string | null): ThemeMode {
  return isThemeMode(stored) ? stored : DEFAULT_THEME_MODE;
}
