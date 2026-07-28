import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../../config.ts';
import { buildAdmin, buildContent, buildGames, buildIdentity, buildRegistrations, buildServer, buildTeams, buildTournaments } from '../../server.ts';
import { allMigrations } from '../../migrations.ts';
import { runMigrations } from '../../shared/db/migrations.ts';
import { seedSystemConfiguration } from '../../shared/db/seed.ts';
import { createTestDatabase, type TestDatabase } from '../../shared/db/test-support.ts';
import { newId } from '../../shared/ids.ts';
import { utcNow } from '../../shared/events.ts';
import { SESSION_COOKIE } from '../identity/index.ts';
import { GLOBAL_SCOPE_ID, GLOBAL_SCOPE_TYPE, roleAssignments } from '../admin/store.ts';

/**
 * Registration integration coverage (TOURN-004..017): authorization/IDOR,
 * eligibility, duplicate prevention, idempotency, capacity contention under
 * concurrency, waitlist ordering/promotion, team owner-only + roster snapshot,
 * manual approval queue, and the OD-007 paid-registration gate.
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
  const teams = buildTeams(fixture.database, games, identity);
  const tournaments = buildTournaments(fixture.database, games);
  app = buildServer(config, {
    database: fixture.database,
    identity,
    admin: buildAdmin(fixture.database),
    content: buildContent(fixture.database),
    games,
    teams,
    tournaments,
    registrations: buildRegistrations(fixture.database, tournaments, identity, teams)
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
  for (const name of ['registrations', 'tournament_seat_counters', 'tournaments', 'teams', 'team_memberships', 'team_roster_snapshots', 'gaming_identities', 'role_assignments', 'audit_events', 'domain_event_outbox', 'idempotency_keys', 'rate_limits', 'otp_challenges']) {
    await coll(name).deleteMany({});
  }
});

function auth(cookie: string) {
  return { cookies: { [SESSION_COOKIE]: cookie } };
}

let counter = 6_000_000;
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

/** Signs in and completes a profile (so the account is eligible where a profile is required). */
async function registerUser(): Promise<{ cookie: string; accountId: string; username: string }> {
  const s = await login();
  const username = `p_${String(counter)}`;
  await app.inject({ method: 'PUT', url: '/api/v1/account/profile', ...auth(s.cookie), payload: { username, displayName: `P ${String(counter)}`, birthDate: '2000-01-01', visibility: 'public' } });
  return { ...s, username };
}

async function grant(accountId: string, role: string, scope?: { tournamentId: string }): Promise<void> {
  await roleAssignments(fixture.database.db).insertOne({
    _id: newId(), accountId, role,
    scopeType: scope ? 'tournament' : GLOBAL_SCOPE_TYPE,
    scopeId: scope ? scope.tournamentId : GLOBAL_SCOPE_ID,
    grantedBy: 'test', grantedAt: utcNow(), revokedAt: null
  });
}

async function publishedGame(): Promise<string> {
  counter += 1;
  const id = newId();
  const now = utcNow();
  await coll('games').insertOne({ _id: id, slug: `rg-game-${String(counter)}`, status: 'published', translations: { fa: { name: 'ب', description: '', seoTitle: '', seoDescription: '' }, en: { name: 'G', description: '', seoTitle: '', seoDescription: '' } }, coverImageUrl: null, version: 1, createdAt: now, updatedAt: now, publishedAt: now });
  return id;
}

let tourCounter = 0;
async function publishedTournament(gameId: string, overrides: Record<string, unknown> = {}): Promise<string> {
  tourCounter += 1;
  const id = newId();
  const now = utcNow();
  await coll('tournaments').insertOne({
    _id: id, slug: `tourn-${String(tourCounter)}-${String(counter)}`, state: 'published',
    translations: { fa: { name: `ت ${String(tourCounter)}`, summary: 'خ', description: '', seoTitle: '', seoDescription: '' }, en: { name: `T ${String(tourCounter)}`, summary: 'S', description: '', seoTitle: '', seoDescription: '' } },
    gameId, participantType: 'individual', capacity: 64,
    registration: { opensAt: null, closesAt: null }, schedule: { startAt: null, endAt: null },
    format: 'single_elimination', ruleProfile: { kind: 'custom', text: { fa: 'ق', en: 'R' } },
    approvalMode: 'automatic', waitlistMode: 'disabled',
    eligibility: { minAge: null, requireCompleteProfile: false, requireGameIdentity: false },
    questionSet: { version: 0, questions: [] }, fee: { kind: 'free', components: [] },
    refundPolicy: { kind: 'no_refund', text: { fa: '', en: '' } }, prizes: { version: 0, placements: [] },
    version: 1, organizerId: 'system', createdAt: now, updatedAt: now, publishedAt: now, cancelledAt: null,
    ...overrides
  });
  return id;
}

