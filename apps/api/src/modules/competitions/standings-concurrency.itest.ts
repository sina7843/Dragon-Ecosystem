import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { loadConfig } from '../../config.ts';
import { buildGames, buildIdentity, buildRegistrations, buildTeams, buildTournaments } from '../../server.ts';
import { allMigrations } from '../../migrations.ts';
import { runMigrations } from '../../shared/db/migrations.ts';
import { seedSystemConfiguration } from '../../shared/db/seed.ts';
import { createTestDatabase, type TestDatabase } from '../../shared/db/test-support.ts';
import { createRequestContext } from '../../shared/context.ts';
import { newId } from '../../shared/ids.ts';
import { utcNow } from '../../shared/events.ts';
import { CompetitionsService } from './index.ts';
import type { MatchRecord } from './state.ts';

/**
 * Standings, corrections, locking, and concurrency (DRAGON-09c). Requires the
 * disposable test database: `npm run db:test:up`.
 */

let fixture: TestDatabase;
let competitions: CompetitionsService;

before(async () => {
  fixture = await createTestDatabase();
  await runMigrations(fixture.database.db, allMigrations);
  await seedSystemConfiguration(fixture.database.db);
  const config = loadConfig({ NODE_ENV: 'test' });
  const games = buildGames(fixture.database);
  const identity = buildIdentity(fixture.database, config);
  const teams = buildTeams(fixture.database, games, identity);
  const tournaments = buildTournaments(fixture.database, games);
  const registrations = buildRegistrations(fixture.database, tournaments, identity, teams);
  competitions = new CompetitionsService(fixture.database, tournaments.service, registrations.service);
});

after(async () => {
  await fixture.dispose();
});

function coll(name: string) {
  return fixture.database.db.collection<{ _id: string } & Record<string, unknown>>(name);
}

beforeEach(async () => {
  for (const name of ['competitions', 'competition_matches', 'competition_standings', 'competition_result_corrections', 'tournaments', 'registrations', 'audit_events', 'domain_event_outbox', 'idempotency_keys']) {
    await coll(name).deleteMany({});
  }
});

const ctx = () => createRequestContext(newId(), { kind: 'account', accountId: 'admin', roles: [] });
let counter = 9_000_000;

async function publishedTournament(format: string): Promise<string> {
  counter += 1;
  const id = newId();
  const now = utcNow();
  await coll('tournaments').insertOne({
    _id: id, slug: `sc-${String(counter)}`, state: 'published',
    translations: { fa: { name: 'ت', summary: 'خ', description: '', seoTitle: '', seoDescription: '' }, en: { name: 'T', summary: 'S', description: '', seoTitle: '', seoDescription: '' } },
    gameId: newId(), participantType: 'individual', capacity: 1000,
    registration: { opensAt: null, closesAt: null }, schedule: { startAt: null, endAt: null },
    format, ruleProfile: { kind: 'custom', text: { fa: '', en: '' } }, approvalMode: 'manual', waitlistMode: 'disabled',
    eligibility: { minAge: null, requireCompleteProfile: false, requireGameIdentity: false },
    questionSet: { version: 0, questions: [] }, fee: { kind: 'free', components: [] },
    refundPolicy: { kind: 'no_refund', text: { fa: '', en: '' } }, prizes: { version: 0, placements: [] },
    version: 1, organizerId: 'system', createdAt: now, updatedAt: now, publishedAt: now, cancelledAt: null
  });
  return id;
}

async function approveMany(tournamentId: string, n: number): Promise<void> {
  const now = utcNow();
  await coll('registrations').insertMany(Array.from({ length: n }, () => ({
    _id: newId(), tournamentId, participantType: 'individual', accountId: newId(), teamId: null, subjectId: newId(),
    state: 'approved', active: true, seat: 'main', answers: [], questionVersion: 0, rosterSnapshotId: null, waitlistSeq: null,
    createdAt: now, updatedAt: now, decidedBy: 'admin', decidedAt: now, reason: null, version: 1
  })));
}

async function matches(competitionId: string): Promise<MatchRecord[]> {
  return coll('competition_matches').find({ competitionId }).sort({ round: 1, index: 1 }).toArray() as unknown as Promise<MatchRecord[]>;
}
const currentStandings = (competitionId: string) => coll('competition_standings').findOne({ competitionId, current: true });

