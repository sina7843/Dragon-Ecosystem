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
import { CompetitionsService, type ManualGraphSpec } from './index.ts';
import type { MatchRecord } from './state.ts';

/**
 * Advanced-format competition integration (DRAGON-09b): double elimination, Swiss,
 * and manual competitions driven through the service, including progression,
 * byes, Swiss round generation, and database concurrency guarantees.
 * Requires the disposable test database: `npm run db:test:up`.
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
  for (const name of ['competitions', 'competition_matches', 'tournaments', 'registrations', 'audit_events', 'domain_event_outbox']) {
    await coll(name).deleteMany({});
  }
});

const ctx = () => createRequestContext(newId(), { kind: 'account', accountId: 'admin', roles: [] });

let counter = 8_000_000;
async function publishedTournament(format: string): Promise<string> {
  counter += 1;
  const id = newId();
  const now = utcNow();
  await coll('tournaments').insertOne({
    _id: id, slug: `adv-${String(counter)}`, state: 'published',
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
  const docs = Array.from({ length: n }, () => ({
    _id: newId(), tournamentId, participantType: 'individual', accountId: newId(), teamId: null, subjectId: newId(),
    state: 'approved', active: true, seat: 'main', answers: [], questionVersion: 0, rosterSnapshotId: null, waitlistSeq: null,
    createdAt: now, updatedAt: now, decidedBy: 'admin', decidedAt: now, reason: null, version: 1
  }));
  await coll('registrations').insertMany(docs);
}

async function matches(competitionId: string): Promise<MatchRecord[]> {
  return coll('competition_matches').find({ competitionId }).sort({ round: 1, index: 1 }).toArray() as unknown as Promise<MatchRecord[]>;
}

/** Plays every ready match (winner = slot A) until none remain ready. */
async function playAllReady(tournamentId: string, competitionId: string): Promise<void> {
  for (let guard = 0; guard < 10_000; guard += 1) {
    const ready = (await matches(competitionId)).filter((m) => m.state === 'ready');
    if (ready.length === 0) return;
    for (const m of ready) {
      const fresh = await coll('competition_matches').findOne({ _id: m._id });
      if (fresh?.['state'] !== 'ready') continue;
      await competitions.recordResult(ctx(), tournamentId, m._id, { winnerSlot: 'a' });
    }
  }
  throw new Error('did not converge');
}

describe('double elimination', () => {
  test('generates a winners+losers bracket and plays through to a champion', async () => {
    const tid = await publishedTournament('double_elimination');
    await approveMany(tid, 8);
    const comp = await competitions.generate(ctx(), tid);
    const ms = await matches(comp._id);
    assert.ok(ms.some((m) => m.bracket === 'winners'));
    assert.ok(ms.some((m) => m.bracket === 'losers'));
    assert.equal(ms.filter((m) => m.bracket === 'grand_final').length, 1);
    // Losers-bracket fixtures eliminate their loser.
    assert.ok(ms.filter((m) => m.bracket === 'losers').every((m) => m.loserNextMatchId === null));

    await playAllReady(tid, comp._id);
    const compDoc = await coll('competitions').findOne({ _id: comp._id });
    assert.equal(compDoc?.['state'], 'completed');
    const gf = (await matches(comp._id)).find((m) => m.bracket === 'grand_final');
    assert.equal(gf?.state, 'completed');
    assert.ok(gf?.winner);
  });

  test('a non-power-of-two count with byes plays through validly', async () => {
    const tid = await publishedTournament('double_elimination');
    await approveMany(tid, 6);
    const comp = await competitions.generate(ctx(), tid);
    assert.ok((await matches(comp._id)).some((m) => m.state === 'bye'));
    await playAllReady(tid, comp._id);
    assert.equal((await coll('competitions').findOne({ _id: comp._id }))?.['state'], 'completed');
  });

  test('concurrent sibling results feed one downstream fixture without corruption', async () => {
    const tid = await publishedTournament('double_elimination');
    await approveMany(tid, 4);
    const comp = await competitions.generate(ctx(), tid);
    const ms = await matches(comp._id);
    const wbFinal = ms.find((m) => m.key === 'wb-r2-m0');
    const r1 = ms.filter((m) => m.key === 'wb-r1-m0' || m.key === 'wb-r1-m1');
    assert.ok(wbFinal);
    assert.equal(r1.length, 2);

    await Promise.all(r1.map((m) => competitions.recordResult(ctx(), tid, m._id, { winnerSlot: 'a' })));
    const after = await coll('competition_matches').findOne({ _id: wbFinal._id });
    assert.ok(after?.['slotA'] && after?.['slotB'], 'both winners advanced into the WB final');
    assert.equal(after?.['state'], 'ready');
  });

  test('duplicate generation is rejected', async () => {
    const tid = await publishedTournament('double_elimination');
    await approveMany(tid, 4);
    await competitions.generate(ctx(), tid);
    await assert.rejects(() => competitions.generate(ctx(), tid), (e: { code?: string }) => e.code === 'COMPETITION_EXISTS');
  });
});