async function makeTeam(ownerId: string, gameId: string): Promise<string> {
  counter += 1;
  const teamId = newId();
  const now = utcNow();
  await coll('teams').insertOne({ _id: teamId, slug: `team-${String(counter)}`, name: `Team ${String(counter)}`, description: '', gameId, visibility: 'private', status: 'active', ownerId, version: 1, createdAt: now, updatedAt: now, disbandedAt: null });
  await coll('team_memberships').insertOne({ _id: newId(), teamId, accountId: ownerId, role: 'owner', status: 'active', joinedAt: now, leftAt: null, invitationId: null });
  return teamId;
}

const key = (): string => `idem-${newId()}`;

function register(cookie: string, tournamentId: string, body: Record<string, unknown> = {}) {
  return app.inject({ method: 'POST', url: `/api/v1/tournaments/${tournamentId}/registration`, ...auth(cookie), payload: { idempotencyKey: key(), ...body } });
}

async function seatCount(tournamentId: string): Promise<number> {
  const doc = await coll('tournament_seat_counters').findOne({ _id: tournamentId });
  return (doc?.['mainCount'] as number) ?? 0;
}

describe('authorization', () => {
  test('registration requires a session', async () => {
    const tid = await publishedTournament(await publishedGame());
    assert.equal((await app.inject({ method: 'POST', url: `/api/v1/tournaments/${tid}/registration`, payload: { idempotencyKey: key() } })).statusCode, 401);
  });

  test('a non-published tournament is a 404', async () => {
    const gameId = await publishedGame();
    const tid = await publishedTournament(gameId, { state: 'draft' });
    const user = await registerUser();
    assert.equal((await register(user.cookie, tid)).statusCode, 404);
  });
});

describe('individual registration, duplicates, idempotency', () => {
  test('automatic approval seats the participant immediately', async () => {
    const tid = await publishedTournament(await publishedGame());
    const user = await registerUser();
    const res = await register(user.cookie, tid);
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(res.json<{ state: string }>().state, 'approved');
    assert.equal(await seatCount(tid), 1);
    const me = await app.inject({ method: 'GET', url: `/api/v1/tournaments/${tid}/registration/me`, ...auth(user.cookie) });
    assert.equal(me.json<{ state: string }>().state, 'approved');
  });

  test('a duplicate active registration is rejected (TOURN-009)', async () => {
    const tid = await publishedTournament(await publishedGame());
    const user = await registerUser();
    assert.equal((await register(user.cookie, tid)).statusCode, 201);
    const dup = await register(user.cookie, tid);
    assert.equal(dup.statusCode, 409);
    assert.equal(dup.json<{ error: { code: string } }>().error.code, 'DUPLICATE_REGISTRATION');
    assert.equal(await seatCount(tid), 1);
  });

  test('replaying the same idempotency key returns the same registration (TOURN-013)', async () => {
    const tid = await publishedTournament(await publishedGame());
    const user = await registerUser();
    const idempotencyKey = key();
    const first = await app.inject({ method: 'POST', url: `/api/v1/tournaments/${tid}/registration`, ...auth(user.cookie), payload: { idempotencyKey } });
    const second = await app.inject({ method: 'POST', url: `/api/v1/tournaments/${tid}/registration`, ...auth(user.cookie), payload: { idempotencyKey } });
    assert.equal(first.json<{ id: string }>().id, second.json<{ id: string }>().id);
    assert.equal(await seatCount(tid), 1);
  });
});

describe('eligibility (TOURN-008)', () => {
  test('minimum age and game identity are enforced', async () => {
    const gameId = await publishedGame();
    const tid = await publishedTournament(gameId, { eligibility: { minAge: 99, requireCompleteProfile: true, requireGameIdentity: true } });
    const user = await registerUser();
    const res = await register(user.cookie, tid);
    assert.equal(res.statusCode, 422);
    const codes = res.json<{ error: { fieldErrors: Array<{ code: string }> } }>().error.fieldErrors.map((f) => f.code);
    assert.ok(codes.includes('BELOW_MINIMUM_AGE'));
    assert.ok(codes.includes('GAME_IDENTITY_REQUIRED'));
  });

  test('a paid tournament is gated by OD-007', async () => {
    const tid = await publishedTournament(await publishedGame(), { fee: { kind: 'toman', components: [{ assetCode: 'IRR', amountInteger: 50000, scale: 0 }] } });
    const user = await registerUser();
    const res = await register(user.cookie, tid);
    assert.equal(res.statusCode, 422);
    assert.equal(res.json<{ error: { fieldErrors: Array<{ code: string }> } }>().error.fieldErrors[0]?.code, 'PAYMENT_NOT_AVAILABLE');
  });
});

