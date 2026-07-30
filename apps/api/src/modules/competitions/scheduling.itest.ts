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
 * Match scheduling and rescheduling (DRAGON-29D; TOURN-019, TOURN-020, API-043).
 *
 * Covers what the requirement actually promises: a reasoned, versioned change that records
 * the old and the new time with its actor, notifies the participants, and refuses every
 * state in which a schedule would be a commitment the tournament cannot honour.
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
  for (const name of [
    'competitions',
    'competition_matches',
    'competition_match_schedules',
    'tournaments',
    'registrations',
    'audit_events',
    'domain_event_outbox'
  ]) {
    await coll(name).deleteMany({});
  }
});

const ctx = (actor = 'admin-actor') => createRequestContext(newId(), { kind: 'account', accountId: actor, roles: [] });

let counter = 8_100_000;

async function publishedTournament(): Promise<string> {
  counter += 1;
  const id = newId();
  const now = utcNow();
  await coll('tournaments').insertOne({
    _id: id, slug: `sched-t-${String(counter)}`, state: 'published',
    translations: { fa: { name: 'ت', summary: 'خ', description: '', seoTitle: '', seoDescription: '' }, en: { name: 'T', summary: 'S', description: '', seoTitle: '', seoDescription: '' } },
    gameId: newId(), participantType: 'individual', capacity: 1000,
    registration: { opensAt: null, closesAt: null }, schedule: { startAt: null, endAt: null },
    format: 'single_elimination', ruleProfile: { kind: 'custom', text: { fa: '', en: '' } },
    approvalMode: 'manual', waitlistMode: 'disabled',
    eligibility: { minAge: null, requireCompleteProfile: false, requireGameIdentity: false },
    questionSet: { version: 0, questions: [] }, fee: { kind: 'free', components: [] },
    refundPolicy: { kind: 'no_refund', text: { fa: '', en: '' } }, prizes: { version: 0, placements: [] },
    version: 1, organizerId: 'system', createdAt: now, updatedAt: now, publishedAt: now, cancelledAt: null
  });
  return id;
}

/** An approved individual entry, returning both the registration id and its account. */
async function approve(tournamentId: string): Promise<{ registrationId: string; accountId: string }> {
  const registrationId = newId();
  const accountId = newId();
  const now = utcNow();
  await coll('registrations').insertOne({
    _id: registrationId, tournamentId, participantType: 'individual',
    accountId, teamId: null, subjectId: newId(),
    state: 'approved', active: true, seat: 'main',
    answers: [], questionVersion: 0, rosterSnapshotId: null, waitlistSeq: null,
    createdAt: now, updatedAt: now, decidedBy: 'admin', decidedAt: now, reason: null, version: 1
  });
  return { registrationId, accountId };
}

/** A generated two-entrant competition plus its single playable match. */
async function readyMatch(): Promise<{ tournamentId: string; match: MatchRecord; accounts: string[] }> {
  const tournamentId = await publishedTournament();
  const a = await approve(tournamentId);
  const b = await approve(tournamentId);
  await competitions.generate(ctx(), tournamentId, {});
  const match = (await coll('competition_matches').findOne({ tournamentId })) as unknown as MatchRecord;
  return { tournamentId, match, accounts: [a.accountId, b.accountId] };
}

const LATER = '2100-03-01T18:30:00.000Z';

async function outboxFor(matchId: string) {
  return coll('domain_event_outbox').find({ 'event.eventName': 'competition.match_rescheduled', 'event.aggregateId': matchId }).toArray();
}

