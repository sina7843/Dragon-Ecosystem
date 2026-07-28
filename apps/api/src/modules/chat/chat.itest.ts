import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../../config.ts';
import { buildAdmin, buildChat, buildIdentity, buildModeration, buildServer } from '../../server.ts';
import { allMigrations } from '../../migrations.ts';
import { runMigrations } from '../../shared/db/migrations.ts';
import { seedSystemConfiguration } from '../../shared/db/seed.ts';
import { createTestDatabase, type TestDatabase } from '../../shared/db/test-support.ts';
import { newId } from '../../shared/ids.ts';
import { utcNow } from '../../shared/events.ts';
import { SESSION_COOKIE } from '../identity/index.ts';
import { GLOBAL_SCOPE_ID, GLOBAL_SCOPE_TYPE, roleAssignments } from '../admin/store.ts';
import { LocalStubStreamingProvider, StreamsService } from '../streams/index.ts';
import type { ChatMessageRecord } from './state.ts';

/**
 * Live chat integration coverage (CHAT-001..008, TEST-021).
 *
 * TEST-021 requires ordering, duplicate delivery, rate limit, timeout, ban, and report
 * evidence; each has a test below. The security cases are that chat moderation never
 * reaches the shared identity boundary, and that a room-scoped moderator cannot act
 * outside their room.
 */

let fixture: TestDatabase;
let app: FastifyInstance;
let streamsService: StreamsService;

before(async () => {
  fixture = await createTestDatabase();
  await runMigrations(fixture.database.db, allMigrations);
  await seedSystemConfiguration(fixture.database.db);

  const config = loadConfig({ NODE_ENV: 'test' });
  const identity = buildIdentity(fixture.database, config);
  const moderation = buildModeration(fixture.database, identity);
  streamsService = new StreamsService(
    fixture.database,
    new LocalStubStreamingProvider('chat-itest-secure-link-secret'),
    { rightsPolicyApproved: false, playbackTtlSeconds: 300 },
    { async raise() { /* alerts are covered by the streams suite */ } }
  );
  const streams = { service: streamsService };
  app = buildServer(config, {
    database: fixture.database,
    identity,
    admin: buildAdmin(fixture.database),
    moderation,
    streams,
    chat: buildChat(fixture.database, streams, moderation)
  });
  await app.ready();
});

after(async () => {
  await app.close();
  await fixture.dispose();
});

beforeEach(async () => {
  for (const name of [
    'chat_rooms',
    'chat_messages',
    'chat_restrictions',
    'streams',
    'moderation_reports',
    'moderation_cases',
    'role_assignments',
    'audit_events',
    'rate_limits'
  ]) {
    await fixture.database.db.collection(name).deleteMany({});
  }
});

let counter = 9_100_000;
async function loginAs(role?: string, scope?: { type: string; id: string }): Promise<{ cookie: string; accountId: string }> {
  counter += 1;
  const mobile = `0912${String(counter)}`;
  await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { mobile } });
  const inbox = await app.inject({ method: 'GET', url: `/api/v1/dev/sms-inbox?mobile=${mobile}` });
  const code = inbox.json<Array<{ code: string }>>()[0]?.code as string;
  const verify = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { mobile, code } });
  const cookie = verify.cookies.find((c) => c.name === SESSION_COOKIE)?.value as string;
  const session = await app.inject({ method: 'GET', url: '/api/v1/auth/session', cookies: { [SESSION_COOKIE]: cookie } });
  const accountId = session.json<{ account: { id: string } }>().account.id;
  if (role !== undefined) {
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
  return { cookie, accountId };
}

function auth(cookie: string) {
  return { cookies: { [SESSION_COOKIE]: cookie } };
}

interface RoomView {
  id: string;
  streamId: string;
  state: string;
  version: number;
}
interface MessageView {
  id: string;
  sequence: number;
  senderId: string;
  state: string;
  body: string | null;
}
interface Feed {
  roomId: string;
  roomState: string;
  lastSequence: number;
  items: MessageView[];
}

