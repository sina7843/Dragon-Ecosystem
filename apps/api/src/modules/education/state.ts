import type { EntityId } from '../../shared/ids.ts';
import type { Money } from '../../shared/money.ts';

/**
 * Education contracts (EDU-001..012, DATA-050..055).
 *
 * A course is authored and published like any other editorial resource, but access to
 * its lessons is gated on two independent facts: an enrollment in an access-granting
 * state, and — for a paid course — the entitlement that enrollment was activated by
 * (BR-024). Neither alone is sufficient, which is what makes revocation effective.
 */

export const LOCALES = ['fa', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

// --- Coach (DATA-050, EDU-011) ---

/**
 * A coach's public identity. Deliberately narrow: only the fields an education manager
 * has approved for publication live here, so there is no private contact or payment
 * field that could leak through a projection mistake — the data simply is not stored.
 */
export interface CoachProfileRecord {
  _id: EntityId;
  accountId: EntityId;
  slug: string;
  translations: Record<Locale, { displayName: string; bio: string }>;
  gameIds: string[];
  avatarUrl: string | null;
  /** Only an approved coach can own a published course (EDU-009). */
  approved: boolean;
  approvedBy: EntityId | null;
  approvedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// --- Course (DATA-051) ---

export const COURSE_STATES = ['draft', 'review', 'published', 'unpublished', 'archived'] as const;
export type CourseState = (typeof COURSE_STATES)[number];

/** Section 12.10 exactly. `archived` is terminal; `unpublished` can return to review. */
const COURSE_TRANSITIONS: Readonly<Record<CourseState, readonly CourseState[]>> = {
  draft: ['review', 'archived'],
  review: ['published', 'draft', 'archived'],
  published: ['unpublished', 'archived'],
  unpublished: ['review', 'published', 'archived'],
  archived: []
};

export function canCourseTransition(from: CourseState, to: CourseState): boolean {
  return COURSE_TRANSITIONS[from].includes(to);
}

/** A visitor may read a published course only. Everything else is authoring state (EDU-001). */
export function isCoursePubliclyReadable(state: CourseState): boolean {
  return state === 'published';
}

export const ACCESS_MODELS = ['free', 'paid'] as const;
export type AccessModel = (typeof ACCESS_MODELS)[number];

/**
 * Completion rule (EDU-007). Deterministic by construction: completion is a pure
 * function of which required lessons are complete, so the same progress inputs always
 * produce the same result.
 */
export interface CompletionRule {
  kind: 'all_required_lessons';
  /** Percentage of required lessons that must be complete, 1..100. */
  thresholdPercent: number;
}

export interface CourseRecord {
  _id: EntityId;
  slug: string;
  state: CourseState;
  translations: Record<Locale, { title: string; summary: string; description: string }>;
  gameId: string | null;
  coachId: EntityId | null;
  accessModel: AccessModel;
  /** Exact integer price components. Empty for a free course. */
  price: Money[];
  completionRule: CompletionRule;
  coverImageUrl: string | null;
  /** Bumped on every publication, so an enrollment records which curriculum it bought. */
  publishedVersion: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

// --- Lesson (DATA-052, EDU-003) ---

/**
 * Lesson content types. `exercise` and `quiz` are deliberately absent: EDU-003 permits
 * only *approved* exercise types and OD-016 has approved none, so an unsupported type is
 * rejected rather than half-built (see `validateLessonType`).
 */
export const LESSON_TYPES = ['text', 'video', 'file'] as const;
export type LessonType = (typeof LESSON_TYPES)[number];

export interface LessonRecord {
  _id: EntityId;
  courseId: EntityId;
  type: LessonType;
  /** Explicit ordering (EDU-004); unique per course. */
  order: number;
  /** Lessons that must be complete first. A learner cannot open a locked lesson. */
  prerequisiteLessonIds: EntityId[];
  /** Whether this lesson counts toward completion. */
  required: boolean;
  translations: Record<Locale, { title: string; body: string }>;
  /** Media path for a video or file lesson; requires an active entitlement (MEDIA-012). */
  mediaUrl: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// --- Enrollment (DATA-053, EDU-005) ---

export const ENROLLMENT_STATES = [
  'pending',
  'pending_payment',
  'active',
  'completed',
  'revoked',
  'refunded',
  'cancelled'
] as const;
export type EnrollmentState = (typeof ENROLLMENT_STATES)[number];

/**
 * Section 12.10: free runs pending → active → completed, paid runs
 * pending_payment → active → completed, and the applicable states may move to
 * revoked / refunded / cancelled.
 */
const ENROLLMENT_TRANSITIONS: Readonly<Record<EnrollmentState, readonly EnrollmentState[]>> = {
  pending: ['active', 'cancelled'],
  pending_payment: ['active', 'cancelled'],
  active: ['completed', 'revoked', 'refunded', 'cancelled'],
  completed: ['revoked', 'refunded'],
  revoked: [],
  refunded: [],
  cancelled: []
};

export function canEnrollmentTransition(from: EnrollmentState, to: EnrollmentState): boolean {
  return ENROLLMENT_TRANSITIONS[from].includes(to);
}

/**
 * States that hold a live seat. Used for the unique-active-enrollment index and for
 * deciding whether a re-enrollment is a duplicate or a fresh start after revocation.
 */
export const ACTIVE_ENROLLMENT_STATES: readonly EnrollmentState[] = ['pending', 'pending_payment', 'active', 'completed'];

/** States that grant lesson access. `completed` keeps access; revoked/refunded do not (EDU-005). */
export function grantsCourseAccess(state: EnrollmentState): boolean {
  return state === 'active' || state === 'completed';
}

export interface EnrollmentRecord {
  _id: EntityId;
  courseId: EntityId;
  learnerId: EntityId;
  state: EnrollmentState;
  accessModel: AccessModel;
  /** Curriculum version bought, so a later republish cannot silently change what was paid for. */
  courseVersion: number;
  /**
   * The entitlement this enrollment's access depends on (EDU-005). For a free course
   * the enrollment is its own entitlement and this is null; for a paid one it is the
   * Dragon Coin hold that was captured, which is the durable proof of purchase.
   */
  entitlementId: EntityId | null;
  entitlementState: 'none' | 'pending' | 'active' | 'revoked';
  /** Exact integer amount paid, mirrored from the course price at enrolment time. */
  paidAmount: Money[];
  /** Durable business reference; one per learner per course attempt. */
  businessRef: string;
  revokedReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
  completedAt: string | null;
}

// --- Progress (DATA-054, EDU-006) ---

export interface LessonProgressRecord {
  _id: EntityId;
  enrollmentId: EntityId;
  lessonId: EntityId;
  learnerId: EntityId;
  /** 0..100. Monotonic: a later report never lowers recorded progress. */
  percent: number;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

// --- Review (DATA-055, EDU-008) ---

export const REVIEW_STATES = ['pending', 'published', 'removed'] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export interface CourseReviewRecord {
  _id: EntityId;
  courseId: EntityId;
  enrollmentId: EntityId;
  learnerId: EntityId;
  rating: number;
  body: string;
  /** Reviews are moderated before they are public (EDU-008). */
  state: ReviewState;
  moderatedBy: EntityId | null;
  moderatedReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Completion decision (EDU-007). Pure, so the same inputs always yield the same answer.
 * A course with no required lessons is never auto-completed — there is nothing to measure.
 */
export function isCourseComplete(
  requiredLessonIds: readonly EntityId[],
  completedLessonIds: readonly EntityId[],
  rule: CompletionRule
): boolean {
  if (requiredLessonIds.length === 0) return false;
  const completed = new Set(completedLessonIds);
  const done = requiredLessonIds.filter((id) => completed.has(id)).length;
  return (done * 100) / requiredLessonIds.length >= rule.thresholdPercent;
}
