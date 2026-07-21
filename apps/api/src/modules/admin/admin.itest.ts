import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../../config.ts';
import { buildAdmin, buildIdentity, buildServer } from '../../server.ts';
import { allMigrations } from '../../migrations.ts';
import { runMigrations } from '../../shared/db/migrations.ts';
import { seedSystemConfiguration } from '../../shared/db/seed.ts';
import { createTestDatabase, type TestDatabase } from '../../shared/db/test-support.ts';
import { COLLECTIONS } from '../../shared/db/collections.ts';
import { newId } from '../../shared/ids.ts';
import { utcNow } from '../../shared/events.ts';
import { createRequestContext, SYSTEM_ACTOR } from '../../shared/context.ts';
import { SESSION_COOKIE } from '../identity/index.ts';
import { ADMIN_COLLECTIONS } from './collections.ts';
import { GLOBAL_SCOPE_ID, GLOBAL_SCOPE_TYPE, roleAssignments } from './store.ts';

/**
 * Authorization matrix (SEC-005, SEC-026, ADMIN-001, section 16.4).
 * Requires the disposable test database: `npm run db:test:up`.
 */

let fixture: TestDatabase;
let app: FastifyInstance;
let admin: ReturnType<typeof buildAdmin>['service'];

before(async () => {
  fixture = await createTestDatabase();
  await runMigrations(fixture.database.db, allMigrations);
  await seedSystemConfiguration(fixture.database.db);
  const config = loadConfig({ NODE_ENV: 'test' });
  const identity = buildIdentity(fixture.database, config);
  const adminDeps = buildAdmin(fixture.database);
  admin = adminDeps.service;
  app = buildServer(config, { database: fixture.database, identity, admin: adminDeps });
  await app.ready();
});

after(async () => {
  await app.close();
  await fixture.dispose();
});

beforeEach(async () => {
  for (const name of [
    ...Object.values(ADMIN_COLLECTIONS),
    COLLECTIONS.auditEvents,
    'accounts',
    'identity_methods',
    'otp_challenges',
    'sessions',
    'user_profiles',
    'rate_limits',
    'dev_sms_inbox',
    'sms_deliveries'
  ]) {
    await fixture.database.db.collection(name).deleteMany({});
  }
});

let mobileCounter = 1_000_000;
function nextMobile(): string {
  mobileCounter += 1;
  return `0912${String(mobileCounter)}`;
}

/** Logs in a fresh account and returns its cookie and id. */
async function login(): Promise<{ cookie: string; accountId: string }> {
  const mobile = nextMobile();
  await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { mobile } });
  const inbox = await app.inject({ method: 'GET', url: `/api/v1/dev/sms-inbox?mobile=${mobile}` });
  const code = inbox.json<Array<{ code: string }>>()[0]?.code as string;
  const verify = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/otp/verify',
    payload: { mobile, code }
  });
  const cookie = verify.cookies.find((c) => c.name === SESSION_COOKIE)?.value as string;
  const session = await app.inject({ method: 'GET', url: '/api/v1/auth/session', cookies: { [SESSION_COOKIE]: cookie } });
  return { cookie, accountId: session.json<{ account: { id: string } }>().account.id };
}

/** Grants a role by inserting the assignment directly (bootstrap for tests). */
async function grant(accountId: string, role: string, scope?: { type: string; id: string }): Promise<void> {
  await roleAssignments(fixture.database.db).insertOne({
    _id: newId(),
    accountId,
    role,
    scopeType: scope?.type ?? GLOBAL_SCOPE_TYPE,
    scopeId: scope?.id ?? GLOBAL_SCOPE_ID,
    grantedBy: 'test',
    grantedAt: utcNow(),
    revokedAt: null
  });
}

async function loginAs(role: string, scope?: { type: string; id: string }): Promise<{ cookie: string; accountId: string }> {
  const session = await login();
  await grant(session.accountId, role, scope);
  return session;
}

function auth(cookie: string) {
  return { cookies: { [SESSION_COOKIE]: cookie } };
}

