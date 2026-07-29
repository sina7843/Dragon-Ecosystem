import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { allMigrations } from '../../migrations.ts';
import { runMigrations } from '../../shared/db/migrations.ts';
import { createTestDatabase, type TestDatabase } from '../../shared/db/test-support.ts';
import { newId } from '../../shared/ids.ts';
import { buildRecoveryDetector } from '../../server.ts';
import { HOLDS_COLLECTIONS } from '../holds/index.ts';
import type { StuckReservationDetector, StuckFinding } from './recovery.ts';

/**
 * Stuck-reservation detection (DRAGON-27B).
 *
 * The gap: store checkout and course enrolment commit their domain record — claiming
 * stock or a place — before reserving and capturing the coin. A dead process in that
 * window leaves the record stranded with its resource claimed, and nothing was watching.
 *
 * These tests build each stuck shape directly, because the point is what the detector
 * reports about state it did not create. They also assert the two things it must *not* do:
 * touch anything, and report records that are merely young or already finished.
 */

let fixture: TestDatabase;
let detector: StuckReservationDetector;

const STALE = 900;
/** Comfortably older than the threshold. */
const OLD = new Date(Date.now() - 4 * 3600 * 1000).toISOString();
const RECENT = new Date(Date.now() - 30 * 1000).toISOString();

before(async () => {
  fixture = await createTestDatabase();
  await runMigrations(fixture.database.db, allMigrations);
  detector = buildRecoveryDetector(fixture.database);
});

after(async () => {
  await cleanup();
  await fixture.dispose();
});

/**
 * Ids this suite created, so cleanup removes only its own rows.
 *
 * `node --test` runs suite files in parallel against one database, so wiping shared
 * collections here would pull the ground out from under the store, education, and economy
 * suites mid-assertion. Only what this file inserted is removed.
 */
const created: Array<{ collection: string; id: string }> = [];

async function cleanup(): Promise<void> {
  for (const row of created.splice(0)) {
    await fixture.database.db.collection(row.collection).deleteOne({ _id: row.id } as never);
  }
}

beforeEach(cleanup);

async function order(fields: Record<string, unknown>): Promise<string> {
  const id = newId();
  await fixture.database.db.collection('store_orders').insertOne({
    _id: id,
    accountId: newId(),
    state: 'pending_payment',
    holdId: null,
    reference: `DS-${id.slice(0, 6)}`,
    createdAt: OLD,
    ...fields
  } as never);
  created.push({ collection: 'store_orders', id });
  return id;
}

async function hold(state: string, ownerId: string, amount = 100): Promise<string> {
  const id = newId();
  await fixture.database.db.collection(HOLDS_COLLECTIONS.holds).insertOne({
    _id: id,
    ownerId,
    state,
    amount,
    remainingAmount: state === 'active' ? amount : 0,
    purpose: 'store_order',
    // The collection enforces a unique business reference, so each synthetic hold needs
    // its own — the same constraint a real hold is created under.
    businessRef: `recovery_itest:${id}`,
    createdAt: OLD
  } as never);
  created.push({ collection: HOLDS_COLLECTIONS.holds, id });
  return id;
}

function findingFor(result: { findings: StuckFinding[] }, recordId: string): StuckFinding {
  const found = result.findings.find((f) => f.recordId === recordId);
  assert.ok(found !== undefined, `expected a finding for ${recordId}`);
  return found;
}

