import { ValidationError, type FieldError } from '../../shared/errors.ts';
import { dragonCoin, type Money } from '../../shared/money.ts';
import { sanitizeRichText } from '../content/sanitize.ts';
import {
  LESSON_TYPES,
  LOCALES,
  type AccessModel,
  type CompletionRule,
  type CourseRecord,
  type LessonRecord,
  type LessonType
} from './state.ts';

/**
 * Pure validators and builders for course authoring (FORM-017, EDU-003, EDU-009).
 *
 * Each `build*` returns the canonical stored shape or throws, so the service never has to
 * reason about half-validated input. Publication completeness is reported as one list, so
 * an author fixes a single form rather than rediscovering the next missing field.
 */

const TITLE_MAX = 160;
const SUMMARY_MAX = 600;
const BODY_MAX = 20_000;
const MAX_LESSONS_PER_COURSE = 200;
/** Domain ceiling for a price, well inside the safe-integer range. */
const MAX_AMOUNT = 1_000_000_000_000;

function trimField(value: string | undefined, max: number): string {
  return (value ?? '').trim().slice(0, max);
}

export interface CourseTranslationInput {
  title?: string;
  summary?: string;
  description?: string;
}

export function buildCourseTranslation(
  input: CourseTranslationInput | undefined,
  previous: CourseRecord['translations']['en']
): CourseRecord['translations']['en'] {
  return {
    title: trimField(input?.title ?? previous.title, TITLE_MAX),
    summary: trimField(input?.summary ?? previous.summary, SUMMARY_MAX),
    // Sanitised at the write boundary, so the public read path serves safe HTML.
    description: sanitizeRichText(input?.description ?? previous.description ?? '')
  };
}

export function emptyCourseTranslation(): CourseRecord['translations']['en'] {
  return { title: '', summary: '', description: '' };
}

export function emptyLessonTranslation(): LessonRecord['translations']['en'] {
  return { title: '', body: '' };
}

export function buildLessonTranslation(
  input: { title?: string; body?: string } | undefined,
  previous: LessonRecord['translations']['en']
): LessonRecord['translations']['en'] {
  return {
    title: trimField(input?.title ?? previous.title, TITLE_MAX),
    body: sanitizeRichText(input?.body ?? previous.body ?? '').slice(0, BODY_MAX)
  };
}

/**
 * EDU-003 permits text, video, files, and *approved* exercise types. OD-016 has approved
 * none, so an exercise or quiz is rejected by name with the decision cited rather than
 * silently coerced or half-implemented.
 */
export function validateLessonType(value: unknown, fallback: LessonType): LessonType {
  if (value === undefined) return fallback;
  if (value === 'exercise' || value === 'quiz') {
    throw new ValidationError('That lesson type is not available yet.', [
      {
        field: 'type',
        code: 'EXERCISE_TYPE_NOT_APPROVED',
        message: 'Quiz and exercise lessons are unavailable: no exercise type has been approved (OD-016).'
      }
    ]);
  }
  if (typeof value === 'string' && (LESSON_TYPES as readonly string[]).includes(value)) return value as LessonType;
  throw new ValidationError('The lesson type is not valid.', [
    { field: 'type', code: 'INVALID_LESSON_TYPE', message: `Use one of: ${LESSON_TYPES.join(', ')}.` }
  ]);
}

export function validateAccessModel(value: unknown, fallback: AccessModel): AccessModel {
  if (value === undefined) return fallback;
  if (value === 'free' || value === 'paid') return value;
  throw new ValidationError('The access model is not valid.', [
    { field: 'accessModel', code: 'INVALID_ACCESS_MODEL', message: 'Use "free" or "paid".' }
  ]);
}

export interface PriceInput {
  dragonCoinAmount?: number;
  tomanAmount?: number;
}

/**
 * Course price (EDU-002, EDU-010).
 *
 * Dragon Coin only. A Toman price is refused with OD-015 named: cash revenue on a
 * coach-owned course is exactly the commercial arrangement that decision governs
 * (ownership, refund, and any coach commercial terms), and Dragon Coin — which cannot be
 * redeemed or sold back — creates no cash obligation, refund path, or payout question.
 */
export function buildPrice(accessModel: AccessModel, input: PriceInput | undefined, paidCoursesEnabled: boolean): Money[] {
  if (accessModel === 'free') return [];
  if (!paidCoursesEnabled) {
    throw new ValidationError('Paid courses are not available yet.', [
      {
        field: 'accessModel',
        code: 'PAID_COURSES_DISABLED',
        message: 'Paid course enrolment is not activated (OD-015).'
      }
    ]);
  }
  if (input?.tomanAmount !== undefined) {
    throw new ValidationError('A Toman course price is not available yet.', [
      {
        field: 'price.tomanAmount',
        code: 'TOMAN_PRICE_NOT_APPROVED',
        message: 'Cash pricing needs approved course ownership, refund, and coach commercial terms (OD-015). Price in Dragon Coin.'
      }
    ]);
  }
  const amount = input?.dragonCoinAmount;
  if (!Number.isSafeInteger(amount) || (amount as number) <= 0 || (amount as number) > MAX_AMOUNT) {
    throw new ValidationError('The course price is not valid.', [
      { field: 'price.dragonCoinAmount', code: 'INVALID_AMOUNT', message: 'Use a whole number of Dragon Coin greater than zero.' }
    ]);
  }
  return [dragonCoin(amount as number)];
}