describe('401 vs 403 vs 404', () => {
  test('unauthenticated requests to admin routes get 401', async () => {
    for (const url of ['/api/v1/admin/capabilities', '/api/v1/admin/users', '/api/v1/admin/audit']) {
      const response = await app.inject({ method: 'GET', url });
      assert.equal(response.statusCode, 401, `${url} should be 401 when anonymous`);
    }
  });

  test('an authenticated ordinary user is denied every admin route (deny-by-default)', async () => {
    const { cookie } = await login();
    for (const url of ['/api/v1/admin/capabilities', '/api/v1/admin/users', '/api/v1/admin/audit']) {
      const response = await app.inject({ method: 'GET', url, ...auth(cookie) });
      assert.equal(response.statusCode, 403, `${url} should be 403 for a user with no admin role`);
    }
  });

  test('a permitted user reaches the route', async () => {
    const { cookie } = await loginAs('platform_administrator');
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/users', ...auth(cookie) });
    assert.equal(response.statusCode, 200);
  });

  test('suspending an unknown account is 404, not 403 or 500', async () => {
    const { cookie } = await loginAs('platform_administrator');
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${newId()}/suspend`,
      ...auth(cookie),
      payload: { reason: 'test' }
    });
    assert.equal(response.statusCode, 404);
  });
});

describe('capabilities drive the admin surface', () => {
  test('capabilities reflect exactly the granted role', async () => {
    const { cookie } = await loginAs('security_auditor');
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/capabilities', ...auth(cookie) });
    const body = response.json<{ permissions: string[]; isSuperAdmin: boolean }>();
    assert.ok(body.permissions.includes('audit.read'));
    assert.ok(body.permissions.includes('audit.export'));
    assert.ok(!body.permissions.includes('users.suspend'));
    assert.equal(body.isSuperAdmin, false);
  });

  test('a fresh grant takes effect on the next request (no stale permissions)', async () => {
    const { cookie, accountId } = await login();
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/users', ...auth(cookie) })).statusCode, 403);
    await grant(accountId, 'platform_administrator');
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/users', ...auth(cookie) })).statusCode, 200);
  });
});

describe('privilege escalation is prevented', () => {
  test('a platform administrator cannot grant the super-administrator role', async () => {
    const platform = await loginAs('platform_administrator');
    const target = await login();
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${target.accountId}/roles`,
      ...auth(platform.cookie),
      payload: { role: 'super_administrator', reason: 'escalation attempt' }
    });
    assert.equal(response.statusCode, 403);
  });

  test('a super administrator can grant the super-administrator role', async () => {
    const superAdmin = await loginAs('super_administrator');
    const target = await login();
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${target.accountId}/roles`,
      ...auth(superAdmin.cookie),
      payload: { role: 'super_administrator', reason: 'bootstrap second super admin' }
    });
    assert.equal(response.statusCode, 201);
  });

  test('an unknown role is rejected', async () => {
    const superAdmin = await loginAs('super_administrator');
    const target = await login();
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${target.accountId}/roles`,
      ...auth(superAdmin.cookie),
      payload: { role: 'wizard', reason: 'nope' }
    });
    assert.equal(response.statusCode, 422);
  });

  test('a resource-scoped role does not grant platform-wide admin access (IDOR/escalation)', async () => {
    // tournament_administrator scoped to one tournament must not unlock global user admin.
    const { cookie } = await loginAs('tournament_administrator', { type: 'tournament', id: 'A' });
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/users', ...auth(cookie) });
    assert.equal(response.statusCode, 403);
  });
});

