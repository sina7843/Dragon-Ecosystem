import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { runMigrations } from '../../shared/db/migrations.ts';
import { allMigrations } from '../../migrations.ts';
import { createTestDatabase, type TestDatabase } from '../../shared/db/test-support.ts';
import { createRequestContext } from '../../shared/context.ts';
import { newId } from '../../shared/ids.ts';
import { OperationsService, type JobRunner } from './service.ts';
import { OPERATIONS_COLLECTIONS } from './collections.ts';

/**
 * Operations integration coverage (DRAGON-14): consent-aware pseudonymous analytics
 * (nonessential dropped without consent, raw account never stored, no external forward
 * under OD-026), redacted error capture, a bounded job runner that records executions
 * and raises a queue alert on failure, and cross-collection metrics + health alerts.
 * Requires `npm run db:test:up`.
 */

let fixture: TestDatabase;
const ran: string[] = [];
let failNext = false;

const jobs: readonly JobRunner[] = [
  {
    name: 'test.ok',
    run: (_context, limit) => {
      ran.push('test.ok');
      return Promise.resolve({ processed: limit });
    }
  },
  {
    name: 'test.boom',
    run: () => {
      ran.push('test.boom');
      if (failNext) throw new Error('kaboom\nsecret-stack-line: do-not-leak');
      return Promise.resolve({ processed: 0 });
    }
  }
];

function makeService(external: boolean): OperationsService {
  return new OperationsService(fixture.database, { analyticsExternalEnabled: external }, jobs);
}

before(async () => {
  fixture = await createTestDatabase();
  await runMigrations(fixture.database.db, allMigrations);
});

after(async () => {
  await fixture.dispose();
});

function coll(name: string) {
  return fixture.database.db.collection<{ _id: string } & Record<string, unknown>>(name);
}

beforeEach(async () => {
  for (const name of [...Object.values(OPERATIONS_COLLECTIONS), 'domain_event_outbox', 'notification_deliveries', 'audit_events']) {
    await coll(name).deleteMany({});
  }
  ran.length = 0;
  failNext = false;
});

const ctx = () => createRequestContext(newId(), { kind: 'account', accountId: newId(), roles: [] });

describe('consent-aware analytics', () => {
  test('an essential event is recorded; a nonessential event needs consent', async () => {
    const ops = makeService(false);
    const c = ctx();
    assert.deepEqual(await ops.track(c, { name: 'app_open', essential: true, accountId: newId() }), { recorded: true, forwardedExternally: false });
    assert.deepEqual(await ops.track(c, { name: 'promo_click', essential: false, accountId: newId() }), { recorded: false, forwardedExternally: false });
    assert.deepEqual(await ops.track(c, { name: 'promo_click', essential: false, accountId: newId(), consented: true }), { recorded: true, forwardedExternally: false });
    assert.equal(await coll(OPERATIONS_COLLECTIONS.analyticsEvents).countDocuments({}), 2);
  });

  test('the raw account id is never stored; a pseudonym is used and is stable', async () => {
    const ops = makeService(true); // even with the external gate ON there is no external forward path (OD-026)
    const accountId = newId();
    const result = await ops.track(ctx(), { name: 'app_open', essential: true, accountId });
    assert.equal(result.forwardedExternally, false);
    const rows = await coll(OPERATIONS_COLLECTIONS.analyticsEvents).find({}).toArray();
    assert.equal(rows.length, 1);
    const stored = rows[0] as unknown as { pseudonymId: string };
    assert.notEqual(stored.pseudonymId, accountId);
    assert.equal(stored.pseudonymId.length, 32);
    // Same account → same pseudonym.
    await ops.track(ctx(), { name: 'app_open', essential: true, accountId });
    const both = await coll(OPERATIONS_COLLECTIONS.analyticsEvents).find({}).toArray();
    assert.equal((both[0] as unknown as { pseudonymId: string }).pseudonymId, (both[1] as unknown as { pseudonymId: string }).pseudonymId);
  });

  test('captured errors are redacted to a single line without a stack', async () => {
    const ops = makeService(false);
    await ops.captureError(ctx(), { code: 'boom', message: 'top line\n  at secret (/srv/app.js:1:1)\n  at leak' });
    const row = (await coll(OPERATIONS_COLLECTIONS.analyticsErrors).find({}).toArray())[0] as unknown as { message: string };
    assert.equal(row.message, 'top line');
    assert.ok(!row.message.includes('secret'));
  });
});

describe('job runner + observability', () => {
  test('each job records an execution; a failing job raises a critical queue alert', async () => {
    const ops = makeService(false);
    failNext = true;
    const summary = await ops.runJobs(ctx(), { limit: 5 });
    assert.deepEqual(ran, ['test.ok', 'test.boom']);
    assert.equal(summary.find((s) => s.jobName === 'test.ok')?.status, 'succeeded');
    assert.equal(summary.find((s) => s.jobName === 'test.ok')?.result?.['processed'], 5);
    const failed = summary.find((s) => s.jobName === 'test.boom');
    assert.equal(failed?.status, 'failed');
    assert.equal(failed?.error, 'kaboom'); // redacted: first line only, stack stripped
    assert.equal(await coll(OPERATIONS_COLLECTIONS.jobExecutions).countDocuments({ status: 'succeeded' }), 1);
    assert.equal(await coll(OPERATIONS_COLLECTIONS.jobExecutions).countDocuments({ status: 'failed' }), 1);
    const alerts = await coll(OPERATIONS_COLLECTIONS.alerts).find({ category: 'queue', severity: 'critical' }).toArray();
    assert.equal(alerts.length, 1);
  });
});

describe('metrics + health', () => {
  test('metrics count pending outbox, dead-letter deliveries, failed jobs and open alerts', async () => {
    const ops = makeService(false);
    await coll('domain_event_outbox').insertOne({ _id: newId(), state: 'pending' });
    await coll('notification_deliveries').insertOne({ _id: newId(), status: 'dead' });
    failNext = true;
    await ops.runJobs(ctx()); // one failed job + one queue alert

    const metrics = await ops.metrics();
    assert.equal(metrics.pendingOutbox, 1);
    assert.equal(metrics.deadLetterDeliveries, 1);
    assert.equal(metrics.failedJobs, 1);
    assert.equal(metrics.openAlerts, 1);
  });

  test('health raises a queue alert when deliveries are dead-lettered and acknowledge clears it', async () => {
    const ops = makeService(false);
    await coll('notification_deliveries').insertOne({ _id: newId(), status: 'dead' });
    const health = await ops.checkHealth(ctx());
    assert.ok(health.raised >= 1);
    const open = await coll(OPERATIONS_COLLECTIONS.alerts).find({ status: 'open', category: 'queue' }).toArray();
    assert.equal(open.length, 1);
    const acked = await ops.acknowledgeAlert(ctx(), open[0]!._id);
    assert.equal(acked.status, 'acknowledged');
    assert.equal(await ops.metrics().then((m) => m.openAlerts), 0);
  });
});
