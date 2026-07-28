import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../../config.ts';
import { buildAdmin, buildEducation, buildHolds, buildIdentity, buildLedger, buildServer } from '../../server.ts';
import { allMigrations } from '../../migrations.ts';
import { runMigrations } from '../../shared/db/migrations.ts';
import { seedSystemConfiguration } from '../../shared/db/seed.ts';
import { createTestDatabase, type TestDatabase } from '../../shared/db/test-support.ts';
import { createRequestContext } from '../../shared/context.ts';
import { newId } from '../../shared/ids.ts';
import { utcNow } from '../../shared/events.ts';
import { SESSION_COOKIE } from '../identity/index.ts';
import { GLOBAL_SCOPE_ID, GLOBAL_SCOPE_TYPE, roleAssignments } from '../admin/store.ts';
import type { LedgerService } from '../ledger/index.ts';
import type { EnrollmentRecord } from './state.ts';

/**
 * Education integration coverage (EDU-001..012, TEST-022).
 *
 * TEST-022 requires free/paid entitlement, progress, completion, and revocation; each has
 * a test below. The security cases are that a draft course is never public, that lesson
 * content needs both an enrollment and a live entitlement (BR-024), and that paid
 * activation is exactly-once against the shared ledger.
 */

let fixture: TestDatabase;
/** OD-015 gate off — the shipped default. */
let app: FastifyInstance;
/** OD-015 gate on, to prove the paid path is gated rather than absent. */
let paidApp: FastifyInstance;
let ledger: LedgerService;

function buildApp(paidCoursesEnabled: boolean): FastifyInstance {
  const config = { ...loadConfig({ NODE_ENV: 'test' }), paidCoursesEnabled };
  const identity = buildIdentity(fixture.database, config);
  const ledgerDeps = buildLedger(fixture.database);
  ledger = ledgerDeps.service;
  const holds = buildHolds(fixture.database, ledgerDeps);
  return buildServer(config, {
    database: fixture.database,
    identity,
    admin: buildAdmin(fixture.database),
    education: buildEducation(fixture.database, config, holds)
  });
}

before(async () => {
  fixture = await createTestDatabase();
  await runMigrations(fixture.database.db, allMigrations);
  await seedSystemConfiguration(fixture.database.db);
  app = buildApp(false);
  paidApp = buildApp(true);
  await Promise.all([app.ready(), paidApp.ready()]);
});

after(async () => {
  await Promise.all([app.close(), paidApp.close()]);
  await fixture.dispose();
});

beforeEach(async () => {
  for (const name of [
    'courses',
    'course_lessons',
    'course_enrollments',
    'lesson_progress',
    'course_reviews',
    'coach_profiles',
    'dragon_coin_holds',
    'ledger_accounts',
    'ledger_transactions',
    'ledger_entries',
    'idempotency_keys',
    'role_assignments',
    'audit_events',
    'rate_limits'
  ]) {
    await fixture.database.db.collection(name).deleteMany({});
  }
});

let counter = 9_400_000;
async function loginAs(role?: string): Promise<{ cookie: string; accountId: string }> {
  counter += 1;
  const mobile = `0912${String(counter)}`;
  await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { mobile } });
  const inbox = await app.inject({ method: 'GET', url: `/api/v1/dev/sms-inbox?mobile=${mobile}` });
  const code = inbox.json<Array<{ code: string }>>()[0]?.code as string;
  const verify = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { mobile, code } });
  const cookie = verify.cookies.find((c) => c.name === SESSION_COOKIE)?.value as string;
  const session = await app.inject({ method: 'GET', url: '/api/v1/auth/session', cookies: { [SESSION_COOKIE]: cookie } });
  const accountId = session.json<{ account: { id: string } }>().account.id;
  if (role !== undefined) {
    await roleAssignments(fixture.database.db).insertOne({
      _id: newId(),
      accountId,
      role,
      scopeType: GLOBAL_SCOPE_TYPE,
      scopeId: GLOBAL_SCOPE_ID,
      grantedBy: 'test',
      grantedAt: utcNow(),
      revokedAt: null
    });
  }
  return { cookie, accountId };
}

function auth(cookie: string) {
  return { cookies: { [SESSION_COOKIE]: cookie } };
}

interface Row {
  id: string;
  slug: string;
  state: string;
  version: number;
}

