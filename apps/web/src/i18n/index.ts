import { createI18n } from 'vue-i18n';
import en from './locales/en.json';
import fa from './locales/fa.json';
import { DEFAULT_LOCALE, LOCALE_DIRECTION, LOCALE_STORAGE_KEY, detectLocale, type Locale } from './locale.ts';

function storedLocale(): string | null {
  try {
    return globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY) ?? null;
  } catch {
    // Storage can be unavailable (private mode, disabled cookies); detection still works.
    return null;
  }
}

export const i18n = createI18n({
  legacy: false,
  locale: detectLocale(storedLocale(), globalThis.navigator?.languages ?? []),
  fallbackLocale: DEFAULT_LOCALE,
  messages: { en, fa },
  /**
   * A raw key must never reach production UI (I18N-009). An empty string plus an
   * error signal is the safe fallback required by Requirements section 17.2.
   */
  missing: (locale, key) => {
    console.error(`[i18n] missing translation key "${key}" for locale "${locale}"`);
    return '';
  }
});

/** Applies the document-level language and direction required by section 17.5. */
export function applyDocumentLocale(locale: Locale): void {
  const root = globalThis.document?.documentElement;
  if (root === undefined) return;
  root.lang = locale;
  root.dir = LOCALE_DIRECTION[locale];
}

export function persistLocale(locale: Locale): void {
  try {
    globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // A failed preference write must never break navigation.
  }
}