/**
 * Stream operations run as a stand-in operator account. Rights confirmation records who
 * approved the broadcast, so it needs a real actor rather than an anonymous system one.
 */
const OPERATOR_ID = newId();
const operatorContext = (label: string) => ({
  correlationId: `chat-itest-${label}`,
  actor: { kind: 'account' as const, accountId: OPERATOR_ID, roles: [] as readonly string[] }
});

/** Creates a live stream directly through the service, bypassing the operator HTTP surface. */
async function liveStream(accessMode: 'public' | 'authenticated' = 'public'): Promise<string> {
  const context = operatorContext(String(counter));
  let stream = await streamsService.create(context, {
    slug: `chat-stream-${newId().slice(0, 8)}`,
    accessMode,
    scheduledStartAt: '2026-09-01T18:00:00.000Z',
    translations: { fa: { title: 'پخش گفت‌وگو' }, en: { title: 'Chat stream' } }
  });
  stream = await streamsService.confirmRights(context, stream._id, { expectedVersion: stream.version, reference: 'RIGHTS-CHAT' });
  stream = await streamsService.provision(context, stream._id);
  stream = await streamsService.setState(context, stream._id, 'scheduled', { expectedVersion: stream.version, reason: 'Publishing.' });
  stream = await streamsService.setState(context, stream._id, 'live', { expectedVersion: stream.version, reason: 'Going live.' });
  return stream._id;
}

async function openRoom(cookie: string, streamId: string): Promise<RoomView> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/admin/chat/rooms', payload: { streamId }, ...auth(cookie) });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<RoomView>();
}

async function send(cookie: string, streamId: string, body: string, clientMessageId = newId()) {
  return app.inject({ method: 'POST', url: `/api/v1/streams/${streamId}/chat/messages`, payload: { body, clientMessageId }, ...auth(cookie) });
}

describe('rooms and access (CHAT-001)', () => {
  test('a room cannot be opened for a stream that is not publicly readable', async () => {
    const { cookie } = await loginAs('live_chat_moderator');
    const draft = await streamsService.create(operatorContext('draft'), { slug: `draft-${newId().slice(0, 8)}`, translations: { en: { title: 'Draft' } } });

    const response = await app.inject({ method: 'POST', url: '/api/v1/admin/chat/rooms', payload: { streamId: draft._id }, ...auth(cookie) });
    assert.equal(response.statusCode, 404);
    const unknown = await app.inject({ method: 'POST', url: '/api/v1/admin/chat/rooms', payload: { streamId: newId() }, ...auth(cookie) });
    assert.equal(unknown.statusCode, 404);
  });

  test('opening a room twice converges on one room', async () => {
    const { cookie } = await loginAs('live_chat_moderator');
    const streamId = await liveStream();
    const first = await openRoom(cookie, streamId);
    const second = await openRoom(cookie, streamId);
    assert.equal(first.id, second.id);
    assert.equal(await fixture.database.db.collection('chat_rooms').countDocuments({}), 1);
  });

  test('a stream with no room reports that plainly rather than pretending the stream is missing', async () => {
    const streamId = await liveStream();
    const response = await app.inject({ method: 'GET', url: `/api/v1/streams/${streamId}/chat/messages` });
    assert.equal(response.statusCode, 404);
    assert.match(response.json<{ error: { message: string } }>().error.message, /no chat room/i);
  });

  test('a public stream serves chat anonymously; a sign-in-only stream does not', async () => {
    const { cookie } = await loginAs('live_chat_moderator');
    const open = await liveStream('public');
    await openRoom(cookie, open);
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/streams/${open}/chat/messages` })).statusCode, 200);

    const gated = await liveStream('authenticated');
    await openRoom(cookie, gated);
    const anonymous = await app.inject({ method: 'GET', url: `/api/v1/streams/${gated}/chat/messages` });
    assert.equal(anonymous.statusCode, 403);

    const viewer = await loginAs();
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/streams/${gated}/chat/messages`, ...auth(viewer.cookie) })).statusCode, 200);
  });

  test('sending always requires a session, even on a public stream', async () => {
    const { cookie } = await loginAs('live_chat_moderator');
    const streamId = await liveStream();
    await openRoom(cookie, streamId);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/streams/${streamId}/chat/messages`,
      payload: { body: 'hello', clientMessageId: newId() }
    });
    assert.equal(response.statusCode, 401);
  });

  test('a closed room accepts no messages', async () => {
    const { cookie } = await loginAs('live_chat_moderator');
    const viewer = await loginAs();
    const streamId = await liveStream();
    const room = await openRoom(cookie, streamId);
    const closed = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/chat/rooms/${room.id}/state`,
      payload: { state: 'closed', expectedVersion: room.version },
      ...auth(cookie)
    });
    assert.equal(closed.statusCode, 200);

    const response = await send(viewer.cookie, streamId, 'hello');
    assert.equal(response.statusCode, 409);
    assert.equal(response.json<{ error: { code: string } }>().error.code, 'CHAT_ROOM_CLOSED');
  });
});

