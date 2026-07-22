import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { canInvitationTransition, isInvitationExpired, type InvitationRecord } from './state.ts';

/** Pure state-machine guards for team invitations (TEAM-004, TEAM-005). */

function invitation(overrides: Partial<InvitationRecord> = {}): InvitationRecord {
  return {
    _id: 'i1',
    teamId: 't1',
    invitedAccountId: 'a1',
    invitedBy: 'o1',
    status: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-08T00:00:00.000Z',
    respondedAt: null,
    ...overrides
  };
}

describe('invitation state machine', () => {
  test('only a pending invitation can transition', () => {
    assert.equal(canInvitationTransition('pending', 'accepted'), true);
    assert.equal(canInvitationTransition('pending', 'declined'), true);
    assert.equal(canInvitationTransition('pending', 'expired'), true);
    assert.equal(canInvitationTransition('pending', 'revoked'), true);
  });

  test('a settled invitation is final — replays cannot resurrect it', () => {
    for (const from of ['accepted', 'declined', 'expired', 'revoked'] as const) {
      assert.equal(canInvitationTransition(from, 'accepted'), false);
      assert.equal(canInvitationTransition(from, 'declined'), false);
    }
  });

  test('expiry is evaluated against the expiry instant', () => {
    const inv = invitation();
    assert.equal(isInvitationExpired(inv, new Date('2026-01-07T23:59:59.000Z')), false);
    assert.equal(isInvitationExpired(inv, new Date('2026-01-08T00:00:00.000Z')), true);
    assert.equal(isInvitationExpired(inv, new Date('2026-02-01T00:00:00.000Z')), true);
  });
});
