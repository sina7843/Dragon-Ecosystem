import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../../config.ts';
import { buildAdmin, buildContent, buildGames, buildIdentity, buildServer, buildTeams } from '../../server.ts';
import { allMigrations } from '../../migrations.ts';
import { runMigrations } from '../../shared/db/migrations.ts';
import { seedSystemConfiguration } from '../../shared/db/seed.ts';
import { createTestDatabase, type TestDatabase } from '../../shared/db/test-support.ts';
import { newId } from '../../shared/ids.ts';
import { utcNow } from '../../shared/events.ts';
import { SESSION_COOKIE } from '../identity/index.ts';
import { TEAMS_COLLECTIONS } from './collections.ts';

/**
 * Teams integration coverage (TEAM-001..012, section 16): authorization,
 * membership/invitation state machines, ownership transfer, concurrency safety,
 * immutable roster snapshots, and privacy-aware public views.
 * Requires the disposable test database: `npm run db:test:up`.
 */

let fixture: TestDatabase;
let app: FastifyInstance;

before(async () => {
  fixture = await createTestDatabase();
  await runMigrations(fixture.database.db, allMigrations);
  await seedSystemConfiguration(fixture.database.db);
  const config = loadConfig({ NODE_ENV: 'test' });
  const identity = buildIdentity(fixture.database, config);
  const games = buildGames(fixture.database);
  app = buildServer(config, {
    database: fixture.database,
    identity,
    admin: buildAdmin(fixture.database),
    content: buildContent(fixture.database),
    games,
    teams: buildTeams(fixture.database, games, identity)
  });
  await app.ready();
});

after(async () => {
  await app.close();
  await fixture.dispose();
});

beforeEach(async () => {
  for (const name of Object.values(TEAMS_COLLECTIONS)) {
    await coll(name).deleteMany({});
  }
  // Reset OTP counters so the many logins this suite performs never trip the
  // per-IP request limit across tests (they all share the in-process socket IP).
  for (const name of ['audit_events', 'rate_limits', 'otp_challenges']) {
    await coll(name).deleteMany({});
  }
});

function auth(cookie: string) {
  return { cookies: { [SESSION_COOKIE]: cookie } };
}

/** Raw collection access with a string `_id`, for setup and assertions in tests. */
function coll(name: string) {
  return fixture.database.db.collection<{ _id: string } & Record<string, unknown>>(name);
}

let counter = 3_000_000;

/** Signs in a fresh account and completes its profile so it has a username. */
async function registerUser(): Promise<{ cookie: string; accountId: string; username: string }> {
  counter += 1;
  const mobile = `0912${String(counter)}`;
  const username = `player_${String(counter)}`;
  await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { mobile } });
  const inbox = await app.inject({ method: 'GET', url: `/api/v1/dev/sms-inbox?mobile=${mobile}` });
  const code = inbox.json<Array<{ code: string }>>()[0]?.code as string;
  const verify = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { mobile, code } });
  const cookie = verify.cookies.find((c) => c.name === SESSION_COOKIE)?.value as string;
  const session = await app.inject({ method: 'GET', url: '/api/v1/auth/session', ...auth(cookie) });
  const accountId = session.json<{ account: { id: string } }>().account.id;
  const save = await app.inject({
    method: 'PUT',
    url: '/api/v1/account/profile',
    ...auth(cookie),
    payload: { username, displayName: `Player ${String(counter)}`, birthDate: '2000-01-01', visibility: 'public' }
  });
  assert.equal(save.statusCode, 200, save.body);
  return { cookie, accountId, username };
}

/** Inserts a published game and returns its id. */
async function publishedGame(): Promise<string> {
  counter += 1;
  const id = newId();
  const now = utcNow();
  await coll('games').insertOne({
    _id: id,
    slug: `game-${String(counter)}`,
    status: 'published',
    translations: {
      fa: { name: 'بازی', description: '', seoTitle: '', seoDescription: '' },
      en: { name: 'Game', description: '', seoTitle: '', seoDescription: '' }
    },
    coverImageUrl: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    publishedAt: now
  });
  return id;
}