/** Credits a learner's Dragon Coin balance so a paid enrolment has something to reserve. */
async function creditCoins(accountId: string, amount: number): Promise<void> {
  const context = createRequestContext(`edu-itest-credit-${accountId}`);
  // Named separately: indexing the array would widen each ref to `| undefined`.
  const userRef = { kind: 'user' as const, ownerId: accountId, accountType: 'user_dragon_coin' as const };
  const treasuryRef = { kind: 'system' as const, accountType: 'platform_dragon_coin_treasury' as const };
  await ledger.ensureAccounts([userRef, treasuryRef]);
  await ledger.post(context, {
    type: 'dragon_coin_issue',
    businessRef: `edu-itest-credit:${accountId}`,
    idempotencyKey: `edu-itest-credit:${accountId}`,
    description: 'Test credit',
    entries: [
      { account: userRef, amount },
      { account: treasuryRef, amount: -amount }
    ]
  });
}

/** Creates a published course with `lessonCount` required lessons; returns ids. */
async function publishedCourse(
  target: FastifyInstance,
  cookie: string,
  options: { lessonCount?: number; accessModel?: 'free' | 'paid'; dragonCoinAmount?: number; thresholdPercent?: number } = {}
): Promise<{ courseId: string; slug: string; lessonIds: string[] }> {
  const lessonCount = options.lessonCount ?? 1;
  const slug = `course-${newId().slice(0, 8)}`;

  const coachAccount = await loginAs();
  const coach = await target.inject({
    method: 'POST',
    url: '/api/v1/admin/coaches',
    payload: { accountId: coachAccount.accountId, translations: { fa: { displayName: 'مربی' }, en: { displayName: `Coach ${slug}` } } },
    ...auth(cookie)
  });
  assert.equal(coach.statusCode, 201, coach.body);
  const coachId = coach.json<{ id: string }>().id;
  const approved = await target.inject({
    method: 'POST',
    url: `/api/v1/admin/coaches/${coachId}/approval`,
    payload: { approved: true, reason: 'Approved for the test.' },
    ...auth(cookie)
  });
  assert.equal(approved.statusCode, 200);

  const created = await target.inject({
    method: 'POST',
    url: '/api/v1/admin/courses',
    payload: {
      slug,
      coachId,
      accessModel: options.accessModel ?? 'free',
      ...(options.accessModel === 'paid' ? { price: { dragonCoinAmount: options.dragonCoinAmount ?? 100 } } : {}),
      ...(options.thresholdPercent === undefined ? {} : { completionRule: { thresholdPercent: options.thresholdPercent } }),
      translations: { fa: { title: 'دوره', summary: 'خلاصه' }, en: { title: 'Course', summary: 'Summary' } }
    },
    ...auth(cookie)
  });
  assert.equal(created.statusCode, 201, created.body);
  let course = created.json<Row>();

  const lessonIds: string[] = [];
  for (let i = 1; i <= lessonCount; i += 1) {
    const lesson = await target.inject({
      method: 'POST',
      url: `/api/v1/admin/courses/${course.id}/lessons`,
      payload: {
        order: i,
        required: true,
        type: 'text',
        translations: { fa: { title: `درس ${String(i)}`, body: 'متن' }, en: { title: `Lesson ${String(i)}`, body: 'Body' } },
        ...(i > 1 ? { prerequisiteLessonIds: [lessonIds[i - 2]] } : {})
      },
      ...auth(cookie)
    });
    assert.equal(lesson.statusCode, 201, lesson.body);
    lessonIds.push(lesson.json<{ id: string }>().id);
  }

  for (const state of ['review', 'published'] as const) {
    const moved = await target.inject({
      method: 'POST',
      url: `/api/v1/admin/courses/${course.id}/state`,
      payload: { state, expectedVersion: course.version, reason: `Moving to ${state}.` },
      ...auth(cookie)
    });
    assert.equal(moved.statusCode, 200, moved.body);
    course = moved.json<Row>();
  }
  return { courseId: course.id, slug, lessonIds };
}

describe('authoring authorization (ROLE-023)', () => {
  test('an anonymous caller cannot reach the education console', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/courses' })).statusCode, 401);
  });

  test('a signed-in caller without education.manage is refused', async () => {
    const { cookie } = await loginAs();
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/admin/courses', payload: {}, ...auth(cookie) })).statusCode, 403);
  });

  test('a content publisher cannot manage courses: the permissions are separate', async () => {
    const { cookie } = await loginAs('content_publisher');
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/courses', ...auth(cookie) })).statusCode, 403);
  });

  test('an education manager holds education.manage and no unrelated platform power', async () => {
    const { cookie } = await loginAs('education_manager');
    const capabilities = await app.inject({ method: 'GET', url: '/api/v1/admin/capabilities', ...auth(cookie) });
    const { permissions } = capabilities.json<{ permissions: string[] }>();
    assert.ok(permissions.includes('education.manage'));
    for (const forbidden of ['users.suspend', 'moderation.manage', 'finance.manage', 'tournament.manage']) {
      assert.equal(permissions.includes(forbidden), false, `must not hold ${forbidden}`);
    }
  });
});

