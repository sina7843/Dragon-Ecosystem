import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ValidationError } from '../../shared/errors.ts';
import { newId } from '../../shared/ids.ts';
import {
  canCourseTransition,
  canEnrollmentTransition,
  grantsCourseAccess,
  isCourseComplete,
  isCoursePubliclyReadable,
  COURSE_STATES,
  ENROLLMENT_STATES,
  type CourseRecord,
  type LessonRecord
} from './state.ts';
import {
  buildCompletionRule,
  buildPrice,
  publicationProblems,
  validateLessonType,
  validatePrerequisites
} from './validation.ts';

/** Pure lifecycle, completion, and authoring rules (EDU-003/004/007/009, OD-015/OD-016). */

function courseFixture(overrides: Partial<CourseRecord> = {}): CourseRecord {
  return {
    _id: newId(),
    slug: 'aim-training',
    state: 'draft',
    translations: {
      fa: { title: 'تمرین هدف‌گیری', summary: 'خلاصه', description: '' },
      en: { title: 'Aim training', summary: 'Summary', description: '' }
    },
    gameId: null,
    coachId: newId(),
    accessModel: 'free',
    price: [],
    completionRule: { kind: 'all_required_lessons', thresholdPercent: 100 },
    coverImageUrl: null,
    publishedVersion: 0,
    version: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    publishedAt: null,
    ...overrides
  };
}

function lessonFixture(order: number, overrides: Partial<LessonRecord> = {}): LessonRecord {
  return {
    _id: newId(),
    courseId: 'course-1',
    type: 'text',
    order,
    prerequisiteLessonIds: [],
    required: true,
    translations: { fa: { title: `درس ${String(order)}`, body: '' }, en: { title: `Lesson ${String(order)}`, body: '' } },
    mediaUrl: null,
    version: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides
  };
}

describe('course lifecycle (section 12.10)', () => {
  test('the documented path runs draft → review → published → unpublished → archived', () => {
    assert.equal(canCourseTransition('draft', 'review'), true);
    assert.equal(canCourseTransition('review', 'published'), true);
    assert.equal(canCourseTransition('published', 'unpublished'), true);
    assert.equal(canCourseTransition('unpublished', 'archived'), true);
  });

  test('a draft cannot skip review, and archived is terminal', () => {
    assert.equal(canCourseTransition('draft', 'published'), false);
    for (const target of COURSE_STATES) assert.equal(canCourseTransition('archived', target), false, `archived -> ${target}`);
  });

  test('only a published course is publicly readable (EDU-001)', () => {
    assert.equal(isCoursePubliclyReadable('published'), true);
    for (const state of COURSE_STATES.filter((s) => s !== 'published')) {
      assert.equal(isCoursePubliclyReadable(state), false, `${state} must not be public`);
    }
  });
});

describe('enrollment lifecycle (EDU-005, section 12.10)', () => {
  test('free runs pending → active → completed and paid runs pending_payment → active → completed', () => {
    assert.equal(canEnrollmentTransition('pending', 'active'), true);
    assert.equal(canEnrollmentTransition('pending_payment', 'active'), true);
    assert.equal(canEnrollmentTransition('active', 'completed'), true);
  });

  test('an unpaid enrollment can never reach completed directly', () => {
    assert.equal(canEnrollmentTransition('pending_payment', 'completed'), false);
    assert.equal(canEnrollmentTransition('pending', 'completed'), false);
  });

  test('revocation and refund apply to a live enrollment and are terminal', () => {
    for (const from of ['active', 'completed'] as const) {
      assert.equal(canEnrollmentTransition(from, 'revoked'), true);
      assert.equal(canEnrollmentTransition(from, 'refunded'), true);
    }
    for (const target of ENROLLMENT_STATES) {
      assert.equal(canEnrollmentTransition('revoked', target), false, `revoked -> ${target}`);
      assert.equal(canEnrollmentTransition('refunded', target), false, `refunded -> ${target}`);
    }
  });

  test('only active and completed grant lesson access', () => {
    assert.equal(grantsCourseAccess('active'), true);
    assert.equal(grantsCourseAccess('completed'), true);
    for (const state of ['pending', 'pending_payment', 'revoked', 'refunded', 'cancelled'] as const) {
      assert.equal(grantsCourseAccess(state), false, `${state} must not grant access`);
    }
  });
});