describe('ordering, duplicates, and at-least-once delivery (CHAT-006, TEST-021)', () => {
  test('messages are delivered in a total order by sequence', async () => {
    const { cookie } = await loginAs('live_chat_moderator');
    const viewer = await loginAs();
    const streamId = await liveStream();
    await openRoom(cookie, streamId);

    for (const text of ['one', 'two', 'three', 'four', 'five']) {
      assert.equal((await send(viewer.cookie, streamId, text)).statusCode, 201);
    }
    const feed = (await app.inject({ method: 'GET', url: `/api/v1/streams/${streamId}/chat/messages` })).json<Feed>();
    assert.deepEqual(feed.items.map((m) => m.body), ['one', 'two', 'three', 'four', 'five']);
    assert.deepEqual(feed.items.map((m) => m.sequence), [1, 2, 3, 4, 5]);
    assert.equal(feed.lastSequence, 5);
  });

  test('a repeated clientMessageId returns the original message instead of duplicating it', async () => {
    const { cookie } = await loginAs('live_chat_moderator');
    const viewer = await loginAs();
    const streamId = await liveStream();
    await openRoom(cookie, streamId);

    const key = newId();
    const first = await send(viewer.cookie, streamId, 'only once', key);
    const retry = await send(viewer.cookie, streamId, 'only once', key);
    assert.equal(first.statusCode, 201);
    assert.equal(retry.statusCode, 201);
    assert.equal(first.json<MessageView>().id, retry.json<MessageView>().id);
    assert.equal(first.json<MessageView>().sequence, retry.json<MessageView>().sequence);
    assert.equal(await fixture.database.db.collection('chat_messages').countDocuments({}), 1);
  });

  test('concurrent sends with the same key still produce exactly one message', async () => {
    const { cookie } = await loginAs('live_chat_moderator');
    const viewer = await loginAs();
    const streamId = await liveStream();
    await openRoom(cookie, streamId);

    const key = newId();
    const results = await Promise.all([send(viewer.cookie, streamId, 'race', key), send(viewer.cookie, streamId, 'race', key)]);
    assert.ok(results.every((r) => r.statusCode === 201), results.map((r) => r.body).join(' | '));
    assert.equal(await fixture.database.db.collection('chat_messages').countDocuments({}), 1);
    assert.equal(results[0]?.json<MessageView>().id, results[1]?.json<MessageView>().id);
  });

  test('re-reading from an earlier cursor after a reconnect re-delivers stable ids to deduplicate on', async () => {
    const { cookie } = await loginAs('live_chat_moderator');
    const viewer = await loginAs();
    const streamId = await liveStream();
    await openRoom(cookie, streamId);
    for (const text of ['a', 'b', 'c']) await send(viewer.cookie, streamId, text);

    const full = (await app.inject({ method: 'GET', url: `/api/v1/streams/${streamId}/chat/messages` })).json<Feed>();
    // A client that lost its connection re-polls from a cursor it already passed.
    const replay = (await app.inject({ method: 'GET', url: `/api/v1/streams/${streamId}/chat/messages?afterSequence=1` })).json<Feed>();
    assert.deepEqual(replay.items.map((m) => m.id), full.items.slice(1).map((m) => m.id));
    // Overlapping delivery is expected; the ids are what make it deduplicable.
    assert.equal(new Set([...full.items, ...replay.items].map((m) => m.id)).size, 3);
  });

  test('the cursor advances and the feed page is bounded', async () => {
    const { cookie } = await loginAs('live_chat_moderator');
    const viewer = await loginAs();
    const streamId = await liveStream();
    await openRoom(cookie, streamId);
    for (const text of ['a', 'b', 'c']) await send(viewer.cookie, streamId, text);

    const tail = (await app.inject({ method: 'GET', url: `/api/v1/streams/${streamId}/chat/messages?afterSequence=3` })).json<Feed>();
    assert.deepEqual(tail.items, []);
    const oversize = await app.inject({ method: 'GET', url: `/api/v1/streams/${streamId}/chat/messages?limit=500` });
    assert.equal(oversize.statusCode, 400, 'a page larger than the cap is refused, not silently served');
  });
});