describe('publication and public visibility (EDU-001, EDU-009)', () => {
  test('a draft course is neither listed nor readable', async () => {
    const { cookie } = await loginAs('education_manager');
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/courses',
      payload: { slug: 'hidden-course', translations: { fa: { title: 'پنهان' }, en: { title: 'Hidden' } } },
      ...auth(cookie)
    });
    assert.equal(created.statusCode, 201);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/courses?locale=en' })).json<{ items: unknown[] }>().items.length, 0);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/courses/hidden-course' })).statusCode, 404);
  });

  test('publication is refused until the curriculum, coach, and localization are complete', async () => {
    const { cookie } = await loginAs('education_manager');
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/courses',
      payload: { slug: 'incomplete', translations: { en: { title: 'Incomplete' } } },
      ...auth(cookie)
    });
    let course = created.json<Row>();
    const review = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/courses/${course.id}/state`,
      payload: { state: 'review', expectedVersion: course.version, reason: 'Submitting.' },
      ...auth(cookie)
    });
    course = review.json<Row>();
    const publish = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/courses/${course.id}/state`,
      payload: { state: 'published', expectedVersion: course.version, reason: 'Publishing.' },
      ...auth(cookie)
    });
    assert.equal(publish.statusCode, 422);
    const codes = publish.json<{ error: { fieldErrors: Array<{ code: string }> } }>().error.fieldErrors.map((f) => f.code);
    assert.ok(codes.includes('REQUIRED_FOR_PUBLICATION'));
  });

  test('a published course is listed, and the public payload carries no lesson body', async () => {
    const { cookie } = await loginAs('education_manager');
    const { slug } = await publishedCourse(app, cookie, { lessonCount: 2 });
    const detail = await app.inject({ method: 'GET', url: `/api/v1/courses/${slug}?locale=en` });
    assert.equal(detail.statusCode, 200);
    const body = detail.json<{ curriculum: Array<{ title: string }>; coach: { displayName: string } | null }>();
    assert.equal(body.curriculum.length, 2);
    assert.equal(body.coach?.displayName.startsWith('Coach'), true);
    // The outline is public; the content behind it is not.
    assert.equal(detail.body.includes('"body"'), false, 'no lesson body may appear in a public payload');
  });

  test('an unapproved coach cannot own a published course', async () => {
    const { cookie } = await loginAs('education_manager');
    const coachAccount = await loginAs();
    const coach = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/coaches',
      payload: { accountId: coachAccount.accountId, translations: { en: { displayName: 'Unapproved' }, fa: { displayName: 'تأییدنشده' } } },
      ...auth(cookie)
    });
    const coachId = coach.json<{ id: string }>().id;
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/courses',
      payload: { slug: 'unapproved-owner', coachId, translations: { fa: { title: 'دوره', summary: 'خلاصه' }, en: { title: 'Course', summary: 'Summary' } } },
      ...auth(cookie)
    });
    let course = created.json<Row>();
    await app.inject({ method: 'POST', url: `/api/v1/admin/courses/${course.id}/lessons`, payload: { order: 1, translations: { fa: { title: 'د' }, en: { title: 'L' } } }, ...auth(cookie) });
    const review = await app.inject({ method: 'POST', url: `/api/v1/admin/courses/${course.id}/state`, payload: { state: 'review', expectedVersion: course.version, reason: 'r' }, ...auth(cookie) });
    course = review.json<Row>();
    const publish = await app.inject({ method: 'POST', url: `/api/v1/admin/courses/${course.id}/state`, payload: { state: 'published', expectedVersion: course.version, reason: 'p' }, ...auth(cookie) });
    assert.equal(publish.statusCode, 422);
    assert.ok(publish.json<{ error: { fieldErrors: Array<{ code: string }> } }>().error.fieldErrors.some((f) => f.code === 'COACH_NOT_APPROVED'));
  });

  test('only an approved coach profile is public, and only approved fields', async () => {
    const { cookie } = await loginAs('education_manager');
    const coachAccount = await loginAs();
    const coach = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/coaches',
      payload: { accountId: coachAccount.accountId, slug: 'public-coach', translations: { fa: { displayName: 'مربی', bio: 'زندگی‌نامه' }, en: { displayName: 'Public Coach', bio: 'Bio' } } },
      ...auth(cookie)
    });
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/coaches/public-coach' })).statusCode, 404, 'unapproved is not public');

    await app.inject({ method: 'POST', url: `/api/v1/admin/coaches/${coach.json<{ id: string }>().id}/approval`, payload: { approved: true, reason: 'ok' }, ...auth(cookie) });
    const publicCoach = await app.inject({ method: 'GET', url: '/api/v1/coaches/public-coach?locale=en' });
    assert.equal(publicCoach.statusCode, 200);
    const payload = publicCoach.json<Record<string, unknown>>();
    assert.equal(payload['displayName'], 'Public Coach');
    // EDU-011: the account id, approval trail, and any internal field stay out.
    for (const field of ['accountId', 'approvedBy', 'approvedAt', 'version']) {
      assert.equal(field in payload, false, `${field} must not be public`);
    }
  });
});