describe('capacity contention (TOURN-005)', () => {
  test('the final slot is not overbooked under concurrent requests; overflow waitlists', async () => {
    const tid = await publishedTournament(await publishedGame(), { capacity: 1, waitlistMode: 'enabled' });
    const users = await Promise.all([registerUser(), registerUser(), registerUser(), registerUser(), registerUser()]);
    const results = await Promise.all(users.map((u) => register(u.cookie, tid)));
    const states = results.map((r) => r.json<{ state: string }>().state);
    assert.equal(states.filter((s) => s === 'approved').length, 1);
    assert.equal(states.filter((s) => s === 'waitlisted').length, 4);
    assert.equal(await seatCount(tid), 1);
    // Waitlist positions are deterministic and distinct.
    const seqs = results.filter((r) => r.json<{ state: string }>().state === 'waitlisted').map((r) => r.json<{ waitlistSeq: number }>().waitlistSeq);
    assert.equal(new Set(seqs).size, seqs.length);
  });

  test('a full tournament without a waitlist rejects further registration', async () => {
    const tid = await publishedTournament(await publishedGame(), { capacity: 1, waitlistMode: 'disabled' });
    const a = await registerUser();
    const b = await registerUser();
    assert.equal((await register(a.cookie, tid)).statusCode, 201);
    const full = await register(b.cookie, tid);
    assert.equal(full.statusCode, 409);
    assert.equal(full.json<{ error: { code: string } }>().error.code, 'TOURNAMENT_FULL');
  });
});