describe('Swiss', () => {
  test('generates round 1, then subsequent rounds from results with no rematch', async () => {
    const tid = await publishedTournament('swiss');
    await approveMany(tid, 8);
    const comp = await competitions.generate(ctx(), tid);
    assert.equal(comp.swiss?.currentRound, 1);
    assert.ok(comp.swiss && comp.swiss.targetRounds >= 3);
    assert.equal((await matches(comp._id)).filter((m) => m.round === 1 && m.state === 'ready').length, 4);

    // Cannot generate round 2 while round 1 is incomplete.
    await assert.rejects(() => competitions.generateSwissRound(ctx(), tid), (e: { code?: string }) => e.code === 'SWISS_ROUND_INCOMPLETE');

    await playAllReady(tid, comp._id);
    const gen = await competitions.generateSwissRound(ctx(), tid);
    assert.equal(gen.round, 2);
    const round2 = (await matches(comp._id)).filter((m) => m.round === 2);
    assert.equal(round2.filter((m) => m.state === 'ready').length, 4);

    // No round-2 pairing repeats a round-1 pairing.
    const key = (m: MatchRecord): string => [m.slotA?.registrationId, m.slotB?.registrationId].sort().join('|');
    const round1Pairs = new Set((await matches(comp._id)).filter((m) => m.round === 1 && m.slotB !== null).map(key));
    assert.ok(round2.filter((m) => m.slotB !== null).every((m) => !round1Pairs.has(key(m))));
  });

  test('an odd Swiss count produces exactly one bye per round', async () => {
    const tid = await publishedTournament('swiss');
    await approveMany(tid, 7);
    const comp = await competitions.generate(ctx(), tid);
    assert.equal((await matches(comp._id)).filter((m) => m.round === 1 && m.state === 'bye').length, 1);
  });

  test('concurrent next-round generation produces exactly one round', async () => {
    const tid = await publishedTournament('swiss');
    await approveMany(tid, 8);
    const comp = await competitions.generate(ctx(), tid);
    await playAllReady(tid, comp._id);
    const results = await Promise.allSettled([competitions.generateSwissRound(ctx(), tid), competitions.generateSwissRound(ctx(), tid)]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(await coll('competition_matches').countDocuments({ competitionId: comp._id, round: 2 }), 4);
  });
});

describe('manual / custom graph', () => {
  const semisAndFinal: ManualGraphSpec = {
    fixtures: [
      { key: 'sf1', seedA: 0, seedB: 3, winnerNext: { key: 'final', slot: 'a' }, loserNext: null },
      { key: 'sf2', seedA: 1, seedB: 2, winnerNext: { key: 'final', slot: 'b' }, loserNext: null },
      { key: 'final', seedA: null, seedB: null, winnerNext: null, loserNext: null }
    ]
  };

  test('generates from a validated graph and propagates results only inside it', async () => {
    const tid = await publishedTournament('manual');
    await approveMany(tid, 4);
    const comp = await competitions.generate(ctx(), tid, { manualGraph: semisAndFinal });
    const ms = await matches(comp._id);
    assert.equal(ms.length, 3);
    const final = ms.find((m) => m.key === 'final');
    assert.equal(final?.state, 'pending');

    await playAllReady(tid, comp._id); // sf1, sf2 → final becomes ready → final played
    assert.equal((await coll('competitions').findOne({ _id: comp._id }))?.['state'], 'completed');
  });

  test('an invalid graph is rejected before persistence', async () => {
    const tid = await publishedTournament('manual');
    await approveMany(tid, 4);
    const cyclic: ManualGraphSpec = { fixtures: [
      { key: 'x', seedA: 0, seedB: null, winnerNext: { key: 'y', slot: 'a' }, loserNext: null },
      { key: 'y', seedA: null, seedB: 1, winnerNext: { key: 'x', slot: 'b' }, loserNext: null }
    ] };
    await assert.rejects(() => competitions.generate(ctx(), tid, { manualGraph: cyclic }), (e: { fieldErrors?: Array<{ code: string }> }) => e.fieldErrors?.[0]?.code === 'CYCLIC_GRAPH');
    assert.equal(await coll('competitions').countDocuments({ tournamentId: tid }), 0);
  });
});
