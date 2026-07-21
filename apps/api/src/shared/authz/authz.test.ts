import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  WILDCARD,
  isHighRiskConfigKey,
  normalizeConfigKey,
  permissionsForRoles
} from './permissions.ts';
import { EffectivePermissions, type Grant } from './policy.ts';

function globalGrant(...permissions: string[]): Grant {
  return { permissions: new Set(permissions as never), scope: null };
}
function scopedGrant(type: string, id: string, ...permissions: string[]): Grant {
  return { permissions: new Set(permissions as never), scope: { type, id } };
}

describe('role → permission mapping', () => {
  test('ordinary and unknown roles hold no permissions (deny-by-default)', () => {
    assert.equal(permissionsForRoles(['registered_user']).size, 0);
    assert.equal(permissionsForRoles(['player', 'team_owner']).size, 0);
    assert.equal(permissionsForRoles(['not_a_role']).size, 0);
    assert.equal(permissionsForRoles([]).size, 0);
  });

  test('super administrator holds the wildcard', () => {
    assert.deepEqual([...permissionsForRoles(['super_administrator'])], [WILDCARD]);
  });

  test('platform administrator has no finance approval or wildcard (ROLE-025)', () => {
    const perms = permissionsForRoles(['platform_administrator']);
    assert.ok(perms.has(PERMISSIONS.usersSuspend));
    assert.ok(!perms.has(WILDCARD));
    assert.ok(!perms.has(PERMISSIONS.financeApprove));
    assert.ok(!perms.has(PERMISSIONS.financeManage));
  });

  test('finance operator cannot approve, approver cannot initiate spend (separation of duties)', () => {
    const operator = permissionsForRoles(['finance_operator']);
    const approver = permissionsForRoles(['financial_approver']);
    assert.ok(operator.has(PERMISSIONS.financeManage));
    assert.ok(!operator.has(PERMISSIONS.financeApprove));
    assert.ok(approver.has(PERMISSIONS.financeApprove));
    assert.ok(!approver.has(PERMISSIONS.financeManage));
  });

  test('every mapped role is a non-empty permission list', () => {
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      assert.ok(perms.length > 0, `${role} must grant at least one permission`);
    }
  });
});

describe('deny-by-default evaluation', () => {
  test('no grants means no access', () => {
    const none = new EffectivePermissions([]);
    assert.equal(none.can({ permission: PERMISSIONS.usersRead }), false);
    assert.equal(none.isSuperAdmin(), false);
    assert.equal(none.hasAnyGlobal(), false);
  });

  test('a global grant authorizes the held permission and nothing else', () => {
    const perms = new EffectivePermissions([globalGrant(PERMISSIONS.usersRead)]);
    assert.equal(perms.can({ permission: PERMISSIONS.usersRead }), true);
    assert.equal(perms.can({ permission: PERMISSIONS.usersSuspend }), false);
    assert.equal(perms.can({ permission: PERMISSIONS.auditRead }), false);
  });

  test('the wildcard authorizes anything (super admin)', () => {
    const god = new EffectivePermissions([globalGrant(WILDCARD)]);
    assert.equal(god.can({ permission: PERMISSIONS.financeApprove }), true);
    assert.equal(god.can({ permission: PERMISSIONS.usersSuspend, scope: { type: 'tournament', id: 'x' } }), true);
    assert.equal(god.isSuperAdmin(), true);
  });
});

describe('resource scope prevents IDOR and privilege escalation', () => {
  test('a scoped grant authorizes only its own resource', () => {
    const perms = new EffectivePermissions([scopedGrant('tournament', 'A', PERMISSIONS.tournamentManage)]);
    assert.equal(
      perms.can({ permission: PERMISSIONS.tournamentManage, scope: { type: 'tournament', id: 'A' } }),
      true
    );
    // Same permission, different resource id → denied (IDOR guard).
    assert.equal(
      perms.can({ permission: PERMISSIONS.tournamentManage, scope: { type: 'tournament', id: 'B' } }),
      false
    );
    // Same id, different resource type → denied.
    assert.equal(perms.can({ permission: PERMISSIONS.tournamentManage, scope: { type: 'team', id: 'A' } }), false);
  });

  test('a scoped grant never satisfies an unscoped, platform-wide request (escalation guard)', () => {
    const perms = new EffectivePermissions([scopedGrant('tournament', 'A', PERMISSIONS.tournamentManage)]);
    assert.equal(perms.can({ permission: PERMISSIONS.tournamentManage }), false);
    assert.equal(perms.hasAnyGlobal(), false);
    assert.equal(perms.isSuperAdmin(), false);
  });

  test('a global grant does satisfy a scoped request for the same permission', () => {
    const perms = new EffectivePermissions([globalGrant(PERMISSIONS.tournamentManage)]);
    assert.equal(
      perms.can({ permission: PERMISSIONS.tournamentManage, scope: { type: 'tournament', id: 'anything' } }),
      true
    );
  });

  test('multiple scoped grants each stay isolated to their resource', () => {
    const perms = new EffectivePermissions([
      scopedGrant('tournament', 'A', PERMISSIONS.tournamentManage),
      scopedGrant('tournament', 'C', PERMISSIONS.tournamentManage)
    ]);
    for (const id of ['A', 'C']) {
      assert.equal(perms.can({ permission: PERMISSIONS.tournamentManage, scope: { type: 'tournament', id } }), true);
    }
    assert.equal(perms.can({ permission: PERMISSIONS.tournamentManage, scope: { type: 'tournament', id: 'B' } }), false);
  });
});

describe('high-risk configuration keys', () => {
  test('finance, security, and payout keys are high risk', () => {
    assert.equal(isHighRiskConfigKey('finance.refund_policy'), true);
    assert.equal(isHighRiskConfigKey('security.session_ttl'), true);
    assert.equal(isHighRiskConfigKey('payout.limits'), true);
  });

  test('ordinary keys are not high risk', () => {
    assert.equal(isHighRiskConfigKey('feature.new_home'), false);
    assert.equal(isHighRiskConfigKey('content.banner'), false);
  });

  test('case and whitespace variants cannot dodge high-risk classification', () => {
    // A miscased or padded key must still be recognised as high-risk, so it cannot
    // skip dual control by being treated as a different, low-risk key.
    for (const variant of ['Finance.refund_policy', ' finance.refund_policy', 'FINANCE.LIMIT', 'Security.session']) {
      assert.equal(isHighRiskConfigKey(variant), true, `${variant} must be high risk`);
    }
    assert.equal(normalizeConfigKey('  Finance.Refund_Policy '), 'finance.refund_policy');
  });
});