describe('rate limiting and backpressure (CHAT-003, PERF-012)', () => {
  test('a flood receives a controlled rejection rather than being queued', async () => {
    const { cookie } = await loginAs('live_chat_moderator');
    const viewer = await loginAs();
    const streamId = await liveStream();
    await openRoom(cookie, streamId);

    const statuses: number[] = [];
    for (let i = 0; i < 15; i += 1) {
      statuses.push((await send(viewer.cookie, streamId, `flood ${String(i)}`)).statusCode);
    }
    assert.equal(statuses.filter((s) => s === 201).length, 10, 'exactly the configured window is accepted');
    assert.ok(statuses.includes(429), 'the excess is refused with a rate-limit status');
    assert.equal(statuses.filter((s) => s >= 500).length, 0, 'backpressure is a controlled rejection, never a server error');
    assert.equal(await fixture.database.db.collection('chat_messages').countDocuments({}), 10);
  });

  test('the limit is per sender, so one flooder cannot silence the room', async () => {
    const { cookie } = await loginAs('live_chat_moderator');
    const flooder = await loginAs();
    const other = await loginAs();
    const streamId = await liveStream();
    await openRoom(cookie, streamId);

    for (let i = 0; i < 12; i += 1) await send(flooder.cookie, streamId, `flood ${String(i)}`);
    assert.equal((await send(other.cookie, streamId, 'still here')).statusCode, 201);
  });
});

