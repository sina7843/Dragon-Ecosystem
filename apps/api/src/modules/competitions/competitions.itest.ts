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
 * Competition integration coverage (DRAGON-09a): generation from approved
 * registrations, immutable roster-snapshot references, deterministic single-
 * elimination progression, byes, round-robin, and the database concurrency
 * guarantees (unique-generation, single-result, concurrent progression).
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

const ctx = () => createRequestContext(newId(), { kind: 'account', accountId: 'admin-actor', roles: [] });

let counter = 7_000_000;
async function publishedTournament(format: string, overrides: Record<string, unknown> = {}): Promise<string> {
  counter += 1;
  const id = newId();
  const now = utcNow();
  await coll('tournaments').insertOne({
    _id: id, slug: `comp-t-${String(counter)}`, state: 'published',
    translations: { fa: { name: 'ت', summary: 'خ', description: '', seoTitle: '', seoDescription: '' }, en: { name: 'T', summary: 'S', description: '', seoTitle: '', seoDescription: '' } },
    gameId: newId(), participantType: 'individual', capacity: 1000,
    registration: { opensAt: null, closesAt: null }, schedule: { startAt: null, endAt: null },
    format, ruleProfile: { kind: 'custom', text: { fa: '', en: '' } },
    approvalMode: 'manual', waitlistMode: 'disabled',
    eligibility: { minAge: null, requireCompleteProfile: false, requireGameIdentity: false },
    questionSet: { version: 0, questions: [] }, fee: { kind: 'free', components: [] },
    refundPolicy: { kind: 'no_refund', text: { fa: '', en: '' } }, prizes: { version: 0, placements: [] },
    version: 1, organizerId: 'system', createdAt: now, updatedAt: now, publishedAt: now, cancelledAt: null,
    ...overrides
  });
  return id;
}

async function approve(tournamentId: string, opts: { participantType?: 'individual' | 'team'; rosterSnapshotId?: string; state?: string } = {}): Promise<string> {
  const regId = newId();
  const now = utcNow();
  const participantType = opts.participantType ?? 'individual';
  await coll('registrations').insertOne({
    _id: regId, tournamentId, participantType,
    accountId: newId(), teamId: participantType === 'team' ? newId() : null, subjectId: newId(),
    state: opts.state ?? 'approved', active: true, seat: 'main',
    answers: [], questionVersion: 0, rosterSnapshotId: opts.rosterSnapshotId ?? null, waitlistSeq: null,
    createdAt: now, updatedAt: now, decidedBy: 'admin', decidedAt: now, reason: null, version: 1
  });
  return regId;
}

async function approveMany(tournamentId: string, n: number): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) out.push(await approve(tournamentId));
  return out;
}

async function matches(competitionId: string): Promise<MatchRecord[]> {
  return coll('competition_matches').find({ competitionId }).sort({ round: 1, index: 1 }).toArray() as unknown as Promise<MatchRecord[]>;
}

describe('generation from approved registrations', () => {
  test('single elimination generates bracketSize-1 matches from approved entries only', async () => {
    const tid = await publishedTournament('single_elimination');
    await approveMany(tid, 8);
    await approve(tid, { state: 'pending' }); // not approved → excluded
    await approve(tid, { state: 'rejected' });

    const comp = await competitions.generate(ctx(), tid);
    assert.equal(comp.participantCount, 8);
    assert.equal(comp.format, 'single_elimination');
    const ms = await matches(comp._id);
    assert.equal(ms.length, 7);
    // Round 1 seats every approved participant exactly once.
    const r1 = ms.filter((m) => m.round === 1).flatMap((m) => [m.slotA?.registrationId, m.slotB?.registrationId].filter(Boolean));
    assert.equal(new Set(r1).size, 8);
  });

  test('a team entry carries its immutable registration-time roster snapshot (TOURN-010)', async () => {
    const tid = await publishedTournament('single_elimination', { participantType: 'team' });
    const snap = newId();
    await approve(tid, { participantType: 'team', rosterSnapshotId: snap });
    await approve(tid, { participantType: 'team', rosterSnapshotId: newId() });
    const comp = await competitions.generate(ctx(), tid);
    const ms = await matches(comp._id);
    const refs = ms.flatMap((m) => [m.slotA, m.slotB]).filter((s): s is NonNullable<typeof s> => s !== null);
    assert.ok(refs.some((r) => r.rosterSnapshotId === snap));
    assert.ok(refs.every((r) => r.participantType === 'team' && r.rosterSnapshotId !== null));
  });

  test('generation is rejected for a non-published tournament and an unsupported format', async () => {
    const draft = await publishedTournament('single_elimination', { state: 'draft' });
    await approveMany(draft, 4);
    await assert.rejects(() => competitions.generate(ctx(), draft), /Unknown tournament/);

    const de = await publishedTournament('double_elimination');
    await approveMany(de, 4);
    await assert.rejects(() => competitions.generate(ctx(), de), (e: { fieldErrors?: Array<{ code: string }> }) => e.fieldErrors?.[0]?.code === 'UNSUPPORTED_FORMAT');
  });

  test('byes are explicit and pre-advanced for a non-power-of-two count', async () => {
    const tid = await publishedTournament('single_elimination');
    await approveMany(tid, 3); // bracket 4, one bye
    const comp = await competitions.generate(ctx(), tid);
    const ms = await matches(comp._id);
    const byeMatches = ms.filter((m) => m.state === 'bye');
    assert.equal(byeMatches.length, 1);
    // The bye winner is pre-advanced into the final's slot.
    const final = ms.find((m) => m.nextMatchId === null);
    assert.ok(final && (final.slotA !== null || final.slotB !== null), 'a bye winner is pre-advanced into the final');
  });

  test('round robin generates every pairing once with no advancement links', async () => {
    const tid = await publishedTournament('round_robin');
    await approveMany(tid, 4);
    const comp = await competitions.generate(ctx(), tid);
    const ms = await matches(comp._id);
    assert.equal(ms.length, 6); // C(4,2)
    assert.ok(ms.every((m) => m.nextMatchId === null));
    assert.ok(ms.every((m) => m.state === 'ready'));
  });
});

