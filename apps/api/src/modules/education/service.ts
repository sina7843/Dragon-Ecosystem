import type { Db } from 'mongodb';
import type { Database } from '../../shared/db/client.ts';
import { runUnitOfWork } from '../../shared/db/unit-of-work.ts';
import type { RequestContext } from '../../shared/context.ts';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors.ts';
import { utcNow } from '../../shared/events.ts';
import { newId, type EntityId } from '../../shared/ids.ts';
import { clampLimit, decodeCursor, toPage, type Page } from '../../shared/pagination.ts';
import { applyTextSearch, normalizeQuery } from '../../shared/search.ts';
import { resolveSlug } from '../content/slug.ts';
import type { HoldsService } from '../holds/index.ts';
import { EDUCATION_COLLECTIONS } from './collections.ts';
import {
  ACTIVE_ENROLLMENT_STATES,
  canCourseTransition,
  canEnrollmentTransition,
  grantsCourseAccess,
  isCourseComplete,
  isCoursePubliclyReadable,
  type AccessModel,
  type CoachProfileRecord,
  type CourseRecord,
  type CourseReviewRecord,
  type CourseState,
  type EnrollmentRecord,
  type LessonProgressRecord,
  type LessonRecord,
  type Locale
} from './state.ts';
import {
  buildCompletionRule,
  buildCourseTranslation,
  buildLessonTranslation,
  buildPrice,
  emptyCourseTranslation,
  emptyLessonTranslation,
  publicationProblems,
  validateAccessModel,
  validateLessonOrder,
  validateLessonType,
  validateMediaUrl,
  validatePrerequisites,
  validateRating,
  type CourseTranslationInput,
  type PriceInput
} from './validation.ts';

/**
 * Courses, enrollment, progress, and reviews (EDU-001..012).
 *
 * Invariants:
 * - A draft course is never publicly readable, and publication validates the localized
 *   curriculum, access model, and an approved owning coach (EDU-001, EDU-009).
 * - Lesson access needs BOTH an access-granting enrollment and, for a paid course, a live
 *   entitlement (BR-024). Revoking either closes access immediately (EDU-005).
 * - Progress is monotonic per learner/lesson and idempotent to replay (EDU-006).
 * - Completion is a pure function of required-lesson progress (EDU-007).
 * - Paid enrolment reserves and captures a Dragon Coin hold through the shared holds and
 *   ledger services; no education-specific balance exists anywhere (EDU-010).
 */

const DUPLICATE_KEY = 11000;
function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === DUPLICATE_KEY;
}

export interface EducationConfig {
  /**
   * OD-015 gate. Fail-closed: while false a course cannot be priced or paid for, so no
   * commercial course flow is reachable. Free courses are unaffected.
   */
  readonly paidCoursesEnabled: boolean;
}

export interface CourseInput {
  slug?: string;
  translations?: Partial<Record<Locale, CourseTranslationInput>>;
  gameId?: string | null;
  coachId?: string | null;
  accessModel?: string;
  price?: PriceInput;
  completionRule?: { thresholdPercent?: number };
  coverImageUrl?: string | null;
}

export interface LessonInput {
  type?: string;
  order?: number;
  required?: boolean;
  prerequisiteLessonIds?: string[];
  translations?: Partial<Record<Locale, { title?: string; body?: string }>>;
  mediaUrl?: string | null;
}

/** One lesson as a learner sees it, with the lock decision already made server-side. */
export interface LearnerLessonView {
  id: EntityId;
  order: number;
  type: string;
  required: boolean;
  title: string;
  /** Null while locked: a locked lesson never delivers its body or media (EDU-004). */
  body: string | null;
  mediaUrl: string | null;
  locked: boolean;
  percent: number;
  completed: boolean;
}

export class EducationService {
  readonly #database: Database;
  readonly #config: EducationConfig;
  readonly #holds: HoldsService;

  constructor(database: Database, config: EducationConfig, holds: HoldsService) {
    this.#database = database;
    this.#config = config;
    this.#holds = holds;
  }