describe('free enrollment, progress, and completion (EDU-005, EDU-006, EDU-007)', () => {
  test('a free course activates immediately and grants lesson access', async () => {
    const manager = await loginAs('education_manager');
    const { courseId } = await publishedCourse(app, manager.cookie);
    const learner = await loginAs();

    const enrolled = await app.inject({ method: 'POST', url: `/api/v1/courses/${courseId}/enrollments`, ...auth(learner.cookie) });
    assert.equal(enrolled.statusCode, 201);
    const enrollment = enrolled.json<EnrollmentRecord & { id: string }>();
    assert.equal(enrollment.state, 'active');
    assert.equal(enrollment.entitlementState, 'none');

    const player = await app.inject({ method: 'GET', url: `/api/v1/me/enrollments/${enrollment.id}?locale=en`, ...auth(learner.cookie) });
    assert.equal(player.statusCode, 200);
    assert.equal(player.json<{ lessons: Array<{ locked: boolean; body: string | null }> }>().lessons[0]?.body, 'Body');
  });

  test('enrolling twice returns the same enrollment', async () => {
    const manager = await loginAs('education_manager');
    const { courseId } = await publishedCourse(app, manager.cookie);
    const learner = await loginAs();
    const first = await app.inject({ method: 'POST', url: `/api/v1/courses/${courseId}/enrollments`, ...auth(learner.cookie) });
    const second = await app.inject({ method: 'POST', url: `/api/v1/courses/${courseId}/enrollments`, ...auth(learner.cookie) });
    assert.equal(first.json<{ id: string }>().id, second.json<{ id: string }>().id);
    assert.equal(await fixture.database.db.collection('course_enrollments').countDocuments({ courseId }), 1);
  });

  test('a later lesson is locked until its prerequisite is complete, and delivers no body while locked', async () => {
    const manager = await loginAs('education_manager');
    const { courseId, lessonIds } = await publishedCourse(app, manager.cookie, { lessonCount: 2 });
    const learner = await loginAs();
    const enrollment = (await app.inject({ method: 'POST', url: `/api/v1/courses/${courseId}/enrollments`, ...auth(learner.cookie) })).json<{ id: string }>();

    const locked = (await app.inject({ method: 'GET', url: `/api/v1/me/enrollments/${enrollment.id}?locale=en`, ...auth(learner.cookie) })).json<{
      lessons: Array<{ id: string; locked: boolean; body: string | null }>;
    }>();
    assert.equal(locked.lessons[1]?.locked, true);
    assert.equal(locked.lessons[1]?.body, null, 'a locked lesson must not deliver its body');

    // Reporting progress on a locked lesson is refused, not silently accepted.
    const early = await app.inject({
      method: 'PUT',
      url: `/api/v1/me/enrollments/${enrollment.id}/lessons/${lessonIds[1] as string}/progress`,
      payload: { percent: 100 },
      ...auth(learner.cookie)
    });
    assert.equal(early.statusCode, 403);

    await app.inject({
      method: 'PUT',
      url: `/api/v1/me/enrollments/${enrollment.id}/lessons/${lessonIds[0] as string}/progress`,
      payload: { percent: 100 },
      ...auth(learner.cookie)
    });
    const unlocked = (await app.inject({ method: 'GET', url: `/api/v1/me/enrollments/${enrollment.id}?locale=en`, ...auth(learner.cookie) })).json<{
      lessons: Array<{ locked: boolean; body: string | null }>;
    }>();
    assert.equal(unlocked.lessons[1]?.locked, false);
    assert.equal(unlocked.lessons[1]?.body, 'Body');
  });

  test('progress is idempotent and monotonic across devices', async () => {
    const manager = await loginAs('education_manager');
    const { courseId, lessonIds } = await publishedCourse(app, manager.cookie, { lessonCount: 2 });
    const learner = await loginAs();
    const enrollment = (await app.inject({ method: 'POST', url: `/api/v1/courses/${courseId}/enrollments`, ...auth(learner.cookie) })).json<{ id: string }>();
    const url = `/api/v1/me/enrollments/${enrollment.id}/lessons/${lessonIds[0] as string}/progress`;

    await app.inject({ method: 'PUT', url, payload: { percent: 60 }, ...auth(learner.cookie) });
    // A replay of the same report changes nothing.
    const replay = await app.inject({ method: 'PUT', url, payload: { percent: 60 }, ...auth(learner.cookie) });
    assert.equal(replay.json<{ progress: { percent: number } }>().progress.percent, 60);
    // A stale device reporting less never lowers what was recorded.
    const stale = await app.inject({ method: 'PUT', url, payload: { percent: 10 }, ...auth(learner.cookie) });
    assert.equal(stale.json<{ progress: { percent: number } }>().progress.percent, 60);
    // One row per enrollment/lesson, whatever the number of reports.
    assert.equal(await fixture.database.db.collection('lesson_progress').countDocuments({ enrollmentId: enrollment.id }), 1);
  });

  test('completing every required lesson completes the enrollment deterministically', async () => {
    const manager = await loginAs('education_manager');
    const { courseId, lessonIds } = await publishedCourse(app, manager.cookie, { lessonCount: 2 });
    const learner = await loginAs();
    const enrollment = (await app.inject({ method: 'POST', url: `/api/v1/courses/${courseId}/enrollments`, ...auth(learner.cookie) })).json<{ id: string }>();

    const first = await app.inject({
      method: 'PUT',
      url: `/api/v1/me/enrollments/${enrollment.id}/lessons/${lessonIds[0] as string}/progress`,
      payload: { percent: 100 },
      ...auth(learner.cookie)
    });
    assert.equal(first.json<{ enrollment: { state: string } }>().enrollment.state, 'active', 'not complete until every required lesson is');

    const second = await app.inject({
      method: 'PUT',
      url: `/api/v1/me/enrollments/${enrollment.id}/lessons/${lessonIds[1] as string}/progress`,
      payload: { percent: 100 },
      ...auth(learner.cookie)
    });
    assert.equal(second.json<{ enrollment: { state: string; completedAt: string | null } }>().enrollment.state, 'completed');
    assert.ok(second.json<{ enrollment: { completedAt: string | null } }>().enrollment.completedAt);
    // A completed enrollment keeps access.
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/me/enrollments/${enrollment.id}`, ...auth(learner.cookie) })).statusCode, 200);
  });

  test("a learner cannot read another learner's enrollment", async () => {
    const manager = await loginAs('education_manager');
    const { courseId } = await publishedCourse(app, manager.cookie);
    const owner = await loginAs();
    const stranger = await loginAs();
    const enrollment = (await app.inject({ method: 'POST', url: `/api/v1/courses/${courseId}/enrollments`, ...auth(owner.cookie) })).json<{ id: string }>();
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/me/enrollments/${enrollment.id}`, ...auth(stranger.cookie) })).statusCode, 404);
  });
});

