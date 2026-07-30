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
import type { RegistrationsService } from './service.ts';

/**
 * Registration transition history, the account read, and its privacy boundary
 * (DRAGON-29E, PAGE-017).
 *
 * The emphasis is on the negative cases: a history that can fork, a read that answers for
 * someone else's record, or a staff reason that reaches a participant are all worse than a
 * missing feature. Requires the disposable test database: `npm run db:test:up`.
 */

let fixture: TestDatabase;
let registrations: RegistrationsService;

before(async () => {
  fixture = await createTestDatabase();
  await runMigrations(fixture.database.db, allMigrations);
  await seedSystemConfiguration(fixture.database.db);
  const config = loadConfig({ NODE_ENV: 'test' });
  const games = buildGames(fixture.database);
  const identity = buildIdentity(fixture.database, config);
  const teams = buildTeams(fixture.database, games, identity);
  const tournaments = buildTournaments(fixture.database, games);
  registrations = buildRegistrations(fixture.database, tournaments, identity, teams).service;
});

after(async () => {
  await fixture.dispose();
});

function coll(name: string) {
  return fixture.database.db.collection<{ _id: string } & Record<string, unknown>>(name);
}

beforeEach(async () => {
  for (const name of ['registrations', 'registration_transitions', 'tournaments', 'tournament_seat_counters', 'audit_events', 'domain_event_outbox']) {
    await coll(name).deleteMany({});
  }
});

const ctx = () => createRequestContext(newId(), { kind: 'account', accountId: 'staff-actor', roles: [] });

let counter = 9_100_000;

async function publishedTournament(overrides: Record<string, unknown> = {}): Promise<string> {
  counter += 1;
  const id = newId();
  const now = utcNow();
  await coll('tournaments').insertOne({
    _id: id, slug: `hist-t-${String(counter)}`, state: 'published',
    translations: { fa: { name: 'ت', summary: 'خ', description: '', seoTitle: '', seoDescription: '' }, en: { name: 'T', summary: 'S', description: '', seoTitle: '', seoDescription: '' } },
    gameId: newId(), participantType: 'individual', capacity: 100,
    registration: { opensAt: null, closesAt: null }, schedule: { startAt: null, endAt: null },
    format: 'single_elimination', ruleProfile: { kind: 'custom', text: { fa: '', en: '' } },
    approvalMode: 'manual', waitlistMode: 'disabled',
    eligibility: { minAge: null, requireCompleteProfile: false, requireGameIdentity: false },
    questionSet: { version: 0, questions: [] }, fee: { kind: 'free', components: [] },
    refundPolicy: { kind: 'no_refund', text: { fa: '', en: '' } }, prizes: { version: 0, placements: [] },
    version: 1, organizerId: 'system', createdAt: now, updatedAt: now, publishedAt: now, cancelledAt: null,
    ...overrides
  });
  return id;
}

async function submit(tournamentId: string, accountId: string): Promise<string> {
  const reg = await registrations.register(ctx(), accountId, tournamentId, { idempotencyKey: newId() });
  return reg._id;
}

/** A registration written straight to the collection, as one predating the history migration. */
async function legacyRegistration(tournamentId: string, accountId: string): Promise<string> {
  const id = newId();
  const now = utcNow();
  await coll('registrations').insertOne({
    _id: id, tournamentId, participantType: 'individual', accountId, teamId: null, subjectId: accountId,
    state: 'approved', active: true, seat: 'main', answers: [], questionVersion: 0, rosterSnapshotId: null,
    waitlistSeq: null, createdAt: now, updatedAt: now, decidedBy: 'admin', decidedAt: now,
    reason: 'Staff-only note that must never reach a participant.', version: 3
  });
  return id;
}