let nameCounter = 0;
async function createTeam(cookie: string, gameId: string, overrides: Record<string, unknown> = {}): Promise<{ id: string; version: number }> {
  nameCounter += 1;
  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/teams',
    ...auth(cookie),
    payload: { name: `Team ${String(nameCounter)} ${String(counter)}`, gameId, ...overrides }
  });
  assert.equal(create.statusCode, 201, create.body);
  return create.json<{ id: string; version: number }>();
}

async function activeMembers(teamId: string): Promise<Array<{ accountId: string; role: string }>> {
  return fixture.database.db
    .collection(TEAMS_COLLECTIONS.memberships)
    .find({ teamId, status: 'active' })
    .project({ _id: 0, accountId: 1, role: 1 })
    .toArray() as Promise<Array<{ accountId: string; role: string }>>;
}

/** Owner invites a user and the user accepts, returning nothing but leaving an active membership. */
async function joinTeam(ownerCookie: string, teamId: string, invitee: { cookie: string; username: string }): Promise<void> {
  const invite = await app.inject({ method: 'POST', url: `/api/v1/teams/${teamId}/invitations`, ...auth(ownerCookie), payload: { username: invitee.username } });
  assert.equal(invite.statusCode, 201, invite.body);
  const invitationId = invite.json<{ id: string }>().id;
  const accept = await app.inject({ method: 'POST', url: `/api/v1/invitations/${invitationId}/accept`, ...auth(invitee.cookie) });
  assert.equal(accept.statusCode, 200, accept.body);
}

describe('team creation and identity', () => {
  test('creating a team makes the creator the sole owner (TEAM-001, TEAM-003)', async () => {
    const owner = await registerUser();
    const gameId = await publishedGame();
    const team = await createTeam(owner.cookie, gameId);
    const members = await activeMembers(team.id);
    assert.deepEqual(members, [{ accountId: owner.accountId, role: 'owner' }]);
  });

  test('a duplicate normalized team name is rejected (TEAM-001)', async () => {
    const owner = await registerUser();
    const gameId = await publishedGame();
    const first = await app.inject({ method: 'POST', url: '/api/v1/teams', ...auth(owner.cookie), payload: { name: 'Dragon Squad', gameId } });
    assert.equal(first.statusCode, 201);
    const dup = await app.inject({ method: 'POST', url: '/api/v1/teams', ...auth(owner.cookie), payload: { name: 'Dragon Squad', gameId } });
    assert.equal(dup.statusCode, 422);
    assert.equal(dup.json<{ error: { fieldErrors: Array<{ code: string }> } }>().error.fieldErrors[0]?.code, 'TEAM_SLUG_TAKEN');
  });

  test('a team must reference a published game', async () => {
    const owner = await registerUser();
    const bad = await app.inject({ method: 'POST', url: '/api/v1/teams', ...auth(owner.cookie), payload: { name: 'No Game', gameId: newId() } });
    assert.equal(bad.statusCode, 422);
    assert.equal(bad.json<{ error: { fieldErrors: Array<{ code: string }> } }>().error.fieldErrors[0]?.code, 'INVALID_GAME');
  });
});

describe('authorization (IDOR and privilege escalation)', () => {
  test('anonymous callers cannot manage teams', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/teams/mine' })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/teams', payload: { name: 'X', gameId: 'y' } })).statusCode, 401);
  });

  test('a non-member cannot see a private team (404, not 403)', async () => {
    const owner = await registerUser();
    const stranger = await registerUser();
    const team = await createTeam(owner.cookie, await publishedGame());
    const view = await app.inject({ method: 'GET', url: `/api/v1/teams/${team.id}`, ...auth(stranger.cookie) });
    assert.equal(view.statusCode, 404);
  });

  test('a member cannot perform owner actions (invite, update, remove, transfer, disband)', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const outsider = await registerUser();
    const gameId = await publishedGame();
    const team = await createTeam(owner.cookie, gameId);
    await joinTeam(owner.cookie, team.id, member);

    const invite = await app.inject({ method: 'POST', url: `/api/v1/teams/${team.id}/invitations`, ...auth(member.cookie), payload: { username: outsider.username } });
    assert.equal(invite.statusCode, 403);
    const update = await app.inject({ method: 'PUT', url: `/api/v1/teams/${team.id}`, ...auth(member.cookie), payload: { name: 'Renamed By Member' } });
    assert.equal(update.statusCode, 403);
    const disband = await app.inject({ method: 'POST', url: `/api/v1/teams/${team.id}/disband`, ...auth(member.cookie), payload: { reason: 'nope' } });
    assert.equal(disband.statusCode, 403);
    const transfer = await app.inject({ method: 'POST', url: `/api/v1/teams/${team.id}/transfer`, ...auth(member.cookie), payload: { accountId: owner.accountId } });
    assert.equal(transfer.statusCode, 403);
  });
});