describe('moderator actions (CHAT-002, CHAT-004)', () => {
  test('a timeout blocks sending for its period and can be lifted early', async () => {
    const moderator = await loginAs('live_chat_moderator');
    const viewer = await loginAs();
    const streamId = await liveStream();
    const room = await openRoom(moderator.cookie, streamId);
    assert.equal((await send(viewer.cookie, streamId, 'before')).statusCode, 201);

    const timeout = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/chat/users/${viewer.accountId}/timeouts`,
      payload: { roomId: room.id, reason: 'Spam', durationSeconds: 600 },
      ...auth(moderator.cookie)
    });
    assert.equal(timeout.statusCode, 201);

    const blocked = await send(viewer.cookie, streamId, 'during');
    assert.equal(blocked.statusCode, 403);
    assert.match(blocked.json<{ error: { message: string } }>().error.message, /timed out/i);

    const lifted = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/chat/rooms/${room.id}/restrictions/${timeout.json<{ id: string }>().id}/lift`,
      payload: { reason: 'Appeal accepted.' },
      ...auth(moderator.cookie)
    });
    assert.equal(lifted.statusCode, 200);
    assert.equal((await send(viewer.cookie, streamId, 'after')).statusCode, 201);
  });

  test('a ban blocks sending and is confined to its own room', async () => {
    const moderator = await loginAs('live_chat_moderator');
    const viewer = await loginAs();
    const bannedStream = await liveStream();
    const otherStream = await liveStream();
    const bannedRoom = await openRoom(moderator.cookie, bannedStream);
    await openRoom(moderator.cookie, otherStream);

    const ban = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/chat/users/${viewer.accountId}/bans`,
      payload: { roomId: bannedRoom.id, reason: 'Repeated abuse.' },
      ...auth(moderator.cookie)
    });
    assert.equal(ban.statusCode, 201);
    assert.equal(ban.json<{ expiresAt: string | null }>().expiresAt, null, 'a ban has no expiry');

    assert.equal((await send(viewer.cookie, bannedStream, 'hello')).statusCode, 403);
    // Room-scoped: chat moderation never reaches the account itself.
    assert.equal((await send(viewer.cookie, otherStream, 'hello')).statusCode, 201);
    const account = await app.inject({ method: 'GET', url: '/api/v1/auth/session', ...auth(viewer.cookie) });
    assert.equal(account.json<{ account: { state: string } }>().account.state, 'active', 'a chat ban must not suspend the account');
  });

  test('a timeout without a valid duration is refused', async () => {
    const moderator = await loginAs('live_chat_moderator');
    const viewer = await loginAs();
    const streamId = await liveStream();
    const room = await openRoom(moderator.cookie, streamId);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/chat/users/${viewer.accountId}/timeouts`,
      payload: { roomId: room.id, reason: 'Spam', durationSeconds: 999_999 },
      ...auth(moderator.cookie)
    });
    assert.equal(response.statusCode, 400);
  });

  test('a removed message stops delivering its body to viewers but is retained for moderators', async () => {
    const moderator = await loginAs('live_chat_moderator');
    const viewer = await loginAs();
    const streamId = await liveStream();
    const room = await openRoom(moderator.cookie, streamId);
    const sent = (await send(viewer.cookie, streamId, 'offending text')).json<MessageView>();

    const removed = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/chat/rooms/${room.id}/messages/${sent.id}/remove`,
      payload: { reason: 'Abusive.' },
      ...auth(moderator.cookie)
    });
    assert.equal(removed.statusCode, 200);

    const viewerFeed = (await app.inject({ method: 'GET', url: `/api/v1/streams/${streamId}/chat/messages` })).json<Feed>();
    const tombstone = viewerFeed.items.find((m) => m.id === sent.id);
    assert.equal(tombstone?.state, 'removed');
    assert.equal(tombstone?.body, null, 'the body must not be delivered to ordinary viewers');

    const moderatorFeed = (await app.inject({ method: 'GET', url: `/api/v1/admin/chat/rooms/${room.id}/messages`, ...auth(moderator.cookie) })).json<Feed>();
    assert.equal(moderatorFeed.items.find((m) => m.id === sent.id)?.body, 'offending text', 'evidence is retained for review');

    const stored = await fixture.database.db.collection<ChatMessageRecord>('chat_messages').findOne({ _id: sent.id });
    assert.equal(stored?.body, 'offending text');
    assert.equal(stored?.removedBy, moderator.accountId);

    const audited = await fixture.database.db.collection('audit_events').countDocuments({ action: 'chat.message_removed', resourceId: sent.id });
    assert.equal(audited, 1);
  });
});

describe('moderation scope (ROLE-013)', () => {
  test('a moderator assigned to one room cannot act on another', async () => {
    const owner = await loginAs('live_chat_moderator');
    const streamA = await liveStream();
    const streamB = await liveStream();
    const roomA = await openRoom(owner.cookie, streamA);
    const roomB = await openRoom(owner.cookie, streamB);

    // Scoped assignment: this moderator holds chat.moderate for room A only.
    const scoped = await loginAs('live_chat_moderator', { type: 'chat_room', id: roomA.id });
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/admin/chat/rooms/${roomA.id}/messages`, ...auth(scoped.cookie) })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/admin/chat/rooms/${roomB.id}/messages`, ...auth(scoped.cookie) })).statusCode, 403);

    // A scoped grant never satisfies an unscoped, platform-wide action.
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/admin/chat/rooms', ...auth(scoped.cookie) })).statusCode, 403);
  });

  /**
   * The mutating routes are the highest-risk surface: `remove` and `lift` name the room in
   * the path, but `timeouts` and `bans` take it from the request body, so a scoped grant
   * has to be checked against a value the caller controls. Each case below is a room-A
   * moderator reaching at room B.
   */
  test('a room-scoped moderator cannot restrict, remove, or lift in another room', async () => {
    const owner = await loginAs('live_chat_moderator');
    const victim = await loginAs();
    const streamA = await liveStream();
    const streamB = await liveStream();
    const roomA = await openRoom(owner.cookie, streamA);
    const roomB = await openRoom(owner.cookie, streamB);
    const messageB = (await send(victim.cookie, streamB, 'in room B')).json<MessageView>();
    const restrictionB = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/admin/chat/users/${victim.accountId}/bans`,
        payload: { roomId: roomB.id, reason: 'Set up by the room-B owner.' },
        ...auth(owner.cookie)
      })
    ).json<{ id: string }>();

    const scoped = await loginAs('live_chat_moderator', { type: 'chat_room', id: roomA.id });

    // Body-supplied room: the scope extractor reads the caller's own value, so this is the
    // case a mistake here would silently allow.
    for (const action of ['timeouts', 'bans'] as const) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/chat/users/${victim.accountId}/${action}`,
        payload: { roomId: roomB.id, reason: 'Crossing rooms.', ...(action === 'timeouts' ? { durationSeconds: 60 } : {}) },
        ...auth(scoped.cookie)
      });
      assert.equal(response.statusCode, 403, `${action} across rooms must be refused`);
    }

    const removal = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/chat/rooms/${roomB.id}/messages/${messageB.id}/remove`,
      payload: { reason: 'Crossing rooms.' },
      ...auth(scoped.cookie)
    });
    assert.equal(removal.statusCode, 403);

    const lift = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/chat/rooms/${roomB.id}/restrictions/${restrictionB.id}/lift`,
      payload: { reason: 'Crossing rooms.' },
      ...auth(scoped.cookie)
    });
    assert.equal(lift.statusCode, 403);

    // Nothing crossed the boundary.
    const stored = await fixture.database.db.collection<ChatMessageRecord>('chat_messages').findOne({ _id: messageB.id });
    assert.equal(stored?.state, 'visible');
    assert.equal((await send(victim.cookie, streamB, 'still banned')).statusCode, 403, 'the room-B ban is untouched');
  });

  /**
   * Naming room A while targeting a message or restriction that lives in room B must also
   * fail — otherwise the scope check passes and the action lands on the wrong room.
   */
  test('a moderator cannot act on another room by naming their own room in the path', async () => {
    const owner = await loginAs('live_chat_moderator');
    const victim = await loginAs();
    const streamA = await liveStream();
    const streamB = await liveStream();
    const roomA = await openRoom(owner.cookie, streamA);
    const roomB = await openRoom(owner.cookie, streamB);
    const messageB = (await send(victim.cookie, streamB, 'in room B')).json<MessageView>();
    const restrictionB = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/admin/chat/users/${victim.accountId}/bans`,
        payload: { roomId: roomB.id, reason: 'Set up by the room-B owner.' },
        ...auth(owner.cookie)
      })
    ).json<{ id: string }>();

    const scoped = await loginAs('live_chat_moderator', { type: 'chat_room', id: roomA.id });

    const removal = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/chat/rooms/${roomA.id}/messages/${messageB.id}/remove`,
      payload: { reason: 'Room A scope, room B message.' },
      ...auth(scoped.cookie)
    });
    assert.equal(removal.statusCode, 404, 'the message does not belong to the authorized room');

    const lift = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/chat/rooms/${roomA.id}/restrictions/${restrictionB.id}/lift`,
      payload: { reason: 'Room A scope, room B restriction.' },
      ...auth(scoped.cookie)
    });
    assert.equal(lift.statusCode, 404, 'the restriction does not belong to the authorized room');

    const stored = await fixture.database.db.collection<ChatMessageRecord>('chat_messages').findOne({ _id: messageB.id });
    assert.equal(stored?.state, 'visible');
  });

  test('a scoped moderator can still act inside their own room', async () => {
    const owner = await loginAs('live_chat_moderator');
    const victim = await loginAs();
    const streamA = await liveStream();
    const roomA = await openRoom(owner.cookie, streamA);
    const messageA = (await send(victim.cookie, streamA, 'in room A')).json<MessageView>();

    const scoped = await loginAs('live_chat_moderator', { type: 'chat_room', id: roomA.id });
    const removal = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/chat/rooms/${roomA.id}/messages/${messageA.id}/remove`,
      payload: { reason: 'Within scope.' },
      ...auth(scoped.cookie)
    });
    assert.equal(removal.statusCode, 200);

    const timeout = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/chat/users/${victim.accountId}/timeouts`,
      payload: { roomId: roomA.id, reason: 'Within scope.', durationSeconds: 60 },
      ...auth(scoped.cookie)
    });
    assert.equal(timeout.statusCode, 201);
  });

  test('an ordinary viewer cannot reach any moderator surface', async () => {
    const moderator = await loginAs('live_chat_moderator');
    const viewer = await loginAs();
    const streamId = await liveStream();
    const room = await openRoom(moderator.cookie, streamId);
    for (const url of [`/api/v1/admin/chat/rooms/${room.id}/messages`, `/api/v1/admin/chat/rooms/${room.id}/restrictions`, '/api/v1/admin/chat/rooms']) {
      assert.equal((await app.inject({ method: 'GET', url, ...auth(viewer.cookie) })).statusCode, 403, url);
    }
  });

  test('a chat moderator holds chat.moderate and no platform moderation power', async () => {
    const moderator = await loginAs('live_chat_moderator');
    // Asserted on the effective-permission list rather than a route, so it holds however
    // the moderation surface is composed: ROLE-013 is scope-limited by construction and
    // must never carry the permission that suspends accounts or resolves shared cases.
    const capabilities = await app.inject({ method: 'GET', url: '/api/v1/admin/capabilities', ...auth(moderator.cookie) });
    assert.equal(capabilities.statusCode, 200);
    const { permissions, isSuperAdmin } = capabilities.json<{ permissions: string[]; isSuperAdmin: boolean }>();
    assert.equal(isSuperAdmin, false);
    assert.ok(permissions.includes('chat.moderate'));
    assert.equal(permissions.includes('moderation.manage'), false);
    assert.equal(permissions.includes('users.suspend'), false);
  });
});

