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

/**
 * Validates submitted answers against the tournament's current question set and
 * stamps the version (TOURN-007). A single-choice answer's value is the option
 * index; a required question must be answered.
 */
export function buildAnswers(
  questionSet: TournamentRecord['questionSet'],
  input: Array<{ key: string; value: string }> | undefined
): { answers: RegistrationAnswer[]; version: number } {
  const provided = new Map((input ?? []).map((a) => [a.key, (a.value ?? '').trim()]));
  const answers: RegistrationAnswer[] = [];
  const problems: FieldError[] = [];

  for (const question of questionSet.questions) {
    const value = provided.get(question.key) ?? '';
    if (value === '') {
      if (question.required) problems.push({ field: `answers.${question.key}`, code: 'ANSWER_REQUIRED', message: 'This question requires an answer.' });
      continue;
    }
    if (question.type === 'single_choice') {
      const index = Number(value);
      if (!Number.isInteger(index) || index < 0 || index >= question.options.length) {
        problems.push({ field: `answers.${question.key}`, code: 'INVALID_CHOICE', message: 'Choose one of the provided options.' });
        continue;
      }
    }
    answers.push({ key: question.key, value });
  }

  if (problems.length > 0) throw new ValidationError('Some answers are missing or invalid.', problems);
  return { answers, version: questionSet.version };
}