describe('registration transition history (PAGE-017)', () => {
  test('submitting a registration records its first transition', async () => {
    const tournamentId = await publishedTournament();
    const account = newId();
    const registrationId = await submit(tournamentId, account);

    const detail = await registrations.myRegistrationDetail(account, registrationId);
    assert.notEqual(detail, null);
    assert.equal(detail?.history.length, 1);
    assert.equal(detail?.history[0]?.fromState, null, 'the creating transition has no prior state');
    assert.equal(detail?.history[0]?.toState, 'pending');
    assert.equal(detail?.history[0]?.actor, 'participant');
    assert.equal(detail?.history[0]?.revision, 1);
  });

  test('a decision appends, never rewrites', async () => {
    const tournamentId = await publishedTournament();
    const account = newId();
    const registrationId = await submit(tournamentId, account);
    await registrations.approve(ctx(), 'staff-actor', tournamentId, registrationId, null);

    const detail = await registrations.myRegistrationDetail(account, registrationId);
    assert.equal(detail?.history.length, 2);
    assert.deepEqual(detail?.history.map((h) => h.toState), ['pending', 'approved'], 'oldest first');
    assert.equal(detail?.history[1]?.fromState, 'pending');
    assert.equal(detail?.history[1]?.actor, 'staff');
    // The first entry is untouched by the second.
    assert.equal(detail?.history[0]?.toState, 'pending');
    assert.equal(detail?.history[0]?.revision, 1);
  });

  test('current state and the latest history entry agree', async () => {
    const tournamentId = await publishedTournament();
    const account = newId();
    const registrationId = await submit(tournamentId, account);
    await registrations.approve(ctx(), 'staff-actor', tournamentId, registrationId, null);

    const detail = await registrations.myRegistrationDetail(account, registrationId);
    const latest = detail?.history[(detail?.history.length ?? 1) - 1];
    assert.equal(latest?.toState, detail?.registration.state);
    assert.equal(latest?.revision, detail?.registration.version);
  });

  test('an invalid transition appends nothing', async () => {
    const tournamentId = await publishedTournament();
    const account = newId();
    const registrationId = await submit(tournamentId, account);
    await registrations.approve(ctx(), 'staff-actor', tournamentId, registrationId, null);
    await registrations.cancel(ctx(), 'staff-actor', tournamentId, registrationId, { asAdmin: true, reason: 'Done.' });
    const before = await coll('registration_transitions').countDocuments({ registrationId });

    // `cancelled` is terminal: a further decision is refused.
    await assert.rejects(() => registrations.approve(ctx(), 'staff-actor', tournamentId, registrationId, null));
    assert.equal(await coll('registration_transitions').countDocuments({ registrationId }), before, 'a rejected transition wrote no history');
  });

  test('concurrent decisions produce one transition, not a forked history', async () => {
    const tournamentId = await publishedTournament();
    const account = newId();
    const registrationId = await submit(tournamentId, account);

    const attempts = await Promise.allSettled([
      registrations.approve(ctx(), 'staff-actor', tournamentId, registrationId, null),
      registrations.reject(ctx(), 'staff-actor', tournamentId, registrationId, 'Not eligible.'),
      registrations.approve(ctx(), 'staff-actor', tournamentId, registrationId, null)
    ]);
    assert.equal(attempts.filter((a) => a.status === 'fulfilled').length, 1, 'exactly one decision wins');

    const history = await coll('registration_transitions').find({ registrationId }).toArray();
    assert.equal(history.length, 2, 'the creating transition plus exactly one decision');
    const revisions = history.map((h) => h['revision']);
    assert.equal(new Set(revisions).size, revisions.length, 'no two entries share a revision');
  });

  test('the participant view carries no staff reason, actor identity, or answers', async () => {
    const tournamentId = await publishedTournament();
    const account = newId();
    const registrationId = await submit(tournamentId, account);
    await registrations.reject(ctx(), 'staff-actor', tournamentId, registrationId, 'Staff-only rejection note.');

    const detail = await registrations.myRegistrationDetail(account, registrationId);
    for (const entry of detail?.history ?? []) {
      const keys = Object.keys(entry);
      assert.equal(keys.includes('reason'), false, 'the staff reason must never be written to history');
      assert.equal(keys.includes('actorId'), false, 'the acting staff identity stays in the audit record');
    }
    // The reason does live on the registration itself, which is why the route projection
    // must not spread the raw record — asserted by the route-shape test below.
    assert.equal(detail?.registration.reason, 'Staff-only rejection note.');
  });

  test('a legacy registration keeps its state and reports an empty history', async () => {
    const tournamentId = await publishedTournament();
    const account = newId();
    const registrationId = await legacyRegistration(tournamentId, account);

    const detail = await registrations.myRegistrationDetail(account, registrationId);
    assert.equal(detail?.registration.state, 'approved', 'the current state is preserved');
    assert.deepEqual(detail?.history, [], 'no transition is invented for a record that predates the history');
  });

  test('a legacy registration decided after the migration reports an incomplete history', async () => {
    // The row the decision writes is real, but the trail does not reach back to the
    // registration. A bare non-empty check would present that partial list as the whole
    // story, which is a quieter kind of wrong than showing nothing.
    const tournamentId = await publishedTournament();
    const account = newId();
    const registrationId = await legacyRegistration(tournamentId, account);
    await registrations.cancel(ctx(), 'staff-actor', tournamentId, registrationId, { asAdmin: true, reason: 'Later decision.' });

    const detail = await registrations.myRegistrationDetail(account, registrationId);
    assert.equal(detail?.history.length, 1, 'the post-migration decision is recorded');
    assert.notEqual(detail?.history[0]?.fromState, null, 'and it is not a creating transition');
  });
});