describe('reports and evidence (CHAT-005)', () => {
  test('a report opens a shared moderation case whose evidence survives removal of the message', async () => {
    const moderator = await loginAs('live_chat_moderator');
    const author = await loginAs();
    const reporter = await loginAs();
    const streamId = await liveStream();
    const room = await openRoom(moderator.cookie, streamId);
    const sent = (await send(author.cookie, streamId, 'reportable text')).json<MessageView>();

    const report = await app.inject({
      method: 'POST',
      url: `/api/v1/chat/messages/${sent.id}/reports`,
      payload: { reason: 'Harassment', details: 'targeted at another viewer' },
      ...auth(reporter.cookie)
    });
    assert.equal(report.statusCode, 201);
    const { caseId } = report.json<{ reportId: string; caseId: string }>();

    // The case lives in the shared moderation workflow, not a private chat table.
    const moderationCase = await fixture.database.db
      .collection<{ _id: string; subjectType: string; subjectId: string }>('moderation_cases')
      .findOne({ _id: caseId });
    assert.equal(moderationCase?.subjectType, 'chat_message');
    assert.equal(moderationCase?.subjectId, sent.id);

    // Remove the message from public display, then confirm the evidence is still readable.
    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/chat/rooms/${room.id}/messages/${sent.id}/remove`,
      payload: { reason: 'Confirmed abuse.' },
      ...auth(moderator.cookie)
    });

    const stored = await fixture.database.db.collection<{ details: string }>('moderation_reports').findOne({ caseId });
    assert.match(stored?.details ?? '', /reportable text/, 'the report snapshot preserves what was said');
    assert.match(stored?.details ?? '', /targeted at another viewer/);

    const evidence = await app.inject({ method: 'GET', url: `/api/v1/admin/chat/messages/${sent.id}`, ...auth(moderator.cookie) });
    assert.equal(evidence.statusCode, 200);
    assert.equal(evidence.json<{ body: string; state: string }>().body, 'reportable text');
    assert.equal(evidence.json<{ state: string }>().state, 'removed');
  });

  test('repeat reports on one message collapse into a single open case', async () => {
    const moderator = await loginAs('live_chat_moderator');
    const author = await loginAs();
    const streamId = await liveStream();
    await openRoom(moderator.cookie, streamId);
    const sent = (await send(author.cookie, streamId, 'reportable')).json<MessageView>();

    for (let i = 0; i < 2; i += 1) {
      const reporter = await loginAs();
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/chat/messages/${sent.id}/reports`,
        payload: { reason: 'Spam' },
        ...auth(reporter.cookie)
      });
      assert.equal(response.statusCode, 201);
    }
    assert.equal(await fixture.database.db.collection('moderation_cases').countDocuments({ subjectType: 'chat_message' }), 1);
    assert.equal(await fixture.database.db.collection('moderation_reports').countDocuments({ subjectId: sent.id }), 2);
  });

  test('reporting requires a session and a readable room', async () => {
    const moderator = await loginAs('live_chat_moderator');
    const author = await loginAs();
    const streamId = await liveStream();
    await openRoom(moderator.cookie, streamId);
    const sent = (await send(author.cookie, streamId, 'text')).json<MessageView>();

    const anonymous = await app.inject({ method: 'POST', url: `/api/v1/chat/messages/${sent.id}/reports`, payload: { reason: 'Spam' } });
    assert.equal(anonymous.statusCode, 401);

    const reporter = await loginAs();
    const unknown = await app.inject({ method: 'POST', url: `/api/v1/chat/messages/${newId()}/reports`, payload: { reason: 'Spam' }, ...auth(reporter.cookie) });
    assert.equal(unknown.statusCode, 404);
  });
});

