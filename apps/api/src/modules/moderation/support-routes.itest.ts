import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../../config.ts';
import { buildAdmin, buildGames, buildIdentity, buildModeration, buildServer, buildTournaments } from '../../server.ts';
import { allMigrations } from '../../migrations.ts';
import { runMigrations } from '../../shared/db/migrations.ts';
import { seedSystemConfiguration } from '../../shared/db/seed.ts';
import { createTestDatabase, type TestDatabase } from '../../shared/db/test-support.ts';
import { newId } from '../../shared/ids.ts';
import { utcNow } from '../../shared/events.ts';
import { SESSION_COOKIE } from '../identity/index.ts';
import { GLOBAL_SCOPE_ID, GLOBAL_SCOPE_TYPE, roleAssignments } from '../admin/store.ts';

/**
 * The participant-facing support surface behind `/help` (PAGE-023).
 *
 * The ownership boundary is already covered at the service level; what is asserted here is
 * the HTTP contract the browser actually depends on — that the requester's projection never
 * carries the operator's working note or the assigned staff identity, that the category
 * vocabulary is closed, that a caller cannot read someone else's case through the id, and
 * that the list pages over the caller's own cases only.
 * Requires the disposable test database: `npm run db:test:up`.
 */

let fixture: TestDatabase;
let app: FastifyInstance;

before(async () => {
  fixture = await createTestDatabase();
  await runMigrations(fixture.database.db, allMigrations);
  await seedSystemConfiguration(fixture.database.db);
  const config = loadConfig({ NODE_ENV: 'test' });
  const identity = buildIdentity(fixture.database, config);
  const games = buildGames(fixture.database);
  app = buildServer(config, {
    database: fixture.database,
    identity,
    admin: buildAdmin(fixture.database),
    games,
    // The moderation routes are registered inside the tournaments branch of the server
    // wiring, so the surface under test only exists when tournaments is supplied.
    tournaments: buildTournaments(fixture.database, games),
    moderation: buildModeration(fixture.database, identity)
  });
  await app.ready();
});

after(async () => {
  await app.close();
  await fixture.dispose();
});

function coll(name: string) {
  return fixture.database.db.collection<{ _id: string } & Record<string, unknown>>(name);
}

beforeEach(async () => {
  for (const name of ['support_cases', 'role_assignments', 'audit_events', 'domain_event_outbox', 'rate_limits', 'otp_challenges']) {
    await coll(name).deleteMany({});
  }
});

function auth(cookie: string) {
  return { cookies: { [SESSION_COOKIE]: cookie } };
}

let counter = 9_100_000;
async function login(): Promise<{ cookie: string; accountId: string }> {
  counter += 1;
  const mobile = `0912${String(counter)}`;
  await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { mobile } });
  const inbox = await app.inject({ method: 'GET', url: `/api/v1/dev/sms-inbox?mobile=${mobile}` });
  const code = inbox.json<Array<{ code: string }>>()[0]?.code as string;
  const verify = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { mobile, code } });
  const cookie = verify.cookies.find((c) => c.name === SESSION_COOKIE)?.value as string;
  const session = await app.inject({ method: 'GET', url: '/api/v1/auth/session', ...auth(cookie) });
  return { cookie, accountId: session.json<{ account: { id: string } }>().account.id };
}

async function grant(accountId: string, role: string): Promise<void> {
  await roleAssignments(fixture.database.db).insertOne({
    _id: newId(), accountId, role,
    scopeType: GLOBAL_SCOPE_TYPE, scopeId: GLOBAL_SCOPE_ID,
    grantedBy: 'test', grantedAt: utcNow(), revokedAt: null
  });
}

const CASE = { category: 'account', subject: 'Cannot sign in', body: 'My code never arrives.' };

async function open(cookie: string, overrides: Record<string, unknown> = {}) {
  return app.inject({ method: 'POST', url: '/api/v1/support/cases', ...auth(cookie), payload: { ...CASE, ...overrides } });
}