describe('stuck reservation detection', () => {
  test('a stale record that never recorded a reservation is critical', async () => {
    // The crash window itself: stock claimed, coin never reserved.
    const id = await order({});
    const result = await detector.inspect({ staleAfterSeconds: STALE });
    const finding = findingFor(result, id);
    assert.equal(finding.kind, 'reservation_missing');
    assert.equal(finding.severity, 'critical');
    assert.match(finding.explanation, /never complete|held against nothing/);
  });

  test('a released or expired reservation with a still-pending record is critical', async () => {
    for (const state of ['released', 'expired', 'cancelled']) {
      const accountId = newId();
      const holdId = await hold(state, accountId);
      const id = await order({ accountId, holdId });
      const finding = findingFor(await detector.inspect({ staleAfterSeconds: STALE }), id);
      assert.equal(finding.kind, 'reservation_terminal', `hold state ${state}`);
      assert.equal(finding.severity, 'critical');
      assert.equal(finding.holdState, state);
    }
  });

  test('a captured reservation with an unfinished record is critical — the account paid for nothing', async () => {
    const accountId = newId();
    const holdId = await hold('captured', accountId);
    const id = await order({ accountId, holdId });
    const finding = findingFor(await detector.inspect({ staleAfterSeconds: STALE }), id);
    assert.equal(finding.kind, 'captured_not_finalized');
    assert.equal(finding.severity, 'critical');
    assert.match(finding.explanation, /has paid/);
  });

  test('an open reservation on a stale record is a warning, not a critical', async () => {
    const accountId = newId();
    const holdId = await hold('active', accountId);
    const id = await order({ accountId, holdId });
    const finding = findingFor(await detector.inspect({ staleAfterSeconds: STALE }), id);
    assert.equal(finding.kind, 'reservation_open_stale');
    assert.equal(finding.severity, 'warning');
  });

  test('a reservation owned by a different account than the record is reported', async () => {
    const holdId = await hold('active', newId());
    const id = await order({ accountId: newId(), holdId });
    const finding = findingFor(await detector.inspect({ staleAfterSeconds: STALE }), id);
    assert.equal(finding.severity, 'critical');
    assert.match(finding.explanation, /different account/);
  });

  test('a record whose reservation id points at nothing is reported', async () => {
    const id = await order({ holdId: newId() });
    const finding = findingFor(await detector.inspect({ staleAfterSeconds: STALE }), id);
    assert.equal(finding.kind, 'reservation_missing');
    assert.match(finding.explanation, /does not exist/);
  });

  test('a completed record is never reported, however old it is', async () => {
    const paid = await order({ state: 'paid' });
    const failed = await order({ state: 'failed' });
    const cancelled = await order({ state: 'cancelled' });
    const result = await detector.inspect({ staleAfterSeconds: STALE });
    for (const id of [paid, failed, cancelled]) {
      assert.equal(result.findings.some((f) => f.recordId === id), false, `${id} must not be reported`);
    }
  });

  test('a record still inside the stale window is not reported', async () => {
    // An in-flight checkout must not look like a stuck one.
    const id = await order({ createdAt: RECENT });
    const result = await detector.inspect({ staleAfterSeconds: STALE });
    assert.equal(result.findings.some((f) => f.recordId === id), false);
  });

  test('course enrolments are covered too, using their own field names', async () => {
    const learnerId = newId();
    const id = newId();
    await fixture.database.db.collection('course_enrollments').insertOne({
      _id: id,
      learnerId,
      state: 'pending_payment',
      entitlementId: null,
      createdAt: OLD
    } as never);
    created.push({ collection: 'course_enrollments', id });
    const result = await detector.inspect({ staleAfterSeconds: STALE });
    const finding = findingFor(result, id);
    assert.equal(finding.workflow, 'course_enrollment');
    // The adapter must read `learnerId`; reading `accountId` would silently report blank.
    assert.equal(finding.accountId, learnerId, 'the owning account is resolved, not blank');
    assert.match(finding.claim, /course/);
  });

  test('inspection is read-only: it changes no record it reports on', async () => {
    const accountId = newId();
    const holdId = await hold('captured', accountId);
    const id = await order({ accountId, holdId });
    const orderBefore = await fixture.database.db.collection('store_orders').findOne({ _id: id } as never);
    const holdBefore = await fixture.database.db.collection(HOLDS_COLLECTIONS.holds).findOne({ _id: holdId } as never);

    await detector.inspect({ staleAfterSeconds: STALE });

    assert.deepEqual(await fixture.database.db.collection('store_orders').findOne({ _id: id } as never), orderBefore);
    assert.deepEqual(await fixture.database.db.collection(HOLDS_COLLECTIONS.holds).findOne({ _id: holdId } as never), holdBefore);
  });

  test('two concurrent inspections agree and still change nothing', async () => {
    const accountId = newId();
    const holdId = await hold('released', accountId);
    const id = await order({ accountId, holdId });
    const before = await fixture.database.db.collection('store_orders').findOne({ _id: id } as never);

    const [a, b] = await Promise.all([detector.inspect({ staleAfterSeconds: STALE }), detector.inspect({ staleAfterSeconds: STALE })]);
    assert.equal(findingFor(a, id).kind, findingFor(b, id).kind);
    assert.deepEqual(await fixture.database.db.collection('store_orders').findOne({ _id: id } as never), before);
  });

  test('the scan is bounded by the requested limit', async () => {
    for (let i = 0; i < 5; i += 1) await order({});
    const result = await detector.inspect({ staleAfterSeconds: STALE, limit: 2 });
    // At most `limit` per workflow. Counted per workflow rather than globally, because
    // other suites sharing this database may have stale records of their own.
    for (const workflow of result.inspectedWorkflows) {
      const perWorkflow = result.findings.filter((f) => f.workflow === workflow).length;
      assert.ok(perWorkflow <= 2, `${workflow} returned ${String(perWorkflow)} findings for a limit of 2`);
    }
    assert.deepEqual(result.inspectedWorkflows, ['store_order', 'course_enrollment']);
  });

  test('the enrolment recovery scan is served by an index rather than a collection scan', async () => {
    const plan = await fixture.database.db
      .collection('course_enrollments')
      .find({ state: { $in: ['pending_payment'] }, createdAt: { $lt: OLD } })
      .sort({ createdAt: 1 })
      .explain('queryPlanner');
    const stage = JSON.stringify((plan as { queryPlanner?: unknown }).queryPlanner ?? plan);
    assert.match(stage, /IXSCAN/, 'the recovery scan must use an index');
    assert.match(stage, /enrollment_state_created/, 'specifically the index added for it');
  });
});