describe('concurrency guarantees', () => {
  test('concurrent generation produces exactly one competition (unique index)', async () => {
    const tid = await publishedTournament('single_elimination');
    await approveMany(tid, 8);
    const results = await Promise.allSettled([competitions.generate(ctx(), tid), competitions.generate(ctx(), tid)]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    assert.equal(ok, 1);
    assert.equal(await coll('competitions').countDocuments({ tournamentId: tid }), 1);
    const comp = await coll('competitions').findOne({ tournamentId: tid });
    assert.equal(await coll('competition_matches').countDocuments({ competitionId: comp?._id }), 7);
  });

  test('a result is recorded once; concurrent progression yields one success and one conflict', async () => {
    const tid = await publishedTournament('single_elimination');
    await approveMany(tid, 4);
    const comp = await competitions.generate(ctx(), tid);
    const ready = (await matches(comp._id)).find((m) => m.state === 'ready');
    assert.ok(ready);

    const results = await Promise.allSettled([
      competitions.recordResult(ctx(), tid, ready._id, { winnerSlot: 'a' }),
      competitions.recordResult(ctx(), tid, ready._id, { winnerSlot: 'a' })
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const after = await coll('competition_matches').findOne({ _id: ready._id });
    assert.equal(after?.['state'], 'completed');
    assert.equal((after?.['winner'] as { registrationId: string }).registrationId, ready.slotA?.registrationId);
  });
});

describe('progression', () => {
  test('a winner advances into the next match; the final completes the competition', async () => {
    const tid = await publishedTournament('single_elimination');
    await approveMany(tid, 4);
    const comp = await competitions.generate(ctx(), tid);
    const ms = await matches(comp._id);
    const [m0, m1] = ms.filter((m) => m.round === 1);
    const final = ms.find((m) => m.nextMatchId === null);
    assert.ok(m0 && m1 && final);

    await competitions.recordResult(ctx(), tid, m0._id, { winnerSlot: 'a' });
    // The final now has one slot filled but is still pending until the other semifinal.
    let finalDoc = await coll('competition_matches').findOne({ _id: final._id });
    assert.equal(finalDoc?.['state'], 'pending');

    await competitions.recordResult(ctx(), tid, m1._id, { winnerSlot: 'b' });
    finalDoc = await coll('competition_matches').findOne({ _id: final._id });
    assert.equal(finalDoc?.['state'], 'ready'); // both winners advanced → playable

    const done = await competitions.recordResult(ctx(), tid, final._id, { winnerSlot: 'a' });
    assert.equal(done.state, 'completed');
    const compDoc = await coll('competitions').findOne({ _id: comp._id });
    assert.equal(compDoc?.['state'], 'completed');
  });

  test('a result cannot be recorded for a match that is not ready, and never twice', async () => {
    const tid = await publishedTournament('single_elimination');
    await approveMany(tid, 4);
    const comp = await competitions.generate(ctx(), tid);
    const ms = await matches(comp._id);
    const final = ms.find((m) => m.nextMatchId === null);
    const ready = ms.find((m) => m.state === 'ready');
    assert.ok(final && ready);

    // The final is pending (no participants yet) → not recordable.
    await assert.rejects(() => competitions.recordResult(ctx(), tid, final._id, { winnerSlot: 'a' }), (e: { code?: string }) => e.code === 'MATCH_NOT_READY');

    await competitions.recordResult(ctx(), tid, ready._id, { winnerSlot: 'a' });
    // Replaying the same result is idempotent; a different result conflicts.
    const replay = await competitions.recordResult(ctx(), tid, ready._id, { winnerSlot: 'a' });
    assert.equal(replay.state, 'completed');
    await assert.rejects(() => competitions.recordResult(ctx(), tid, ready._id, { winnerSlot: 'b' }), (e: { code?: string }) => e.code === 'RESULT_ALREADY_RECORDED');
  });
});