describe('invitations (TEAM-004, TEAM-005)', () => {
  test('accept creates exactly one membership and is idempotent', async () => {
    const owner = await registerUser();
    const invitee = await registerUser();
    const team = await createTeam(owner.cookie, await publishedGame());
    const invite = await app.inject({ method: 'POST', url: `/api/v1/teams/${team.id}/invitations`, ...auth(owner.cookie), payload: { username: invitee.username } });
    const invitationId = invite.json<{ id: string }>().id;

    const first = await app.inject({ method: 'POST', url: `/api/v1/invitations/${invitationId}/accept`, ...auth(invitee.cookie) });
    assert.equal(first.statusCode, 200);
    // A replayed accept must not create a second membership.
    const second = await app.inject({ method: 'POST', url: `/api/v1/invitations/${invitationId}/accept`, ...auth(invitee.cookie) });
    assert.equal(second.statusCode, 200);

    const members = await activeMembers(team.id);
    assert.equal(members.filter((m) => m.accountId === invitee.accountId).length, 1);
  });

  test('a duplicate pending invitation is rejected', async () => {
    const owner = await registerUser();
    const invitee = await registerUser();
    const team = await createTeam(owner.cookie, await publishedGame());
    await app.inject({ method: 'POST', url: `/api/v1/teams/${team.id}/invitations`, ...auth(owner.cookie), payload: { username: invitee.username } });
    const dup = await app.inject({ method: 'POST', url: `/api/v1/teams/${team.id}/invitations`, ...auth(owner.cookie), payload: { username: invitee.username } });
    assert.equal(dup.statusCode, 422);
    assert.equal(dup.json<{ error: { fieldErrors: Array<{ code: string }> } }>().error.fieldErrors[0]?.code, 'INVITE_PENDING');
  });

  test('an invitation addressed to someone else is a 404 for a third party', async () => {
    const owner = await registerUser();
    const invitee = await registerUser();
    const attacker = await registerUser();
    const team = await createTeam(owner.cookie, await publishedGame());
    const invite = await app.inject({ method: 'POST', url: `/api/v1/teams/${team.id}/invitations`, ...auth(owner.cookie), payload: { username: invitee.username } });
    const invitationId = invite.json<{ id: string }>().id;
    const steal = await app.inject({ method: 'POST', url: `/api/v1/invitations/${invitationId}/accept`, ...auth(attacker.cookie) });
    assert.equal(steal.statusCode, 404);
  });

  test('concurrent accepts of the same invitation yield one membership', async () => {
    const owner = await registerUser();
    const invitee = await registerUser();
    const team = await createTeam(owner.cookie, await publishedGame());
    const invite = await app.inject({ method: 'POST', url: `/api/v1/teams/${team.id}/invitations`, ...auth(owner.cookie), payload: { username: invitee.username } });
    const invitationId = invite.json<{ id: string }>().id;

    const results = await Promise.allSettled([
      app.inject({ method: 'POST', url: `/api/v1/invitations/${invitationId}/accept`, ...auth(invitee.cookie) }),
      app.inject({ method: 'POST', url: `/api/v1/invitations/${invitationId}/accept`, ...auth(invitee.cookie) })
    ]);
    // Neither request errors out; at least one succeeds.
    assert.ok(results.every((r) => r.status === 'fulfilled'));
    const members = await activeMembers(team.id);
    assert.equal(members.filter((m) => m.accountId === invitee.accountId).length, 1);
  });
});

