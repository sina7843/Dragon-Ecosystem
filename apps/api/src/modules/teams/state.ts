import type { EntityId } from '../../shared/ids.ts';

/**
 * Team domain shapes and the pure state-machine guards.
 *
 * The role lives on each membership record — a resource-scoped grant per member — so
 * advanced delegation extends the same model without rewriting a fixed team-role column
 * (TEAM-012). Phase 4 uses exactly that seam: `manager` and `captain` are additional
 * values of the existing `role` field, so no team, membership, or roster-snapshot record
 * is rewritten and every Phase 1 team id and history row survives untouched (TEAM-011,
 * SOCIAL-009). Existing rows are already valid `owner`/`member` values, which is why
 * there is no Phase 4 team migration at all.
 */

export type TeamStatus = 'active' | 'disbanded';
export type TeamVisibility = 'private' | 'public';

/**
 * Team roles, most privileged first.
 *
 * - `owner` — the single accountable holder. Ownership transfer, disbanding, and
 *   delegating roles stay owner-only (ROLE-007: a manager administers the team but
 *   cannot hand it away).
 * - `manager` — advanced team administration: settings plus everything a captain can do.
 * - `captain` — competition-focused delegation: roster and invitation actions only
 *   (ROLE-006).
 * - `member` — plays; changes nothing.
 */
export type TeamRole = 'owner' | 'manager' | 'captain' | 'member';
export const TEAM_ROLES: readonly TeamRole[] = ['owner', 'manager', 'captain', 'member'];

/** Roles an owner may delegate. `owner` is absent by construction: it moves only through transfer. */
export const DELEGATABLE_TEAM_ROLES: readonly TeamRole[] = ['manager', 'captain', 'member'];

/** Team settings and metadata (ROLE-007). */
export function canAdministerTeam(role: TeamRole): boolean {
  return role === 'owner' || role === 'manager';
}

/** Invitations, removals, and roster snapshots (ROLE-006). */
export function canManageRoster(role: TeamRole): boolean {
  return role === 'owner' || role === 'manager' || role === 'captain';
}

export type MembershipStatus = 'active' | 'removed' | 'left';
export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked';

export interface TeamRecord {
  _id: EntityId;
  slug: string;
  name: string;
  description: string;
  /** Team logo/avatar: a site media path (`/media/<id>`) or an https URL; null when unset. */
  avatarUrl: string | null;
  gameId: EntityId;
  /** Privacy by default (DEC-043): a new team is private until made public. */
  visibility: TeamVisibility;
  status: TeamStatus;
  /** Denormalized cache of the active owner; the owner membership row is the authority. */
  ownerId: EntityId;
  version: number;
  createdAt: string;
  updatedAt: string;
  disbandedAt: string | null;
}

export interface MembershipRecord {
  _id: EntityId;
  teamId: EntityId;
  accountId: EntityId;
  role: TeamRole;
  status: MembershipStatus;
  /** Effective dates so a historical roster can be reproduced at any instant (TEAM-010). */
  joinedAt: string;
  leftAt: string | null;
  invitationId: EntityId | null;
}

export interface InvitationRecord {
  _id: EntityId;
  teamId: EntityId;
  invitedAccountId: EntityId;
  invitedBy: EntityId;
  status: InvitationStatus;
  createdAt: string;
  expiresAt: string;
  respondedAt: string | null;
}

export interface RosterSnapshotRecord {
  _id: EntityId;
  teamId: EntityId;
  capturedAt: string;
  capturedBy: EntityId;
  reason: string;
  members: ReadonlyArray<{ accountId: EntityId; role: TeamRole; joinedAt: string }>;
}

/** A pending invitation is actionable only before its expiry (TEAM-004). */
export function isInvitationExpired(invitation: InvitationRecord, now: Date): boolean {
  return new Date(invitation.expiresAt).getTime() <= now.getTime();
}

/**
 * Whether an invitation may move to a new status. Only a live pending invitation
 * can be accepted, declined, revoked, or expired; a settled invitation is final,
 * so replays and races cannot resurrect it.
 */
export function canInvitationTransition(from: InvitationStatus, to: InvitationStatus): boolean {
  if (from !== 'pending') return false;
  return to === 'accepted' || to === 'declined' || to === 'expired' || to === 'revoked';
}
