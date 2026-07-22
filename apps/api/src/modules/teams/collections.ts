import type { IndexDeclaration } from '../../shared/db/collections.ts';

/** Collections owned by the teams module (TEAM-001..012). No other module reads these directly (section 32.1). */
export const TEAMS_COLLECTIONS = {
  teams: 'teams',
  memberships: 'team_memberships',
  invitations: 'team_invitations',
  rosterSnapshots: 'team_roster_snapshots',
  gamingIdentities: 'gaming_identities'
} as const;

/**
 * The membership and invitation uniqueness rules are enforced by partial unique
 * indexes rather than read-before-write, so concurrent requests cannot corrupt a
 * roster: the database is the single authority on "one active membership", "one
 * active owner", and "one pending invitation" (TEAM-003, TEAM-005).
 */
export const TEAMS_INDEXES: readonly IndexDeclaration[] = [
  // TEAM-001: unique normalized team identity.
  { collection: TEAMS_COLLECTIONS.teams, name: 'team_slug_unique', keys: { slug: 1 }, options: { unique: true } },
  { collection: TEAMS_COLLECTIONS.teams, name: 'team_status_updated', keys: { status: 1, updatedAt: -1 } },
  // Public team directory search: public + active teams sorted by slug (DRAGON-16c).
  { collection: TEAMS_COLLECTIONS.teams, name: 'team_public_slug', keys: { visibility: 1, status: 1, slug: 1 } },

  // One active membership per (team, account) — blocks duplicate active membership.
  {
    collection: TEAMS_COLLECTIONS.memberships,
    name: 'membership_team_account_active_unique',
    keys: { teamId: 1, accountId: 1 },
    options: { unique: true, partialFilterExpression: { status: 'active' } }
  },
  // TEAM-003: exactly one active owner per team.
  {
    collection: TEAMS_COLLECTIONS.memberships,
    name: 'membership_one_active_owner',
    keys: { teamId: 1 },
    options: { unique: true, partialFilterExpression: { role: 'owner', status: 'active' } }
  },
  // TEAM-010: membership history is queried by account and by team over time.
  { collection: TEAMS_COLLECTIONS.memberships, name: 'membership_account', keys: { accountId: 1, status: 1 } },
  { collection: TEAMS_COLLECTIONS.memberships, name: 'membership_team', keys: { teamId: 1, joinedAt: 1 } },

  // One pending invitation per (team, invited account).
  {
    collection: TEAMS_COLLECTIONS.invitations,
    name: 'invitation_team_account_pending_unique',
    keys: { teamId: 1, invitedAccountId: 1 },
    options: { unique: true, partialFilterExpression: { status: 'pending' } }
  },
  { collection: TEAMS_COLLECTIONS.invitations, name: 'invitation_invited', keys: { invitedAccountId: 1, status: 1 } },
  { collection: TEAMS_COLLECTIONS.invitations, name: 'invitation_team', keys: { teamId: 1, status: 1 } },

  // Immutable snapshots, read back by team (BR-007, ASM-004, TOURN-010).
  { collection: TEAMS_COLLECTIONS.rosterSnapshots, name: 'snapshot_team_captured', keys: { teamId: 1, capturedAt: -1 } },

  // One gaming identity per (account, game).
  {
    collection: TEAMS_COLLECTIONS.gamingIdentities,
    name: 'gaming_identity_account_game_unique',
    keys: { accountId: 1, gameId: 1 },
    options: { unique: true }
  }
];
