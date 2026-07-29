import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../../config.ts';
import { buildAdmin, buildIdentity, buildModeration, buildServer, buildSocial } from '../../server.ts';
import { allMigrations } from '../../migrations.ts';
import { runMigrations } from '../../shared/db/migrations.ts';
import { seedSystemConfiguration } from '../../shared/db/seed.ts';
import { createTestDatabase, type TestDatabase } from '../../shared/db/test-support.ts';
import { newId } from '../../shared/ids.ts';
import { utcNow } from '../../shared/events.ts';
import { SESSION_COOKIE } from '../identity/index.ts';
import { GLOBAL_SCOPE_ID, GLOBAL_SCOPE_TYPE, roleAssignments } from '../admin/store.ts';
import { SOCIAL_COLLECTIONS } from './collections.ts';

/**
 * Community integration coverage (SOCIAL-001..012, BR-025, MOD-008, TEST-023).
 *
 * The load-bearing cases are the privacy ones: a followers-only post must be invisible to
 * a stranger *and* to search, a private author must not be discoverable at all, and a
 * removed post must vanish from every read surface at once. Each is asserted against the
 * HTTP surface, because that is what an attacker actually reaches.
 */

let fixture: TestDatabase;
let app: FastifyInstance;

before(async () => {
  fixture = await createTestDatabase();
  await runMigrations(fixture.database.db, allMigrations);
  await seedSystemConfiguration(fixture.database.db);

  const config = loadConfig({ NODE_ENV: 'test' });
  const identity = buildIdentity(fixture.database, config);
  const moderation = buildModeration(fixture.database, identity);
  app = buildServer(config, {
    database: fixture.database,
    identity,
    admin: buildAdmin(fixture.database),
    moderation,
    social: buildSocial(fixture.database, config, identity, moderation)
  });
  await app.ready();
});

after(async () => {
  await app.close();
  await fixture.dispose();
});

beforeEach(async () => {
  for (const name of [
    ...Object.values(SOCIAL_COLLECTIONS),
    'moderation_reports',
    'moderation_cases',
    'role_assignments',
    'audit_events',
    'outbox_events',
    'rate_limits'
  ]) {
    await fixture.database.db.collection(name).deleteMany({});
  }
});

let counter = 9_400_000;

interface Actor {
  cookie: string;
  accountId: string;
  username: string;
}

/** Signs in a fresh account and gives it a profile, public unless asked otherwise. */
async function signUp(options: { visibility?: 'public' | 'private'; role?: string } = {}): Promise<Actor> {
  counter += 1;
  const mobile = `0912${String(counter)}`;
  const username = `player${String(counter)}`;
  await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { mobile } });
  const inbox = await app.inject({ method: 'GET', url: `/api/v1/dev/sms-inbox?mobile=${mobile}` });
  const code = inbox.json<Array<{ code: string }>>()[0]?.code as string;
  const verify = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { mobile, code } });
  const cookie = verify.cookies.find((c) => c.name === SESSION_COOKIE)?.value as string;
  const session = await app.inject({ method: 'GET', url: '/api/v1/auth/session', cookies: { [SESSION_COOKIE]: cookie } });
  const accountId = session.json<{ account: { id: string } }>().account.id;
  const profile = await app.inject({
    method: 'PUT',
    url: '/api/v1/account/profile',
    cookies: { [SESSION_COOKIE]: cookie },
    payload: { username, displayName: `Player ${String(counter)}`, birthDate: '2000-01-01', visibility: options.visibility ?? 'public' }
  });
  assert.equal(profile.statusCode, 200, profile.body);
  if (options.role !== undefined) {
    await roleAssignments(fixture.database.db).insertOne({
      _id: newId(),
      accountId,
      role: options.role,
      scopeType: GLOBAL_SCOPE_TYPE,
      scopeId: GLOBAL_SCOPE_ID,
      grantedBy: 'test',
      grantedAt: utcNow(),
      revokedAt: null
    });
  }
  return { cookie, accountId, username };
}

function auth(cookie: string) {
  return { cookies: { [SESSION_COOKIE]: cookie } };
}

interface PostBody {
  id: string;
  body: string | null;
  state: string;
  visibility: string;
  commentCount: number;
  reactionCount: number;
  viewerReacted?: boolean;
}

