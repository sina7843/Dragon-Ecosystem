import type { Locale } from './locale.ts';

/**
 * Locale-aware formatting (Requirements section 17.4).
 *
 * - Times are stored in UTC and displayed in the selected time zone (DEC-005).
 * - Number grouping and digit presentation are locale-aware without changing the
 *   stored value.
 * - Rial is the stored fiat unit; Toman is the user-facing convention. Nothing
 *   here labels a value, so a rial amount can never be shown as if it were Toman.
 */

/** BCP 47 tags used for Intl. Persian formatting uses the Iranian regional defaults. */
const INTL_LOCALE: Readonly<Record<Locale, string>> = {
  fa: 'fa-IR',
  en: 'en-US'
};

/**
 * 1 Toman = 10 rial. The authoritative Money contract lives in the API
 * (`apps/api/src/shared/money.ts`); this is the display-side mirror.
 * ponytail: duplicated constant, extract a shared package if a third consumer appears.
 */
export const RIAL_PER_TOMAN = 10;

export function intlLocale(locale: Locale): string {
  return INTL_LOCALE[locale];
}

export function formatNumber(value: number, locale: Locale, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(intlLocale(locale), options).format(value);
}

export function formatDate(
  value: Date | string,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }
): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new TypeError(`Invalid date: ${String(value)}`);
  return new Intl.DateTimeFormat(intlLocale(locale), options).format(date);
}

export function formatDateTime(
  value: Date | string,
  locale: Locale,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }
): string {
  return formatDate(value, locale, { ...options, timeZone });
}

/** The viewer's own IANA time zone, used to localize UTC-stored times (TOURN-019). */
export function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Splits a stored integer rial amount into its Toman value and any rial
 * remainder. The remainder is returned rather than rounded away so a caller can
 * never silently lose money in the display layer.
 */
export function rialToTomanParts(rialAmount: number): { toman: number; rialRemainder: number } {
  if (!Number.isSafeInteger(rialAmount)) {
    throw new RangeError(`rial amount must be a safe integer, received ${String(rialAmount)}`);
  }
  const sign = rialAmount < 0 ? -1 : 1;
  const magnitude = Math.abs(rialAmount);
  return {
    toman: sign * Math.trunc(magnitude / RIAL_PER_TOMAN),
    rialRemainder: sign * (magnitude % RIAL_PER_TOMAN)
  };
}

/**
 * Formats a stored rial amount as a localized Toman number. The caller supplies
 * the localized unit label, so the currency name always comes from the locale
 * bundle rather than being hardcoded here (I18N-008).
 */
export function formatTomanValue(rialAmount: number, locale: Locale): string {
  const { toman } = rialToTomanParts(rialAmount);
  return formatNumber(toman, locale);
}

const PERSIAN_DIGIT_BASE = 0x06f0;
const ARABIC_DIGIT_BASE = 0x0660;

/**
 * Normalises Persian and Arabic-Indic digits to Latin so numeric fields accept
 * what a Persian keyboard produces (section 17.4). Non-digit characters are
 * preserved untouched.
 */
export function normalizeDigits(input: string): string {
  let result = '';
  for (const character of input) {
    const code = character.codePointAt(0) ?? 0;
    if (code >= PERSIAN_DIGIT_BASE && code <= PERSIAN_DIGIT_BASE + 9) {
      result += String(code - PERSIAN_DIGIT_BASE);
    } else if (code >= ARABIC_DIGIT_BASE && code <= ARABIC_DIGIT_BASE + 9) {
      result += String(code - ARABIC_DIGIT_BASE);
    } else {
      result += character;
    }
  }
  return result;
}