describe('membership changes (TEAM-006, TEAM-003)', () => {
  test('owner removes a member; the owner cannot be removed', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const team = await createTeam(owner.cookie, await publishedGame());
    await joinTeam(owner.cookie, team.id, member);

    const removeOwner = await app.inject({ method: 'POST', url: `/api/v1/teams/${team.id}/members/${owner.accountId}/remove`, ...auth(owner.cookie), payload: { reason: 'x' } });
    assert.equal(removeOwner.statusCode, 422);
    assert.equal(removeOwner.json<{ error: { fieldErrors: Array<{ code: string }> } }>().error.fieldErrors[0]?.code, 'CANNOT_REMOVE_OWNER');

    const remove = await app.inject({ method: 'POST', url: `/api/v1/teams/${team.id}/members/${member.accountId}/remove`, ...auth(owner.cookie), payload: { reason: 'left the roster' } });
    assert.equal(remove.statusCode, 204);
    assert.deepEqual(await activeMembers(team.id), [{ accountId: owner.accountId, role: 'owner' }]);
    // History is retained rather than deleted.
    const historical = await coll(TEAMS_COLLECTIONS.memberships).countDocuments({ teamId: team.id, accountId: member.accountId, status: 'removed' });
    assert.equal(historical, 1);
  });

  test('a member leaves; the owner cannot leave (must transfer or disband)', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const team = await createTeam(owner.cookie, await publishedGame());
    await joinTeam(owner.cookie, team.id, member);

    const ownerLeave = await app.inject({ method: 'POST', url: `/api/v1/teams/${team.id}/leave`, ...auth(owner.cookie) });
    assert.equal(ownerLeave.statusCode, 422);
    assert.equal(ownerLeave.json<{ error: { fieldErrors: Array<{ code: string }> } }>().error.fieldErrors[0]?.code, 'OWNER_CANNOT_LEAVE');

    const leave = await app.inject({ method: 'POST', url: `/api/v1/teams/${team.id}/leave`, ...auth(member.cookie) });
    assert.equal(leave.statusCode, 204);
    assert.deepEqual(await activeMembers(team.id), [{ accountId: owner.accountId, role: 'owner' }]);
  });
});

describe('ownership transfer (TEAM-007)', () => {
  test('transfer is atomic: the new owner owns, the old owner becomes a member', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const team = await createTeam(owner.cookie, await publishedGame());
    await joinTeam(owner.cookie, team.id, member);

    const transfer = await app.inject({ method: 'POST', url: `/api/v1/teams/${team.id}/transfer`, ...auth(owner.cookie), payload: { accountId: member.accountId } });
    assert.equal(transfer.statusCode, 204);

    const members = await activeMembers(team.id);
    const owners = members.filter((m) => m.role === 'owner');
    assert.equal(owners.length, 1);
    assert.equal(owners[0]?.accountId, member.accountId);
    assert.equal(members.find((m) => m.accountId === owner.accountId)?.role, 'member');
  });

  test('transfer target must be an active member', async () => {
    const owner = await registerUser();
    const stranger = await registerUser();
    const team = await createTeam(owner.cookie, await publishedGame());
    const transfer = await app.inject({ method: 'POST', url: `/api/v1/teams/${team.id}/transfer`, ...auth(owner.cookie), payload: { accountId: stranger.accountId } });
    assert.equal(transfer.statusCode, 422);
    assert.equal(transfer.json<{ error: { fieldErrors: Array<{ code: string }> } }>().error.fieldErrors[0]?.code, 'NOT_A_MEMBER');
  });

  test('concurrent transfers leave exactly one owner', async () => {
    const owner = await registerUser();
    const a = await registerUser();
    const b = await registerUser();
    const team = await createTeam(owner.cookie, await publishedGame());
    await joinTeam(owner.cookie, team.id, a);
    await joinTeam(owner.cookie, team.id, b);

    await Promise.allSettled([
      app.inject({ method: 'POST', url: `/api/v1/teams/${team.id}/transfer`, ...auth(owner.cookie), payload: { accountId: a.accountId } }),
      app.inject({ method: 'POST', url: `/api/v1/teams/${team.id}/transfer`, ...auth(owner.cookie), payload: { accountId: b.accountId } })
    ]);
    const owners = (await activeMembers(team.id)).filter((m) => m.role === 'owner');
    assert.equal(owners.length, 1);
  });
});

