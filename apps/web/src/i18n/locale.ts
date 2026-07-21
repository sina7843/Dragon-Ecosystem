/**
 * Locale policy (Requirements section 17.1).
 * - I18N-001: supported locales are Persian and English.
 * - I18N-002: initial locale is detected from browser/device preference.
 * - I18N-003: unsupported or missing preference falls back to Persian.
 */

export const SUPPORTED_LOCALES = ['fa', 'en'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'fa';

/** Text direction per locale (Requirements section 17.5). */
export const LOCALE_DIRECTION: Readonly<Record<Locale, 'rtl' | 'ltr'>> = {
  fa: 'rtl',
  en: 'ltr'
};

/** Anonymous client preference key (I18N-006). Authenticated persistence arrives with accounts in DRAGON-03. */
export const LOCALE_STORAGE_KEY = 'dragon.locale';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Resolves the startup locale: a stored preference wins, then the first
 * browser preference whose base language is supported, then Persian.
 */
export function detectLocale(stored: string | null, preferred: readonly string[] = []): Locale {
  if (isLocale(stored)) return stored;

  for (const candidate of preferred) {
    const base = candidate.toLowerCase().split('-')[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}
