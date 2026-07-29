import type { IndexDeclaration } from '../../shared/db/collections.ts';

/** Collections owned by the education module (DATA-050..055). */
export const EDUCATION_COLLECTIONS = {
  coaches: 'coach_profiles',
  courses: 'courses',
  lessons: 'course_lessons',
  enrollments: 'course_enrollments',
  progress: 'lesson_progress',
  reviews: 'course_reviews'
} as const;

export const EDUCATION_INDEXES: readonly IndexDeclaration[] = [
  { collection: EDUCATION_COLLECTIONS.coaches, name: 'coach_slug_unique', keys: { slug: 1 }, options: { unique: true } },
  { collection: EDUCATION_COLLECTIONS.coaches, name: 'coach_account_unique', keys: { accountId: 1 }, options: { unique: true } },

  { collection: EDUCATION_COLLECTIONS.courses, name: 'course_slug_unique', keys: { slug: 1 }, options: { unique: true } },
  // The public catalog walks published courses in slug order; the compound index keeps
  // that walk inside matching rows instead of filtering the whole collection (PERF-010).
  { collection: EDUCATION_COLLECTIONS.courses, name: 'course_state_slug', keys: { state: 1, slug: 1 } },
  { collection: EDUCATION_COLLECTIONS.courses, name: 'course_state_game', keys: { state: 1, gameId: 1, slug: 1 } },
  { collection: EDUCATION_COLLECTIONS.courses, name: 'course_coach', keys: { coachId: 1, updatedAt: -1 } },
  { collection: EDUCATION_COLLECTIONS.courses, name: 'course_updatedAt', keys: { updatedAt: -1, _id: -1 } },

  // EDU-004: lesson order is explicit and unique within a course, so a curriculum can
  // never present two lessons at the same position.
  { collection: EDUCATION_COLLECTIONS.lessons, name: 'lesson_course_order_unique', keys: { courseId: 1, order: 1 }, options: { unique: true } },

  /**
   * DATA-053: one active enrollment per learner per course. Partial so a learner whose
   * enrollment was revoked or cancelled can enroll again, while a live one blocks a
   * duplicate — which is what makes paid activation safe to retry.
   */
  {
    collection: EDUCATION_COLLECTIONS.enrollments,
    name: 'enrollment_active_unique',
    keys: { courseId: 1, learnerId: 1 },
    options: { unique: true, partialFilterExpression: { state: { $in: ['pending', 'pending_payment', 'active', 'completed'] } } }
  },
  { collection: EDUCATION_COLLECTIONS.enrollments, name: 'enrollment_learner_created', keys: { learnerId: 1, createdAt: -1 } },
  { collection: EDUCATION_COLLECTIONS.enrollments, name: 'enrollment_course_state', keys: { courseId: 1, state: 1 } },
  // Serves the stuck-reservation scan: `{ state: { $in: [...] }, createdAt: { $lt } }`
  // sorted by createdAt. Without it that scan is a COLLSCAN over every enrolment ever
  // made, which is the opposite of what a recovery check should cost. The store's
  // equivalent `order_state_created` already existed.
  { collection: EDUCATION_COLLECTIONS.enrollments, name: 'enrollment_state_created', keys: { state: 1, createdAt: 1 } },
  { collection: EDUCATION_COLLECTIONS.enrollments, name: 'enrollment_business_ref_unique', keys: { businessRef: 1 }, options: { unique: true } },

  // DATA-054: one progress row per enrollment/lesson, so an idempotent update converges.
  { collection: EDUCATION_COLLECTIONS.progress, name: 'progress_enrollment_lesson_unique', keys: { enrollmentId: 1, lessonId: 1 }, options: { unique: true } },

  // DATA-055: one active review per eligible enrollment.
  {
    collection: EDUCATION_COLLECTIONS.reviews,
    name: 'review_enrollment_active_unique',
    keys: { enrollmentId: 1 },
    options: { unique: true, partialFilterExpression: { state: { $in: ['pending', 'published'] } } }
  },
  { collection: EDUCATION_COLLECTIONS.reviews, name: 'review_course_state', keys: { courseId: 1, state: 1, createdAt: -1 } }
];
