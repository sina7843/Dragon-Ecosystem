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
import type { BracketVersionRecord, MatchRecord } from './state.ts';
import type { ManualGraphSpec } from './manual.ts';

/**
 * Bracket-version integration coverage (DRAGON-10): regeneration and rollback with
 * immutable history — an approved result is never lost silently — plus destructive
 * confirmation, reasons, optimistic concurrency, and lock enforcement, across every
 * format. Requires the disposable test database: `npm run db:test:up`.
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
  for (const name of ['competitions', 'competition_matches', 'competition_bracket_versions', 'competition_standings', 'competition_result_corrections', 'tournaments', 'registrations', 'audit_events', 'domain_event_outbox']) {
    await coll(name).deleteMany({});
  }
});

const ctx = () => createRequestContext(newId(), { kind: 'account', accountId: 'admin-actor', roles: [] });

let counter = 8_000_000;
async function publishedTournament(format: string): Promise<string> {
  counter += 1;
  const id = newId();
  const now = utcNow();
  await coll('tournaments').insertOne({
    _id: id, slug: `ver-t-${String(counter)}`, state: 'published',
    translations: { fa: { name: 'ت', summary: 'خ', description: '', seoTitle: '', seoDescription: '' }, en: { name: 'T', summary: 'S', description: '', seoTitle: '', seoDescription: '' } },
    gameId: newId(), participantType: 'individual', capacity: 1000,
    registration: { opensAt: null, closesAt: null }, schedule: { startAt: null, endAt: null },
    format, ruleProfile: { kind: 'custom', text: { fa: '', en: '' } },
    approvalMode: 'manual', waitlistMode: 'disabled',
    eligibility: { minAge: null, requireCompleteProfile: false, requireGameIdentity: false },
    questionSet: { version: 0, questions: [] }, fee: { kind: 'free', components: [] },
    refundPolicy: { kind: 'no_refund', text: { fa: '', en: '' } }, prizes: { version: 0, placements: [] },
    version: 1, organizerId: 'system', createdAt: now, updatedAt: now, publishedAt: now, cancelledAt: null
  });
  return id;
}

async function approveMany(tournamentId: string, n: number): Promise<void> {
  const now = utcNow();
  for (let i = 0; i < n; i += 1) {
    await coll('registrations').insertOne({
      _id: newId(), tournamentId, participantType: 'individual',
      accountId: newId(), teamId: null, subjectId: newId(),
      state: 'approved', active: true, seat: 'main',
      answers: [], questionVersion: 0, rosterSnapshotId: null, waitlistSeq: null,
      createdAt: now, updatedAt: now, decidedBy: 'admin', decidedAt: now, reason: null, version: 1
    });
  }
}

async function matches(competitionId: string): Promise<MatchRecord[]> {
  return coll('competition_matches').find({ competitionId }).sort({ round: 1, index: 1 }).toArray() as unknown as Promise<MatchRecord[]>;
}
async function versions(competitionId: string): Promise<BracketVersionRecord[]> {
  return coll('competition_bracket_versions').find({ competitionId }).sort({ versionNumber: 1 }).toArray() as unknown as Promise<BracketVersionRecord[]>;
}

/** A minimal valid two-semifinal-plus-final custom graph for 4 participants. */
const manualGraph4: ManualGraphSpec = {
  fixtures: [
    { key: 'sf1', seedA: 0, seedB: 1, winnerNext: { key: 'f', slot: 'a' }, loserNext: null },
    { key: 'sf2', seedA: 2, seedB: 3, winnerNext: { key: 'f', slot: 'b' }, loserNext: null },
    { key: 'f', seedA: null, seedB: null, winnerNext: null, loserNext: null }
  ]
};

describe('generation establishes version 1', () => {
  test('the first version is active with an empty snapshot', async () => {
    const tid = await publishedTournament('single_elimination');
    await approveMany(tid, 4);
    const comp = await competitions.generate(ctx(), tid);
    assert.equal(comp.activeVersion, 1);
    const vs = await versions(comp._id);
    assert.equal(vs.length, 1);
    assert.deepEqual({ versionNumber: vs[0]?.versionNumber, state: vs[0]?.state, origin: vs[0]?.origin }, { versionNumber: 1, state: 'active', origin: 'generation' });
  });
});