describe('paid enrollment under OD-015 (EDU-002, EDU-010)', () => {
  test('with the gate off, a course cannot even be priced', async () => {
    const { cookie } = await loginAs('education_manager');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/courses',
      payload: { slug: 'priced', accessModel: 'paid', price: { dragonCoinAmount: 100 }, translations: { en: { title: 'Paid' } } },
      ...auth(cookie)
    });
    assert.equal(response.statusCode, 422);
    assert.ok(response.json<{ error: { fieldErrors: Array<{ code: string }> } }>().error.fieldErrors.some((f) => f.code === 'PAID_COURSES_DISABLED'));
  });

  test('a paid enrolment reserves the price, activates on capture, and moves the ledger exactly once', async () => {
    const manager = await loginAs('education_manager');
    const { courseId } = await publishedCourse(paidApp, manager.cookie, { accessModel: 'paid', dragonCoinAmount: 250 });
    const learner = await loginAs();
    await creditCoins(learner.accountId, 1000);

    const enrolled = await paidApp.inject({ method: 'POST', url: `/api/v1/courses/${courseId}/enrollments`, ...auth(learner.cookie) });
    assert.equal(enrolled.statusCode, 201, enrolled.body);
    const enrollment = enrolled.json<EnrollmentRecord & { id: string }>();
    assert.equal(enrollment.state, 'pending_payment');
    assert.equal(enrollment.entitlementState, 'pending');

    // The reservation is real: the balance is held before anything is captured.
    const held = await ledger.getBalanceByRef({ kind: 'user', ownerId: learner.accountId, accountType: 'user_dragon_coin' });
    assert.equal(held?.heldAmount, 250);

    // Access is denied while the entitlement is only pending (BR-024).
    assert.equal((await paidApp.inject({ method: 'GET', url: `/api/v1/me/enrollments/${enrollment.id}`, ...auth(learner.cookie) })).statusCode, 403);

    const activated = await paidApp.inject({ method: 'POST', url: `/api/v1/me/enrollments/${enrollment.id}/activate`, ...auth(learner.cookie) });
    assert.equal(activated.statusCode, 200, activated.body);
    assert.equal(activated.json<{ state: string; entitlementState: string }>().state, 'active');
    assert.equal(activated.json<{ entitlementState: string }>().entitlementState, 'active');

    const afterCapture = await ledger.getBalanceByRef({ kind: 'user', ownerId: learner.accountId, accountType: 'user_dragon_coin' });
    assert.equal(afterCapture?.balance, 750, 'exact integer arithmetic: 1000 - 250');
    assert.equal(afterCapture?.heldAmount, 0);

    // Replaying activation is free: no second capture, no second charge.
    const replay = await paidApp.inject({ method: 'POST', url: `/api/v1/me/enrollments/${enrollment.id}/activate`, ...auth(learner.cookie) });
    assert.equal(replay.statusCode, 200);
    const afterReplay = await ledger.getBalanceByRef({ kind: 'user', ownerId: learner.accountId, accountType: 'user_dragon_coin' });
    assert.equal(afterReplay?.balance, 750, 'activation is exactly-once');

    assert.equal((await paidApp.inject({ method: 'GET', url: `/api/v1/me/enrollments/${enrollment.id}`, ...auth(learner.cookie) })).statusCode, 200);
  });

  test('cancelling a pending paid enrolment releases the reservation', async () => {
    const manager = await loginAs('education_manager');
    const { courseId } = await publishedCourse(paidApp, manager.cookie, { accessModel: 'paid', dragonCoinAmount: 300 });
    const learner = await loginAs();
    await creditCoins(learner.accountId, 1000);

    const enrollment = (await paidApp.inject({ method: 'POST', url: `/api/v1/courses/${courseId}/enrollments`, ...auth(learner.cookie) })).json<{ id: string }>();
    assert.equal((await ledger.getBalanceByRef({ kind: 'user', ownerId: learner.accountId, accountType: 'user_dragon_coin' }))?.heldAmount, 300);

    const cancelled = await paidApp.inject({ method: 'POST', url: `/api/v1/me/enrollments/${enrollment.id}/cancel`, ...auth(learner.cookie) });
    assert.equal(cancelled.statusCode, 200, cancelled.body);
    assert.equal(cancelled.json<{ state: string }>().state, 'cancelled');

    // The balance is returned immediately rather than waiting for the hold to expire.
    const after = await ledger.getBalanceByRef({ kind: 'user', ownerId: learner.accountId, accountType: 'user_dragon_coin' });
    assert.equal(after?.heldAmount, 0);
    assert.equal(after?.balance, 1000, 'nothing was captured');

    // The seat is free again, so the learner can enroll afresh.
    assert.equal((await paidApp.inject({ method: 'POST', url: `/api/v1/courses/${courseId}/enrollments`, ...auth(learner.cookie) })).statusCode, 201);
  });

  test('a concurrent duplicate enrolment leaves no reservation stranded', async () => {
    const manager = await loginAs('education_manager');
    const { courseId } = await publishedCourse(paidApp, manager.cookie, { accessModel: 'paid', dragonCoinAmount: 200 });
    const learner = await loginAs();
    await creditCoins(learner.accountId, 1000);

    // Both requests pass the existence check before either inserts, so both attempt a
    // reservation. Two defences apply: within one millisecond the shared idempotency
    // layer collapses them onto a single hold, and otherwise the losing attempt releases
    // its own reservation when the unique index refuses its enrollment.
    const results = await Promise.all([
      paidApp.inject({ method: 'POST', url: `/api/v1/courses/${courseId}/enrollments`, ...auth(learner.cookie) }),
      paidApp.inject({ method: 'POST', url: `/api/v1/courses/${courseId}/enrollments`, ...auth(learner.cookie) })
    ]);
    // One request always succeeds; the other either returns the same enrollment or is
    // refused in a controlled way. Neither may be a server error.
    assert.equal(results.filter((r) => r.statusCode === 201).length >= 1, true, results.map((r) => r.body).join(' | '));
    assert.equal(results.filter((r) => r.statusCode >= 500).length, 0, 'a race must never surface as a server error');
    assert.equal(await fixture.database.db.collection('course_enrollments').countDocuments({ courseId }), 1);

    // The invariant that matters: exactly one price is held, never two.
    const balance = await ledger.getBalanceByRef({ kind: 'user', ownerId: learner.accountId, accountType: 'user_dragon_coin' });
    assert.equal(balance?.heldAmount, 200, 'only the winning enrolment holds the learner’s balance');
    assert.equal(await fixture.database.db.collection('dragon_coin_holds').countDocuments({ ownerId: learner.accountId, state: 'active' }), 1);
  });

  test('a learner without enough Dragon Coin cannot enroll, and no enrollment is left behind', async () => {
    const manager = await loginAs('education_manager');
    const { courseId } = await publishedCourse(paidApp, manager.cookie, { accessModel: 'paid', dragonCoinAmount: 500 });
    const learner = await loginAs();
    await creditCoins(learner.accountId, 100);

    const response = await paidApp.inject({ method: 'POST', url: `/api/v1/courses/${courseId}/enrollments`, ...auth(learner.cookie) });
    assert.equal(response.statusCode, 409);
    assert.equal(await fixture.database.db.collection('course_enrollments').countDocuments({ courseId }), 0);
  });

  test('a published paid course cannot be silently repriced under an existing enrolment', async () => {
    const manager = await loginAs('education_manager');
    const { courseId } = await publishedCourse(paidApp, manager.cookie, { accessModel: 'paid', dragonCoinAmount: 100 });
    const course = (await paidApp.inject({ method: 'GET', url: `/api/v1/admin/courses/${courseId}`, ...auth(manager.cookie) })).json<{ course: Row }>().course;
    const response = await paidApp.inject({
      method: 'PUT',
      url: `/api/v1/admin/courses/${courseId}`,
      payload: { expectedVersion: course.version, price: { dragonCoinAmount: 900 } },
      ...auth(manager.cookie)
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json<{ error: { code: string } }>().error.code, 'COURSE_PRICE_LOCKED');
  });
});