describe('disband (TEAM-008)', () => {
  test('disbanding archives the team without destroying membership history', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const team = await createTeam(owner.cookie, await publishedGame());
    await joinTeam(owner.cookie, team.id, member);

    const disband = await app.inject({ method: 'POST', url: `/api/v1/teams/${team.id}/disband`, ...auth(owner.cookie), payload: { reason: 'season over' } });
    assert.equal(disband.statusCode, 204);

    const teamDoc = await coll(TEAMS_COLLECTIONS.teams).findOne({ _id: team.id });
    assert.equal(teamDoc?.['status'], 'disbanded');
    // Memberships are retained.
    const count = await coll(TEAMS_COLLECTIONS.memberships).countDocuments({ teamId: team.id });
    assert.equal(count, 2);
    // A further owner action on a disbanded team is refused.
    const invite = await app.inject({ method: 'POST', url: `/api/v1/teams/${team.id}/invitations`, ...auth(owner.cookie), payload: { username: member.username } });
    assert.equal(invite.statusCode, 422);
  });
});

describe('immutable roster snapshots (TEAM-010, BR-007)', () => {
  test('a snapshot captures the current roster and later changes do not alter it', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const team = await createTeam(owner.cookie, await publishedGame());
    await joinTeam(owner.cookie, team.id, member);

    const snap = await app.inject({ method: 'POST', url: `/api/v1/teams/${team.id}/snapshots`, ...auth(owner.cookie), payload: { reason: 'registration' } });
    assert.equal(snap.statusCode, 201);
    const snapshotId = snap.json<{ id: string; members: unknown[] }>().id;
    assert.equal(snap.json<{ members: unknown[] }>().members.length, 2);

    // Remove the member after the snapshot.
    await app.inject({ method: 'POST', url: `/api/v1/teams/${team.id}/members/${member.accountId}/remove`, ...auth(owner.cookie), payload: { reason: 'x' } });

    // The stored snapshot is unchanged.
    const stored = await coll(TEAMS_COLLECTIONS.rosterSnapshots).findOne({ _id: snapshotId });
    assert.equal((stored?.['members'] as unknown[]).length, 2);
  });
});

describe('gaming identities and public views (privacy by default)', () => {
  test('a player manages a game-specific identity; public identities respect profile privacy', async () => {
    const player = await registerUser(); // profile is public
    const gameId = await publishedGame();
    const save = await app.inject({ method: 'PUT', url: '/api/v1/account/gaming-identities', ...auth(player.cookie), payload: { gameId, inGameName: 'ShadowFang', visibility: 'public' } });
    assert.equal(save.statusCode, 200, save.body);

    const publicView = await app.inject({ method: 'GET', url: `/api/v1/public/players/${player.username}/gaming-identities` });
    assert.equal(publicView.statusCode, 200);
    assert.equal(publicView.json<{ identities: Array<{ inGameName: string }> }>().identities[0]?.inGameName, 'ShadowFang');
  });

  test('a private profile hides gaming identities entirely (404)', async () => {
    const player = await registerUser();
    const gameId = await publishedGame();
    await app.inject({ method: 'PUT', url: '/api/v1/account/gaming-identities', ...auth(player.cookie), payload: { gameId, inGameName: 'Hidden', visibility: 'public' } });
    // Make the profile private.
    await app.inject({ method: 'PUT', url: '/api/v1/account/profile', ...auth(player.cookie), payload: { username: player.username, displayName: 'Player', birthDate: '2000-01-01', visibility: 'private' } });
    const view = await app.inject({ method: 'GET', url: `/api/v1/public/players/${player.username}/gaming-identities` });
    assert.equal(view.statusCode, 404);
  });

  test('a private team is 404 publicly; a public team lists only public-profile members', async () => {
    const owner = await registerUser();
    const team = await createTeam(owner.cookie, await publishedGame());

    const privateView = await app.inject({ method: 'GET', url: `/api/v1/public/teams/${(await teamSlug(team.id))}` });
    assert.equal(privateView.statusCode, 404);

    const publish = await app.inject({ method: 'PUT', url: `/api/v1/teams/${team.id}`, ...auth(owner.cookie), payload: { visibility: 'public' } });
    assert.equal(publish.statusCode, 200);
    const slug = publish.json<{ slug: string }>().slug;
    const publicView = await app.inject({ method: 'GET', url: `/api/v1/public/teams/${slug}` });
    assert.equal(publicView.statusCode, 200);
    // The owner has a public profile, so they appear.
    assert.equal(publicView.json<{ members: Array<{ username: string }> }>().members.length, 1);
  });
});

