import type { ClientSession, Db } from 'mongodb';
import type { Database } from '../../shared/db/client.ts';
import { runUnitOfWork } from '../../shared/db/unit-of-work.ts';
import type { RequestContext } from '../../shared/context.ts';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, type FieldError } from '../../shared/errors.ts';
import { utcNow } from '../../shared/events.ts';
import { newId, type EntityId } from '../../shared/ids.ts';
import { resolveSlug } from '../content/slug.ts';
import { TEAMS_COLLECTIONS } from './collections.ts';
import {
  canInvitationTransition,
  isInvitationExpired,
  type InvitationRecord,
  type MembershipRecord,
  type RosterSnapshotRecord,
  type TeamRecord,
  type TeamRole,
  type TeamVisibility
} from './state.ts';

/**
 * Persistent teams, memberships, invitations, ownership operations, and immutable
 * roster snapshots (TEAM-001..012).
 *
 * Authorization is resource-scoped and derived from membership: an action on a
 * team is permitted only to the actor's own active membership in *that* team, and
 * owner-only actions require the active owner membership. That closes IDOR (a
 * caller cannot act on a team it is not on) and privilege escalation (a member
 * cannot perform owner actions). Uniqueness invariants — one active membership,
 * one active owner, one pending invitation — are enforced by partial unique
 * indexes inside the write transaction, never by read-before-write alone.
 */

const NAME_MIN = 3;
const NAME_MAX = 50;
const DESCRIPTION_MAX = 500;
const IN_GAME_NAME_MAX = 50;
const INVITE_TTL_DAYS = 7;

const DUPLICATE_KEY = 11000;
function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === DUPLICATE_KEY;
}

/** Minimal view of the games catalog the teams module depends on (section 32.1 boundary). */
export interface GameLookup {
  getById(id: EntityId): Promise<{ _id: EntityId; status: string } | null>;
}

/** Minimal identity lookups the teams module depends on for invitations and public views. */
export interface IdentityLookup {
  findAccountIdByUsername(username: string): Promise<EntityId | null>;
  getIdentitySummaries(accountIds: readonly EntityId[]): Promise<Map<EntityId, { username: string; displayName: string }>>;
  getPublicIdentities(accountIds: readonly EntityId[]): Promise<Map<EntityId, { username: string; displayName: string }>>;
  isProfilePublic(username: string): Promise<boolean>;
}

export interface CreateTeamInput {
  name: string;
  description?: string;
  gameId: string;
  slug?: string;
  visibility?: TeamVisibility;
}

export interface UpdateTeamInput {
  name?: string;
  description?: string;
  gameId?: string;
  slug?: string;
  visibility?: TeamVisibility;
  expectedVersion?: number;
}

export interface MemberView {
  accountId: EntityId;
  role: TeamRole;
  joinedAt: string;
  username: string | null;
  displayName: string | null;
}

export interface TeamView {
  id: EntityId;
  slug: string;
  name: string;
  description: string;
  gameId: EntityId;
  visibility: TeamVisibility;
  status: string;
  version: number;
  viewerRole: TeamRole;
  members: MemberView[];
}

function validName(raw: string): string {
  const value = raw.trim();
  if (value.length < NAME_MIN || value.length > NAME_MAX) {
    throw new ValidationError('The team name is not valid.', [
      { field: 'name', code: 'INVALID_LENGTH', message: `Use between ${String(NAME_MIN)} and ${String(NAME_MAX)} characters.` }
    ]);
  }
  return value;
}

function validDescription(raw: string | undefined): string {
  return (raw ?? '').trim().slice(0, DESCRIPTION_MAX);
}

export class TeamsService {
  readonly #database: Database;
  readonly #games: GameLookup;
  readonly #identity: IdentityLookup;

  constructor(database: Database, games: GameLookup, identity: IdentityLookup) {
    this.#database = database;
    this.#games = games;
    this.#identity = identity;
  }