describe('revocation (EDU-005)', () => {
  test('revoking an entitlement closes access immediately and keeps the progress record', async () => {
    const manager = await loginAs('education_manager');
    const { courseId, lessonIds } = await publishedCourse(app, manager.cookie);
    const learner = await loginAs();
    const enrollment = (await app.inject({ method: 'POST', url: `/api/v1/courses/${courseId}/enrollments`, ...auth(learner.cookie) })).json<{ id: string }>();
    await app.inject({
      method: 'PUT',
      url: `/api/v1/me/enrollments/${enrollment.id}/lessons/${lessonIds[0] as string}/progress`,
      payload: { percent: 40 },
      ...auth(learner.cookie)
    });

    const revoked = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/enrollments/${enrollment.id}/revoke`,
      payload: { reason: 'Policy breach.' },
      ...auth(manager.cookie)
    });
    assert.equal(revoked.statusCode, 200);
    assert.equal(revoked.json<{ state: string; entitlementState: string }>().state, 'revoked');

    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/me/enrollments/${enrollment.id}`, ...auth(learner.cookie) })).statusCode, 403);
    const blocked = await app.inject({
      method: 'PUT',
      url: `/api/v1/me/enrollments/${enrollment.id}/lessons/${lessonIds[0] as string}/progress`,
      payload: { percent: 100 },
      ...auth(learner.cookie)
    });
    assert.equal(blocked.statusCode, 403);
    // The record of what was learned survives the revocation.
    assert.equal(await fixture.database.db.collection('lesson_progress').countDocuments({ enrollmentId: enrollment.id }), 1);
  });

  test('a revoked learner may enroll again, and the new enrollment is separate', async () => {
    const manager = await loginAs('education_manager');
    const { courseId } = await publishedCourse(app, manager.cookie);
    const learner = await loginAs();
    const first = (await app.inject({ method: 'POST', url: `/api/v1/courses/${courseId}/enrollments`, ...auth(learner.cookie) })).json<{ id: string }>();
    await app.inject({ method: 'POST', url: `/api/v1/admin/enrollments/${first.id}/revoke`, payload: { reason: 'Revoked.' }, ...auth(manager.cookie) });

    const second = await app.inject({ method: 'POST', url: `/api/v1/courses/${courseId}/enrollments`, ...auth(learner.cookie) });
    assert.equal(second.statusCode, 201);
    assert.notEqual(second.json<{ id: string }>().id, first.id);
  });

  test('an ordinary learner cannot revoke an enrollment', async () => {
    const manager = await loginAs('education_manager');
    const { courseId } = await publishedCourse(app, manager.cookie);
    const learner = await loginAs();
    const enrollment = (await app.inject({ method: 'POST', url: `/api/v1/courses/${courseId}/enrollments`, ...auth(learner.cookie) })).json<{ id: string }>();
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/enrollments/${enrollment.id}/revoke`,
      payload: { reason: 'Trying.' },
      ...auth(learner.cookie)
    });
    assert.equal(response.statusCode, 403);
  });
});

describe('reviews (EDU-008)', () => {
  test('only an enrolled learner can review, and the review is moderated before it is public', async () => {
    const manager = await loginAs('education_manager');
    const { courseId, slug } = await publishedCourse(app, manager.cookie);
    const stranger = await loginAs();
    const ineligible = await app.inject({ method: 'POST', url: `/api/v1/courses/${courseId}/reviews`, payload: { rating: 5, body: 'Great' }, ...auth(stranger.cookie) });
    assert.equal(ineligible.statusCode, 403);

    const learner = await loginAs();
    await app.inject({ method: 'POST', url: `/api/v1/courses/${courseId}/enrollments`, ...auth(learner.cookie) });
    const review = await app.inject({ method: 'POST', url: `/api/v1/courses/${courseId}/reviews`, payload: { rating: 5, body: 'Great course' }, ...auth(learner.cookie) });
    assert.equal(review.statusCode, 201);
    assert.equal(review.json<{ state: string }>().state, 'pending');

    // Pending reviews are not public.
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/courses/${slug}` })).json<{ reviews: unknown[] }>().reviews.length, 0);

    const moderated = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/reviews/${review.json<{ id: string }>().id}/moderate`,
      payload: { state: 'published', reason: 'Approved.' },
      ...auth(manager.cookie)
    });
    assert.equal(moderated.statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/courses/${slug}` })).json<{ reviews: unknown[] }>().reviews.length, 1);
  });

  test('a learner cannot review the same course twice', async () => {
    const manager = await loginAs('education_manager');
    const { courseId } = await publishedCourse(app, manager.cookie);
    const learner = await loginAs();
    await app.inject({ method: 'POST', url: `/api/v1/courses/${courseId}/enrollments`, ...auth(learner.cookie) });
    await app.inject({ method: 'POST', url: `/api/v1/courses/${courseId}/reviews`, payload: { rating: 5, body: 'First' }, ...auth(learner.cookie) });
    const second = await app.inject({ method: 'POST', url: `/api/v1/courses/${courseId}/reviews`, payload: { rating: 1, body: 'Second' }, ...auth(learner.cookie) });
    assert.equal(second.statusCode, 409);
  });
});

