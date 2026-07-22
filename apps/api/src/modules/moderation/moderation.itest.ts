import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { runMigrations } from '../../shared/db/migrations.ts';
import { allMigrations } from '../../migrations.ts';
import { createTestDatabase, type TestDatabase } from '../../shared/db/test-support.ts';
import { createRequestContext } from '../../shared/context.ts';
import { newId } from '../../shared/ids.ts';
import { ConflictError, RateLimitError, ValidationError } from '../../shared/errors.ts';
import { ModerationService, type ModerationIdentityAccess } from './service.ts';
import { MODERATION_COLLECTIONS } from './collections.ts';

/**
 * Moderation / support / recovery integration coverage (DRAGON-14): report intake
 * collapses to one open case, moderator lifecycle (assign/severity/emergency/act) with
 * version guards + audit, suspend routes only through the identity adapter and only for
 * a user subject, support-case ownership boundary, and recovery triage that can never
 * approve (OD-029) and masks the account. Requires `npm run db:test:up`.
 */

let fixture: TestDatabase;
let moderation: ModerationService;
const suspendCalls: Array<{ accountId: string; reason: string; emergency: boolean }> = [];

const identity: ModerationIdentityAccess = {
  suspendAccount(accountId, _context, reason, emergency) {
    suspendCalls.push({ accountId, reason, emergency });
    return Promise.resolve();
  }
};

before(async () => {
  fixture = await createTestDatabase();
  await runMigrations(fixture.database.db, allMigrations);
  moderation = new ModerationService(fixture.database, identity);
});

after(async () => {
  await fixture.dispose();
});

function coll(name: string) {
  return fixture.database.db.collection<{ _id: string } & Record<string, unknown>>(name);
}

beforeEach(async () => {
  for (const name of [...Object.values(MODERATION_COLLECTIONS), 'domain_event_outbox', 'audit_events', 'rate_limits']) {
    await coll(name).deleteMany({});
  }
  suspendCalls.length = 0;
});

const ctx = (accountId: string) => createRequestContext(newId(), { kind: 'account', accountId, roles: [] });

/** A linked report always has a case id; narrows the nullable field for the assertions. */
function caseIdOf(report: { caseId: string | null }): string {
  assert.ok(report.caseId, 'expected a linked case id');
  return report.caseId;
}

describe('report intake', () => {
  test('multiple reports on the same subject collapse into one open case', async () => {
    const subjectId = newId();
    const first = await moderation.fileReport(ctx(newId()), newId(), { subjectType: 'tournament', subjectId, reason: 'cheating' });
    const second = await moderation.fileReport(ctx(newId()), newId(), { subjectType: 'tournament', subjectId, reason: 'again' });
    assert.equal(first.caseId, second.caseId);
    const cases = await moderation.listCases({ subjectType: 'tournament', subjectId });
    assert.equal(cases.items.length, 1);
    assert.equal(cases.items[0]?.reportCount, 2);
    assert.equal(cases.items[0]?.state, 'open');
  });

  test('a report requires a reason and is rate limited at 10/hr', async () => {
    const reporter = newId();
    await assert.rejects(() => moderation.fileReport(ctx(reporter), reporter, { subjectType: 'user', subjectId: newId(), reason: '   ' }), ValidationError);
    for (let i = 0; i < 10; i += 1) {
      await moderation.fileReport(ctx(reporter), reporter, { subjectType: 'user', subjectId: newId(), reason: 'x' });
    }
    await assert.rejects(() => moderation.fileReport(ctx(reporter), reporter, { subjectType: 'user', subjectId: newId(), reason: 'x' }), RateLimitError);
  });
});