describe('content safety (CHAT-007)', () => {
  test('markup is stripped on write, so nothing unsafe is ever stored or served', async () => {
    const moderator = await loginAs('live_chat_moderator');
    const viewer = await loginAs();
    const streamId = await liveStream();
    await openRoom(moderator.cookie, streamId);

    const sent = await send(viewer.cookie, streamId, '<img src=x onerror="alert(1)">hi <b>there</b>');
    assert.equal(sent.statusCode, 201);
    const stored = sent.json<MessageView>().body ?? '';
    assert.equal(stored.includes('<'), false, 'no markup survives the write boundary');
    assert.equal(stored.includes('onerror'), false);
    assert.match(stored, /hi there/);
  });

  test('mixed-script text is preserved exactly', async () => {
    const moderator = await loginAs('live_chat_moderator');
    const viewer = await loginAs();
    const streamId = await liveStream();
    await openRoom(moderator.cookie, streamId);

    const mixed = 'سلام GG WP 2026';
    const sent = await send(viewer.cookie, streamId, mixed);
    assert.equal(sent.json<MessageView>().body, mixed);
  });

  test('an empty or markup-only message is refused', async () => {
    const moderator = await loginAs('live_chat_moderator');
    const viewer = await loginAs();
    const streamId = await liveStream();
    await openRoom(moderator.cookie, streamId);
    const response = await send(viewer.cookie, streamId, '<script>alert(1)</script>');
    assert.equal(response.statusCode, 422);
  });
});