export function buildCompletionRule(input: { thresholdPercent?: number } | undefined, previous: CompletionRule): CompletionRule {
  if (input?.thresholdPercent === undefined) return previous;
  const threshold = input.thresholdPercent;
  if (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > 100) {
    throw new ValidationError('The completion rule is not valid.', [
      { field: 'completionRule.thresholdPercent', code: 'INVALID_THRESHOLD', message: 'Use a whole percentage from 1 to 100.' }
    ]);
  }
  return { kind: 'all_required_lessons', thresholdPercent: threshold };
}

export function validateLessonOrder(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_LESSONS_PER_COURSE) {
    throw new ValidationError('The lesson order is not valid.', [
      { field: 'order', code: 'INVALID_ORDER', message: `Use a whole number from 1 to ${String(MAX_LESSONS_PER_COURSE)}.` }
    ]);
  }
  return value as number;
}

/** Media reference: a site media path or an https URL (mirrors games/content, MEDIA-006). */
export function validateMediaUrl(url: string | null | undefined, fallback: string | null): string | null {
  if (url === undefined) return fallback;
  if (url === null || url === '') return null;
  const value = url.trim();
  if (value.startsWith('/') || value.startsWith('https://')) return value;
  throw new ValidationError('The media reference is not allowed.', [
    { field: 'mediaUrl', code: 'INVALID_MEDIA_REF', message: 'Use a site path or an https URL.' }
  ]);
}

export function validateRating(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 5) {
    throw new ValidationError('The rating is not valid.', [
      { field: 'rating', code: 'INVALID_RATING', message: 'Rate from 1 to 5.' }
    ]);
  }
  return value as number;
}

/**
 * Everything a course needs before it can be published (EDU-009), reported together.
 *
 * Ownership is part of the contract: a published course must name an *approved* coach, so
 * the platform never publishes content whose ownership has not been established.
 */
export function publicationProblems(
  course: CourseRecord,
  lessons: readonly LessonRecord[],
  coachApproved: boolean
): FieldError[] {
  const problems: FieldError[] = [];
  for (const locale of LOCALES) {
    const translation = course.translations[locale];
    if (translation.title.trim() === '') {
      problems.push({ field: `translations.${locale}.title`, code: 'REQUIRED_FOR_PUBLICATION', message: `The ${locale} title is required.` });
    }
    if (translation.summary.trim() === '') {
      problems.push({ field: `translations.${locale}.summary`, code: 'REQUIRED_FOR_PUBLICATION', message: `The ${locale} summary is required.` });
    }
  }
  if (course.coachId === null) {
    problems.push({ field: 'coachId', code: 'REQUIRED_FOR_PUBLICATION', message: 'Assign a coach who owns this course.' });
  } else if (!coachApproved) {
    problems.push({ field: 'coachId', code: 'COACH_NOT_APPROVED', message: 'The assigned coach is not approved.' });
  }
  if (lessons.length === 0) {
    problems.push({ field: 'lessons', code: 'REQUIRED_FOR_PUBLICATION', message: 'Add at least one lesson.' });
  }
  for (const locale of LOCALES) {
    const untranslated = lessons.filter((lesson) => lesson.translations[locale].title.trim() === '');
    if (untranslated.length > 0) {
      problems.push({
        field: `lessons.translations.${locale}.title`,
        code: 'REQUIRED_FOR_PUBLICATION',
        message: `${String(untranslated.length)} lesson(s) have no ${locale} title.`
      });
    }
  }
  if (!lessons.some((lesson) => lesson.required)) {
    problems.push({ field: 'lessons.required', code: 'REQUIRED_FOR_PUBLICATION', message: 'At least one lesson must count toward completion.' });
  }
  if (course.accessModel === 'paid' && course.price.length === 0) {
    problems.push({ field: 'price', code: 'REQUIRED_FOR_PUBLICATION', message: 'A paid course needs a price.' });
  }
  return problems;
}

/**
 * Prerequisite integrity (EDU-004): a prerequisite must exist in the same course and come
 * earlier in the order, so a curriculum can never contain an unreachable lesson.
 */
export function validatePrerequisites(
  prerequisiteLessonIds: readonly string[],
  order: number,
  siblings: readonly LessonRecord[],
  selfId: string | null
): string[] {
  const unique = [...new Set(prerequisiteLessonIds)];
  const byId = new Map(siblings.map((lesson) => [lesson._id, lesson]));
  const problems: FieldError[] = [];
  for (const id of unique) {
    if (id === selfId) {
      problems.push({ field: 'prerequisiteLessonIds', code: 'SELF_PREREQUISITE', message: 'A lesson cannot require itself.' });
      continue;
    }
    const sibling = byId.get(id);
    if (sibling === undefined) {
      problems.push({ field: 'prerequisiteLessonIds', code: 'UNKNOWN_PREREQUISITE', message: 'A prerequisite lesson is not in this course.' });
    } else if (sibling.order >= order) {
      problems.push({ field: 'prerequisiteLessonIds', code: 'PREREQUISITE_NOT_EARLIER', message: 'A prerequisite must come earlier in the course.' });
    }
  }
  if (problems.length > 0) throw new ValidationError('The prerequisites are not valid.', problems);
  return unique;
}