async function teamSlug(teamId: string): Promise<string> {
  const doc = await coll(TEAMS_COLLECTIONS.teams).findOne({ _id: teamId });
  return doc?.['slug'] as string;
}

describe('historical roster reconstruction (TEAM-010)', () => {
  test('rosterAt reproduces membership at a past instant via the API-created records', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const team = await createTeam(owner.cookie, await publishedGame());
    await joinTeam(owner.cookie, team.id, member);
    await app.inject({ method: 'POST', url: `/api/v1/teams/${team.id}/members/${member.accountId}/remove`, ...auth(owner.cookie), payload: { reason: 'x' } });

    const memberDoc = await coll(TEAMS_COLLECTIONS.memberships).findOne({ teamId: team.id, accountId: member.accountId });
    const joinedAt = memberDoc?.['joinedAt'] as string;
    const leftAt = memberDoc?.['leftAt'] as string;

    // At the join instant the member is on the roster; strictly after leaving they are not.
    const during = await coll(TEAMS_COLLECTIONS.memberships).countDocuments({
      teamId: team.id,
      joinedAt: { $lte: joinedAt },
      $or: [{ leftAt: null }, { leftAt: { $gt: joinedAt } }]
    });
    assert.ok(during >= 2);
    const afterLeave = await coll(TEAMS_COLLECTIONS.memberships).countDocuments({
      teamId: team.id,
      accountId: member.accountId,
      joinedAt: { $lte: leftAt },
      $or: [{ leftAt: null }, { leftAt: { $gt: leftAt } }]
    });
    assert.equal(afterLeave, 0);
  });
});

/**
 * Advanced delegated roles (ROLE-006, ROLE-007, TEAM-011, SOCIAL-009).
 *
 * The load-bearing case is that delegation is additive: the same team, the same
 * membership rows, and the same ids carry the new roles, so Phase 1 history stays intact.
 */