describe('suspension is audited and reason-gated (ADMIN-002, AUTH-010)', () => {
  test('suspend then reactivate, each producing an audit event', async () => {
    const admin = await loginAs('platform_administrator');
    const target = await login();

    const suspend = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${target.accountId}/suspend`,
      ...auth(admin.cookie),
      payload: { reason: 'policy violation' }
    });
    assert.equal(suspend.statusCode, 204);

    // The suspended account is now blocked from its own protected routes.
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/v1/account/sessions', ...auth(target.cookie) })).statusCode,
      403
    );

    const reactivate = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${target.accountId}/reactivate`,
      ...auth(admin.cookie),
      payload: { reason: 'appeal upheld' }
    });
    assert.equal(reactivate.statusCode, 204);

    const events = await fixture.database.db
      .collection(COLLECTIONS.auditEvents)
      .find({ resourceId: target.accountId, action: 'account.state_changed' })
      .toArray();
    assert.equal(events.length, 2);
    assert.ok(events.every((event) => typeof event['reason'] === 'string' && event['reason'].length > 0));
  });

  test('a suspension without a reason is rejected at the request boundary', async () => {
    const admin = await loginAs('platform_administrator');
    const target = await login();
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${target.accountId}/suspend`,
      ...auth(admin.cookie),
      payload: { reason: '' }
    });
    // An empty reason is a request-shape violation (schema minLength) → 400.
    assert.equal(response.statusCode, 400);
  });
});

describe('versioned configuration with dual control (ADMIN-003, ADMIN-009)', () => {
  test('a low-risk key activates immediately on proposal', async () => {
    const admin = await loginAs('platform_administrator');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/configuration',
      ...auth(admin.cookie),
      payload: { key: 'feature.new_home', value: { enabled: true }, reason: 'launch' }
    });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json<{ state: string }>().state, 'active');
  });

  test('a high-risk key needs a different actor to approve it', async () => {
    const operator = await loginAs('finance_operator');
    const approver = await loginAs('financial_approver');

    const proposal = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/configuration',
      ...auth(operator.cookie),
      payload: { key: 'finance.refund_policy', value: { window: 7 }, reason: 'new policy' }
    });
    assert.equal(proposal.statusCode, 201);
    const version = proposal.json<{ id: string; state: string }>();
    assert.equal(version.state, 'pending_approval');

    // The proposer cannot approve their own change.
    const selfApprove = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/configuration/${version.id}/approve`,
      ...auth(operator.cookie),
      payload: { reason: 'self' }
    });
    // finance_operator lacks config.approve entirely, so this is 403.
    assert.equal(selfApprove.statusCode, 403);

    const approve = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/configuration/${version.id}/approve`,
      ...auth(approver.cookie),
      payload: { reason: 'reviewed and approved' }
    });
    assert.equal(approve.statusCode, 200);
    assert.equal(approve.json<{ state: string }>().state, 'active');
  });

  test('a miscased high-risk key is still forced through dual control', async () => {
    // Regression: a finance_operator has config.propose but not config.approve.
    // Proposing `Finance.limit` must be classified high-risk (pending), not auto-activated.
    const operator = await loginAs('finance_operator');
    const proposal = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/configuration',
      ...auth(operator.cookie),
      payload: { key: 'Finance.limit', value: { max: 1000 }, reason: 'attempt to dodge approval' }
    });
    assert.equal(proposal.statusCode, 201);
    const version = proposal.json<{ key: string; state: string; highRisk: boolean }>();
    assert.equal(version.state, 'pending_approval');
    assert.equal(version.highRisk, true);
    // Stored under the canonical lowercase key.
    assert.equal(version.key, 'finance.limit');
  });

  test('an approver who also proposed cannot approve their own high-risk change', async () => {
    // A super admin holds both propose and approve; dual control must still block self-approval.
    const superAdmin = await loginAs('super_administrator');
    const proposal = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/configuration',
      ...auth(superAdmin.cookie),
      payload: { key: 'security.session_ttl', value: { hours: 12 }, reason: 'tighten' }
    });
    const version = proposal.json<{ id: string }>();

    const selfApprove = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/configuration/${version.id}/approve`,
      ...auth(superAdmin.cookie),
      payload: { reason: 'self approval attempt' }
    });
    assert.equal(selfApprove.statusCode, 403);
  });
});