describe('completion is deterministic (EDU-007)', () => {
  const rule = { kind: 'all_required_lessons', thresholdPercent: 100 } as const;

  test('the same progress inputs always produce the same result', () => {
    const required = ['a', 'b', 'c'];
    for (let i = 0; i < 5; i += 1) {
      assert.equal(isCourseComplete(required, ['a', 'b'], rule), false);
      assert.equal(isCourseComplete(required, ['a', 'b', 'c'], rule), true);
    }
  });

  test('order and duplicates in the completed set do not change the answer', () => {
    const required = ['a', 'b'];
    assert.equal(isCourseComplete(required, ['b', 'a'], rule), true);
    assert.equal(isCourseComplete(required, ['a', 'a', 'b'], rule), true);
  });

  test('a lower threshold completes earlier, and non-required lessons never count', () => {
    const partial = { kind: 'all_required_lessons', thresholdPercent: 50 } as const;
    assert.equal(isCourseComplete(['a', 'b'], ['a'], partial), true);
    assert.equal(isCourseComplete(['a', 'b'], ['a'], rule), false);
    // A lesson outside the required set contributes nothing.
    assert.equal(isCourseComplete(['a', 'b'], ['a', 'z'], rule), false);
  });

  test('a course with no required lessons is never auto-completed', () => {
    assert.equal(isCourseComplete([], [], rule), false);
    assert.equal(isCourseComplete([], ['a'], rule), false);
  });
});

describe('lesson types under OD-016', () => {
  test('text, video, and file are accepted', () => {
    for (const type of ['text', 'video', 'file'] as const) assert.equal(validateLessonType(type, 'text'), type);
  });

  test('quiz and exercise are refused by name, citing the decision', () => {
    for (const type of ['quiz', 'exercise']) {
      assert.throws(
        () => validateLessonType(type, 'text'),
        (error: unknown) =>
          error instanceof ValidationError && error.fieldErrors.some((f) => f.code === 'EXERCISE_TYPE_NOT_APPROVED' && /OD-016/.test(f.message))
      );
    }
  });

  test('an unknown type is rejected rather than coerced', () => {
    assert.throws(() => validateLessonType('podcast', 'text'), /lesson type is not valid/i);
  });
});

describe('pricing under OD-015', () => {
  test('a free course has no price at all', () => {
    assert.deepEqual(buildPrice('free', { dragonCoinAmount: 10 }, true), []);
  });

  test('with the gate off, a paid course cannot be priced', () => {
    assert.throws(
      () => buildPrice('paid', { dragonCoinAmount: 10 }, false),
      (error: unknown) => error instanceof ValidationError && error.fieldErrors.some((f) => f.code === 'PAID_COURSES_DISABLED' && /OD-015/.test(f.message))
    );
  });

  test('with the gate on, a Dragon Coin price is stored as an exact integer', () => {
    const price = buildPrice('paid', { dragonCoinAmount: 250 }, true);
    assert.equal(price.length, 1);
    assert.equal(price[0]?.assetCode, 'DRC');
    assert.equal(price[0]?.amountInteger, 250);
    assert.equal(price[0]?.scale, 0);
  });

  test('a Toman price is refused: cash revenue needs approved ownership and refund terms', () => {
    assert.throws(
      () => buildPrice('paid', { tomanAmount: 50_000 }, true),
      (error: unknown) => error instanceof ValidationError && error.fieldErrors.some((f) => f.code === 'TOMAN_PRICE_NOT_APPROVED' && /OD-015/.test(f.message))
    );
  });

  test('a fractional, zero, or missing amount is rejected', () => {
    for (const amount of [0, -5, 2.5, undefined]) {
      assert.throws(() => buildPrice('paid', amount === undefined ? {} : { dragonCoinAmount: amount }, true), /price is not valid/i);
    }
  });
});

