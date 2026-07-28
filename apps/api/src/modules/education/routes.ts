import type { FastifyInstance, FastifyRequest } from 'fastify';
import { NotFoundError } from '../../shared/errors.ts';
import { PERMISSIONS } from '../../shared/authz/permissions.ts';
import { createSessionGuards, requireIdentity, type IdentityService } from '../identity/index.ts';
import { requirePermission, type AuthorizationService } from '../admin/index.ts';
import type { EducationService } from './service.ts';
import { ACCESS_MODELS, COURSE_STATES, type AccessModel, type CourseRecord, type CourseState, type Locale } from './state.ts';

/**
 * Education HTTP surface (API-077..082, PAGE-030..033, PAGE-054).
 *
 * The public side serves published courses only, and never a lesson body — a curriculum
 * outline is public, the content behind it is not. Lesson content is reachable only
 * through the learner routes, which check the enrollment and entitlement first (BR-024).
 *
 * Certification, accreditation, and coach payout have no endpoint here (EDU-012).
 */

export interface EducationDeps {
  identity: IdentityService;
  authorization: AuthorizationService;
  education: EducationService;
}

const errorResponses = {
  400: { $ref: 'ErrorResponse#' },
  401: { $ref: 'ErrorResponse#' },
  403: { $ref: 'ErrorResponse#' },
  404: { $ref: 'ErrorResponse#' },
  409: { $ref: 'ErrorResponse#' },
  422: { $ref: 'ErrorResponse#' }
} as const;

const idParam = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } };
const slugParam = { type: 'object', required: ['slug'], additionalProperties: false, properties: { slug: { type: 'string' } } };
const lessonParams = {
  type: 'object',
  required: ['id', 'lessonId'],
  additionalProperties: false,
  properties: { id: { type: 'string' }, lessonId: { type: 'string' } }
} as const;
const localeQuery = { type: 'string', enum: ['fa', 'en'] } as const;
const reasonProperty = { type: 'string', minLength: 1, maxLength: 500 } as const;

function localeOf(request: FastifyRequest): Locale {
  return (request.query as { locale?: string }).locale === 'en' ? 'en' : 'fa';
}

/**
 * Public course projection. Carries the curriculum outline (titles and order) but no
 * lesson body or media — those belong to an entitled learner.
 */
function publicCourseView(course: CourseRecord, locale: Locale, lessons: Array<{ _id: string; order: number; type: string; required: boolean; translations: Record<Locale, { title: string }> }>) {
  const translation = course.translations[locale];
  return {
    id: course._id,
    slug: course.slug,
    locale,
    title: translation.title,
    summary: translation.summary,
    description: translation.description,
    gameId: course.gameId,
    coachId: course.coachId,
    accessModel: course.accessModel,
    price: course.price,
    completionRule: course.completionRule,
    coverImageUrl: course.coverImageUrl,
    publishedVersion: course.publishedVersion,
    curriculum: lessons.map((lesson) => ({ id: lesson._id, order: lesson.order, type: lesson.type, required: lesson.required, title: lesson.translations[locale].title }))
  };
}

function adminView<T extends { _id: string }>(record: T) {
  const { _id, ...rest } = record;
  return { id: _id, ...rest };
}

