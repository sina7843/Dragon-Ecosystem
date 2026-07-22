import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../../config.ts';
import { buildAdmin, buildContent, buildGames, buildIdentity, buildServer, buildTeams, buildTournaments } from '../../server.ts';
import { allMigrations } from '../../migrations.ts';
import { runMigrations } from '../../shared/db/migrations.ts';
import { seedSystemConfiguration } from '../../shared/db/seed.ts';
import { createTestDatabase, type TestDatabase } from '../../shared/db/test-support.ts';
import { newId } from '../../shared/ids.ts';
import { utcNow } from '../../shared/events.ts';
import { SESSION_COOKIE } from '../identity/index.ts';
import { GLOBAL_SCOPE_ID, GLOBAL_SCOPE_TYPE, roleAssignments } from '../admin/store.ts';
import { TOURNAMENTS_COLLECTIONS } from './collections.ts';

/**
 * Tournament authoring and discovery integration coverage (TOURN-001..030 scope):
 * authorization, publication validation, cross-field dates, capacity, versioning,
 * cloning, fees/prizes, and the published-only public read side.
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
    content: buildContent(fixture.database),
    games,
    teams: buildTeams(fixture.database, games, identity),
    tournaments: buildTournaments(fixture.database, games)
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
  for (const name of Object.values(TOURNAMENTS_COLLECTIONS)) await coll(name).deleteMany({});
  for (const name of ['role_assignments', 'audit_events', 'rate_limits', 'otp_challenges']) await coll(name).deleteMany({});
});

function auth(cookie: string) {
  return { cookies: { [SESSION_COOKIE]: cookie } };
}

let counter = 5_000_000;
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

async function loginAs(role: string): Promise<{ cookie: string; accountId: string }> {
  const s = await login();
  await roleAssignments(fixture.database.db).insertOne({
    _id: newId(), accountId: s.accountId, role, scopeType: GLOBAL_SCOPE_TYPE, scopeId: GLOBAL_SCOPE_ID, grantedBy: 'test', grantedAt: utcNow(), revokedAt: null
  });
  return s;
}

async function publishedGame(): Promise<string> {
  counter += 1;
  const id = newId();
  const now = utcNow();
  await coll('games').insertOne({
    _id: id, slug: `t-game-${String(counter)}`, status: 'published',
    translations: { fa: { name: 'بازی', description: '', seoTitle: '', seoDescription: '' }, en: { name: 'Game', description: '', seoTitle: '', seoDescription: '' } },
    coverImageUrl: null, version: 1, createdAt: now, updatedAt: now, publishedAt: now
  });
  return id;
}

const DATES = {
  registration: { opensAt: '2026-09-01T00:00:00.000Z', closesAt: '2026-09-10T00:00:00.000Z' },
  schedule: { startAt: '2026-09-11T00:00:00.000Z', endAt: '2026-09-12T00:00:00.000Z' }
};

let nameCounter = 0;
function completeDraft(gameId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  nameCounter += 1;
  return {
    gameId,
    translations: {
      fa: { name: `تورنمنت ${String(nameCounter)}`, summary: 'خلاصه' },
      en: { name: `Tournament ${String(nameCounter)}`, summary: 'Summary' }
    },
    ruleProfile: { text: { fa: 'قوانین', en: 'Rules' } },
    capacity: 64,
    ...DATES,
    ...overrides
  };
}

async function createDraft(cookie: string, gameId: string, overrides: Record<string, unknown> = {}): Promise<{ id: string; version: number }> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/admin/tournaments', ...auth(cookie), payload: completeDraft(gameId, overrides) });
  assert.equal(res.statusCode, 201, res.body);
  return res.json<{ id: string; version: number }>();
}

async function publish(cookie: string, id: string): Promise<{ statusCode: number; body: string; json: <T>() => T }> {
  return app.inject({ method: 'POST', url: `/api/v1/admin/tournaments/${id}/transition`, ...auth(cookie), payload: { to: 'published', reason: 'go live' } });
}

describe('authoring authorization', () => {
  test('anonymous and ordinary users cannot author', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/tournaments' })).statusCode, 401);
    const { cookie } = await login();
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/tournaments', ...auth(cookie) })).statusCode, 403);
  });

  test('a tournament administrator can author and publish', async () => {
    const admin = await loginAs('tournament_administrator');
    const gameId = await publishedGame();
    const draft = await createDraft(admin.cookie, gameId);
    const res = await publish(admin.cookie, draft.id);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json<{ state: string }>().state, 'published');
  });
});

describe('creation validation', () => {
  test('a tournament must reference a published game', async () => {
    const admin = await loginAs('tournament_organizer');
    const res = await app.inject({ method: 'POST', url: '/api/v1/admin/tournaments', ...auth(admin.cookie), payload: completeDraft(newId()) });
    assert.equal(res.statusCode, 422);
    assert.equal(res.json<{ error: { fieldErrors: Array<{ code: string }> } }>().error.fieldErrors[0]?.code, 'INVALID_GAME');
  });

  test('cross-field date ordering is rejected on save', async () => {
    const admin = await loginAs('tournament_organizer');
    const gameId = await publishedGame();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/admin/tournaments', ...auth(admin.cookie),
      payload: completeDraft(gameId, { schedule: { startAt: '2026-09-05T00:00:00.000Z', endAt: '2026-09-12T00:00:00.000Z' } })
    });
    assert.equal(res.statusCode, 422);
    assert.ok(res.json<{ error: { fieldErrors: Array<{ code: string }> } }>().error.fieldErrors.some((f) => f.code === 'DATE_ORDER'));
  });

  test('capacity of 1000 is accepted; 1001 is rejected (DEC-046)', async () => {
    const admin = await loginAs('tournament_organizer');
    const gameId = await publishedGame();
    const ok = await createDraft(admin.cookie, gameId, { capacity: 1000 });
    assert.equal(ok.version, 1);
    const bad = await app.inject({ method: 'POST', url: '/api/v1/admin/tournaments', ...auth(admin.cookie), payload: completeDraft(gameId, { capacity: 1001 }) });
    assert.equal(bad.statusCode, 422);
    assert.equal(bad.json<{ error: { fieldErrors: Array<{ code: string }> } }>().error.fieldErrors[0]?.code, 'INVALID_CAPACITY');
  });
});

describe('publication validation (TOURN-002)', () => {
  test('an incomplete draft cannot publish and every missing value is reported', async () => {
    const admin = await loginAs('tournament_administrator');
    const gameId = await publishedGame();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/admin/tournaments', ...auth(admin.cookie),
      // English only, no rules, no dates.
      payload: { gameId, translations: { en: { name: 'Only English', summary: 's' } }, capacity: 8 }
    });
    const draft = res.json<{ id: string }>();
    const pub = await publish(admin.cookie, draft.id);
    assert.equal(pub.statusCode, 422);
    const codes = pub.json<{ error: { fieldErrors: Array<{ code: string; field: string }> } }>().error.fieldErrors;
    assert.ok(codes.every((f) => f.code === 'REQUIRED_FOR_PUBLICATION'));
    assert.ok(codes.some((f) => f.field === 'translations.fa.name'));
    assert.ok(codes.some((f) => f.field === 'schedule.startAt'));
  });
});

describe('fees and prizes', () => {
  test('a mixed fee stores exact integer Toman (rial) and Dragon Coin components (TOURN-012)', async () => {
    const admin = await loginAs('tournament_organizer');
    const gameId = await publishedGame();
    const draft = await createDraft(admin.cookie, gameId, { fee: { kind: 'mixed', tomanAmount: 200, dragonCoinAmount: 5 } });
    const full = await app.inject({ method: 'GET', url: `/api/v1/admin/tournaments/${draft.id}`, ...auth(admin.cookie) });
    const fee = full.json<{ fee: { kind: string; components: Array<{ assetCode: string; amountInteger: number }> } }>().fee;
    assert.equal(fee.kind, 'mixed');
    assert.equal(fee.components.find((c) => c.assetCode === 'IRR')?.amountInteger, 2000);
    assert.equal(fee.components.find((c) => c.assetCode === 'DRC')?.amountInteger, 5);
  });

  test('editing prizes bumps the prize version (versioned prize definitions)', async () => {
    const admin = await loginAs('tournament_organizer');
    const gameId = await publishedGame();
    const draft = await createDraft(admin.cookie, gameId, { prizes: { placements: [{ rank: 1, tomanAmount: 1000 }] } });
    const update = await app.inject({
      method: 'PUT', url: `/api/v1/admin/tournaments/${draft.id}`, ...auth(admin.cookie),
      payload: { expectedVersion: draft.version, prizes: { placements: [{ rank: 1, tomanAmount: 2000 }, { rank: 2, dragonCoinAmount: 10 }] } }
    });
    assert.equal(update.statusCode, 200, update.body);
    assert.equal(update.json<{ prizes: { version: number } }>().prizes.version, 2);
  });
});

describe('versioning, cloning, history', () => {
  test('update bumps version and records a revision; stale update is a conflict', async () => {
    const admin = await loginAs('tournament_organizer');
    const gameId = await publishedGame();
    const draft = await createDraft(admin.cookie, gameId);
    const upd = await app.inject({ method: 'PUT', url: `/api/v1/admin/tournaments/${draft.id}`, ...auth(admin.cookie), payload: { expectedVersion: draft.version, capacity: 128 } });
    assert.equal(upd.json<{ version: number }>().version, 2);
    const stale = await app.inject({ method: 'PUT', url: `/api/v1/admin/tournaments/${draft.id}`, ...auth(admin.cookie), payload: { expectedVersion: draft.version, capacity: 32 } });
    assert.equal(stale.statusCode, 409);
    const revisions = await app.inject({ method: 'GET', url: `/api/v1/admin/tournaments/${draft.id}/revisions`, ...auth(admin.cookie) });
    assert.ok(revisions.json<unknown[]>().length >= 2);
  });

  test('cloning produces a fresh draft with a new id and slug', async () => {
    const admin = await loginAs('tournament_organizer');
    const gameId = await publishedGame();
    const draft = await createDraft(admin.cookie, gameId);
    const clone = await app.inject({ method: 'POST', url: `/api/v1/admin/tournaments/${draft.id}/clone`, ...auth(admin.cookie) });
    assert.equal(clone.statusCode, 201, clone.body);
    const body = clone.json<{ id: string; state: string; version: number; slug: string }>();
    assert.notEqual(body.id, draft.id);
    assert.equal(body.state, 'draft');
    assert.equal(body.version, 1);
  });
});

describe('public discovery (published only)', () => {
  test('a published tournament is listed and readable by slug; a draft is 404', async () => {
    const admin = await loginAs('tournament_administrator');
    const gameId = await publishedGame();
    const draft = await createDraft(admin.cookie, gameId);
    // Draft is not public.
    const full = await app.inject({ method: 'GET', url: `/api/v1/admin/tournaments/${draft.id}`, ...auth(admin.cookie) });
    const slug = full.json<{ slug: string }>().slug;
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/tournaments/${slug}?locale=en` })).statusCode, 404);

    const pub = await publish(admin.cookie, draft.id);
    assert.equal(pub.statusCode, 200, pub.body);

    const detail = await app.inject({ method: 'GET', url: `/api/v1/tournaments/${slug}?locale=en` });
    assert.equal(detail.statusCode, 200);
    const body = detail.json<{ name: string; rules: string; eligibility: unknown; questionSet?: unknown }>();
    assert.equal(body.name.startsWith('Tournament'), true);
    assert.equal(body.rules, 'Rules');
    // The internal question set is never exposed publicly (TOURN-029).
    assert.equal((body as { questionSet?: unknown }).questionSet, undefined);

    const fa = await app.inject({ method: 'GET', url: `/api/v1/tournaments/${slug}?locale=fa` });
    assert.equal(fa.json<{ name: string }>().name.startsWith('تورنمنت'), true);

    const list = await app.inject({ method: 'GET', url: `/api/v1/tournaments?locale=en&game=${gameId}` });
    assert.equal(list.json<{ items: unknown[] }>().items.length, 1);
  });

  test('the calendar returns published tournaments within a range', async () => {
    const admin = await loginAs('tournament_administrator');
    const gameId = await publishedGame();
    const draft = await createDraft(admin.cookie, gameId);
    await publish(admin.cookie, draft.id);
    const cal = await app.inject({ method: 'GET', url: '/api/v1/tournaments-calendar?locale=en&from=2026-09-01T00:00:00.000Z&to=2026-09-30T00:00:00.000Z' });
    assert.equal(cal.statusCode, 200);
    assert.ok(cal.json<{ items: unknown[] }>().items.length >= 1);
    const empty = await app.inject({ method: 'GET', url: '/api/v1/tournaments-calendar?locale=en&from=2027-01-01T00:00:00.000Z&to=2027-01-31T00:00:00.000Z' });
    assert.equal(empty.json<{ items: unknown[] }>().items.length, 0);
  });

  test('a cancelled tournament is no longer public', async () => {
    const admin = await loginAs('tournament_administrator');
    const gameId = await publishedGame();
    const draft = await createDraft(admin.cookie, gameId);
    await publish(admin.cookie, draft.id);
    const full = await app.inject({ method: 'GET', url: `/api/v1/admin/tournaments/${draft.id}`, ...auth(admin.cookie) });
    const slug = full.json<{ slug: string }>().slug;
    const cancel = await app.inject({ method: 'POST', url: `/api/v1/admin/tournaments/${draft.id}/transition`, ...auth(admin.cookie), payload: { to: 'cancelled', reason: 'called off' } });
    assert.equal(cancel.statusCode, 200, cancel.body);
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/tournaments/${slug}?locale=en` })).statusCode, 404);
  });
});