describe('moderator lifecycle', () => {
  test('assign → severity → suspend runs the identity adapter and audits; stale version is rejected', async () => {
    const subjectId = newId();
    const report = await moderation.fileReport(ctx(newId()), newId(), { subjectType: 'user', subjectId, reason: 'abuse' });
    const caseId = caseIdOf(report);
    const mod = ctx(newId());

    const assigned = await moderation.assignCase(mod, caseId, newId(), 1);
    assert.equal(assigned.state, 'assigned');
    assert.equal(assigned.version, 2);

    // A stale expectedVersion is rejected.
    await assert.rejects(() => moderation.setSeverity(mod, caseId, 'high', 1), ConflictError);

    const severe = await moderation.setSeverity(mod, caseId, 'high', 2);
    assert.equal(severe.severity, 'high');

    const acted = await moderation.actOnCase(mod, caseId, { action: 'suspend', reason: 'confirmed abuse', emergency: true }, 3);
    assert.equal(acted.state, 'actioned');
    assert.equal(acted.action, 'suspend');
    assert.deepEqual(suspendCalls, [{ accountId: subjectId, reason: 'confirmed abuse', emergency: true }]);
    assert.equal(await coll('audit_events').countDocuments({ action: 'moderation.case_suspend' }), 1);
  });

  test('suspend is rejected for a non-user subject and never calls the identity adapter', async () => {
    const report = await moderation.fileReport(ctx(newId()), newId(), { subjectType: 'tournament', subjectId: newId(), reason: 'rigged' });
    await assert.rejects(() => moderation.actOnCase(ctx(newId()), caseIdOf(report), { action: 'suspend', reason: 'x' }, 1), ValidationError);
    assert.equal(suspendCalls.length, 0);
    // Case is untouched (still open, version 1).
    const c = await moderation.getCase(caseIdOf(report));
    assert.equal(c?.state, 'open');
    assert.equal(c?.version, 1);
  });

  test('dismiss closes the case without any suspension', async () => {
    const report = await moderation.fileReport(ctx(newId()), newId(), { subjectType: 'content', subjectId: newId(), reason: 'spam' });
    const dismissed = await moderation.actOnCase(ctx(newId()), caseIdOf(report), { action: 'dismiss', reason: 'not actionable' }, 1);
    assert.equal(dismissed.state, 'dismissed');
    assert.equal(suspendCalls.length, 0);
    // A dismissed subject no longer collapses; a new report opens a fresh case.
    const again = await moderation.fileReport(ctx(newId()), newId(), { subjectType: 'content', subjectId: dismissed.subjectId, reason: 'again' });
    assert.notEqual(again.caseId, report.caseId);
  });
});

describe('support boundary', () => {
  test('a requester sees only their own case; an operator sees any', async () => {
    const owner = newId();
    const other = newId();
    const opened = await moderation.openSupportCase(ctx(owner), owner, { category: 'billing', subject: 'help', body: 'please' });
    assert.equal(await moderation.getSupportCase(other, opened._id), null);
    assert.notEqual(await moderation.getSupportCase(other, opened._id, { asOperator: true }), null);
    assert.notEqual(await moderation.getSupportCase(owner, opened._id), null);
  });
});

describe('recovery triage (OD-029)', () => {
  test('review can mark reviewed/rejected but never approve, and the list masks the account', async () => {
    const accountId = newId();
    const created = await moderation.createRecovery(ctx(newId()), { accountId, reason: 'lost phone' });

    await assert.rejects(
      () => moderation.reviewRecovery(ctx(newId()), created._id, { decision: 'approved', note: 'let them in', expectedVersion: 1 }),
      (e: unknown) => e instanceof ConflictError && (e as ConflictError).code === 'RECOVERY_APPROVAL_DISABLED'
    );

    const reviewed = await moderation.reviewRecovery(ctx(newId()), created._id, { decision: 'reviewed', note: 'needs more proof', expectedVersion: 1 });
    assert.equal(reviewed.state, 'reviewed');

    const list = await moderation.listRecovery({});
    assert.equal(list.items.length, 1);
    const row = list.items[0] as unknown as { accountMasked: string; accountId?: string };
    assert.equal(row.accountId, undefined);
    assert.notEqual(row.accountMasked, accountId);
    assert.match(row.accountMasked, /…/);
  });
});