describe('manual approval queue, capacity release, promotion', () => {
  test('pending → approve/reject/waitlist/promote with resource-scoped admin', async () => {
    const gameId = await publishedGame();
    const tid = await publishedTournament(gameId, { approvalMode: 'manual', capacity: 1, waitlistMode: 'enabled' });
    const admin = await registerUser();
    await grant(admin.accountId, 'tournament_administrator', { tournamentId: tid });
    const p1 = await registerUser();
    const p2 = await registerUser();

    // Both register: manual approval → pending, no seat consumed yet.
    const r1 = await register(p1.cookie, tid);
    const r2 = await register(p2.cookie, tid);
    assert.equal(r1.json<{ state: string }>().state, 'pending');
    assert.equal(await seatCount(tid), 0);
    const id1 = r1.json<{ id: string }>().id;
    const id2 = r2.json<{ id: string }>().id;

    // Approve p1 → claims the only seat.
    const approve1 = await app.inject({ method: 'POST', url: `/api/v1/admin/tournaments/${tid}/registrations/${id1}/approve`, ...auth(admin.cookie), payload: {} });
    assert.equal(approve1.statusCode, 200, approve1.body);
    assert.equal(approve1.json<{ state: string }>().state, 'approved');
    assert.equal(await seatCount(tid), 1);

    // Approving p2 now → full.
    const approve2 = await app.inject({ method: 'POST', url: `/api/v1/admin/tournaments/${tid}/registrations/${id2}/approve`, ...auth(admin.cookie), payload: {} });
    assert.equal(approve2.statusCode, 409);

    // Waitlist p2 instead.
    const wl = await app.inject({ method: 'POST', url: `/api/v1/admin/tournaments/${tid}/registrations/${id2}/waitlist`, ...auth(admin.cookie), payload: {} });
    assert.equal(wl.json<{ state: string }>().state, 'waitlisted');

    // Reject requires a reason.
    const rejectNoReason = await app.inject({ method: 'POST', url: `/api/v1/admin/tournaments/${tid}/registrations/${id1}/reject`, ...auth(admin.cookie), payload: {} });
    assert.equal(rejectNoReason.statusCode, 400);

    // Cancel p1 (releases the seat), then promote p2 into it.
    const cancel1 = await app.inject({ method: 'POST', url: `/api/v1/admin/tournaments/${tid}/registrations/${id1}/cancel`, ...auth(admin.cookie), payload: { reason: 'withdrew' } });
    assert.equal(cancel1.statusCode, 200, cancel1.body);
    assert.equal(await seatCount(tid), 0);
    const promote = await app.inject({ method: 'POST', url: `/api/v1/admin/tournaments/${tid}/registrations/${id2}/promote`, ...auth(admin.cookie), payload: {} });
    assert.equal(promote.statusCode, 200, promote.body);
    assert.equal(promote.json<{ state: string }>().state, 'approved');
    assert.equal(await seatCount(tid), 1);
  });

  test('an ordinary user cannot access the admin queue; a scope for another tournament cannot either (IDOR)', async () => {
    const gameId = await publishedGame();
    const tidA = await publishedTournament(gameId, { approvalMode: 'manual' });
    const tidB = await publishedTournament(gameId, { approvalMode: 'manual' });
    const user = await registerUser();
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/admin/tournaments/${tidA}/registrations`, ...auth(user.cookie) })).statusCode, 403);

    // Scoped to B only.
    const scopedAdmin = await registerUser();
    await grant(scopedAdmin.accountId, 'tournament_administrator', { tournamentId: tidB });
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/admin/tournaments/${tidB}/registrations`, ...auth(scopedAdmin.cookie) })).statusCode, 200);
    // Same admin cannot reach tournament A.
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/admin/tournaments/${tidA}/registrations`, ...auth(scopedAdmin.cookie) })).statusCode, 403);
  });
});

describe('team registration (TOURN-009, TOURN-010)', () => {
  test('only the team owner may register the team, and a roster snapshot is captured', async () => {
    const gameId = await publishedGame();
    const tid = await publishedTournament(gameId, { participantType: 'team' });
    const owner = await registerUser();
    const teamId = await makeTeam(owner.accountId, gameId);

    const res = await register(owner.cookie, tid, { teamId });
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(res.json<{ participantType: string }>().participantType, 'team');
    // An immutable roster snapshot exists and is referenced.
    const reg = await coll('registrations').findOne({ tournamentId: tid, teamId });
    assert.ok(reg?.['rosterSnapshotId']);
    const snap = await coll('team_roster_snapshots').findOne({ _id: reg?.['rosterSnapshotId'] as string });
    assert.ok(snap);

    // A non-owner cannot register the team.
    const stranger = await registerUser();
    const denied = await register(stranger.cookie, tid, { teamId });
    assert.equal(denied.statusCode, 403);
  });

  test('an individual cannot register for a team tournament (participant type mismatch)', async () => {
    const tid = await publishedTournament(await publishedGame(), { participantType: 'team' });
    const user = await registerUser();
    const res = await register(user.cookie, tid);
    assert.equal(res.statusCode, 422);
    assert.equal(res.json<{ error: { fieldErrors: Array<{ code: string }> } }>().error.fieldErrors[0]?.code, 'PARTICIPANT_TYPE_MISMATCH');
  });
});

describe('public participant list is bounded (DB-002)', () => {
  test('pages through a roster instead of returning it all at once', async () => {
    const tid = await publishedTournament(await publishedGame(), { participantsPublic: true });
    for (let i = 0; i < 5; i += 1) {
      const user = await registerUser();
      const res = await register(user.cookie, tid);
      assert.equal(res.statusCode, 201, res.body);
    }

    // A small page returns exactly that many entries plus a cursor to continue from.
    const first = await app.inject({ method: 'GET', url: `/api/v1/tournaments/${tid}/participants?limit=2` });
    assert.equal(first.statusCode, 200, first.body);
    const firstPage = first.json<{ items: Array<{ registrationId: string }>; nextCursor: string | null }>();
    assert.equal(firstPage.items.length, 2, 'the page size is honoured');
    assert.ok(firstPage.nextCursor !== null, 'more entries are reported as available');

    // Following the cursor continues the roster without repeating an entry.
    const second = await app.inject({
      method: 'GET',
      url: `/api/v1/tournaments/${tid}/participants?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor as string)}`
    });
    assert.equal(second.statusCode, 200, second.body);
    const secondPage = second.json<{ items: Array<{ registrationId: string }> }>();
    assert.equal(secondPage.items.length, 2);
    const firstIds = new Set(firstPage.items.map((p) => p.registrationId));
    assert.ok(!secondPage.items.some((p) => firstIds.has(p.registrationId)), 'pages do not overlap');

    // Walking every page reaches the whole roster exactly once.
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const suffix: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
      const url: string = `/api/v1/tournaments/${tid}/participants?limit=2${suffix}`;
      const page: { items: Array<{ registrationId: string }>; nextCursor: string | null } = (
        await app.inject({ method: 'GET', url })
      ).json();
      for (const item of page.items) seen.add(item.registrationId);
      cursor = page.nextCursor;
      if (cursor === null) break;
    }
    assert.equal(seen.size, 5, 'every participant is reachable by paging');
  });
});

describe('outbox events', () => {
  test('a registration emits a domain event in the same transaction', async () => {
    const tid = await publishedTournament(await publishedGame());
    const user = await registerUser();
    await register(user.cookie, tid);
    const events = await coll('domain_event_outbox').countDocuments({ 'event.eventName': 'tournament.registration.approved' });
    assert.ok(events >= 1);
  });
});