export function registerEducationRoutes(app: FastifyInstance, deps: EducationDeps): void {
  const guards = createSessionGuards(deps.identity);
  const manageGate = () => ({ preHandler: [guards.requireSession, requirePermission(deps.authorization, PERMISSIONS.educationManage)] });
  const learner = (request: FastifyRequest): string => requireIdentity(request).account._id;

  // --- Public catalog (API-077, PAGE-030) ---

  app.get(
    '/courses',
    {
      schema: {
        tags: ['education'],
        summary: 'Discover published courses.',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            locale: localeQuery,
            game: { type: 'string' },
            accessModel: { type: 'string', enum: [...ACCESS_MODELS] },
            q: { type: 'string', maxLength: 100 },
            cursor: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 }
          }
        },
        response: { 200: { type: 'object', additionalProperties: true }, 400: { $ref: 'ErrorResponse#' } }
      }
    },
    async (request) => {
      const q = request.query as { game?: string; accessModel?: AccessModel; q?: string; cursor?: string; limit?: number };
      const locale = localeOf(request);
      const page = await deps.education.listPublicCourses({
        locale,
        ...(q.game === undefined ? {} : { gameId: q.game }),
        ...(q.accessModel === undefined ? {} : { accessModel: q.accessModel }),
        ...(q.q === undefined ? {} : { q: q.q }),
        ...(q.cursor === undefined ? {} : { cursor: q.cursor }),
        ...(q.limit === undefined ? {} : { limit: q.limit })
      });
      return {
        items: page.items.map((course) => ({
          id: course._id,
          slug: course.slug,
          title: course.translations[locale].title,
          summary: course.translations[locale].summary,
          gameId: course.gameId,
          accessModel: course.accessModel,
          price: course.price,
          coverImageUrl: course.coverImageUrl
        })),
        nextCursor: page.nextCursor
      };
    }
  );

  // --- Public course detail (API-078, PAGE-031) ---

  app.get(
    '/courses/:slug',
    {
      preHandler: [guards.loadSession],
      schema: {
        tags: ['education'],
        summary: 'Published course detail with the curriculum outline. A draft course returns 404.',
        params: slugParam,
        querystring: { type: 'object', additionalProperties: false, properties: { locale: localeQuery } },
        response: { 200: { type: 'object', additionalProperties: true }, 404: { $ref: 'ErrorResponse#' } }
      }
    },
    async (request) => {
      const { slug } = request.params as { slug: string };
      const locale = localeOf(request);
      const course = await deps.education.getPublicCourseBySlug(slug);
      if (course === null) throw new NotFoundError('Unknown course.');
      const [lessons, reviews] = await Promise.all([deps.education.listLessons(course._id), deps.education.listPublishedReviews(course._id)]);
      const coach = course.coachId === null ? null : await deps.education.getCoachById(course.coachId);
      const accountId = request.identity?.account._id ?? null;
      // The signed-in learner's own enrollment drives the call to action (PAGE-031).
      const enrollment = accountId === null ? null : await deps.education.findMyEnrollment(course._id, accountId);
      return {
        ...publicCourseView(course, locale, lessons),
        coach:
          coach === null || !coach.approved
            ? null
            : { id: coach._id, slug: coach.slug, displayName: coach.translations[locale].displayName, avatarUrl: coach.avatarUrl },
        reviews: reviews.map((review) => ({ id: review._id, rating: review.rating, body: review.body, createdAt: review.createdAt })),
        myEnrollment: enrollment === null ? null : { id: enrollment._id, state: enrollment.state, entitlementState: enrollment.entitlementState }
      };
    }
  );

  // --- Public coach profile (PAGE-033, EDU-011) ---

  app.get(
    '/coaches/:slug',
    {
      schema: {
        tags: ['education'],
        summary: 'Approved coach profile. Only approved public fields are returned.',
        params: slugParam,
        querystring: { type: 'object', additionalProperties: false, properties: { locale: localeQuery } },
        response: { 200: { type: 'object', additionalProperties: true }, 404: { $ref: 'ErrorResponse#' } }
      }
    },
    async (request) => {
      const { slug } = request.params as { slug: string };
      const coach = await deps.education.getPublicCoach(slug, localeOf(request));
      if (coach === null) throw new NotFoundError('Unknown coach.');
      return coach;
    }
  );

  // --- Enrollment (API-079) ---

  app.post(
    '/courses/:id/enrollments',
    {
      preHandler: [guards.requireSession],
      schema: {
        tags: ['education'],
        summary: 'Enroll in a course. A free course activates immediately; a paid one reserves the price and waits for activation.',
        params: idParam,
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const enrollment = await deps.education.enroll(request.requestContext, (request.params as { id: string }).id, learner(request));
      reply.status(201);
      return adminView(enrollment);
    }
  );

  app.post(
    '/me/enrollments/:id/activate',
    {
      preHandler: [guards.requireSession],
      schema: {
        tags: ['education'],
        summary: 'Capture the reserved price and activate a paid enrolment. Idempotent.',
        params: idParam,
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => adminView(await deps.education.activateEnrollment(request.requestContext, (request.params as { id: string }).id, learner(request)))
  );

  app.post(
    '/me/enrollments/:id/cancel',
    {
      preHandler: [guards.requireSession],
      schema: {
        tags: ['education'],
        summary: 'Cancel a pending enrolment and release any reservation.',
        params: idParam,
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => adminView(await deps.education.cancelEnrollment(request.requestContext, (request.params as { id: string }).id, learner(request)))
  );

  app.get(
    '/me/enrollments',
    {
      preHandler: [guards.requireSession],
      schema: { tags: ['education'], summary: 'The signed-in learner’s enrolments.', response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } }
    },
    async (request) => ({ items: (await deps.education.listMyEnrollments(learner(request))).map(adminView) })
  );

  // --- Course player (API-080, PAGE-032) ---

  app.get(
    '/me/enrollments/:id',
    {
      preHandler: [guards.requireSession],
      schema: {
        tags: ['education'],
        summary: 'Course access and progress. A locked lesson is returned without its body or media.',
        params: idParam,
        querystring: { type: 'object', additionalProperties: false, properties: { locale: localeQuery } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const { enrollment, course, lessons } = await deps.education.getLearnerCourse(
        (request.params as { id: string }).id,
        learner(request),
        localeOf(request)
      );
      const locale = localeOf(request);
      return {
        enrollment: adminView(enrollment),
        course: { id: course._id, slug: course.slug, title: course.translations[locale].title, completionRule: course.completionRule },
        lessons
      };
    }
  );

  // --- Progress (API-081) ---

  app.put(
    '/me/enrollments/:id/lessons/:lessonId/progress',
    {
      preHandler: [guards.requireSession],
      schema: {
        tags: ['education'],
        summary: 'Record lesson progress. Idempotent and monotonic; completion is recomputed from stored progress.',
        params: lessonParams,
        body: { type: 'object', required: ['percent'], additionalProperties: false, properties: { percent: { type: 'integer', minimum: 0, maximum: 100 } } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const { id, lessonId } = request.params as { id: string; lessonId: string };
      const { percent } = request.body as { percent: number };
      const result = await deps.education.recordProgress(request.requestContext, id, learner(request), lessonId, { percent });
      return { progress: adminView(result.progress), enrollment: adminView(result.enrollment) };
    }
  );

  // --- Reviews (API-082, EDU-008) ---

  app.post(
    '/courses/:id/reviews',
    {
      preHandler: [guards.requireSession],
      schema: {
        tags: ['education'],
        summary: 'Review a course. Requires an eligible enrolment; the review is moderated before it is public.',
        params: idParam,
        body: {
          type: 'object',
          required: ['rating', 'body'],
          additionalProperties: false,
          properties: { rating: { type: 'integer', minimum: 1, maximum: 5 }, body: { type: 'string', minLength: 1, maxLength: 2000 } }
        },
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const body = request.body as { rating: number; body: string };
      const review = await deps.education.createReview(request.requestContext, (request.params as { id: string }).id, learner(request), body);
      reply.status(201);
      return adminView(review);
    }
  );

  // --- Education administration (PAGE-054, ROLE-023) ---

  app.get(
    '/admin/courses/config',
    { ...manageGate(), schema: { tags: ['education'], summary: 'Which education controls are gated.', response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } },
    async () => deps.education.configView()
  );

  app.get(
    '/admin/courses',
    {
      ...manageGate(),
      schema: {
        tags: ['education'],
        summary: 'List courses in any state.',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { state: { type: 'string', enum: [...COURSE_STATES] }, cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }
        },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const page = await deps.education.listForAdmin(request.query as { state?: CourseState });
      return { items: page.items.map(adminView), nextCursor: page.nextCursor };
    }
  );

  app.post(
    '/admin/courses',
    {
      ...manageGate(),
      schema: { tags: ['education'], summary: 'Create a course (draft).', body: { type: 'object', additionalProperties: true, properties: {} }, response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses } }
    },
    async (request, reply) => {
      const record = await deps.education.createCourse(request.requestContext, request.body as Parameters<EducationService['createCourse']>[1]);
      reply.status(201);
      return adminView(record);
    }
  );

  app.get(
    '/admin/courses/:id',
    { ...manageGate(), schema: { tags: ['education'], summary: 'Full course with its lessons and reviews.', params: idParam, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } },
    async (request) => {
      const { id } = request.params as { id: string };
      const course = await deps.education.getCourseById(id);
      if (course === null) throw new NotFoundError('Unknown course.');
      const [lessons, reviews, enrollments] = await Promise.all([
        deps.education.listLessons(id),
        deps.education.listReviewsForAdmin(id),
        deps.education.listCourseEnrollments(id)
      ]);
      return { course: adminView(course), lessons: lessons.map(adminView), reviews: reviews.map(adminView), enrollments: enrollments.map(adminView) };
    }
  );

  app.put(
    '/admin/courses/:id',
    {
      ...manageGate(),
      schema: {
        tags: ['education'],
        summary: 'Update a course. Access model and price are locked while published.',
        params: idParam,
        body: { type: 'object', additionalProperties: true, required: ['expectedVersion'], properties: { expectedVersion: { type: 'integer', minimum: 1 } } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => adminView(await deps.education.updateCourse(request.requestContext, (request.params as { id: string }).id, request.body as Parameters<EducationService['updateCourse']>[2]))
  );

  app.post(
    '/admin/courses/:id/state',
    {
      ...manageGate(),
      schema: {
        tags: ['education'],
        summary: 'Move a course through its lifecycle. Publication validates the curriculum, access model, and owning coach.',
        params: idParam,
        body: {
          type: 'object',
          required: ['state', 'expectedVersion', 'reason'],
          additionalProperties: false,
          properties: { state: { type: 'string', enum: [...COURSE_STATES] }, expectedVersion: { type: 'integer', minimum: 1 }, reason: reasonProperty }
        },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const body = request.body as { state: CourseState; expectedVersion: number; reason: string };
      return adminView(await deps.education.setCourseState(request.requestContext, (request.params as { id: string }).id, body.state, body));
    }
  );

  app.post(
    '/admin/courses/:id/lessons',
    {
      ...manageGate(),
      schema: { tags: ['education'], summary: 'Add a lesson. Quiz and exercise types are refused (OD-016).', params: idParam, body: { type: 'object', additionalProperties: true, properties: {} }, response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses } }
    },
    async (request, reply) => {
      const record = await deps.education.createLesson(request.requestContext, (request.params as { id: string }).id, request.body as Parameters<EducationService['createLesson']>[2]);
      reply.status(201);
      return adminView(record);
    }
  );

  app.put(
    '/admin/lessons/:id',
    {
      ...manageGate(),
      schema: {
        tags: ['education'],
        summary: 'Update a lesson.',
        params: idParam,
        body: { type: 'object', additionalProperties: true, required: ['expectedVersion'], properties: { expectedVersion: { type: 'integer', minimum: 1 } } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => adminView(await deps.education.updateLesson(request.requestContext, (request.params as { id: string }).id, request.body as Parameters<EducationService['updateLesson']>[2]))
  );

  app.post(
    '/admin/enrollments/:id/revoke',
    {
      ...manageGate(),
      schema: {
        tags: ['education'],
        summary: 'Revoke an enrolment’s entitlement. Records the revocation only; it executes no refund (OD-015).',
        params: idParam,
        body: { type: 'object', required: ['reason'], additionalProperties: false, properties: { reason: reasonProperty } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const { reason } = request.body as { reason: string };
      return adminView(await deps.education.revokeEnrollment(request.requestContext, (request.params as { id: string }).id, reason));
    }
  );

  app.post(
    '/admin/reviews/:id/moderate',
    {
      ...manageGate(),
      schema: {
        tags: ['education'],
        summary: 'Publish or remove a course review.',
        params: idParam,
        body: {
          type: 'object',
          required: ['state', 'reason'],
          additionalProperties: false,
          properties: { state: { type: 'string', enum: ['published', 'removed'] }, reason: reasonProperty }
        },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const body = request.body as { state: 'published' | 'removed'; reason: string };
      return adminView(await deps.education.moderateReview(request.requestContext, (request.params as { id: string }).id, body.state, body.reason));
    }
  );

  app.get(
    '/admin/coaches',
    { ...manageGate(), schema: { tags: ['education'], summary: 'List coach profiles.', response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } },
    async () => ({ items: (await deps.education.listCoaches()).map(adminView) })
  );

  app.post(
    '/admin/coaches',
    {
      ...manageGate(),
      schema: { tags: ['education'], summary: 'Create or update a coach profile (approved public fields only).', body: { type: 'object', additionalProperties: true, required: ['accountId'], properties: { accountId: { type: 'string' } } }, response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses } }
    },
    async (request, reply) => {
      const record = await deps.education.upsertCoach(request.requestContext, request.body as Parameters<EducationService['upsertCoach']>[1]);
      reply.status(201);
      return adminView(record);
    }
  );

  app.post(
    '/admin/coaches/:id/approval',
    {
      ...manageGate(),
      schema: {
        tags: ['education'],
        summary: 'Approve or withdraw approval for a coach. Only an approved coach can own a published course.',
        params: idParam,
        body: { type: 'object', required: ['approved', 'reason'], additionalProperties: false, properties: { approved: { type: 'boolean' }, reason: reasonProperty } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const body = request.body as { approved: boolean; reason: string };
      return adminView(await deps.education.approveCoach(request.requestContext, (request.params as { id: string }).id, body.approved, body.reason));
    }
  );
}