describe('completion rule validation', () => {
  const previous = { kind: 'all_required_lessons', thresholdPercent: 100 } as const;
  test('a whole percentage from 1 to 100 is accepted', () => {
    assert.equal(buildCompletionRule({ thresholdPercent: 80 }, previous).thresholdPercent, 80);
  });
  test('an out-of-range or fractional threshold is rejected', () => {
    for (const value of [0, 101, 50.5]) {
      assert.throws(() => buildCompletionRule({ thresholdPercent: value }, previous), /completion rule is not valid/i);
    }
  });
});

describe('prerequisites (EDU-004)', () => {
  const first = lessonFixture(1);
  const second = lessonFixture(2);

  test('an earlier lesson in the same course is a valid prerequisite', () => {
    assert.deepEqual(validatePrerequisites([first._id], 2, [first, second], second._id), [first._id]);
  });

  test('a later lesson cannot be a prerequisite, or the curriculum is unreachable', () => {
    assert.throws(() => validatePrerequisites([second._id], 1, [first, second], first._id), /prerequisites are not valid/i);
  });

  test('a lesson cannot require itself', () => {
    assert.throws(() => validatePrerequisites([first._id], 1, [first, second], first._id), /prerequisites are not valid/i);
  });

  test('a prerequisite outside the course is rejected', () => {
    assert.throws(() => validatePrerequisites([newId()], 2, [first, second], second._id), /prerequisites are not valid/i);
  });

  test('duplicates collapse', () => {
    assert.deepEqual(validatePrerequisites([first._id, first._id], 2, [first, second], second._id), [first._id]);
  });
});

describe('publication completeness (EDU-009)', () => {
  test('a complete course with an approved coach reports no problems', () => {
    assert.deepEqual(publicationProblems(courseFixture(), [lessonFixture(1)], true), []);
  });

  test('an unapproved coach blocks publication, which is the ownership check', () => {
    const problems = publicationProblems(courseFixture(), [lessonFixture(1)], false);
    assert.equal(problems.some((p) => p.code === 'COACH_NOT_APPROVED'), true);
  });

  test('a course with no coach blocks publication', () => {
    const problems = publicationProblems(courseFixture({ coachId: null }), [lessonFixture(1)], false);
    assert.equal(problems.some((p) => p.field === 'coachId' && p.code === 'REQUIRED_FOR_PUBLICATION'), true);
  });

  test('every missing prerequisite is reported together, not one per attempt', () => {
    const problems = publicationProblems(
      courseFixture({
        coachId: null,
        translations: { fa: { title: '', summary: '', description: '' }, en: { title: '', summary: '', description: '' } }
      }),
      [],
      false
    );
    // 4 localized title/summary problems + coach + no lessons + nothing required.
    assert.equal(problems.length, 7);
  });

  test('a curriculum with no required lesson cannot be published: completion would be unmeasurable', () => {
    const problems = publicationProblems(courseFixture(), [lessonFixture(1, { required: false })], true);
    assert.equal(problems.some((p) => p.field === 'lessons.required'), true);
  });

  test('a lesson missing a localized title blocks publication', () => {
    const untitled = lessonFixture(1, { translations: { fa: { title: '', body: '' }, en: { title: 'Lesson 1', body: '' } } });
    const problems = publicationProblems(courseFixture(), [untitled], true);
    assert.equal(problems.some((p) => p.field === 'lessons.translations.fa.title'), true);
  });

  test('a paid course with no price blocks publication', () => {
    const problems = publicationProblems(courseFixture({ accessModel: 'paid', price: [] }), [lessonFixture(1)], true);
    assert.equal(problems.some((p) => p.field === 'price'), true);
  });
});
