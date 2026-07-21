import { ValidationError, type FieldError } from '../../shared/errors.ts';

/**
 * Profile validation (FORM-003, DEC-003).
 *
 * OD-028 is unresolved, so no reserved-name list and no change-frequency policy
 * is invented here. Only format and uniqueness are enforced; uniqueness lives in
 * the repository because it needs the database.
 */

/** DEC-003: minimum platform age is 13, with no custom guardian workflow (DEC-042). */
export const MINIMUM_AGE = 13;

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;
const USERNAME_PATTERN = /^[a-z0-9_]+$/;

export const DISPLAY_NAME_MIN_LENGTH = 1;
export const DISPLAY_NAME_MAX_LENGTH = 50;

function fieldError(field: string, code: string, message: string): FieldError {
  return { field, code, message };
}

/** Usernames are stored lowercase so comparisons and uniqueness are unambiguous. */
export function normalizeUsername(raw: string): string {
  const value = raw.trim().toLowerCase();
  const problems: FieldError[] = [];

  if (value.length < USERNAME_MIN_LENGTH || value.length > USERNAME_MAX_LENGTH) {
    problems.push(
      fieldError(
        'username',
        'INVALID_LENGTH',
        `Use between ${String(USERNAME_MIN_LENGTH)} and ${String(USERNAME_MAX_LENGTH)} characters.`
      )
    );
  } else if (!USERNAME_PATTERN.test(value)) {
    problems.push(
      fieldError('username', 'INVALID_FORMAT', 'Use lowercase letters, numbers, and underscore only.')
    );
  }

  if (problems.length > 0) throw new ValidationError('The username is not valid.', problems);
  return value;
}

export function validateDisplayName(raw: string): string {
  const value = raw.trim();
  if (value.length < DISPLAY_NAME_MIN_LENGTH || value.length > DISPLAY_NAME_MAX_LENGTH) {
    throw new ValidationError('The display name is not valid.', [
      fieldError(
        'displayName',
        'INVALID_LENGTH',
        `Use between ${String(DISPLAY_NAME_MIN_LENGTH)} and ${String(DISPLAY_NAME_MAX_LENGTH)} characters.`
      )
    ]);
  }
  return value;
}

/** Whole years elapsed, evaluated in UTC to match stored timestamps (DEC-005). */
export function calculateAge(birthDate: string, now: Date): number {
  const birth = new Date(`${birthDate}T00:00:00.000Z`);
  if (Number.isNaN(birth.getTime())) {
    throw new ValidationError('The birth date is not valid.', [
      fieldError('birthDate', 'INVALID_DATE', 'Enter a valid date.')
    ]);
  }

  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - birth.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

/**
 * Enforces the minimum age. Age-appropriate notices and privacy-by-default
 * settings apply to every account; there is no guardian-consent workflow.
 */
export function assertMinimumAge(birthDate: string, now: Date): void {
  const age = calculateAge(birthDate, now);
  if (age < 0) {
    throw new ValidationError('The birth date is not valid.', [
      fieldError('birthDate', 'INVALID_DATE', 'The date cannot be in the future.')
    ]);
  }
  if (age < MINIMUM_AGE) {
    throw new ValidationError('The account does not meet the minimum age.', [
      fieldError('birthDate', 'BELOW_MINIMUM_AGE', `You must be at least ${String(MINIMUM_AGE)} years old.`)
    ]);
  }
}

/** Rejects unknown IANA zones so stored preferences always format correctly. */
export function validateTimeZone(raw: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: raw });
    return raw;
  } catch {
    throw new ValidationError('The time zone is not valid.', [
      fieldError('timeZone', 'INVALID_TIME_ZONE', 'Choose a supported time zone.')
    ]);
  }
}