  get #db(): Db {
    return this.#database.db;
  }
  #coaches(db: Db = this.#db) {
    return db.collection<CoachProfileRecord>(EDUCATION_COLLECTIONS.coaches);
  }
  #courses(db: Db = this.#db) {
    return db.collection<CourseRecord>(EDUCATION_COLLECTIONS.courses);
  }
  #lessons(db: Db = this.#db) {
    return db.collection<LessonRecord>(EDUCATION_COLLECTIONS.lessons);
  }
  #enrollments(db: Db = this.#db) {
    return db.collection<EnrollmentRecord>(EDUCATION_COLLECTIONS.enrollments);
  }
  #progress(db: Db = this.#db) {
    return db.collection<LessonProgressRecord>(EDUCATION_COLLECTIONS.progress);
  }
  #reviews(db: Db = this.#db) {
    return db.collection<CourseReviewRecord>(EDUCATION_COLLECTIONS.reviews);
  }

  configView(): { paidCoursesEnabled: boolean } {
    return { paidCoursesEnabled: this.#config.paidCoursesEnabled };
  }

  // --- Coaches (DATA-050, EDU-011) ---

  async upsertCoach(
    context: RequestContext,
    input: { accountId: string; slug?: string; translations?: Partial<Record<Locale, { displayName?: string; bio?: string }>>; gameIds?: string[]; avatarUrl?: string | null }
  ): Promise<CoachProfileRecord> {
    const existing = await this.#coaches().findOne({ accountId: input.accountId });
    const now = utcNow();
    const base =
      existing ??
      ({
        _id: newId(),
        accountId: input.accountId,
        slug: '',
        translations: { fa: { displayName: '', bio: '' }, en: { displayName: '', bio: '' } },
        gameIds: [],
        avatarUrl: null,
        approved: false,
        approvedBy: null,
        approvedAt: null,
        version: 0,
        createdAt: now,
        updatedAt: now
      } satisfies CoachProfileRecord);

    const translations = {
      fa: {
        displayName: (input.translations?.fa?.displayName ?? base.translations.fa.displayName).trim().slice(0, 120),
        bio: (input.translations?.fa?.bio ?? base.translations.fa.bio).trim().slice(0, 2000)
      },
      en: {
        displayName: (input.translations?.en?.displayName ?? base.translations.en.displayName).trim().slice(0, 120),
        bio: (input.translations?.en?.bio ?? base.translations.en.bio).trim().slice(0, 2000)
      }
    };
    const next: CoachProfileRecord = {
      ...base,
      slug: resolveSlug(input.slug ?? (base.slug === '' ? undefined : base.slug), translations.en.displayName || translations.fa.displayName || 'coach'),
      translations,
      gameIds: input.gameIds === undefined ? base.gameIds : [...new Set(input.gameIds)].slice(0, 20),
      avatarUrl: validateMediaUrl(input.avatarUrl, base.avatarUrl),
      version: base.version + 1,
      updatedAt: now
    };
    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        await this.#coaches(uow.db).replaceOne({ _id: next._id }, next, { session: uow.session, upsert: true });
        uow.audit({ action: existing === null ? 'course.coach_created' : 'course.coach_updated', resourceType: 'coach_profile', resourceId: next._id, after: { accountId: next.accountId, approved: next.approved }, reason: 'Coach profile saved.' });
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ValidationError('That coach slug is already in use.', [{ field: 'slug', code: 'SLUG_TAKEN', message: 'Choose a different slug.' }]);
      }
      throw error;
    }
    return next;
  }

  async approveCoach(context: RequestContext, coachId: EntityId, approved: boolean, reason: string): Promise<CoachProfileRecord> {
    const current = await this.#coaches().findOne({ _id: coachId });
    if (current === null) throw new NotFoundError('Unknown coach profile.');
    const actorId = context.actor.accountId;
    if (actorId === null) throw new ForbiddenError();
    const now = utcNow();
    const next: CoachProfileRecord = {
      ...current,
      approved,
      approvedBy: approved ? actorId : null,
      approvedAt: approved ? now : null,
      version: current.version + 1,
      updatedAt: now
    };
    await runUnitOfWork(this.#database, context, async (uow) => {
      await this.#coaches(uow.db).replaceOne({ _id: coachId }, next, { session: uow.session });
      uow.audit({ action: approved ? 'course.coach_approved' : 'course.coach_unapproved', resourceType: 'coach_profile', resourceId: coachId, before: { approved: current.approved }, after: { approved }, reason });
    });
    return next;
  }

  /** Public coach projection: approved profiles only, and only approved public fields (EDU-011). */
  async getPublicCoach(slug: string, locale: Locale): Promise<{ id: string; slug: string; displayName: string; bio: string; gameIds: string[]; avatarUrl: string | null } | null> {
    const coach = await this.#coaches().findOne({ slug, approved: true });
    if (coach === null) return null;
    return {
      id: coach._id,
      slug: coach.slug,
      displayName: coach.translations[locale].displayName,
      bio: coach.translations[locale].bio,
      gameIds: coach.gameIds,
      avatarUrl: coach.avatarUrl
    };
  }

  async getCoachById(coachId: EntityId): Promise<CoachProfileRecord | null> {
    return this.#coaches().findOne({ _id: coachId });
  }
  async listCoaches(): Promise<CoachProfileRecord[]> {
    return this.#coaches().find({}).sort({ updatedAt: -1 }).limit(100).toArray();
  }

  // --- Course authoring (EDU-001) ---

  async createCourse(context: RequestContext, input: CourseInput): Promise<CourseRecord> {
    const translations = {
      fa: buildCourseTranslation(input.translations?.fa, emptyCourseTranslation()),
      en: buildCourseTranslation(input.translations?.en, emptyCourseTranslation())
    };
    const accessModel = validateAccessModel(input.accessModel, 'free');
    const now = utcNow();
    const record: CourseRecord = {
      _id: newId(),
      slug: resolveSlug(input.slug, translations.en.title || translations.fa.title || 'course'),
      state: 'draft',
      translations,
      gameId: input.gameId ?? null,
      coachId: input.coachId ?? null,
      accessModel,
      price: buildPrice(accessModel, input.price, this.#config.paidCoursesEnabled),
      completionRule: buildCompletionRule(input.completionRule, { kind: 'all_required_lessons', thresholdPercent: 100 }),
      coverImageUrl: validateMediaUrl(input.coverImageUrl, null),
      publishedVersion: 0,
      version: 1,
      createdAt: now,
      updatedAt: now,
      publishedAt: null
    };
    await this.#writeCourse(context, record, 'course.created', null, 'Course created.');
    return record;
  }

  async updateCourse(context: RequestContext, courseId: EntityId, input: CourseInput & { expectedVersion: number }): Promise<CourseRecord> {
    const current = await this.#requireCourse(courseId);
    if (current.version !== input.expectedVersion) {
      throw new ConflictError('COURSE_STALE', 'This course changed since you opened it. Reload and retry.');
    }
    if (current.state === 'archived') throw new ConflictError('COURSE_NOT_EDITABLE', 'An archived course can no longer be edited.');
    const translations = {
      fa: buildCourseTranslation(input.translations?.fa, current.translations.fa),
      en: buildCourseTranslation(input.translations?.en, current.translations.en)
    };
    const accessModel = validateAccessModel(input.accessModel, current.accessModel);
    // Repricing a published course would change what an existing enrollment paid for.
    const priceChanging = input.price !== undefined || accessModel !== current.accessModel;
    if (priceChanging && current.state === 'published') {
      throw new ConflictError('COURSE_PRICE_LOCKED', 'Unpublish the course before changing its access model or price.');
    }
    const next: CourseRecord = {
      ...current,
      slug: input.slug === undefined ? current.slug : resolveSlug(input.slug, translations.en.title || current.slug),
      translations,
      gameId: input.gameId === undefined ? current.gameId : input.gameId,
      coachId: input.coachId === undefined ? current.coachId : input.coachId,
      accessModel,
      price: priceChanging ? buildPrice(accessModel, input.price, this.#config.paidCoursesEnabled) : current.price,
      completionRule: buildCompletionRule(input.completionRule, current.completionRule),
      coverImageUrl: validateMediaUrl(input.coverImageUrl, current.coverImageUrl),
      version: current.version + 1,
      updatedAt: utcNow()
    };
    await this.#writeCourse(context, next, 'course.updated', current, 'Course updated.');
    return next;
  }

  async setCourseState(context: RequestContext, courseId: EntityId, to: CourseState, input: { expectedVersion: number; reason: string }): Promise<CourseRecord> {
    const current = await this.#requireCourse(courseId);
    if (current.version !== input.expectedVersion) throw new ConflictError('COURSE_STALE', 'This course changed. Reload and retry.');
    if (current.state === to) return current;
    if (!canCourseTransition(current.state, to)) {
      throw new ConflictError('COURSE_TRANSITION_NOT_ALLOWED', `A ${current.state} course cannot move to ${to}.`);
    }
    if (to === 'published') {
      const lessons = await this.#lessons().find({ courseId }).sort({ order: 1 }).toArray();
      const coach = current.coachId === null ? null : await this.#coaches().findOne({ _id: current.coachId });
      const problems = publicationProblems(current, lessons, coach?.approved === true);
      if (problems.length > 0) throw new ValidationError('This course is not ready to be published.', problems);
    }
    const now = utcNow();
    const next: CourseRecord = {
      ...current,
      state: to,
      publishedVersion: to === 'published' ? current.publishedVersion + 1 : current.publishedVersion,
      publishedAt: to === 'published' ? (current.publishedAt ?? now) : current.publishedAt,
      version: current.version + 1,
      updatedAt: now
    };
    await this.#writeCourse(context, next, `course.${to}`, current, input.reason);
    return next;
  }

  async #writeCourse(context: RequestContext, record: CourseRecord, action: string, previous: CourseRecord | null, reason: string): Promise<void> {
    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        const courses = this.#courses(uow.db);
        if (previous === null) {
          await courses.insertOne(record, { session: uow.session });
        } else {
          const result = await courses.replaceOne({ _id: record._id, version: previous.version }, record, { session: uow.session });
          if (result.matchedCount === 0) throw new ConflictError('COURSE_STALE', 'This course changed. Reload and retry.');
        }
        uow.audit({
          action,
          resourceType: 'course',
          resourceId: record._id,
          before: previous === null ? null : { state: previous.state, version: previous.version },
          after: { state: record.state, version: record.version },
          reason
        });
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ValidationError('That slug is already in use.', [{ field: 'slug', code: 'SLUG_TAKEN', message: 'Choose a different slug.' }]);
      }
      throw error;
    }
  }

  // --- Lessons (EDU-003, EDU-004) ---

  async createLesson(context: RequestContext, courseId: EntityId, input: LessonInput): Promise<LessonRecord> {
    const course = await this.#requireCourse(courseId);
    if (course.state === 'archived') throw new ConflictError('COURSE_NOT_EDITABLE', 'An archived course can no longer be edited.');
    const siblings = await this.#lessons().find({ courseId }).sort({ order: 1 }).toArray();
    const order = validateLessonOrder(input.order ?? siblings.length + 1);
    const now = utcNow();
    const record: LessonRecord = {
      _id: newId(),
      courseId,
      type: validateLessonType(input.type, 'text'),
      order,
      prerequisiteLessonIds: validatePrerequisites(input.prerequisiteLessonIds ?? [], order, siblings, null),
      required: input.required ?? true,
      translations: {
        fa: buildLessonTranslation(input.translations?.fa, emptyLessonTranslation()),
        en: buildLessonTranslation(input.translations?.en, emptyLessonTranslation())
      },
      mediaUrl: validateMediaUrl(input.mediaUrl, null),
      version: 1,
      createdAt: now,
      updatedAt: now
    };
    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        await this.#lessons(uow.db).insertOne(record, { session: uow.session });
        uow.audit({ action: 'course.lesson_created', resourceType: 'course_lesson', resourceId: record._id, after: { courseId, order }, reason: 'Lesson created.' });
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ValidationError('That lesson position is already taken.', [{ field: 'order', code: 'ORDER_TAKEN', message: 'Choose a different position.' }]);
      }
      throw error;
    }
    return record;
  }

  async updateLesson(context: RequestContext, lessonId: EntityId, input: LessonInput & { expectedVersion: number }): Promise<LessonRecord> {
    const current = await this.#lessons().findOne({ _id: lessonId });
    if (current === null) throw new NotFoundError('Unknown lesson.');
    if (current.version !== input.expectedVersion) throw new ConflictError('LESSON_STALE', 'This lesson changed. Reload and retry.');
    const siblings = (await this.#lessons().find({ courseId: current.courseId }).sort({ order: 1 }).toArray()).filter((l) => l._id !== lessonId);
    const order = input.order === undefined ? current.order : validateLessonOrder(input.order);
    const next: LessonRecord = {
      ...current,
      type: validateLessonType(input.type, current.type),
      order,
      prerequisiteLessonIds: validatePrerequisites(input.prerequisiteLessonIds ?? current.prerequisiteLessonIds, order, siblings, lessonId),
      required: input.required ?? current.required,
      translations: {
        fa: buildLessonTranslation(input.translations?.fa, current.translations.fa),
        en: buildLessonTranslation(input.translations?.en, current.translations.en)
      },
      mediaUrl: validateMediaUrl(input.mediaUrl, current.mediaUrl),
      version: current.version + 1,
      updatedAt: utcNow()
    };
    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        const result = await this.#lessons(uow.db).replaceOne({ _id: lessonId, version: current.version }, next, { session: uow.session });
        if (result.matchedCount === 0) throw new ConflictError('LESSON_STALE', 'This lesson changed. Reload and retry.');
        uow.audit({ action: 'course.lesson_updated', resourceType: 'course_lesson', resourceId: lessonId, after: { order }, reason: 'Lesson updated.' });
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ValidationError('That lesson position is already taken.', [{ field: 'order', code: 'ORDER_TAKEN', message: 'Choose a different position.' }]);
      }
      throw error;
    }
    return next;
  }

  async listLessons(courseId: EntityId): Promise<LessonRecord[]> {
    return this.#lessons().find({ courseId }).sort({ order: 1 }).toArray();
  }

  // --- Public catalog (PAGE-030, PAGE-031, API-077, API-078) ---

  async listPublicCourses(query: { locale: Locale; gameId?: string; accessModel?: AccessModel; q?: string; cursor?: string; limit?: number }): Promise<Page<CourseRecord>> {
    const limit = clampLimit(query.limit);
    const filter: Record<string, unknown> = { state: 'published' };
    if (query.gameId !== undefined) filter['gameId'] = query.gameId;
    if (query.accessModel !== undefined) filter['accessModel'] = query.accessModel;
    const cursor = decodeCursor(query.cursor);
    if (cursor !== null) filter['$or'] = [{ slug: { $gt: cursor.sortValue } }, { slug: cursor.sortValue, _id: { $gt: cursor.id } }];
    const search = normalizeQuery(query.q);
    if (search !== null) applyTextSearch(filter, search, [`translations.${query.locale}.title`, `translations.${query.locale}.summary`]);
    const rows = await this.#courses().find(filter).sort({ slug: 1, _id: 1 }).limit(limit + 1).toArray();
    const page = toPage(rows.map((r) => ({ ...r, sortValue: r.slug, id: r._id })), limit);
    return { items: page.items.map(({ sortValue: _s, id: _i, ...r }) => r as CourseRecord), nextCursor: page.nextCursor };
  }

  async getPublicCourseBySlug(slug: string): Promise<CourseRecord | null> {
    const course = await this.#courses().findOne({ slug });
    return course === null || !isCoursePubliclyReadable(course.state) ? null : course;
  }

  async listForAdmin(query: { state?: CourseState; cursor?: string; limit?: number }): Promise<Page<CourseRecord>> {
    const limit = clampLimit(query.limit);
    const filter: Record<string, unknown> = {};
    if (query.state !== undefined) filter['state'] = query.state;
    const cursor = decodeCursor(query.cursor);
    if (cursor !== null) filter['$or'] = [{ updatedAt: { $lt: cursor.sortValue } }, { updatedAt: cursor.sortValue, _id: { $lt: cursor.id } }];
    const rows = await this.#courses().find(filter).sort({ updatedAt: -1, _id: -1 }).limit(limit + 1).toArray();
    const page = toPage(rows.map((r) => ({ ...r, sortValue: r.updatedAt, id: r._id })), limit);
    return { items: page.items.map(({ sortValue: _s, id: _i, ...r }) => r as CourseRecord), nextCursor: page.nextCursor };
  }

  async getCourseById(courseId: EntityId): Promise<CourseRecord | null> {
    return this.#courses().findOne({ _id: courseId });
  }

  // --- Enrollment (EDU-002, EDU-005, EDU-010, API-079) ---

  /**
   * Enrolls a learner. A free course activates immediately; a paid one reserves a Dragon
   * Coin hold and waits in `pending_payment` until activation captures it.
   *
   * The reservation is the entitlement: it is a real claim on the learner's balance, made
   * through the shared holds service, so no education-specific balance exists (EDU-010).
   */
  async enroll(context: RequestContext, courseId: EntityId, learnerId: EntityId): Promise<EnrollmentRecord> {
    const course = await this.#requireCourse(courseId);
    if (!isCoursePubliclyReadable(course.state)) throw new NotFoundError('Unknown course.');

    const existing = await this.#enrollments().findOne({ courseId, learnerId, state: { $in: [...ACTIVE_ENROLLMENT_STATES] } });
    if (existing !== null) return existing; // idempotent: one active enrollment per learner

    const paid = course.accessModel === 'paid';
    if (paid && !this.#config.paidCoursesEnabled) {
      throw new ConflictError('PAID_COURSES_DISABLED', 'Paid course enrolment is not available yet.');
    }
    const drcPrice = course.price.find((component) => component.assetCode === 'DRC')?.amountInteger ?? 0;
    if (paid && drcPrice <= 0) throw new ConflictError('COURSE_PRICE_MISSING', 'This course has no usable price.');

    const now = utcNow();
    const businessRef = `course_enrollment:${courseId}:${learnerId}:${String(Date.parse(now))}`;
    let entitlementId: EntityId | null = null;
    if (paid) {
      // The hold is reserved before the enrollment row so a failed reservation (insufficient
      // balance) leaves no pending_payment enrollment behind to clean up.
      const hold = await this.#holds.createHold(context, learnerId, {
        purpose: 'course_enrollment',
        amount: drcPrice,
        businessRef: `hold:${businessRef}`,
        domainRef: courseId,
        idempotencyKey: `course_enroll:${businessRef}`
      });
      entitlementId = hold._id;
    }

    const record: EnrollmentRecord = {
      _id: newId(),
      courseId,
      learnerId,
      state: paid ? 'pending_payment' : 'active',
      accessModel: course.accessModel,
      courseVersion: course.publishedVersion,
      entitlementId,
      entitlementState: paid ? 'pending' : 'none',
      paidAmount: paid ? [...course.price] : [],
      businessRef,
      revokedReason: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      activatedAt: paid ? null : now,
      completedAt: null
    };
    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        await this.#enrollments(uow.db).insertOne(record, { session: uow.session });
        uow.audit({ action: 'course.enrolled', resourceType: 'course_enrollment', resourceId: record._id, after: { courseId, state: record.state, accessModel: record.accessModel }, reason: 'Enrolled.' });
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        const raced = await this.#enrollments().findOne({ courseId, learnerId, state: { $in: [...ACTIVE_ENROLLMENT_STATES] } });
        if (raced !== null) {
          // A concurrent enrolment won the unique index. This attempt's reservation now
          // belongs to no enrollment, so release it immediately rather than leaving the
          // learner's balance held until the hold's TTL expires.
          if (entitlementId !== null) {
            await this.#holds.releaseHold(context, entitlementId, {
              reason: 'Duplicate enrolment attempt; reservation released.',
              idempotencyKey: `course_enroll_release:${businessRef}`
            });
          }
          return raced;
        }
      }
      // Same reasoning for any other failure after the reservation was taken.
      if (entitlementId !== null) {
        await this.#holds.releaseHold(context, entitlementId, {
          reason: 'Enrolment failed; reservation released.',
          idempotencyKey: `course_enroll_release:${businessRef}`
        });
      }
      throw error;
    }
    return record;
  }

  /**
   * Cancels a pending enrolment and releases any reservation (section 12.10).
   *
   * Without this a learner who reserves a paid place and changes their mind has no way
   * back: the balance would stay held until the hold's TTL expired, which is a poor
   * answer to "I clicked the wrong button".
   */
  async cancelEnrollment(context: RequestContext, enrollmentId: EntityId, learnerId: EntityId): Promise<EnrollmentRecord> {
    const current = await this.#enrollments().findOne({ _id: enrollmentId, learnerId });
    if (current === null) throw new NotFoundError('Unknown enrollment.');
    if (current.state === 'cancelled') return current;
    if (!canEnrollmentTransition(current.state, 'cancelled')) {
      throw new ConflictError('ENROLLMENT_TRANSITION_NOT_ALLOWED', `A ${current.state} enrollment cannot be cancelled.`);
    }
    // Released before the state change: if the release fails the enrolment stays as it
    // was, which is recoverable. The reverse would strand the reservation.
    if (current.state === 'pending_payment' && current.entitlementId !== null) {
      await this.#holds.releaseHold(context, current.entitlementId, {
        reason: 'Enrolment cancelled by the learner.',
        idempotencyKey: `course_cancel_release:${current.businessRef}`
      });
    }
    const now = utcNow();
    return runUnitOfWork(this.#database, context, async (uow) => {
      const result = await this.#enrollments(uow.db).updateOne(
        { _id: enrollmentId, state: current.state },
        { $set: { state: 'cancelled', entitlementState: 'none', updatedAt: now }, $inc: { version: 1 } },
        { session: uow.session }
      );
      if (result.matchedCount === 0) throw new ConflictError('ENROLLMENT_STALE', 'This enrollment changed. Reload and retry.');
      uow.audit({ action: 'course.enrollment_cancelled', resourceType: 'course_enrollment', resourceId: enrollmentId, before: { state: current.state }, after: { state: 'cancelled' }, reason: 'Cancelled by the learner.' });
      return { ...current, state: 'cancelled' as const, entitlementState: 'none' as const, updatedAt: now, version: current.version + 1 };
    });
  }

  /**
   * Captures the reserved Dragon Coin and activates a paid enrollment.
   *
   * Idempotent on both halves: the capture carries a stable idempotency key, and the
   * state change is guarded on `pending_payment`, so a replay returns the activated
   * enrollment rather than charging twice (EDU-010).
   */
  async activateEnrollment(context: RequestContext, enrollmentId: EntityId, learnerId: EntityId): Promise<EnrollmentRecord> {
    const current = await this.#enrollments().findOne({ _id: enrollmentId, learnerId });
    if (current === null) throw new NotFoundError('Unknown enrollment.');
    if (current.state === 'active' || current.state === 'completed') return current;
    if (current.state !== 'pending_payment') {
      throw new ConflictError('ENROLLMENT_NOT_PAYABLE', `A ${current.state} enrollment cannot be activated.`);
    }
    if (current.entitlementId === null) throw new ConflictError('ENROLLMENT_NOT_PAYABLE', 'This enrollment has no reservation to capture.');
    const drcPrice = current.paidAmount.find((component) => component.assetCode === 'DRC')?.amountInteger ?? 0;

    await this.#holds.captureHold(context, current.entitlementId, {
      amount: drcPrice,
      idempotencyKey: `course_capture:${current.businessRef}`,
      reason: 'Course enrolment captured.'
    });

    const now = utcNow();
    return runUnitOfWork(this.#database, context, async (uow) => {
      const result = await this.#enrollments(uow.db).updateOne(
        { _id: enrollmentId, state: 'pending_payment' },
        { $set: { state: 'active', entitlementState: 'active', activatedAt: now, updatedAt: now }, $inc: { version: 1 } },
        { session: uow.session }
      );
      if (result.matchedCount === 0) throw new ConflictError('ENROLLMENT_STALE', 'This enrollment changed. Reload and retry.');
      uow.audit({ action: 'course.enrollment_activated', resourceType: 'course_enrollment', resourceId: enrollmentId, before: { state: 'pending_payment' }, after: { state: 'active' }, reason: 'Entitlement captured.' });
      return { ...current, state: 'active', entitlementState: 'active', activatedAt: now, updatedAt: now, version: current.version + 1 };
    });
  }

  /**
   * Revokes an enrollment's entitlement (EDU-005). Access closes immediately.
   *
   * This records the revocation only. It executes no refund: refund policy for a paid
   * course is unresolved under OD-015, and inventing one would move money on a rule
   * nobody has approved.
   */
  async revokeEnrollment(context: RequestContext, enrollmentId: EntityId, reason: string): Promise<EnrollmentRecord> {
    if (reason.trim() === '') {
      throw new ValidationError('A reason is required.', [{ field: 'reason', code: 'REASON_REQUIRED', message: 'Provide a reason.' }]);
    }
    const current = await this.#enrollments().findOne({ _id: enrollmentId });
    if (current === null) throw new NotFoundError('Unknown enrollment.');
    if (current.state === 'revoked') return current;
    if (!canEnrollmentTransition(current.state, 'revoked')) {
      throw new ConflictError('ENROLLMENT_TRANSITION_NOT_ALLOWED', `A ${current.state} enrollment cannot be revoked.`);
    }
    const now = utcNow();
    return runUnitOfWork(this.#database, context, async (uow) => {
      const result = await this.#enrollments(uow.db).updateOne(
        { _id: enrollmentId, state: current.state },
        { $set: { state: 'revoked', entitlementState: 'revoked', revokedReason: reason.slice(0, 500), updatedAt: now }, $inc: { version: 1 } },
        { session: uow.session }
      );
      if (result.matchedCount === 0) throw new ConflictError('ENROLLMENT_STALE', 'This enrollment changed. Reload and retry.');
      uow.audit({ action: 'course.enrollment_revoked', resourceType: 'course_enrollment', resourceId: enrollmentId, before: { state: current.state }, after: { state: 'revoked' }, reason });
      return { ...current, state: 'revoked', entitlementState: 'revoked', revokedReason: reason, updatedAt: now, version: current.version + 1 };
    });
  }

  async getEnrollment(enrollmentId: EntityId, learnerId: EntityId): Promise<EnrollmentRecord | null> {
    return this.#enrollments().findOne({ _id: enrollmentId, learnerId });
  }

  async listMyEnrollments(learnerId: EntityId): Promise<EnrollmentRecord[]> {
    return this.#enrollments().find({ learnerId }).sort({ createdAt: -1 }).limit(100).toArray();
  }

  async listCourseEnrollments(courseId: EntityId): Promise<EnrollmentRecord[]> {
    return this.#enrollments().find({ courseId }).sort({ createdAt: -1 }).limit(100).toArray();
  }

  /** The learner's own enrollment for a course, whatever its state (for the detail page CTA). */
  async findMyEnrollment(courseId: EntityId, learnerId: EntityId): Promise<EnrollmentRecord | null> {
    return this.#enrollments().find({ courseId, learnerId }).sort({ createdAt: -1 }).limit(1).next();
  }

  // --- Course player (BR-024, EDU-004, EDU-006, API-080, API-081) ---

  /**
   * The learner's view of a course.
   *
   * Access requires both an access-granting enrollment and, for a paid course, a live
   * entitlement — BR-024's "either missing means denied". A locked lesson is returned
   * without its body or media, so the lock is enforced by the payload, not by the client.
   */
  async getLearnerCourse(
    enrollmentId: EntityId,
    learnerId: EntityId,
    locale: Locale
  ): Promise<{ enrollment: EnrollmentRecord; course: CourseRecord; lessons: LearnerLessonView[] }> {
    const enrollment = await this.#enrollments().findOne({ _id: enrollmentId, learnerId });
    if (enrollment === null) throw new NotFoundError('Unknown enrollment.');
    this.#assertAccess(enrollment);

    const course = await this.#requireCourse(enrollment.courseId);
    const lessons = await this.#lessons().find({ courseId: course._id }).sort({ order: 1 }).toArray();
    const progress = await this.#progress().find({ enrollmentId }).toArray();
    const byLesson = new Map(progress.map((row) => [row.lessonId, row]));
    const completed = new Set(progress.filter((row) => row.completed).map((row) => row.lessonId));

    return {
      enrollment,
      course,
      lessons: lessons.map((lesson) => {
        const locked = lesson.prerequisiteLessonIds.some((id) => !completed.has(id));
        const row = byLesson.get(lesson._id);
        return {
          id: lesson._id,
          order: lesson.order,
          type: lesson.type,
          required: lesson.required,
          title: lesson.translations[locale].title,
          body: locked ? null : lesson.translations[locale].body,
          // MEDIA-012: course media travels only with a live entitlement, and only unlocked.
          mediaUrl: locked ? null : lesson.mediaUrl,
          locked,
          percent: row?.percent ?? 0,
          completed: row?.completed ?? false
        };
      })
    };
  }

  /**
   * Records progress for one lesson (EDU-006, API-081).
   *
   * Idempotent and monotonic: replaying the same report changes nothing, and a lower
   * percentage never lowers what was already recorded — a second device mid-lesson cannot
   * erase progress made on the first. Completion is then recomputed from the stored rows
   * only, so it is a pure function of progress (EDU-007).
   */
  async recordProgress(
    context: RequestContext,
    enrollmentId: EntityId,
    learnerId: EntityId,
    lessonId: EntityId,
    input: { percent: number }
  ): Promise<{ progress: LessonProgressRecord; enrollment: EnrollmentRecord }> {
    if (!Number.isSafeInteger(input.percent) || input.percent < 0 || input.percent > 100) {
      throw new ValidationError('The progress value is not valid.', [
        { field: 'percent', code: 'INVALID_PROGRESS', message: 'Use a whole percentage from 0 to 100.' }
      ]);
    }
    const enrollment = await this.#enrollments().findOne({ _id: enrollmentId, learnerId });
    if (enrollment === null) throw new NotFoundError('Unknown enrollment.');
    this.#assertAccess(enrollment);

    const lesson = await this.#lessons().findOne({ _id: lessonId, courseId: enrollment.courseId });
    if (lesson === null) throw new NotFoundError('Unknown lesson.');

    const priorCompleted = new Set(
      (await this.#progress().find({ enrollmentId, completed: true }).toArray()).map((row) => row.lessonId)
    );
    if (lesson.prerequisiteLessonIds.some((id) => !priorCompleted.has(id))) {
      throw new ForbiddenError('Finish the earlier lessons before this one.');
    }

    const now = utcNow();
    const existing = await this.#progress().findOne({ enrollmentId, lessonId });
    const percent = Math.max(existing?.percent ?? 0, input.percent);
    const completed = percent >= 100;
    const record: LessonProgressRecord = existing === null
      ? { _id: newId(), enrollmentId, lessonId, learnerId, percent, completed, createdAt: now, updatedAt: now }
      : { ...existing, percent, completed, updatedAt: now };

    await runUnitOfWork(this.#database, context, async (uow) => {
      await this.#progress(uow.db).replaceOne({ enrollmentId, lessonId }, record, { session: uow.session, upsert: true });
    });

    if (completed) priorCompleted.add(lessonId);
    const course = await this.#requireCourse(enrollment.courseId);
    const lessons = await this.#lessons().find({ courseId: course._id }).toArray();
    const requiredIds = lessons.filter((l) => l.required).map((l) => l._id);
    const shouldComplete =
      enrollment.state === 'active' && isCourseComplete(requiredIds, [...priorCompleted], course.completionRule);

    if (!shouldComplete) return { progress: record, enrollment };

    const completedAt = utcNow();
    const updated = await runUnitOfWork(this.#database, context, async (uow) => {
      const result = await this.#enrollments(uow.db).updateOne(
        { _id: enrollmentId, state: 'active' },
        { $set: { state: 'completed', completedAt, updatedAt: completedAt }, $inc: { version: 1 } },
        { session: uow.session }
      );
      if (result.matchedCount === 0) return enrollment; // a concurrent update won; not an error
      uow.audit({ action: 'course.completed', resourceType: 'course_enrollment', resourceId: enrollmentId, before: { state: 'active' }, after: { state: 'completed' }, reason: 'Completion rule met.' });
      return { ...enrollment, state: 'completed' as const, completedAt, updatedAt: completedAt, version: enrollment.version + 1 };
    });
    return { progress: record, enrollment: updated };
  }

  // --- Reviews (EDU-008, API-082) ---

  async createReview(
    context: RequestContext,
    courseId: EntityId,
    learnerId: EntityId,
    input: { rating: number; body: string }
  ): Promise<CourseReviewRecord> {
    const rating = validateRating(input.rating);
    // EDU-008: only an eligible enrollment may review, so an unenrolled or revoked
    // learner has nothing to review with.
    const enrollment = await this.#enrollments().findOne({ courseId, learnerId, state: { $in: ['active', 'completed'] } });
    if (enrollment === null) throw new ForbiddenError('Only an enrolled learner can review this course.');

    const now = utcNow();
    const record: CourseReviewRecord = {
      _id: newId(),
      courseId,
      enrollmentId: enrollment._id,
      learnerId,
      rating,
      body: input.body.trim().slice(0, 2000),
      // Moderated before it is public (EDU-008).
      state: 'pending',
      moderatedBy: null,
      moderatedReason: null,
      version: 1,
      createdAt: now,
      updatedAt: now
    };
    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        await this.#reviews(uow.db).insertOne(record, { session: uow.session });
        uow.audit({ action: 'course.review_submitted', resourceType: 'course_review', resourceId: record._id, after: { courseId, rating }, reason: 'Review submitted.' });
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ConflictError('REVIEW_ALREADY_SUBMITTED', 'You have already reviewed this course.');
      }
      throw error;
    }
    return record;
  }

  async moderateReview(context: RequestContext, reviewId: EntityId, to: 'published' | 'removed', reason: string): Promise<CourseReviewRecord> {
    const current = await this.#reviews().findOne({ _id: reviewId });
    if (current === null) throw new NotFoundError('Unknown review.');
    const actorId = context.actor.accountId;
    const now = utcNow();
    return runUnitOfWork(this.#database, context, async (uow) => {
      const result = await this.#reviews(uow.db).updateOne(
        { _id: reviewId, version: current.version },
        { $set: { state: to, moderatedBy: actorId, moderatedReason: reason.slice(0, 500), updatedAt: now }, $inc: { version: 1 } },
        { session: uow.session }
      );
      if (result.matchedCount === 0) throw new ConflictError('REVIEW_STALE', 'This review changed. Reload and retry.');
      uow.audit({ action: `course.review_${to}`, resourceType: 'course_review', resourceId: reviewId, before: { state: current.state }, after: { state: to }, reason });
      return { ...current, state: to, moderatedBy: actorId, moderatedReason: reason, updatedAt: now, version: current.version + 1 };
    });
  }

  async listPublishedReviews(courseId: EntityId): Promise<CourseReviewRecord[]> {
    return this.#reviews().find({ courseId, state: 'published' }).sort({ createdAt: -1 }).limit(50).toArray();
  }
  async listReviewsForAdmin(courseId: EntityId): Promise<CourseReviewRecord[]> {
    return this.#reviews().find({ courseId }).sort({ createdAt: -1 }).limit(100).toArray();
  }

  // --- Internals ---

  async #requireCourse(courseId: EntityId): Promise<CourseRecord> {
    const course = await this.#courses().findOne({ _id: courseId });
    if (course === null) throw new NotFoundError('Unknown course.');
    return course;
  }

  /**
   * BR-024: both facts must hold. A paid enrollment whose entitlement is not active is
   * denied even if the enrollment row still looks live, and vice versa.
   */
  #assertAccess(enrollment: EnrollmentRecord): void {
    if (!grantsCourseAccess(enrollment.state)) {
      throw new ForbiddenError('This enrolment does not grant access to the course.');
    }
    if (enrollment.accessModel === 'paid' && enrollment.entitlementState !== 'active') {
      throw new ForbiddenError('This enrolment has no active entitlement.');
    }
  }
}