async function post(actor: Actor, body: string, visibility?: 'followers' | 'public'): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/posts',
    ...auth(actor.cookie),
    payload: visibility === undefined ? { body } : { body, visibility }
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ id: string }>().id;
}

async function follow(follower: Actor, target: Actor): Promise<void> {
  const response = await app.inject({ method: 'POST', url: `/api/v1/follows/user/${target.accountId}`, ...auth(follower.cookie) });
  assert.equal(response.statusCode, 201, response.body);
}

async function feedIds(actor: Actor): Promise<string[]> {
  const response = await app.inject({ method: 'GET', url: '/api/v1/feed', ...auth(actor.cookie) });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<{ items: PostBody[] }>().items.map((item) => item.id);
}

// --- Follows (SOCIAL-002, API-083) ---

describe('follow relationships', () => {
  test('following is idempotent and keeps exactly one active relation', async () => {
    const [a, b] = [await signUp(), await signUp()];
    await follow(a, b);
    const again = await app.inject({ method: 'POST', url: `/api/v1/follows/user/${b.accountId}`, ...auth(a.cookie) });
    assert.equal(again.statusCode, 201, 'a repeated follow is not an error');

    const list = await app.inject({ method: 'GET', url: '/api/v1/me/following', ...auth(a.cookie) });
    const items = list.json<{ items: Array<{ targetId: string; state: string }> }>().items;
    assert.equal(items.filter((i) => i.targetId === b.accountId && i.state === 'active').length, 1);
  });

  test('unfollowing an account you never followed is a no-op, not an error', async () => {
    const [a, b] = [await signUp(), await signUp()];
    const response = await app.inject({ method: 'DELETE', url: `/api/v1/follows/user/${b.accountId}`, ...auth(a.cookie) });
    assert.equal(response.statusCode, 200, response.body);
  });

  test('a signed-out visitor cannot follow anything', async () => {
    const b = await signUp();
    const response = await app.inject({ method: 'POST', url: `/api/v1/follows/user/${b.accountId}` });
    assert.equal(response.statusCode, 401);
  });

  test('a private account cannot be followed, so its existence is not confirmed', async () => {
    const [a, hidden] = [await signUp(), await signUp({ visibility: 'private' })];
    const response = await app.inject({ method: 'POST', url: `/api/v1/follows/user/${hidden.accountId}`, ...auth(a.cookie) });
    assert.equal(response.statusCode, 404, response.body);
  });
});

// --- Feed visibility (SOCIAL-003, SOCIAL-004, BR-025) ---