describe('audit search and export (AUDIT-006, AUDIT-007)', () => {
  test('audit read requires permission and is paginated', async () => {
    const admin = await loginAs('platform_administrator');
    const target = await login();
    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${target.accountId}/suspend`,
      ...auth(admin.cookie),
      payload: { reason: 'generate an event' }
    });

    const search = await app.inject({ method: 'GET', url: '/api/v1/admin/audit?limit=1', ...auth(admin.cookie) });
    assert.equal(search.statusCode, 200);
    const body = search.json<{ items: unknown[]; nextCursor: string | null }>();
    assert.ok(Array.isArray(body.items));
    assert.ok('nextCursor' in body);
  });

  test('a user without audit.read cannot search audit', async () => {
    const { cookie } = await loginAs('content_publisher');
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/audit', ...auth(cookie) });
    assert.equal(response.statusCode, 403);
  });

  test('an export records its own audit event with who and why', async () => {
    const auditor = await loginAs('security_auditor');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/audit/export',
      ...auth(auditor.cookie),
      payload: { reason: 'quarterly review' }
    });
    assert.equal(response.statusCode, 200);

    const exportEvent = await fixture.database.db
      .collection(COLLECTIONS.auditEvents)
      .findOne({ action: 'audit.exported' });
    assert.ok(exportEvent, 'export must create its own audit event');
    assert.equal(exportEvent?.['actor']?.['accountId'], auditor.accountId);
    assert.equal(exportEvent?.['reason'], 'quarterly review');
  });

  test('an export without a reason is rejected at the request boundary', async () => {
    const auditor = await loginAs('security_auditor');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/audit/export',
      ...auth(auditor.cookie),
      payload: { reason: '' }
    });
    assert.equal(response.statusCode, 400);
  });
});

describe('one-time super-administrator bootstrap', () => {
  test('grants the first super admin, audited as emergency, then refuses a second run', async () => {
    const first = await login();
    const context = createRequestContext(newId(), SYSTEM_ACTOR);

    assert.equal(await admin.hasSuperAdmin(), false);
    const assignment = await admin.bootstrapFirstSuperAdmin(first.accountId, context);
    assert.equal(assignment.role, 'super_administrator');
    assert.equal(await admin.hasSuperAdmin(), true);

    // The bootstrapped account can now use the admin surface.
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/v1/admin/capabilities', ...auth(first.cookie) })).statusCode,
      200
    );

    // Audited as an emergency action.
    const event = await fixture.database.db
      .collection(COLLECTIONS.auditEvents)
      .findOne({ action: 'superadmin.bootstrapped', resourceId: first.accountId });
    assert.ok(event);
    assert.equal(event?.['emergency'], true);

    // One-time: a second bootstrap is refused even for a different account.
    const second = await login();
    await assert.rejects(
      admin.bootstrapFirstSuperAdmin(second.accountId, createRequestContext(newId(), SYSTEM_ACTOR)),
      /already exists/
    );
  });

  test('two concurrent bootstraps against the same database: exactly one wins', async () => {
    // Two eligible accounts, no super admin yet, both bootstraps started together.
    const a = await login();
    const b = await login();
    assert.equal(await admin.hasSuperAdmin(), false);

    const results = await Promise.allSettled([
      admin.bootstrapFirstSuperAdmin(a.accountId, createRequestContext(newId(), SYSTEM_ACTOR)),
      admin.bootstrapFirstSuperAdmin(b.accountId, createRequestContext(newId(), SYSTEM_ACTOR))
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 1, 'exactly one bootstrap must succeed');
    assert.equal(rejected.length, 1, 'the other must be refused or lose on a write conflict');

    // Exactly one active super-administrator assignment exists.
    const activeSuperAdmins = await roleAssignments(fixture.database.db)
      .find({ role: 'super_administrator', revokedAt: null })
      .toArray();
    assert.equal(activeSuperAdmins.length, 1, 'exactly one active super-admin assignment');

    // Exactly one bootstrap audit event exists.
    const events = await fixture.database.db
      .collection(COLLECTIONS.auditEvents)
      .find({ action: 'superadmin.bootstrapped' })
      .toArray();
    assert.equal(events.length, 1, 'exactly one superadmin.bootstrapped audit event');

    // The winner is one of the two accounts; the loser holds no assignment at all.
    const winnerId = activeSuperAdmins[0]?.accountId;
    assert.ok(winnerId === a.accountId || winnerId === b.accountId);
    const loserId = winnerId === a.accountId ? b.accountId : a.accountId;
    assert.equal(
      await roleAssignments(fixture.database.db).countDocuments({ accountId: loserId }),
      0,
      'the losing account must receive no privileged assignment'
    );
  });
});

describe('emergency oversight (ADMIN-010, MOD-009)', () => {
  test('super-administrator actions are flagged and appear in the oversight queue', async () => {
    const superAdmin = await loginAs('super_administrator');
    const target = await login();
    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${target.accountId}/suspend`,
      ...auth(superAdmin.cookie),
      payload: { reason: 'emergency action' }
    });

    const queue = await app.inject({ method: 'GET', url: '/api/v1/admin/audit/emergency', ...auth(superAdmin.cookie) });
    assert.equal(queue.statusCode, 200);
    const items = queue.json<{ items: Array<{ emergency: boolean; action: string }> }>().items;
    assert.ok(items.length >= 1);
    assert.ok(items.every((event) => event.emergency === true));
  });

  test('a non-emergency action by an ordinary admin is not in the oversight queue', async () => {
    const admin = await loginAs('platform_administrator');
    const target = await login();
    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${target.accountId}/suspend`,
      ...auth(admin.cookie),
      payload: { reason: 'ordinary action' }
    });

    const queue = await app.inject({ method: 'GET', url: '/api/v1/admin/audit/emergency', ...auth(admin.cookie) });
    const items = queue.json<{ items: unknown[] }>().items;
    assert.equal(items.length, 0);
  });
});