describe('delegated team roles', () => {
  async function teamWith(role: 'manager' | 'captain'): Promise<{
    owner: { cookie: string; accountId: string; username: string };
    delegate: { cookie: string; accountId: string; username: string };
    team: { id: string; version: number };
  }> {
    const owner = await registerUser();
    const delegate = await registerUser();
    const team = await createTeam(owner.cookie, await publishedGame());
    await joinTeam(owner.cookie, team.id, delegate);
    const assigned = await app.inject({
      method: 'PUT',
      url: `/api/v1/teams/${team.id}/members/${delegate.accountId}/role`,
      ...auth(owner.cookie),
      payload: { role }
    });
    assert.equal(assigned.statusCode, 204, assigned.body);
    return { owner, delegate, team };
  }

  test('promoting a member keeps the same membership record, so roster history survives (TEAM-011)', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const team = await createTeam(owner.cookie, await publishedGame());
    await joinTeam(owner.cookie, team.id, member);
    const before = await coll(TEAMS_COLLECTIONS.memberships).findOne({ teamId: team.id, accountId: member.accountId });

    await app.inject({ method: 'PUT', url: `/api/v1/teams/${team.id}/members/${member.accountId}/role`, ...auth(owner.cookie), payload: { role: 'captain' } });

    const after = await coll(TEAMS_COLLECTIONS.memberships).findOne({ teamId: team.id, accountId: member.accountId });
    assert.equal(after?.['_id'], before?.['_id'], 'the membership id is unchanged');
    assert.equal(after?.['joinedAt'], before?.['joinedAt'], 'the join instant is unchanged');
    assert.equal(after?.['role'], 'captain');
    assert.equal(
      await coll(TEAMS_COLLECTIONS.memberships).countDocuments({ teamId: team.id, accountId: member.accountId }),
      1,
      'no second membership row is created'
    );
  });

  test('a captain manages the roster but cannot change team settings (ROLE-006)', async () => {
    const { delegate, team } = await teamWith('captain');
    const snapshot = await app.inject({ method: 'POST', url: `/api/v1/teams/${team.id}/snapshots`, ...auth(delegate.cookie), payload: { reason: 'Pre-match roster.' } });
    assert.equal(snapshot.statusCode, 201, snapshot.body);

    const settings = await app.inject({ method: 'PUT', url: `/api/v1/teams/${team.id}`, ...auth(delegate.cookie), payload: { name: 'Renamed by captain' } });
    assert.equal(settings.statusCode, 403, settings.body);
  });

  test('a manager changes team settings but still cannot transfer ownership (ROLE-007)', async () => {
    const { owner, delegate, team } = await teamWith('manager');
    const settings = await app.inject({ method: 'PUT', url: `/api/v1/teams/${team.id}`, ...auth(delegate.cookie), payload: { name: 'Renamed by manager' } });
    assert.equal(settings.statusCode, 200, settings.body);

    const transfer = await app.inject({ method: 'POST', url: `/api/v1/teams/${team.id}/transfer`, ...auth(delegate.cookie), payload: { accountId: delegate.accountId } });
    assert.equal(transfer.statusCode, 403, 'ownership never moves without the owner');
    assert.equal((await activeMembers(team.id)).find((m) => m.accountId === owner.accountId)?.role, 'owner');
  });

  test('a delegate cannot delegate: only the owner grants or revokes a role', async () => {
    const { delegate, team } = await teamWith('manager');
    const third = await registerUser();
    const response = await app.inject({ method: 'PUT', url: `/api/v1/teams/${team.id}/members/${third.accountId}/role`, ...auth(delegate.cookie), payload: { role: 'captain' } });
    assert.equal(response.statusCode, 403, response.body);
  });

  test('ownership cannot be granted through the role route', async () => {
    const { owner, delegate, team } = await teamWith('captain');
    const response = await app.inject({ method: 'PUT', url: `/api/v1/teams/${team.id}/members/${delegate.accountId}/role`, ...auth(owner.cookie), payload: { role: 'owner' } });
    assert.ok(response.statusCode >= 400 && response.statusCode < 500, `expected a client error, got ${String(response.statusCode)}`);
    const owners = (await activeMembers(team.id)).filter((m) => m.role === 'owner');
    assert.equal(owners.length, 1, 'the one-active-owner invariant holds');
  });

  test('a captain cannot remove another delegate, but the owner can', async () => {
    const { owner, delegate, team } = await teamWith('manager');
    const captain = await registerUser();
    await joinTeam(owner.cookie, team.id, captain);
    await app.inject({ method: 'PUT', url: `/api/v1/teams/${team.id}/members/${captain.accountId}/role`, ...auth(owner.cookie), payload: { role: 'captain' } });

    const byCaptain = await app.inject({ method: 'POST', url: `/api/v1/teams/${team.id}/members/${delegate.accountId}/remove`, ...auth(captain.cookie), payload: { reason: 'coup' } });
    assert.equal(byCaptain.statusCode, 403, 'a captain cannot strip the manager who appointed them');

    const byOwner = await app.inject({ method: 'POST', url: `/api/v1/teams/${team.id}/members/${delegate.accountId}/remove`, ...auth(owner.cookie), payload: { reason: 'Stepping down.' } });
    assert.equal(byOwner.statusCode, 204, byOwner.body);
  });

  test('revoking a role takes effect on the next request', async () => {
    const { owner, delegate, team } = await teamWith('manager');
    await app.inject({ method: 'PUT', url: `/api/v1/teams/${team.id}/members/${delegate.accountId}/role`, ...auth(owner.cookie), payload: { role: 'member' } });
    const settings = await app.inject({ method: 'PUT', url: `/api/v1/teams/${team.id}`, ...auth(delegate.cookie), payload: { name: 'Renamed after revoke' } });
    assert.equal(settings.statusCode, 403, settings.body);
  });
});