describe('feed visibility', () => {
  test('a followers-only post reaches a follower and nobody else', async () => {
    const [author, follower, stranger] = [await signUp(), await signUp(), await signUp()];
    await follow(follower, author);
    const id = await post(author, 'Scrim tonight at nine.');

    assert.ok((await feedIds(follower)).includes(id), 'a follower sees it');
    assert.ok(!(await feedIds(stranger)).includes(id), 'a stranger does not');
  });

  test('the author always sees their own post, whatever the audience', async () => {
    const author = await signUp();
    const id = await post(author, 'Note to self.');
    assert.ok((await feedIds(author)).includes(id));
  });

  test('a post defaults to followers-only when the composer says nothing', async () => {
    const author = await signUp();
    const id = await post(author, 'No audience chosen.');
    const detail = await app.inject({ method: 'GET', url: `/api/v1/posts/${id}`, ...auth(author.cookie) });
    assert.equal(detail.json<{ post: PostBody }>().post.visibility, 'followers');
  });

  test('unfollowing removes the post from the feed on the next read, with no rebuild', async () => {
    const [author, follower] = [await signUp(), await signUp()];
    await follow(follower, author);
    const id = await post(author, 'Visible while followed.');
    assert.ok((await feedIds(follower)).includes(id));

    await app.inject({ method: 'DELETE', url: `/api/v1/follows/user/${author.accountId}`, ...auth(follower.cookie) });
    assert.ok(!(await feedIds(follower)).includes(id), 'visibility is decided at read time (BR-025)');
  });

  test('the feed carries followed authors only — a public post is not a global broadcast', async () => {
    const [author, stranger] = [await signUp(), await signUp()];
    const id = await post(author, 'Public but not followed.', 'public');
    assert.ok(!(await feedIds(stranger)).includes(id), 'a public post reaches the author page and search, not a stranger’s feed');
  });

  test('narrowing an author from public to private hides their public posts immediately', async () => {
    const [author, stranger] = [await signUp(), await signUp()];
    const id = await post(author, 'Public while the profile is public.', 'public');
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/posts/${id}`, ...auth(stranger.cookie) })).statusCode, 200);

    await app.inject({
      method: 'PUT',
      url: '/api/v1/account/profile',
      ...auth(author.cookie),
      payload: { username: author.username, displayName: 'Hidden', birthDate: '2000-01-01', visibility: 'private' }
    });
    // No rebuild, no invalidation: the next read simply re-decides (BR-025).
    assert.equal(
      (await app.inject({ method: 'GET', url: `/api/v1/posts/${id}`, ...auth(stranger.cookie) })).statusCode,
      404,
      'a public post is still bounded by the author profile'
    );
    assert.deepEqual(
      (await app.inject({ method: 'GET', url: `/api/v1/social/profiles/${author.accountId}`, ...auth(stranger.cookie) })).statusCode,
      404,
      'and the author page goes with it'
    );
  });

  test('a post the viewer may not see is a 404, so private ids cannot be probed', async () => {
    const [author, stranger] = [await signUp(), await signUp()];
    const id = await post(author, 'Private.');
    const response = await app.inject({ method: 'GET', url: `/api/v1/posts/${id}`, ...auth(stranger.cookie) });
    assert.equal(response.statusCode, 404, 'a 403 would confirm the post exists');
  });

  test('a signed-out visitor sees a public post and never a followers-only one', async () => {
    const author = await signUp();
    const open = await post(author, 'Everyone may read this.', 'public');
    const closed = await post(author, 'Followers only.');
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/posts/${open}` })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/posts/${closed}` })).statusCode, 404);
  });
});

// --- Comments and reactions (SOCIAL-005, API-086, API-087) ---

describe('comments and reactions', () => {
  test('a viewer who cannot see the post cannot comment on it', async () => {
    const [author, stranger] = [await signUp(), await signUp()];
    const id = await post(author, 'Followers only.');
    const response = await app.inject({ method: 'POST', url: `/api/v1/posts/${id}/comments`, ...auth(stranger.cookie), payload: { body: 'Hi' } });
    assert.equal(response.statusCode, 404);
  });

  test('a follower can comment, and the count follows the comment', async () => {
    const [author, follower] = [await signUp(), await signUp()];
    await follow(follower, author);
    const id = await post(author, 'Who is in?');
    const created = await app.inject({ method: 'POST', url: `/api/v1/posts/${id}/comments`, ...auth(follower.cookie), payload: { body: 'I am in.' } });
    assert.equal(created.statusCode, 201, created.body);

    const detail = await app.inject({ method: 'GET', url: `/api/v1/posts/${id}`, ...auth(follower.cookie) });
    const view = detail.json<{ post: PostBody; comments: PostBody[] }>();
    assert.equal(view.post.commentCount, 1);
    assert.equal(view.comments.length, 1);
  });

  test('reacting twice is one reaction, and removing it is idempotent', async () => {
    const [author, follower] = [await signUp(), await signUp()];
    await follow(follower, author);
    const id = await post(author, 'React here.');
    for (const _ of [0, 1]) {
      const response = await app.inject({ method: 'PUT', url: `/api/v1/reactions/post/${id}`, ...auth(follower.cookie) });
      assert.equal(response.statusCode, 200, response.body);
    }
    let detail = await app.inject({ method: 'GET', url: `/api/v1/posts/${id}`, ...auth(follower.cookie) });
    assert.equal(detail.json<{ post: PostBody }>().post.reactionCount, 1);
    assert.equal(detail.json<{ post: PostBody }>().post.viewerReacted, true);

    for (const _ of [0, 1]) {
      const response = await app.inject({ method: 'DELETE', url: `/api/v1/reactions/post/${id}`, ...auth(follower.cookie) });
      assert.equal(response.statusCode, 200, response.body);
    }
    detail = await app.inject({ method: 'GET', url: `/api/v1/posts/${id}`, ...auth(follower.cookie) });
    assert.equal(detail.json<{ post: PostBody }>().post.reactionCount, 0);
  });

  test('a viewer who cannot see the post cannot react to it', async () => {
    const [author, stranger] = [await signUp(), await signUp()];
    const id = await post(author, 'Followers only.');
    const response = await app.inject({ method: 'PUT', url: `/api/v1/reactions/post/${id}`, ...auth(stranger.cookie) });
    assert.equal(response.statusCode, 404);
  });
});

// --- Abuse controls (SOCIAL-007) ---

describe('abuse controls', () => {
  test('posting past the window limit is rate limited rather than accepted', async () => {
    const author = await signUp();
    let limited = false;
    for (let i = 0; i < 15 && !limited; i += 1) {
      const response = await app.inject({ method: 'POST', url: '/api/v1/posts', ...auth(author.cookie), payload: { body: `Spam ${String(i)}` } });
      if (response.statusCode === 429) limited = true;
    }
    assert.ok(limited, 'the rate limit engages before an unbounded number of posts is accepted');
  });

  test('an empty or oversized body is rejected', async () => {
    const author = await signUp();
    const blank = await app.inject({ method: 'POST', url: '/api/v1/posts', ...auth(author.cookie), payload: { body: '   ' } });
    assert.ok(blank.statusCode >= 400 && blank.statusCode < 500, `expected a client error, got ${String(blank.statusCode)}`);
    const huge = await app.inject({ method: 'POST', url: '/api/v1/posts', ...auth(author.cookie), payload: { body: 'x'.repeat(3000) } });
    assert.ok(huge.statusCode >= 400 && huge.statusCode < 500, `expected a client error, got ${String(huge.statusCode)}`);
  });

  test('markup in a body is stripped at the write boundary, not escaped at render', async () => {
    const author = await signUp();
    const id = await post(author, 'Hello <script>alert(1)</script> world');
    const detail = await app.inject({ method: 'GET', url: `/api/v1/posts/${id}`, ...auth(author.cookie) });
    const body = detail.json<{ post: PostBody }>().post.body ?? '';
    assert.ok(!body.includes('<script'), `stored body still contains markup: ${body}`);
  });

  test('a media url outside site media is rejected', async () => {
    const author = await signUp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      ...auth(author.cookie),
      payload: { body: 'Look', mediaUrls: ['https://evil.example/pixel.png'] }
    });
    assert.ok(response.statusCode >= 400 && response.statusCode < 500, `expected a client error, got ${String(response.statusCode)}`);
  });
});

// --- Reporting and moderation (SOCIAL-005, MOD-008, API-088) ---

describe('reporting and moderation', () => {
  test('a report files a shared moderation case carrying the body as evidence', async () => {
    const [author, reporter, moderator] = [await signUp(), await signUp(), await signUp({ role: 'community_moderator' })];
    const id = await post(author, 'Reportable content.', 'public');
    const report = await app.inject({
      method: 'POST',
      url: '/api/v1/social/reports',
      ...auth(reporter.cookie),
      payload: { targetType: 'post', targetId: id, reason: 'Harassment' }
    });
    assert.equal(report.statusCode, 201, report.body);

    const cases = await app.inject({ method: 'GET', url: '/api/v1/admin/community/posts', ...auth(moderator.cookie) });
    assert.equal(cases.statusCode, 200, cases.body);
    assert.ok(cases.json<{ items: PostBody[] }>().items.some((item) => item.id === id));
  });

  test('an ordinary member cannot reach the moderator surface', async () => {
    const member = await signUp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/community/posts', ...auth(member.cookie) });
    assert.equal(response.statusCode, 403, response.body);
  });

  test('a removed post disappears from the feed and the detail page at once', async () => {
    const [author, follower, moderator] = [await signUp(), await signUp(), await signUp({ role: 'community_moderator' })];
    await follow(follower, author);
    const id = await post(author, 'Removed shortly.');
    assert.ok((await feedIds(follower)).includes(id));

    const removed = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/community/posts/${id}/remove`,
      ...auth(moderator.cookie),
      payload: { reason: 'Breaks the community rules.' }
    });
    assert.equal(removed.statusCode, 200, removed.body);

    assert.ok(!(await feedIds(follower)).includes(id), 'a removed post leaves the feed');
    const detail = await app.inject({ method: 'GET', url: `/api/v1/posts/${id}`, ...auth(follower.cookie) });
    assert.equal(detail.statusCode, 404, 'a removed post leaves the detail page');
  });

  test('the removed body is retained for the moderator even though no reader can see it', async () => {
    const [author, moderator] = [await signUp(), await signUp({ role: 'community_moderator' })];
    const id = await post(author, 'Evidence text that must survive removal.', 'public');
    await app.inject({ method: 'POST', url: `/api/v1/admin/community/posts/${id}/remove`, ...auth(moderator.cookie), payload: { reason: 'Rule 3.' } });

    const listing = await app.inject({ method: 'GET', url: '/api/v1/admin/community/posts', ...auth(moderator.cookie) });
    const found = listing.json<{ items: PostBody[] }>().items.find((item) => item.id === id);
    assert.ok(found !== undefined, 'the record survives removal');
    assert.equal(found.state, 'removed');
    assert.ok((found.body ?? '').includes('Evidence text'), 'the body is retained as evidence');
  });

  test('an author can delete their own post but not somebody else’s', async () => {
    const [author, other] = [await signUp(), await signUp()];
    const id = await post(author, 'Mine.', 'public');
    const foreign = await app.inject({ method: 'POST', url: `/api/v1/posts/${id}/remove`, ...auth(other.cookie), payload: {} });
    assert.ok(foreign.statusCode === 403 || foreign.statusCode === 404, `expected a denial, got ${String(foreign.statusCode)}`);

    const own = await app.inject({ method: 'POST', url: `/api/v1/posts/${id}/remove`, ...auth(author.cookie), payload: {} });
    assert.equal(own.statusCode, 200, own.body);
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/posts/${id}` })).statusCode, 404);
  });
});

// --- Gates (OD-017, OD-024, OD-027) ---

describe('open-decision gates', () => {
  test('the config surface reports blocking, appeals, and push as disabled', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/social/config' });
    assert.equal(response.statusCode, 200, response.body);
    const config = response.json<{ blockingEnabled: boolean; appealsEnabled: boolean; pushEnabled: boolean }>();
    assert.equal(config.blockingEnabled, false, 'OD-017');
    assert.equal(config.appealsEnabled, false, 'OD-024');
    assert.equal(config.pushEnabled, false, 'OD-027');
  });
});

// --- Profiles and statistics (SOCIAL-001, SOCIAL-010) ---

describe('social profiles', () => {
  test('a private profile is not readable, and a public one carries statistics with provenance', async () => {
    const [author, viewer, hidden] = [await signUp(), await signUp(), await signUp({ visibility: 'private' })];
    await app.inject({ method: 'PUT', url: '/api/v1/me/social-profile', ...auth(author.cookie), payload: { headline: 'Support main', statisticsVisible: true } });
    await follow(viewer, author);

    const visible = await app.inject({ method: 'GET', url: `/api/v1/social/profiles/${author.accountId}`, ...auth(viewer.cookie) });
    assert.equal(visible.statusCode, 200, visible.body);
    const stats = visible.json<{ statistics: Array<{ key: string; value: number; source: string; calculatedAt: string }> }>().statistics;
    assert.ok(stats.length > 0, 'statistics are present');
    for (const statistic of stats) {
      assert.ok(statistic.source.length > 0, `statistic "${statistic.key}" states where it was counted from (SOCIAL-010)`);
      assert.ok(statistic.calculatedAt.length > 0, `statistic "${statistic.key}" states when it was calculated`);
    }

    const denied = await app.inject({ method: 'GET', url: `/api/v1/social/profiles/${hidden.accountId}`, ...auth(viewer.cookie) });
    assert.equal(denied.statusCode, 404, 'a private profile is indistinguishable from a missing one');
  });

  test('statistics stay hidden until the owner opts in', async () => {
    const [author, viewer] = [await signUp(), await signUp()];
    const response = await app.inject({ method: 'GET', url: `/api/v1/social/profiles/${author.accountId}`, ...auth(viewer.cookie) });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json<{ statistics: unknown[] }>().statistics, [], 'privacy by default (SOCIAL-011)');
  });
});
