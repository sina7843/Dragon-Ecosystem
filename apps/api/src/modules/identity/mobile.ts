import { ValidationError } from '../../shared/errors.ts';

/**
 * Iranian mobile handling (ASM-001, SMS-003).
 *
 * Numbers are stored in E.164 canonical form and displayed in local format.
 * Persian and Arabic-Indic digits are accepted because that is what an Iranian
 * keyboard produces (section 17.4).
 */

const PERSIAN_DIGIT_BASE = 0x06f0;
const ARABIC_DIGIT_BASE = 0x0660;

/** Iranian mobile numbers are +98 followed by 9 and nine more digits. */
const E164_PATTERN = /^\+989\d{9}$/;

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

/**
 * Converts any accepted input form to E.164.
 * Accepts 09xxxxxxxxx, 9xxxxxxxxx, +989xxxxxxxxx, 00989xxxxxxxxx, and any of
 * those with spaces or dashes.
 */
export function normalizeIranianMobile(raw: string): string {
  const digitsOnly = normalizeDigits(raw).replace(/[\s()-]/g, '');

  let national: string;
  if (digitsOnly.startsWith('+98')) national = digitsOnly.slice(3);
  else if (digitsOnly.startsWith('0098')) national = digitsOnly.slice(4);
  else if (digitsOnly.startsWith('98') && digitsOnly.length === 12) national = digitsOnly.slice(2);
  else if (digitsOnly.startsWith('0')) national = digitsOnly.slice(1);
  else national = digitsOnly;

  const candidate = `+98${national}`;
  if (!E164_PATTERN.test(candidate)) {
    throw new ValidationError('The mobile number is not valid.', [
      { field: 'mobile', code: 'INVALID_MOBILE', message: 'Enter a valid Iranian mobile number.' }
    ]);
  }
  return candidate;
}

export function isIranianMobile(raw: string): boolean {
  try {
    normalizeIranianMobile(raw);
    return true;
  } catch {
    return false;
  }
}

/** Local presentation form, e.g. 09123456789. */
export function toLocalMobile(e164: string): string {
  if (!E164_PATTERN.test(e164)) throw new TypeError(`Not a canonical Iranian mobile: ${e164}`);
  return `0${e164.slice(3)}`;
}

/**
 * Masked form for logs, delivery records, and ordinary staff views
 * (SEC-012, SMS-004, ADMIN-008). Never reveals the full subscriber number.
 */
export function maskMobile(e164: string): string {
  if (!E164_PATTERN.test(e164)) return '***';
  return `${e164.slice(0, 6)}***${e164.slice(-2)}`;
}