  get #db(): Db {
    return this.#database.db;
  }

  #teams(db: Db = this.#db) {
    return db.collection<TeamRecord>(TEAMS_COLLECTIONS.teams);
  }
  #members(db: Db = this.#db) {
    return db.collection<MembershipRecord>(TEAMS_COLLECTIONS.memberships);
  }
  #invitations(db: Db = this.#db) {
    return db.collection<InvitationRecord>(TEAMS_COLLECTIONS.invitations);
  }
  #snapshots(db: Db = this.#db) {
    return db.collection<RosterSnapshotRecord>(TEAMS_COLLECTIONS.rosterSnapshots);
  }
  #gamingIdentities(db: Db) {
    return db.collection(TEAMS_COLLECTIONS.gamingIdentities);
  }

  async #assertPublishedGame(gameId: string): Promise<void> {
    const game = await this.#games.getById(gameId);
    if (game === null || game.status !== 'published') {
      throw new ValidationError('The selected game is not available.', [
        { field: 'gameId', code: 'INVALID_GAME', message: 'Choose a published game.' }
      ]);
    }
  }

  /** Loads an active team inside the caller's session, or throws 404. */
  async #activeTeam(session: ClientSession, teamId: string): Promise<TeamRecord> {
    const team = await this.#teams(this.#db).findOne({ _id: teamId }, { session });
    if (team === null) throw new NotFoundError('Unknown team.');
    if (team.status !== 'active') throw new ValidationError('This team has been disbanded.');
    return team;
  }

  async #activeMembership(session: ClientSession, teamId: string, accountId: string): Promise<MembershipRecord | null> {
    return this.#members(this.#db).findOne({ teamId, accountId, status: 'active' }, { session });
  }

  async #assertOwner(session: ClientSession, teamId: string, accountId: string): Promise<void> {
    const membership = await this.#activeMembership(session, teamId, accountId);
    if (membership === null || membership.role !== 'owner') {
      throw new ForbiddenError('Only the team owner can perform this action.');
    }
  }

  // --- Team lifecycle ---

  async createTeam(context: RequestContext, actorId: string, input: CreateTeamInput): Promise<TeamRecord> {
    const name = validName(input.name);
    const description = validDescription(input.description);
    await this.#assertPublishedGame(input.gameId);
    const slug = resolveSlug(input.slug, name);
    const now = utcNow();
    const team: TeamRecord = {
      _id: newId(),
      slug,
      name,
      description,
      gameId: input.gameId,
      visibility: input.visibility ?? 'private',
      status: 'active',
      ownerId: actorId,
      version: 1,
      createdAt: now,
      updatedAt: now,
      disbandedAt: null
    };
    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        await this.#teams(uow.db).insertOne(team, { session: uow.session });
        await this.#members(uow.db).insertOne(
          {
            _id: newId(),
            teamId: team._id,
            accountId: actorId,
            role: 'owner',
            status: 'active',
            joinedAt: now,
            leftAt: null,
            invitationId: null
          },
          { session: uow.session }
        );
        uow.audit({
          action: 'team.created',
          resourceType: 'team',
          resourceId: team._id,
          after: { slug, name, gameId: team.gameId, ownerId: actorId }
        });
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ValidationError('That team name is already taken.', [
          { field: 'name', code: 'TEAM_SLUG_TAKEN', message: 'Choose a different team name.' }
        ]);
      }
      throw error;
    }
    return team;
  }

  async updateTeam(context: RequestContext, actorId: string, teamId: string, input: UpdateTeamInput): Promise<TeamRecord> {
    if (input.gameId !== undefined) await this.#assertPublishedGame(input.gameId);
    try {
      return await runUnitOfWork(this.#database, context, async (uow) => {
        const current = await this.#activeTeam(uow.session, teamId);
        await this.#assertOwner(uow.session, teamId, actorId);
        if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
          throw new ConflictError('TEAM_STALE', 'This team changed since you opened it. Reload and retry.');
        }
        const name = input.name === undefined ? current.name : validName(input.name);
        const next: TeamRecord = {
          ...current,
          name,
          description: input.description === undefined ? current.description : validDescription(input.description),
          gameId: input.gameId ?? current.gameId,
          visibility: input.visibility ?? current.visibility,
          // The slug is the public URL, so a rename never silently changes it; the
          // slug moves only when explicitly supplied (matches the games module).
          slug: input.slug === undefined ? current.slug : resolveSlug(input.slug, name),
          version: current.version + 1,
          updatedAt: utcNow()
        };
        const result = await this.#teams(uow.db).replaceOne({ _id: teamId, version: current.version }, next, { session: uow.session });
        if (result.matchedCount === 0) throw new ConflictError('TEAM_STALE', 'This team changed. Reload and retry.');
        uow.audit({
          action: 'team.updated',
          resourceType: 'team',
          resourceId: teamId,
          before: { name: current.name, slug: current.slug, visibility: current.visibility, version: current.version },
          after: { name: next.name, slug: next.slug, visibility: next.visibility, version: next.version }
        });
        return next;
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ValidationError('That team name is already taken.', [
          { field: 'name', code: 'TEAM_SLUG_TAKEN', message: 'Choose a different team name.' }
        ]);
      }
      throw error;
    }
  }

  async disbandTeam(context: RequestContext, actorId: string, teamId: string, reason: string): Promise<void> {
    await runUnitOfWork(this.#database, context, async (uow) => {
      await this.#activeTeam(uow.session, teamId);
      await this.#assertOwner(uow.session, teamId, actorId);
      const now = utcNow();
      const result = await this.#teams(uow.db).updateOne(
        { _id: teamId, status: 'active' },
        { $set: { status: 'disbanded', disbandedAt: now, updatedAt: now }, $inc: { version: 1 } },
        { session: uow.session }
      );
      if (result.matchedCount === 0) throw new ConflictError('TEAM_STALE', 'This team changed. Reload and retry.');
      uow.audit({ action: 'team.disbanded', resourceType: 'team', resourceId: teamId, reason });
    });
  }

  // --- Invitations (TEAM-004, TEAM-005) ---

  async invite(context: RequestContext, actorId: string, teamId: string, username: string): Promise<InvitationRecord> {
    const invitedAccountId = await this.#identity.findAccountIdByUsername(username);
    if (invitedAccountId === null) {
      throw new ValidationError('No player with that username was found.', [
        { field: 'username', code: 'USER_NOT_FOUND', message: 'Check the username and try again.' }
      ]);
    }
    try {
      return await runUnitOfWork(this.#database, context, async (uow) => {
        await this.#activeTeam(uow.session, teamId);
        await this.#assertOwner(uow.session, teamId, actorId);
        if (invitedAccountId === actorId) {
          throw new ValidationError('You are already on this team.', [
            { field: 'username', code: 'ALREADY_MEMBER', message: 'You cannot invite yourself.' }
          ]);
        }
        const already = await this.#activeMembership(uow.session, teamId, invitedAccountId);
        if (already !== null) {
          throw new ValidationError('That player is already on this team.', [
            { field: 'username', code: 'ALREADY_MEMBER', message: 'That player is already a member.' }
          ]);
        }
        const now = utcNow();
        const invitation: InvitationRecord = {
          _id: newId(),
          teamId,
          invitedAccountId,
          invitedBy: actorId,
          status: 'pending',
          createdAt: now,
          expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000).toISOString(),
          respondedAt: null
        };
        await this.#invitations(uow.db).insertOne(invitation, { session: uow.session });
        uow.audit({
          action: 'team.invited',
          resourceType: 'team',
          resourceId: teamId,
          after: { invitationId: invitation._id, invitedAccountId, expiresAt: invitation.expiresAt }
        });
        return invitation;
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ValidationError('That player already has a pending invitation.', [
          { field: 'username', code: 'INVITE_PENDING', message: 'An invitation is already pending.' }
        ]);
      }
      throw error;
    }
  }

  /** Accept is idempotent: a second accept returns the existing membership rather than creating a duplicate (TEAM-005). */
  async acceptInvitation(context: RequestContext, actorId: string, invitationId: string): Promise<MembershipRecord> {
    try {
      return await runUnitOfWork(this.#database, context, async (uow) => {
        const invitation = await this.#invitations(uow.db).findOne({ _id: invitationId }, { session: uow.session });
        // Hide invitations addressed to someone else behind a 404.
        if (invitation === null || invitation.invitedAccountId !== actorId) throw new NotFoundError('Unknown invitation.');

        const existingMembership = await this.#activeMembership(uow.session, invitation.teamId, actorId);
        if (invitation.status === 'accepted' && existingMembership !== null) return existingMembership;

        if (invitation.status !== 'pending') {
          throw new ValidationError('This invitation is no longer available.', [
            { field: 'invitation', code: 'INVITE_NOT_PENDING', message: 'This invitation cannot be accepted.' }
          ]);
        }
        if (isInvitationExpired(invitation, new Date())) {
          await this.#invitations(uow.db).updateOne(
            { _id: invitationId, status: 'pending' },
            { $set: { status: 'expired', respondedAt: utcNow() } },
            { session: uow.session }
          );
          throw new ValidationError('This invitation has expired.', [
            { field: 'invitation', code: 'INVITE_EXPIRED', message: 'Ask the owner to invite you again.' }
          ]);
        }
        const team = await this.#teams(uow.db).findOne({ _id: invitation.teamId }, { session: uow.session });
        if (team === null || team.status !== 'active') {
          throw new ValidationError('This team is no longer available.', [
            { field: 'invitation', code: 'TEAM_UNAVAILABLE', message: 'This team has been disbanded.' }
          ]);
        }

        const now = utcNow();
        const membership: MembershipRecord = {
          _id: newId(),
          teamId: invitation.teamId,
          accountId: actorId,
          role: 'member',
          status: 'active',
          joinedAt: now,
          leftAt: null,
          invitationId
        };
        await this.#invitations(uow.db).updateOne(
          { _id: invitationId, status: 'pending' },
          { $set: { status: 'accepted', respondedAt: now } },
          { session: uow.session }
        );
        await this.#members(uow.db).insertOne(membership, { session: uow.session });
        uow.audit({
          action: 'team.invitation_accepted',
          resourceType: 'team',
          resourceId: invitation.teamId,
          after: { accountId: actorId, membershipId: membership._id }
        });
        return membership;
      });
    } catch (error) {
      // A concurrent accept won the active-membership index; treat as idempotent success.
      if (isDuplicateKey(error)) {
        const invitation = await this.#invitations().findOne({ _id: invitationId });
        if (invitation !== null) {
          const winner = await this.#members().findOne({ teamId: invitation.teamId, accountId: actorId, status: 'active' });
          if (winner !== null) return winner;
        }
      }
      throw error;
    }
  }

  async declineInvitation(context: RequestContext, actorId: string, invitationId: string): Promise<void> {
    await runUnitOfWork(this.#database, context, async (uow) => {
      const invitation = await this.#invitations(uow.db).findOne({ _id: invitationId }, { session: uow.session });
      if (invitation === null || invitation.invitedAccountId !== actorId) throw new NotFoundError('Unknown invitation.');
      if (invitation.status === 'declined') return; // Idempotent.
      if (!canInvitationTransition(invitation.status, 'declined')) {
        throw new ValidationError('This invitation is no longer available.', [
          { field: 'invitation', code: 'INVITE_NOT_PENDING', message: 'This invitation cannot be declined.' }
        ]);
      }
      await this.#invitations(uow.db).updateOne(
        { _id: invitationId, status: 'pending' },
        { $set: { status: 'declined', respondedAt: utcNow() } },
        { session: uow.session }
      );
      uow.audit({ action: 'team.invitation_declined', resourceType: 'team', resourceId: invitation.teamId, after: { accountId: actorId } });
    });
  }

  // --- Membership changes (TEAM-006) ---

  async removeMember(context: RequestContext, actorId: string, teamId: string, targetAccountId: string, reason: string): Promise<void> {
    await runUnitOfWork(this.#database, context, async (uow) => {
      await this.#activeTeam(uow.session, teamId);
      await this.#assertOwner(uow.session, teamId, actorId);
      if (targetAccountId === actorId) {
        throw new ValidationError('The owner cannot be removed. Transfer ownership or disband the team.', [
          { field: 'accountId', code: 'CANNOT_REMOVE_OWNER', message: 'Transfer ownership first.' }
        ]);
      }
      const membership = await this.#members(uow.db).findOne(
        { teamId, accountId: targetAccountId, status: 'active', role: 'member' },
        { session: uow.session }
      );
      if (membership === null) throw new NotFoundError('That player is not an active member.');
      const result = await this.#members(uow.db).updateOne(
        { _id: membership._id, status: 'active' },
        { $set: { status: 'removed', leftAt: utcNow() } },
        { session: uow.session }
      );
      if (result.matchedCount === 0) throw new ConflictError('MEMBERSHIP_STALE', 'That membership changed. Reload and retry.');
      uow.audit({ action: 'team.member_removed', resourceType: 'team', resourceId: teamId, before: { accountId: targetAccountId }, reason });
    });
  }

  async leaveTeam(context: RequestContext, actorId: string, teamId: string): Promise<void> {
    await runUnitOfWork(this.#database, context, async (uow) => {
      await this.#activeTeam(uow.session, teamId);
      const membership = await this.#activeMembership(uow.session, teamId, actorId);
      if (membership === null) throw new NotFoundError('You are not a member of this team.');
      if (membership.role === 'owner') {
        throw new ValidationError('The owner cannot leave. Transfer ownership or disband the team first.', [
          { field: 'role', code: 'OWNER_CANNOT_LEAVE', message: 'Transfer ownership or disband first.' }
        ]);
      }
      const result = await this.#members(uow.db).updateOne(
        { _id: membership._id, status: 'active' },
        { $set: { status: 'left', leftAt: utcNow() } },
        { session: uow.session }
      );
      if (result.matchedCount === 0) throw new ConflictError('MEMBERSHIP_STALE', 'That membership changed. Reload and retry.');
      uow.audit({ action: 'team.member_left', resourceType: 'team', resourceId: teamId, before: { accountId: actorId } });
    });
  }

  // --- Ownership transfer (TEAM-007) ---

  async transferOwnership(context: RequestContext, actorId: string, teamId: string, targetAccountId: string): Promise<void> {
    await runUnitOfWork(this.#database, context, async (uow) => {
      await this.#activeTeam(uow.session, teamId);
      await this.#assertOwner(uow.session, teamId, actorId);
      if (targetAccountId === actorId) {
        throw new ValidationError('You already own this team.', [
          { field: 'accountId', code: 'ALREADY_OWNER', message: 'Choose a different member.' }
        ]);
      }
      const target = await this.#members(uow.db).findOne(
        { teamId, accountId: targetAccountId, status: 'active', role: 'member' },
        { session: uow.session }
      );
      if (target === null) {
        throw new ValidationError('The new owner must be an active member of the team.', [
          { field: 'accountId', code: 'NOT_A_MEMBER', message: 'Choose an active member.' }
        ]);
      }
      // Atomic swap. The one-active-owner partial index guarantees no window with two
      // owners even under a concurrent transfer; the conditional filters make a stale
      // transfer match nothing and abort.
      const demote = await this.#members(uow.db).updateOne(
        { teamId, accountId: actorId, role: 'owner', status: 'active' },
        { $set: { role: 'member' } },
        { session: uow.session }
      );
      if (demote.matchedCount === 0) throw new ConflictError('OWNERSHIP_STALE', 'Ownership changed. Reload and retry.');
      const promote = await this.#members(uow.db).updateOne(
        { teamId, accountId: targetAccountId, role: 'member', status: 'active' },
        { $set: { role: 'owner' } },
        { session: uow.session }
      );
      if (promote.matchedCount === 0) throw new ConflictError('OWNERSHIP_STALE', 'Ownership changed. Reload and retry.');
      await this.#teams(uow.db).updateOne(
        { _id: teamId },
        { $set: { ownerId: targetAccountId, updatedAt: utcNow() }, $inc: { version: 1 } },
        { session: uow.session }
      );
      uow.audit({
        action: 'team.ownership_transferred',
        resourceType: 'team',
        resourceId: teamId,
        before: { ownerId: actorId },
        after: { ownerId: targetAccountId }
      });
    });
  }

  // --- Immutable roster snapshots (TEAM-010, BR-007, ASM-004, TOURN-010) ---

  /** Captures the current active roster as an append-only, immutable snapshot. */
  async captureRosterSnapshot(context: RequestContext, actorId: string, teamId: string, reason: string): Promise<RosterSnapshotRecord> {
    return runUnitOfWork(this.#database, context, async (uow) => {
      await this.#activeTeam(uow.session, teamId);
      await this.#assertOwner(uow.session, teamId, actorId);
      const active = await this.#members(uow.db).find({ teamId, status: 'active' }, { session: uow.session }).sort({ joinedAt: 1 }).toArray();
      const snapshot: RosterSnapshotRecord = {
        _id: newId(),
        teamId,
        capturedAt: utcNow(),
        capturedBy: actorId,
        reason,
        members: active.map((m) => ({ accountId: m.accountId, role: m.role, joinedAt: m.joinedAt }))
      };
      // Insert-only: snapshots are never updated or deleted (BR-007).
      await this.#snapshots(uow.db).insertOne(snapshot, { session: uow.session });
      uow.audit({ action: 'team.roster_snapshot', resourceType: 'team', resourceId: teamId, after: { snapshotId: snapshot._id, size: snapshot.members.length }, reason });
      return snapshot;
    });
  }

  async getSnapshot(id: string): Promise<RosterSnapshotRecord | null> {
    return this.#snapshots().findOne({ _id: id });
  }

  /**
   * Reproduces the roster active at a given instant from membership effective dates
   * (TEAM-010): joined on or before the instant and not yet left at that instant.
   */
  async rosterAt(teamId: string, at: Date): Promise<MembershipRecord[]> {
    const iso = at.toISOString();
    return this.#members()
      .find({ teamId, joinedAt: { $lte: iso }, $or: [{ leftAt: null }, { leftAt: { $gt: iso } }] })
      .sort({ joinedAt: 1 })
      .toArray();
  }

  // --- Reads ---

  async #memberViews(members: MembershipRecord[], resolver: Map<EntityId, { username: string; displayName: string }>): Promise<MemberView[]> {
    return members.map((m) => {
      const identity = resolver.get(m.accountId);
      return {
        accountId: m.accountId,
        role: m.role,
        joinedAt: m.joinedAt,
        username: identity?.username ?? null,
        displayName: identity?.displayName ?? null
      };
    });
  }

  /** Team-private view for an active member (ROLE-004); non-members get 404. */
  async getTeamForActor(actorId: string, teamId: string): Promise<TeamView> {
    const team = await this.#teams().findOne({ _id: teamId });
    if (team === null) throw new NotFoundError('Unknown team.');
    const viewer = await this.#members().findOne({ teamId, accountId: actorId, status: 'active' });
    if (viewer === null) throw new NotFoundError('Unknown team.');
    const members = await this.#members().find({ teamId, status: 'active' }).sort({ joinedAt: 1 }).toArray();
    const identities = await this.#identity.getIdentitySummaries(members.map((m) => m.accountId));
    return {
      id: team._id,
      slug: team.slug,
      name: team.name,
      description: team.description,
      gameId: team.gameId,
      visibility: team.visibility,
      status: team.status,
      version: team.version,
      viewerRole: viewer.role,
      members: await this.#memberViews(members, identities)
    };
  }

  /** Teams the actor actively belongs to, with their role. */
  async listMyTeams(actorId: string): Promise<Array<{ id: string; slug: string; name: string; role: TeamRole; status: string }>> {
    const memberships = await this.#members().find({ accountId: actorId, status: 'active' }).toArray();
    if (memberships.length === 0) return [];
    const byTeam = new Map(memberships.map((m) => [m.teamId, m.role]));
    const teams = await this.#teams().find({ _id: { $in: [...byTeam.keys()] } }).sort({ updatedAt: -1 }).toArray();
    return teams.map((t) => ({ id: t._id, slug: t.slug, name: t.name, role: byTeam.get(t._id) ?? 'member', status: t.status }));
  }

  /** Pending, unexpired invitations addressed to the actor. */
  async listMyInvitations(actorId: string): Promise<Array<{ id: string; teamId: string; teamName: string; expiresAt: string }>> {
    const now = new Date();
    const invitations = await this.#invitations().find({ invitedAccountId: actorId, status: 'pending' }).toArray();
    const live = invitations.filter((i) => !isInvitationExpired(i, now));
    if (live.length === 0) return [];
    const teams = await this.#teams().find({ _id: { $in: live.map((i) => i.teamId) } }).toArray();
    const nameByTeam = new Map(teams.map((t) => [t._id, t.name]));
    return live.map((i) => ({ id: i._id, teamId: i.teamId, teamName: nameByTeam.get(i.teamId) ?? '', expiresAt: i.expiresAt }));
  }

  /** Pending invitations for a team (owner view). Unknown team is a 404; a non-owner is a 403. */
  async listTeamInvitations(actorId: string, teamId: string): Promise<Array<{ id: string; invitedAccountId: string; username: string | null; expiresAt: string }>> {
    const team = await this.#teams().findOne({ _id: teamId }, { projection: { _id: 1 } });
    if (team === null) throw new NotFoundError('Unknown team.');
    const owner = await this.#members().findOne({ teamId, accountId: actorId, status: 'active', role: 'owner' });
    if (owner === null) throw new ForbiddenError('Only the team owner can view invitations.');
    const invitations = await this.#invitations().find({ teamId, status: 'pending' }).toArray();
    const identities = await this.#identity.getIdentitySummaries(invitations.map((i) => i.invitedAccountId));
    return invitations.map((i) => ({
      id: i._id,
      invitedAccountId: i.invitedAccountId,
      username: identities.get(i.invitedAccountId)?.username ?? null,
      expiresAt: i.expiresAt
    }));
  }

  /** Privacy-aware public view: only a public, active team is visible; its roster shows public identities only. */
  async getPublicTeam(slug: string): Promise<{ slug: string; name: string; description: string; gameId: string; members: MemberView[] } | null> {
    const team = await this.#teams().findOne({ slug, visibility: 'public', status: 'active' });
    if (team === null) return null;
    const members = await this.#members().find({ teamId: team._id, status: 'active' }).sort({ joinedAt: 1 }).toArray();
    const identities = await this.#identity.getPublicIdentities(members.map((m) => m.accountId));
    // Only members who have chosen a public profile are listed (privacy by default).
    const visible = members.filter((m) => identities.has(m.accountId));
    return {
      slug: team.slug,
      name: team.name,
      description: team.description,
      gameId: team.gameId,
      members: await this.#memberViews(visible, identities)
    };
  }

  // --- Gaming identities (game-specific player identity fields) ---

  async saveGamingIdentity(
    context: RequestContext,
    actorId: string,
    input: { gameId: string; inGameName: string; visibility?: TeamVisibility }
  ): Promise<{ accountId: string; gameId: string; inGameName: string; visibility: TeamVisibility }> {
    await this.#assertPublishedGame(input.gameId);
    const inGameName = input.inGameName.trim();
    if (inGameName.length === 0 || inGameName.length > IN_GAME_NAME_MAX) {
      throw new ValidationError('The in-game name is not valid.', [
        { field: 'inGameName', code: 'INVALID_LENGTH', message: `Use between 1 and ${String(IN_GAME_NAME_MAX)} characters.` } satisfies FieldError
      ]);
    }
    const visibility: TeamVisibility = input.visibility ?? 'private';
    const now = utcNow();
    await runUnitOfWork(this.#database, context, async (uow) => {
      await this.#gamingIdentities(uow.db).updateOne(
        { accountId: actorId, gameId: input.gameId },
        {
          $set: { inGameName, visibility, updatedAt: now },
          $setOnInsert: { _id: newId(), accountId: actorId, gameId: input.gameId, createdAt: now }
        },
        { upsert: true, session: uow.session }
      );
      uow.audit({ action: 'gaming_identity.saved', resourceType: 'account', resourceId: actorId, after: { gameId: input.gameId, visibility } });
    });
    return { accountId: actorId, gameId: input.gameId, inGameName, visibility };
  }

  async listMyGamingIdentities(actorId: string): Promise<Array<{ gameId: string; inGameName: string; visibility: TeamVisibility }>> {
    const rows = await this.#gamingIdentities(this.#db)
      .find({ accountId: actorId })
      .project({ _id: 0, gameId: 1, inGameName: 1, visibility: 1 })
      .toArray();
    return rows as Array<{ gameId: string; inGameName: string; visibility: TeamVisibility }>;
  }

  /** Whether an account has set an in-game identity for a game (tournament eligibility, TOURN-008). */
  async hasGamingIdentity(accountId: string, gameId: string): Promise<boolean> {
    return (await this.#gamingIdentities(this.#db).countDocuments({ accountId, gameId }, { limit: 1 })) > 0;
  }

  /** Public gaming identities for a player, privacy-aware: a private profile is a 404 (null). */
  async getPublicGamingIdentities(username: string): Promise<Array<{ gameId: string; inGameName: string }> | null> {
    const isPublic = await this.#identity.isProfilePublic(username);
    if (!isPublic) return null;
    const accountId = await this.#identity.findAccountIdByUsername(username);
    if (accountId === null) return null;
    const rows = await this.#gamingIdentities(this.#db)
      .find({ accountId, visibility: 'public' })
      .project({ _id: 0, gameId: 1, inGameName: 1 })
      .toArray();
    return rows as Array<{ gameId: string; inGameName: string }>;
  }
}