describe('regeneration preserves recorded results in immutable history', () => {
  test('a recorded result is archived into the superseded version, not lost', async () => {
    const tid = await publishedTournament('single_elimination');
    await approveMany(tid, 2);
    const comp = await competitions.generate(ctx(), tid);
    const ready = (await matches(comp._id)).find((m) => m.state === 'ready');
    assert.ok(ready);
    await competitions.recordResult(ctx(), tid, ready._id, { winnerSlot: 'a' });

    const preview = await competitions.regeneratePreview(tid);
    assert.equal(preview.currentCompletedResults, 1);
    assert.equal(preview.nextVersion, 2);

    await competitions.regenerate(ctx(), tid, { expectedVersion: 1, reason: 'wrong seeding', confirm: true });

    const vs = await versions(comp._id);
    const v1 = vs.find((v) => v.versionNumber === 1);
    assert.equal(v1?.state, 'superseded');
    assert.equal(v1?.completedResultCount, 1);
    // The archived snapshot still holds the completed match with its winner.
    const archivedFinal = v1?.matchesSnapshot.find((m) => m.state === 'completed');
    assert.ok(archivedFinal && archivedFinal.winner !== null, 'the recorded result survives in history');

    const compDoc = await coll('competitions').findOne({ _id: comp._id });
    assert.equal(compDoc?.['activeVersion'], 2);
    // The new active bracket is fresh (no results carried over).
    assert.equal((await matches(comp._id)).filter((m) => m.state === 'completed').length, 0);
  });

  test('regeneration requires an explicit confirmation and a reason', async () => {
    const tid = await publishedTournament('single_elimination');
    await approveMany(tid, 4);
    await competitions.generate(ctx(), tid);
    await assert.rejects(() => competitions.regenerate(ctx(), tid, { expectedVersion: 1, reason: '', confirm: true }), (e: { fieldErrors?: Array<{ code: string }> }) => e.fieldErrors?.[0]?.code === 'REASON_REQUIRED');
    await assert.rejects(() => competitions.regenerate(ctx(), tid, { expectedVersion: 1, reason: 'x', confirm: false }), (e: { fieldErrors?: Array<{ code: string }> }) => e.fieldErrors?.[0]?.code === 'CONFIRMATION_REQUIRED');
  });

  test('a stale expected version conflicts; concurrent regeneration yields one success', async () => {
    const tid = await publishedTournament('single_elimination');
    await approveMany(tid, 4);
    await competitions.generate(ctx(), tid);
    await assert.rejects(() => competitions.regenerate(ctx(), tid, { expectedVersion: 99, reason: 'stale', confirm: true }), (e: { code?: string }) => e.code === 'COMPETITION_VERSION_STALE');

    const results = await Promise.allSettled([
      competitions.regenerate(ctx(), tid, { expectedVersion: 1, reason: 'a', confirm: true }),
      competitions.regenerate(ctx(), tid, { expectedVersion: 1, reason: 'b', confirm: true })
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const comp = await coll('competitions').findOne({ tournamentId: tid });
    // Exactly one active version despite the race (partial unique index).
    assert.equal(await coll('competition_bracket_versions').countDocuments({ competitionId: comp?._id, state: 'active' }), 1);
    assert.equal(comp?.['activeVersion'], 2);
  });
});

describe('rollback restores a prior version', () => {
  test('rolling back to a played version restores its results as a new active version', async () => {
    const tid = await publishedTournament('single_elimination');
    await approveMany(tid, 2);
    const comp = await competitions.generate(ctx(), tid);
    const ready = (await matches(comp._id)).find((m) => m.state === 'ready');
    assert.ok(ready);
    const winnerReg = ready.slotA?.registrationId;
    await competitions.recordResult(ctx(), tid, ready._id, { winnerSlot: 'a' });

    await competitions.regenerate(ctx(), tid, { expectedVersion: 1, reason: 'redo', confirm: true });
    // Regenerated bracket is unplayed; standings are no longer final.
    await competitions.rollback(ctx(), tid, { expectedVersion: 2, targetVersion: 1, reason: 'restore', confirm: true });

    const compDoc = await coll('competitions').findOne({ _id: comp._id });
    assert.equal(compDoc?.['activeVersion'], 3);
    assert.equal(compDoc?.['state'], 'completed');
    // The restored live match carries the original recorded winner.
    const restored = (await matches(comp._id)).find((m) => m.state === 'completed');
    assert.equal((restored?.winner)?.registrationId, winnerReg);
    // Standings recomputed to final with a champion.
    const standings = await coll('competition_standings').findOne({ competitionId: comp._id, current: true });
    assert.equal(standings?.['status'], 'final');

    const vs = await versions(comp._id);
    const v3 = vs.find((v) => v.versionNumber === 3);
    assert.deepEqual({ origin: v3?.origin, rolledBackFrom: v3?.rolledBackFrom, state: v3?.state }, { origin: 'rollback', rolledBackFrom: 1, state: 'active' });
  });

  test('rollback restores the version seed order, not the reseeded one', async () => {
    const tid = await publishedTournament('single_elimination');
    await approveMany(tid, 4);
    const comp = await competitions.generate(ctx(), tid, { seed: 'seed-original' });
    const originalOrder = comp.participants.map((p) => p.registrationId);

    // Regenerate with a different seed so the seed order is reshuffled.
    await competitions.regenerate(ctx(), tid, { expectedVersion: 1, reason: 'reseed', confirm: true, seed: 'seed-different' });
    const reseeded = await coll('competitions').findOne({ _id: comp._id });
    assert.notDeepEqual((reseeded?.['participants'] as Array<{ registrationId: string }>).map((p) => p.registrationId), originalOrder);

    // Roll back to version 1: its original seed order and seed are restored.
    await competitions.rollback(ctx(), tid, { expectedVersion: 2, targetVersion: 1, reason: 'restore', confirm: true });
    const rolledBack = await coll('competitions').findOne({ _id: comp._id });
    assert.equal(rolledBack?.['seed'], 'seed-original');
    assert.deepEqual((rolledBack?.['participants'] as Array<{ registrationId: string }>).map((p) => p.registrationId), originalOrder);
  });

  test('rollback rejects an unknown or still-active target', async () => {
    const tid = await publishedTournament('single_elimination');
    await approveMany(tid, 4);
    await competitions.generate(ctx(), tid);
    await assert.rejects(() => competitions.rollback(ctx(), tid, { expectedVersion: 1, targetVersion: 99, reason: 'r', confirm: true }), /Unknown bracket version/);
    await assert.rejects(() => competitions.rollback(ctx(), tid, { expectedVersion: 1, targetVersion: 1, reason: 'r', confirm: true }), (e: { code?: string }) => e.code === 'VERSION_NOT_RESTORABLE');
  });
});

describe('lock enforcement', () => {
  test('a finalized competition refuses regeneration and rollback', async () => {
    const tid = await publishedTournament('single_elimination');
    await approveMany(tid, 4);
    const comp = await competitions.generate(ctx(), tid);
    await competitions.setLockState(ctx(), tid, 'locked', comp.lockVersion);
    await assert.rejects(() => competitions.regenerate(ctx(), tid, { expectedVersion: 1, reason: 'r', confirm: true }), (e: { code?: string }) => e.code === 'COMPETITION_LOCKED');
    await assert.rejects(() => competitions.rollback(ctx(), tid, { expectedVersion: 1, targetVersion: 1, reason: 'r', confirm: true }), (e: { code?: string }) => e.code === 'COMPETITION_LOCKED');
  });
});

describe('every format regenerates', () => {
  for (const format of ['single_elimination', 'round_robin', 'double_elimination', 'swiss'] as const) {
    test(`${format} supports regeneration end to end`, async () => {
      const tid = await publishedTournament(format);
      await approveMany(tid, 4);
      const comp = await competitions.generate(ctx(), tid);
      assert.equal(comp.activeVersion, 1);
      await competitions.regenerate(ctx(), tid, { expectedVersion: 1, reason: 'reseed', confirm: true });
      const compDoc = await coll('competitions').findOne({ _id: comp._id });
      assert.equal(compDoc?.['activeVersion'], 2);
      assert.ok((await matches(comp._id)).length > 0, 'a fresh bracket exists after regeneration');
      assert.equal(await coll('competition_bracket_versions').countDocuments({ competitionId: comp._id, state: 'active' }), 1);
    });
  }

  test('manual regeneration reuses the stored graph', async () => {
    const tid = await publishedTournament('manual');
    await approveMany(tid, 4);
    const comp = await competitions.generate(ctx(), tid, { manualGraph: manualGraph4 });
    assert.equal(comp.activeVersion, 1);
    await competitions.regenerate(ctx(), tid, { expectedVersion: 1, reason: 'reseed', confirm: true });
    const compDoc = await coll('competitions').findOne({ _id: comp._id });
    assert.equal(compDoc?.['activeVersion'], 2);
    // Same graph shape reproduced: three fixtures (two semis + final).
    assert.equal((await matches(comp._id)).length, 3);
  });
});