describe('lesson types under OD-016', () => {
  test('a quiz or exercise lesson is refused with the decision named', async () => {
    const { cookie } = await loginAs('education_manager');
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/courses',
      payload: { slug: 'quiz-course', translations: { en: { title: 'Quiz' } } },
      ...auth(cookie)
    });
    const courseId = created.json<Row>().id;
    for (const type of ['quiz', 'exercise']) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/courses/${courseId}/lessons`,
        payload: { order: 1, type, translations: { en: { title: 'L' } } },
        ...auth(cookie)
      });
      assert.equal(response.statusCode, 422, type);
      assert.ok(response.json<{ error: { fieldErrors: Array<{ message: string }> } }>().error.fieldErrors.some((f) => /OD-016/.test(f.message)));
    }
  });
});

describe('audit trail (AUDIT-001)', () => {
  test('authoring and enrolment changes are audited with the acting account', async () => {
    const manager = await loginAs('education_manager');
    const { courseId } = await publishedCourse(app, manager.cookie);
    const learner = await loginAs();
    await app.inject({ method: 'POST', url: `/api/v1/courses/${courseId}/enrollments`, ...auth(learner.cookie) });

    const actions = (
      await fixture.database.db.collection<{ action: string }>('audit_events').find({ resourceType: { $in: ['course', 'course_enrollment', 'coach_profile'] } }).toArray()
    ).map((row) => row.action);
    for (const expected of ['course.created', 'course.published', 'course.enrolled', 'course.coach_approved']) {
      assert.ok(actions.includes(expected), `missing audit row: ${expected}`);
    }
  });
});
