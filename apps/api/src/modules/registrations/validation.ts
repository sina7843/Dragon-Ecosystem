import { ValidationError, type FieldError } from '../../shared/errors.ts';
import type { TournamentRecord } from '../tournaments/index.ts';
import type { ParticipantType, RegistrationAnswer } from './state.ts';

/**
 * Pure eligibility and answer validation for registration (TOURN-007, TOURN-008).
 * All external facts (profile presence, age, game identity) are resolved by the
 * caller and passed in, so this stays a deterministic, directly-testable core.
 */

export interface EligibilityFacts {
  tournament: TournamentRecord;
  now: Date;
  participantType: ParticipantType;
  hasCompleteProfile: boolean;
  age: number | null;
  hasGameIdentity: boolean;
}

/** Returns a localized-code problem list; empty means eligible. Never throws. */
export function eligibilityProblems(facts: EligibilityFacts): FieldError[] {
  const problems: FieldError[] = [];
  const t = facts.tournament;

  if (facts.participantType !== t.participantType) {
    problems.push({ field: 'participantType', code: 'PARTICIPANT_TYPE_MISMATCH', message: `This tournament accepts ${t.participantType} entries.` });
  }

  const nowMs = facts.now.getTime();
  if (t.registration.opensAt !== null && nowMs < Date.parse(t.registration.opensAt)) {
    problems.push({ field: 'registration', code: 'REGISTRATION_NOT_OPEN', message: 'Registration has not opened yet.' });
  }
  if (t.registration.closesAt !== null && nowMs >= Date.parse(t.registration.closesAt)) {
    problems.push({ field: 'registration', code: 'REGISTRATION_CLOSED', message: 'Registration has closed.' });
  }

  if (t.eligibility.requireCompleteProfile && !facts.hasCompleteProfile) {
    problems.push({ field: 'profile', code: 'PROFILE_REQUIRED', message: 'Complete your profile before registering.' });
  }
  if (t.eligibility.minAge !== null && (facts.age === null || facts.age < t.eligibility.minAge)) {
    problems.push({ field: 'age', code: 'BELOW_MINIMUM_AGE', message: `You must be at least ${String(t.eligibility.minAge)} to register.` });
  }
  if (t.eligibility.requireGameIdentity && !facts.hasGameIdentity) {
    problems.push({ field: 'gameIdentity', code: 'GAME_IDENTITY_REQUIRED', message: 'Set your in-game identity for this game before registering.' });
  }
  return problems;
}

/** Longest accepted free-text answer, so a form cannot be used to store bulk data. */
const ANSWER_MAX = 2000;

/**
 * Iranian national identity number: ten digits with a check digit.
 *
 * Ten repeated digits (`0000000000`) satisfy the arithmetic but are not issued, so they
 * are rejected explicitly. Validating here means a typo is caught at registration rather
 * than at check-in, which is the whole reason to offer the type instead of free text.
 */
function isValidNationalId(value: string): boolean {
  if (!/^\d{10}$/.test(value)) return false;
  if (/^(\d)\1{9}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const checkDigit = digits[9] as number;
  const sum = digits.slice(0, 9).reduce((total, digit, i) => total + digit * (10 - i), 0);
  const remainder = sum % 11;
  return remainder < 2 ? checkDigit === remainder : checkDigit === 11 - remainder;
}

/**
 * A media answer references an asset the media service already accepted and stored; the
 * answer itself never carries bytes. Mirrors the cover-image rule used across the
 * product, so `javascript:` and `data:` values can never reach a rendered page.
 */
function isMediaReference(value: string): boolean {
  return value.startsWith('/media/') || value.startsWith('https://');
}

/** Parses a `multi_choice` value: a comma-separated list of option indices. */
function parseChoiceIndices(value: string, optionCount: number): number[] | null {
  const parts = value.split(',').map((part) => part.trim()).filter((part) => part !== '');
  if (parts.length === 0) return null;
  const indices = parts.map(Number);
  if (indices.some((n) => !Number.isInteger(n) || n < 0 || n >= optionCount)) return null;
  if (new Set(indices).size !== indices.length) return null;
  return indices;
}

/**
 * Validates submitted answers against the tournament's current question set and stamps
 * the version (TOURN-007).
 *
 * Answers are stored as strings whatever the question type — a choice is its option
 * index, a multi-choice is a comma-separated index list, and a file or image is the
 * `/media/<id>` path of an already uploaded asset. Keeping one storage shape means adding
 * a question type never migrates existing registrations.
 *
 * Every type is checked here rather than trusted from the client, because the client form
 * is a convenience: a direct API call must be held to the same rules.
 */
export function buildAnswers(
  questionSet: TournamentRecord['questionSet'],
  input: Array<{ key: string; value: string }> | undefined
): { answers: RegistrationAnswer[]; version: number } {
  const provided = new Map((input ?? []).map((a) => [a.key, (a.value ?? '').trim()]));
  const answers: RegistrationAnswer[] = [];
  const problems: FieldError[] = [];

  for (const question of questionSet.questions) {
    const field = `answers.${question.key}`;
    const value = provided.get(question.key) ?? '';
    if (value === '') {
      if (question.required) problems.push({ field, code: 'ANSWER_REQUIRED', message: 'This question requires an answer.' });
      continue;
    }
    if (value.length > ANSWER_MAX) {
      problems.push({ field, code: 'ANSWER_TOO_LONG', message: `Keep the answer under ${String(ANSWER_MAX)} characters.` });
      continue;
    }

    switch (question.type) {
      case 'single_choice': {
        const index = Number(value);
        if (!Number.isInteger(index) || index < 0 || index >= question.options.length) {
          problems.push({ field, code: 'INVALID_CHOICE', message: 'Choose one of the provided options.' });
          continue;
        }
        break;
      }
      case 'multi_choice': {
        if (parseChoiceIndices(value, question.options.length) === null) {
          problems.push({ field, code: 'INVALID_CHOICE', message: 'Choose one or more of the provided options.' });
          continue;
        }
        break;
      }
      case 'number': {
        if (!/^-?\d+(\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) {
          problems.push({ field, code: 'INVALID_NUMBER', message: 'Enter a number.' });
          continue;
        }
        break;
      }
      case 'national_id': {
        if (!isValidNationalId(value)) {
          problems.push({ field, code: 'INVALID_NATIONAL_ID', message: 'Enter a valid 10-digit national identity number.' });
          continue;
        }
        break;
      }
      case 'file':
      case 'image': {
        if (!isMediaReference(value)) {
          problems.push({ field, code: 'INVALID_MEDIA_REF', message: 'Upload a file and submit the reference it returns.' });
          continue;
        }
        break;
      }
      case 'short_text':
      case 'long_text':
        break;
    }
    answers.push({ key: question.key, value });
  }

  if (problems.length > 0) throw new ValidationError('Some answers are missing or invalid.', problems);
  return { answers, version: questionSet.version };
}