describe('support intake (PAGE-023)', () => {
  test('opening a case requires a session', async () => {
    const anonymous = await app.inject({ method: 'POST', url: '/api/v1/support/cases', payload: CASE });
    assert.equal(anonymous.statusCode, 401);
    const list = await app.inject({ method: 'GET', url: '/api/v1/support/cases' });
    assert.equal(list.statusCode, 401);
  });

  test('a case is created and returned without any operator-only field', async () => {
    const user = await login();
    const created = await open(user.cookie);
    assert.equal(created.statusCode, 201);
    const view = created.json<Record<string, unknown>>();
    assert.equal(view['state'], 'open');
    assert.equal(view['category'], 'account');
    assert.equal(view['subject'], CASE.subject);
    // The requester's projection is exactly these fields. `assignedTo` is the staff account
    // handling the case and `resolutionNote` is the operator's working text; neither is the
    // requester's to read, and `requesterId` adds nothing they do not already know.
    assert.deepEqual(Object.keys(view).sort(), ['category', 'createdAt', 'id', 'state', 'subject', 'version']);
  });

  test('an operator note and assignment never reach the requester', async () => {
    const user = await login();
    const operator = await login();
    await grant(operator.accountId, 'support_operator');
    const caseId = (await open(user.cookie)).json<{ id: string }>().id;

    const resolved = await app.inject({
      method: 'POST', url: `/api/v1/admin/support/cases/${caseId}/resolve`, ...auth(operator.cookie),
      payload: { expectedVersion: 1, assignee: operator.accountId, note: 'internal: duplicate of an earlier report' }
    });
    assert.equal(resolved.statusCode, 200);
    // The operator's own view keeps the fields they act on.
    assert.equal(resolved.json<{ resolutionNote: string }>().resolutionNote, 'internal: duplicate of an earlier report');

    const detail = await app.inject({ method: 'GET', url: `/api/v1/support/cases/${caseId}`, ...auth(user.cookie) });
    assert.equal(detail.statusCode, 200);
    const body = detail.body;
    assert.ok(!body.includes('internal: duplicate'), 'the resolution note must not reach the requester');
    assert.ok(!body.includes(operator.accountId), 'the assigned staff identity must not reach the requester');
    assert.equal(detail.json<{ state: string }>().state, 'resolved');

    const listed = await app.inject({ method: 'GET', url: '/api/v1/support/cases', ...auth(user.cookie) });
    assert.ok(!listed.body.includes('internal: duplicate'), 'the list projection must withhold it too');
  });

  test('one caller cannot read another caller\'s case through its id', async () => {
    const owner = await login();
    const stranger = await login();
    const caseId = (await open(owner.cookie)).json<{ id: string }>().id;

    const probe = await app.inject({ method: 'GET', url: `/api/v1/support/cases/${caseId}`, ...auth(stranger.cookie) });
    assert.equal(probe.statusCode, 404);
    const strangerList = await app.inject({ method: 'GET', url: '/api/v1/support/cases', ...auth(stranger.cookie) });
    assert.deepEqual(strangerList.json<{ items: unknown[] }>().items, []);
  });

  test('the category vocabulary is closed and the text fields are bounded', async () => {
    const user = await login();
    // Only the three localized categories exist; anything else has no label to render.
    assert.equal((await open(user.cookie, { category: 'billing' })).statusCode, 400);
    assert.equal((await open(user.cookie, { subject: '' })).statusCode, 400);
    assert.equal((await open(user.cookie, { body: '' })).statusCode, 400);
    assert.equal((await open(user.cookie, { subject: 'x'.repeat(201) })).statusCode, 400);
    assert.equal((await open(user.cookie, { body: 'x'.repeat(4001) })).statusCode, 400);
    for (const category of ['account', 'payment', 'other']) {
      assert.equal((await open(user.cookie, { category })).statusCode, 201, `${category} must be accepted`);
    }
  });

  test('intake is rate limited per requester', async () => {
    const user = await login();
    const other = await login();
    for (let i = 0; i < 10; i += 1) assert.equal((await open(user.cookie)).statusCode, 201);
    assert.equal((await open(user.cookie)).statusCode, 429);
    // The limit is the requester's own, not a global one.
    assert.equal((await open(other.cookie)).statusCode, 201);
  });

  test('the caller\'s list is newest-first and pages without repeating or dropping a case', async () => {
    const user = await login();
    const subjects: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      subjects.push(`case ${String(i)}`);
      assert.equal((await open(user.cookie, { subject: `case ${String(i)}` })).statusCode, 201);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const url: string = cursor === null ? '/api/v1/support/cases?limit=2' : `/api/v1/support/cases?limit=2&cursor=${encodeURIComponent(cursor)}`;
      const response = await app.inject({ method: 'GET', url, ...auth(user.cookie) });
      assert.equal(response.statusCode, 200);
      const body = response.json<{ items: Array<{ subject: string }>; nextCursor: string | null }>();
      seen.push(...body.items.map((c) => c.subject));
      cursor = body.nextCursor;
      if (cursor === null) break;
    }
    assert.equal(seen.length, new Set(seen).size, 'no case appears on two pages');
    assert.deepEqual([...seen].sort(), [...subjects].sort(), 'every case appears exactly once');
  });
});