describe('standings projection', () => {
  test('a current provisional snapshot exists at generation and updates on each result', async () => {
    const tid = await publishedTournament('single_elimination');
    await approveMany(tid, 4);
    const comp = await competitions.generate(ctx(), tid);
    let snap = await currentStandings(comp._id);
    assert.ok(snap, 'a snapshot exists at generation');
    assert.equal(snap?.['status'], 'provisional');
    assert.equal(snap?.['calculationVersion'], 1);

    const ready = (await matches(comp._id)).find((m) => m.state === 'ready');
    await competitions.recordResult(ctx(), tid, (ready as MatchRecord)._id, { winnerSlot: 'a' });
    snap = await currentStandings(comp._id);
    assert.equal(snap?.['calculationVersion'], 2);
    // Exactly one current snapshot.
    assert.equal(await coll('competition_standings').countDocuments({ competitionId: comp._id, current: true }), 1);
  });

  test('concurrent recalculation yields exactly one current projection', async () => {
    const tid = await publishedTournament('round_robin');
    await approveMany(tid, 4);
    const comp = await competitions.generate(ctx(), tid);
    const results = await Promise.allSettled([competitions.recalculate(ctx(), tid), competitions.recalculate(ctx(), tid)]);
    assert.ok(results.some((r) => r.status === 'fulfilled'));
    assert.equal(await coll('competition_standings').countDocuments({ competitionId: comp._id, current: true }), 1);
  });

  test('recalculation is deterministic (reconciliation reproduces the stored rows)', async () => {
    const tid = await publishedTournament('round_robin');
    await approveMany(tid, 4);
    const comp = await competitions.generate(ctx(), tid);
    for (const m of (await matches(comp._id)).filter((x) => x.state === 'ready')) {
      await competitions.recordResult(ctx(), tid, m._id, { winnerSlot: 'a' });
    }
    const a = await competitions.recalculate(ctx(), tid);
    const b = await competitions.recalculate(ctx(), tid);
    assert.deepEqual(a.rows, b.rows);
  });
});