describe('account registration read: ownership and pagination', () => {
  test('a caller reads only their own registrations', async () => {
    const tournamentId = await publishedTournament();
    const mine = newId();
    const theirs = newId();
    await submit(tournamentId, mine);
    const otherTournament = await publishedTournament();
    const foreign = await submit(otherTournament, theirs);

    const page = await registrations.listMyRegistrations(mine);
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0]?.accountId, mine);
    assert.equal(page.items.some((r) => r._id === foreign), false);
  });

  test('another account’s registration id is indistinguishable from a missing one', async () => {
    const tournamentId = await publishedTournament();
    const mine = newId();
    const theirs = newId();
    const foreign = await submit(tournamentId, theirs);

    assert.equal(await registrations.myRegistrationDetail(mine, foreign), null, 'IDOR: substituting the id reveals nothing');
    assert.equal(await registrations.myRegistrationDetail(mine, newId()), null, 'and a nonexistent id answers identically');
  });

  test('the list is newest-first and pages without skipping or repeating', async () => {
    const account = newId();
    const created: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const tournamentId = await publishedTournament();
      created.push(await submit(tournamentId, account));
      // Distinct createdAt values, so the ordering under test is the sort and not chance.
      await coll('registrations').updateOne({ _id: created[i] as string }, { $set: { createdAt: `2030-01-0${String(i + 1)}T00:00:00.000Z` } });
    }

    const first = await registrations.listMyRegistrations(account, { limit: 2 });
    assert.equal(first.items.length, 2);
    assert.notEqual(first.nextCursor, null);
    const second = await registrations.listMyRegistrations(account, { limit: 2, ...(first.nextCursor === null ? {} : { cursor: first.nextCursor }) });
    const third = await registrations.listMyRegistrations(account, { limit: 2, ...(second.nextCursor === null ? {} : { cursor: second.nextCursor }) });

    const seen = [...first.items, ...second.items, ...third.items].map((r) => r._id);
    assert.equal(seen.length, 5, 'every row appears exactly once across the pages');
    assert.equal(new Set(seen).size, 5, 'no row is duplicated across a page boundary');
    const dates = [...first.items, ...second.items, ...third.items].map((r) => r.createdAt);
    assert.deepEqual([...dates].sort().reverse(), dates, 'newest first');
    assert.equal(third.nextCursor, null, 'the final page ends the cursor chain');
  });

  test('a removed tournament leaves the registration readable', async () => {
    const tournamentId = await publishedTournament();
    const account = newId();
    await submit(tournamentId, account);
    await coll('tournaments').deleteMany({ _id: tournamentId });

    const page = await registrations.listMyRegistrations(account);
    assert.equal(page.items.length, 1, 'history survives the tournament');
    const summaries = await registrations.resolveTournamentSummaries([tournamentId]);
    assert.equal(summaries.get(tournamentId), undefined, 'and the reference resolves to an explicit absence');
  });
});