describe('match scheduling (TOURN-019, TOURN-020, API-043)', () => {
  test('a generated match starts with no scheduled time', async () => {
    const { match } = await readyMatch();
    // Generation says who plays whom, never when. A fabricated time would be
    // indistinguishable from one an organizer actually committed to.
    assert.equal(match.scheduledAt, null);
  });

  test('scheduling records the old and new time, the actor and the reason', async () => {
    const { tournamentId, match } = await readyMatch();
    const revision = await competitions.rescheduleMatch(ctx('organizer-1'), tournamentId, match._id, {
      expectedVersion: match.version,
      scheduledAt: LATER,
      reason: 'Venue conflict.'
    });

    assert.equal(revision.revisionNumber, 1);
    assert.equal(revision.priorScheduledAt, null, 'the first schedule records the absence it replaced');
    assert.equal(revision.scheduledAt, LATER);
    assert.equal(revision.actorId, 'organizer-1');
    assert.equal(revision.reason, 'Venue conflict.');

    const stored = await coll('competition_matches').findOne({ _id: match._id });
    assert.equal(stored?.['scheduledAt'], LATER);
  });

  test('an offset-bearing time is normalized to UTC rather than stored as a wall clock', async () => {
    const { tournamentId, match } = await readyMatch();
    // 18:30+03:30 is 15:00Z. Storing the local string would make the same match show two
    // different times in two zones, which is exactly what TOURN-019 forbids.
    const revision = await competitions.rescheduleMatch(ctx(), tournamentId, match._id, {
      expectedVersion: match.version,
      scheduledAt: '2100-03-01T18:30:00+03:30',
      reason: 'Organizer local time.'
    });
    assert.equal(revision.scheduledAt, '2100-03-01T15:00:00.000Z');
  });

  test('history is append-only: a second move keeps the first time as evidence', async () => {
    const { tournamentId, match } = await readyMatch();
    await competitions.rescheduleMatch(ctx(), tournamentId, match._id, { expectedVersion: match.version, scheduledAt: LATER, reason: 'First.' });
    const moved = await coll('competition_matches').findOne({ _id: match._id });

    const second = await competitions.rescheduleMatch(ctx(), tournamentId, match._id, {
      expectedVersion: moved?.['version'] as number,
      scheduledAt: '2100-04-02T09:00:00.000Z',
      reason: 'Second.'
    });

    assert.equal(second.revisionNumber, 2);
    assert.equal(second.priorScheduledAt, LATER, 'the superseded time survives on the new revision');

    const history = await competitions.listScheduleHistory(tournamentId, match._id);
    assert.equal(history.length, 2);
    assert.deepEqual(history.map((h) => h.revisionNumber), [2, 1], 'newest first');
    // The first revision is untouched by the second: nothing rewrites history.
    assert.equal(history[1]?.scheduledAt, LATER);
    assert.equal(history[1]?.reason, 'First.');
  });

  test('a stale version is refused and writes nothing', async () => {
    const { tournamentId, match } = await readyMatch();
    await competitions.rescheduleMatch(ctx(), tournamentId, match._id, { expectedVersion: match.version, scheduledAt: LATER, reason: 'First.' });

    await assert.rejects(
      () => competitions.rescheduleMatch(ctx(), tournamentId, match._id, { expectedVersion: match.version, scheduledAt: '2100-05-01T10:00:00.000Z', reason: 'Retry.' }),
      (error: unknown) => (error as { code?: string }).code === 'MATCH_VERSION_STALE'
    );

    // The refused attempt appended no revision and published no event — the version guard
    // is also the idempotency boundary, so a retry cannot duplicate either.
    const history = await competitions.listScheduleHistory(tournamentId, match._id);
    assert.equal(history.length, 1);
    assert.equal((await outboxFor(match._id)).length, 2, 'still one event per participant from the first change only');
  });

  test('a reason is required', async () => {
    const { tournamentId, match } = await readyMatch();
    await assert.rejects(
      () => competitions.rescheduleMatch(ctx(), tournamentId, match._id, { expectedVersion: match.version, scheduledAt: LATER, reason: '   ' }),
      /reason/i
    );
  });

  test('an invalid date is refused', async () => {
    const { tournamentId, match } = await readyMatch();
    await assert.rejects(
      () => competitions.rescheduleMatch(ctx(), tournamentId, match._id, { expectedVersion: match.version, scheduledAt: 'next tuesday', reason: 'Bad input.' }),
      /INVALID_DATETIME|not a valid date/i
    );
  });

  test('a completed match cannot be scheduled', async () => {
    const { tournamentId, match } = await readyMatch();
    await coll('competition_matches').updateOne({ _id: match._id }, { $set: { state: 'completed' } });
    const fresh = await coll('competition_matches').findOne({ _id: match._id });
    await assert.rejects(
      () => competitions.rescheduleMatch(ctx(), tournamentId, match._id, { expectedVersion: fresh?.['version'] as number, scheduledAt: LATER, reason: 'Too late.' }),
      (error: unknown) => (error as { code?: string }).code === 'MATCH_NOT_SCHEDULABLE'
    );
  });

  test('a locked competition refuses a schedule change', async () => {
    const { tournamentId, match } = await readyMatch();
    await coll('competitions').updateMany({ tournamentId }, { $set: { lockState: 'locked' } });
    await assert.rejects(
      () => competitions.rescheduleMatch(ctx(), tournamentId, match._id, { expectedVersion: match.version, scheduledAt: LATER, reason: 'Locked.' }),
      (error: unknown) => (error as { code?: string }).code === 'COMPETITION_LOCKED'
    );
  });

  test('a match from another tournament is not reachable', async () => {
    const { match } = await readyMatch();
    const other = await publishedTournament();
    await assert.rejects(
      () => competitions.rescheduleMatch(ctx(), other, match._id, { expectedVersion: match.version, scheduledAt: LATER, reason: 'Wrong tournament.' }),
      /Unknown match/
    );
  });

  test('one event per participant account, carrying no operator reason', async () => {
    const { tournamentId, match, accounts } = await readyMatch();
    await competitions.rescheduleMatch(ctx(), tournamentId, match._id, { expectedVersion: match.version, scheduledAt: LATER, reason: 'Internal note naming a third party.' });

    const events = await outboxFor(match._id);
    assert.equal(events.length, 2, 'one event per participant, matching how social.mentioned fans out');

    const recipients = events.map((e) => ((e['event'] as Record<string, Record<string, unknown>>)['payload'] as Record<string, unknown>)['accountId']);
    assert.deepEqual([...recipients].sort(), [...accounts].sort(), 'recipients resolve from the registration records');

    for (const event of events) {
      const payload = (event['event'] as Record<string, unknown>)['payload'] as Record<string, unknown>;
      assert.equal(payload['scheduledAt'], LATER);
      assert.equal(payload['priorScheduledAt'], null);
      // The reason is staff-facing and may name someone else; it must not ride along.
      assert.equal(Object.hasOwn(payload, 'reason'), false, 'the operator reason must not reach a participant payload');
    }
  });

  test('concurrent reschedules produce exactly one change and one history entry', async () => {
    const { tournamentId, match } = await readyMatch();
    const attempts = await Promise.allSettled(
      ['2100-06-01T10:00:00.000Z', '2100-06-02T10:00:00.000Z', '2100-06-03T10:00:00.000Z'].map((scheduledAt) =>
        competitions.rescheduleMatch(ctx(), tournamentId, match._id, { expectedVersion: match.version, scheduledAt, reason: 'Race.' })
      )
    );
    assert.equal(attempts.filter((a) => a.status === 'fulfilled').length, 1, 'exactly one racer wins the version');

    const history = await competitions.listScheduleHistory(tournamentId, match._id);
    assert.equal(history.length, 1, 'the losers appended nothing');
    assert.equal(history[0]?.revisionNumber, 1);
  });

  test('the change is audited with the old and new time', async () => {
    const { tournamentId, match } = await readyMatch();
    await competitions.rescheduleMatch(ctx('organizer-2'), tournamentId, match._id, { expectedVersion: match.version, scheduledAt: LATER, reason: 'Audited.' });

    const audit = await coll('audit_events').findOne({ action: 'competition.match_rescheduled', resourceId: match._id });
    assert.notEqual(audit, null);
    assert.equal((audit?.['before'] as Record<string, unknown>)['scheduledAt'], null);
    assert.equal((audit?.['after'] as Record<string, unknown>)['scheduledAt'], LATER);
    assert.equal(audit?.['reason'], 'Audited.');
  });
});