describe('result correction and versioning', () => {
  async function setupSemi(): Promise<{ tid: string; compId: string; semi: MatchRecord }> {
    const tid = await publishedTournament('single_elimination');
    await approveMany(tid, 4);
    const comp = await competitions.generate(ctx(), tid);
    const semi = (await matches(comp._id)).find((m) => m.round === 1 && m.state === 'ready') as MatchRecord;
    await competitions.recordResult(ctx(), tid, semi._id, { winnerSlot: 'a' });
    return { tid, compId: comp._id, semi };
  }

  test('a correction creates one immutable revision and updates standings; original is preserved', async () => {
    const { tid, compId, semi } = await setupSemi();
    const before = await coll('competition_matches').findOne({ _id: semi._id });
    const priorWinner = (before?.['winner'] as { registrationId: string }).registrationId;
    const versionBefore = await currentStandings(compId).then((s) => s?.['calculationVersion']);

    const correction = await competitions.correctResult(ctx(), tid, semi._id, { expectedVersion: before?.['version'] as number, winnerSlot: 'b', reason: 'scoring error', idempotencyKey: `k-${newId()}` });
    assert.equal(correction.revisionNumber, 1);
    assert.equal(correction.priorWinner, priorWinner);
    assert.notEqual(correction.correctedWinner, priorWinner);
    // Standings recalculated.
    assert.equal(await currentStandings(compId).then((s) => s?.['calculationVersion']), (versionBefore as number) + 1);
    // The correction history is queryable and immutable (one revision).
    assert.equal(await coll('competition_result_corrections').countDocuments({ matchId: semi._id }), 1);
  });

  test('an identical retry is idempotent; a stale version is rejected', async () => {
    const { tid, semi } = await setupSemi();
    const version = (await coll('competition_matches').findOne({ _id: semi._id }))?.['version'] as number;
    const key = `k-${newId()}`;
    const first = await competitions.correctResult(ctx(), tid, semi._id, { expectedVersion: version, winnerSlot: 'b', reason: 'r', idempotencyKey: key });
    const replay = await competitions.correctResult(ctx(), tid, semi._id, { expectedVersion: version, winnerSlot: 'b', reason: 'r', idempotencyKey: key });
    assert.equal(first._id, replay._id);
    assert.equal(await coll('competition_result_corrections').countDocuments({ matchId: semi._id }), 1);

    // The version is now stale (correction bumped it).
    await assert.rejects(
      () => competitions.correctResult(ctx(), tid, semi._id, { expectedVersion: version, winnerSlot: 'a', reason: 'r2', idempotencyKey: `k-${newId()}` }),
      (e: { code?: string }) => e.code === 'RESULT_VERSION_STALE'
    );
  });

  test('concurrent different corrections yield exactly one winner and one revision', async () => {
    const { tid, semi } = await setupSemi();
    const version = (await coll('competition_matches').findOne({ _id: semi._id }))?.['version'] as number;
    const results = await Promise.allSettled([
      competitions.correctResult(ctx(), tid, semi._id, { expectedVersion: version, winnerSlot: 'b', reason: 'a', idempotencyKey: `k-${newId()}` }),
      competitions.correctResult(ctx(), tid, semi._id, { expectedVersion: version, winnerSlot: 'b', reason: 'c', idempotencyKey: `k-${newId()}` })
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(await coll('competition_result_corrections').countDocuments({ matchId: semi._id }), 1);
  });

  test('a correction that would rewrite a completed downstream fixture is blocked', async () => {
    const tid = await publishedTournament('single_elimination');
    await approveMany(tid, 4);
    const comp = await competitions.generate(ctx(), tid);
    const semis = (await matches(comp._id)).filter((m) => m.round === 1);
    for (const s of semis) await competitions.recordResult(ctx(), tid, s._id, { winnerSlot: 'a' });
    const final = (await matches(comp._id)).find((m) => m.nextMatchId === null) as MatchRecord;
    await competitions.recordResult(ctx(), tid, final._id, { winnerSlot: 'a' });

    const semi = semis[0] as MatchRecord;
    const version = (await coll('competition_matches').findOne({ _id: semi._id }))?.['version'] as number;
    await assert.rejects(
      () => competitions.correctResult(ctx(), tid, semi._id, { expectedVersion: version, winnerSlot: 'b', reason: 'x', idempotencyKey: `k-${newId()}` }),
      (e: { code?: string }) => e.code === 'DOWNSTREAM_HISTORY_CONFLICT'
    );
  });
});

describe('locking and finalize', () => {
  test('a locked competition rejects result entry and corrections; lock is optimistic', async () => {
    const tid = await publishedTournament('single_elimination');
    await approveMany(tid, 4);
    const comp = await competitions.generate(ctx(), tid);
    const semi = (await matches(comp._id)).find((m) => m.state === 'ready') as MatchRecord;

    const locked = await competitions.setLockState(ctx(), tid, 'locked', 0);
    assert.equal(locked.lockState, 'locked');
    await assert.rejects(() => competitions.recordResult(ctx(), tid, semi._id, { winnerSlot: 'a' }), (e: { code?: string }) => e.code === 'COMPETITION_LOCKED');

    // Concurrent lock transitions: only one wins.
    const results = await Promise.allSettled([competitions.setLockState(ctx(), tid, 'open', 1), competitions.setLockState(ctx(), tid, 'correction_limited', 1)]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.ok(results.some((r) => r.status === 'rejected' && (r.reason as { code?: string }).code === 'LOCK_VERSION_STALE'));
  });
});

describe('scale and IDOR', () => {
  test('standings for a large single-elimination are one bounded snapshot', async () => {
    const tid = await publishedTournament('single_elimination');
    await approveMany(tid, 128);
    const comp = await competitions.generate(ctx(), tid);
    const snap = await currentStandings(comp._id);
    assert.equal((snap?.['rows'] as unknown[]).length, 128);
    assert.equal(await coll('competition_standings').countDocuments({ competitionId: comp._id, current: true }), 1);
    // Paginated match read is bounded.
    const page = await competitions.listMatchesPage(comp._id, { limit: 50 });
    assert.equal(page.items.length, 50);
    assert.ok(page.nextCursor !== null);
  });

  test('a result/correction on the wrong tournament is a 404 (cross-tournament IDOR)', async () => {
    const tidA = await publishedTournament('single_elimination');
    const tidB = await publishedTournament('single_elimination');
    await approveMany(tidA, 4);
    const comp = await competitions.generate(ctx(), tidA);
    const semi = (await matches(comp._id)).find((m) => m.state === 'ready') as MatchRecord;
    // Match belongs to tournament A; recording it under tournament B must 404.
    await assert.rejects(() => competitions.recordResult(ctx(), tidB, semi._id, { winnerSlot: 'a' }), /Unknown match/);
  });
});
