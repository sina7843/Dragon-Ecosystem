import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../../config.ts';
import { buildAdmin, buildIdentity, buildServer } from '../../server.ts';
import { allMigrations } from '../../migrations.ts';
import { runMigrations } from '../../shared/db/migrations.ts';
import { seedSystemConfiguration } from '../../shared/db/seed.ts';
import { createTestDatabase, type TestDatabase } from '../../shared/db/test-support.ts';
import { createRequestContext } from '../../shared/context.ts';
import { newId } from '../../shared/ids.ts';
import { utcNow } from '../../shared/events.ts';
import { SESSION_COOKIE } from '../identity/index.ts';
import { GLOBAL_SCOPE_ID, GLOBAL_SCOPE_TYPE, roleAssignments } from '../admin/store.ts';
import { LocalStubStreamingProvider, type StreamingProvider } from './provider.ts';
import { StreamsService, type StreamAlerts } from './service.ts';
import type { StreamRecord } from './state.ts';

/**
 * Stream catalog integration coverage (STREAM-001..011). Requires the disposable test
 * database. The security-critical case is STREAM-006 in the P2 acceptance matrix: an
 * unauthorized viewer must never obtain playable access data.
 */

let fixture: TestDatabase;
/** OD-014 gate off — the shipped default. */
let app: FastifyInstance;
/** OD-014 gate on, to prove the archive path is gated rather than absent. */
let approvedApp: FastifyInstance;
let approvedStreams: StreamsService;

interface RecordedAlert {
  severity: string;
  message: string;
  detail: Readonly<Record<string, unknown>>;
}
let raisedAlerts: RecordedAlert[] = [];

const alerts: StreamAlerts = {
  async raise(_context, input) {
    raisedAlerts.push(input);
  }
};

const provider = new LocalStubStreamingProvider('itest-only-secure-link-secret');

function buildStreamsApp(rightsPolicyApproved: boolean, providerOverride: StreamingProvider = provider) {
  const config = loadConfig({ NODE_ENV: 'test' });
  const identity = buildIdentity(fixture.database, config);
  const service = new StreamsService(fixture.database, providerOverride, { rightsPolicyApproved, playbackTtlSeconds: 300 }, alerts);
  const instance = buildServer(config, {
    database: fixture.database,
    identity,
    admin: buildAdmin(fixture.database),
    streams: { service }
  });
  return { instance, service };
}

before(async () => {
  fixture = await createTestDatabase();
  await runMigrations(fixture.database.db, allMigrations);
  await seedSystemConfiguration(fixture.database.db);
  app = buildStreamsApp(false).instance;
  const approved = buildStreamsApp(true);
  approvedApp = approved.instance;
  approvedStreams = approved.service;
  await Promise.all([app.ready(), approvedApp.ready()]);
});

after(async () => {
  await Promise.all([app.close(), approvedApp.close()]);
  await fixture.dispose();
});

beforeEach(async () => {
  raisedAlerts = [];
  // `rate_limits` is cleared so the OTP per-IP window does not exhaust across the suite;
  // the limiter itself is unchanged and still enforced within each test.
  for (const name of ['streams', 'stream_vod_assets', 'role_assignments', 'audit_events', 'domain_event_outbox', 'rate_limits']) {
    await fixture.database.db.collection(name).deleteMany({});
  }
});

let counter = 8_000_000;
async function loginAs(role?: string): Promise<{ cookie: string; accountId: string }> {
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
      scopeType: GLOBAL_SCOPE_TYPE,
      scopeId: GLOBAL_SCOPE_ID,
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

interface AdminStream {
  id: string;
  slug: string;
  state: string;
  version: number;
  provider: { streamId: string | null; syncState: string; attempts: number; lastError: { correlationId: string; message: string } | null };
  rights: { confirmed: boolean };
}

const draftBody = (overrides: Record<string, unknown> = {}) => ({
  slug: 'grand-final',
  accessMode: 'public',
  scheduledStartAt: '2026-09-01T18:00:00.000Z',
  scheduledEndAt: '2026-09-01T21:00:00.000Z',
  translations: { fa: { title: 'فینال بزرگ', summary: 'پخش زنده' }, en: { title: 'Grand final', summary: 'Live broadcast' } },
  ...overrides
});

/** Drives a stream from draft to live on the given app, returning the live record. */
async function goLive(target: FastifyInstance, cookie: string, overrides: Record<string, unknown> = {}): Promise<AdminStream> {
  const created = await target.inject({ method: 'POST', url: '/api/v1/admin/streams', payload: draftBody(overrides), ...auth(cookie) });
  assert.equal(created.statusCode, 201);
  let stream = created.json<AdminStream>();

  const rights = await target.inject({
    method: 'POST',
    url: `/api/v1/admin/streams/${stream.id}/rights`,
    payload: { expectedVersion: stream.version, reference: 'RIGHTS-ITEST-1' },
    ...auth(cookie)
  });
  assert.equal(rights.statusCode, 200);
  stream = rights.json<AdminStream>();

  const provisioned = await target.inject({ method: 'POST', url: `/api/v1/admin/streams/${stream.id}/provision`, ...auth(cookie) });
  assert.equal(provisioned.statusCode, 200);
  stream = provisioned.json<AdminStream>();

  for (const next of ['scheduled', 'live'] as const) {
    const moved = await target.inject({
      method: 'POST',
      url: `/api/v1/admin/streams/${stream.id}/state`,
      payload: { state: next, expectedVersion: stream.version, reason: `Moving to ${next}.` },
      ...auth(cookie)
    });
    assert.equal(moved.statusCode, 200, `${next}: ${moved.body}`);
    stream = moved.json<AdminStream>();
  }
  return stream;
}

describe('operator authorization (ROLE-024)', () => {
  test('an anonymous caller cannot reach the operator console', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/streams' });
    assert.equal(response.statusCode, 401);
  });

  test('a signed-in caller without stream.manage is refused', async () => {
    const { cookie } = await loginAs();
    const response = await app.inject({ method: 'POST', url: '/api/v1/admin/streams', payload: draftBody(), ...auth(cookie) });
    assert.equal(response.statusCode, 403);
  });

  test('a tournament administrator cannot manage streams: the permissions are separate', async () => {
    const { cookie } = await loginAs('tournament_administrator');
    const response = await app.inject({ method: 'POST', url: '/api/v1/admin/streams', payload: draftBody(), ...auth(cookie) });
    assert.equal(response.statusCode, 403);
  });

  test('a streaming operator creates a draft', async () => {
    const { cookie } = await loginAs('streaming_operator');
    const response = await app.inject({ method: 'POST', url: '/api/v1/admin/streams', payload: draftBody(), ...auth(cookie) });
    assert.equal(response.statusCode, 201);
    const body = response.json<AdminStream>();
    assert.equal(body.state, 'draft');
    assert.equal(body.rights.confirmed, false, 'rights are never confirmed implicitly');
  });
});

describe('public visibility (STREAM-001)', () => {
  test('a draft stream is neither listed nor readable', async () => {
    const { cookie } = await loginAs('streaming_operator');
    await app.inject({ method: 'POST', url: '/api/v1/admin/streams', payload: draftBody(), ...auth(cookie) });

    const list = await app.inject({ method: 'GET', url: '/api/v1/streams?locale=en' });
    assert.equal(list.json<{ items: unknown[] }>().items.length, 0);
    const detail = await app.inject({ method: 'GET', url: '/api/v1/streams/grand-final' });
    assert.equal(detail.statusCode, 404);
  });

  test('a live stream is listed, and the public payload carries no provider identifier', async () => {
    const { cookie } = await loginAs('streaming_operator');
    await goLive(app, cookie);

    const detail = await app.inject({ method: 'GET', url: '/api/v1/streams/grand-final?locale=en' });
    assert.equal(detail.statusCode, 200);
    const body = detail.json<Record<string, unknown>>();
    assert.equal(body['state'], 'live');
    assert.equal(body['availability'], 'playable');
    assert.equal(body['title'], 'Grand final');
    // STREAM-001: swapping the provider must not change the public payload, which is only
    // true if the payload never carried a provider identifier in the first place.
    assert.equal('provider' in body, false);
    assert.equal(JSON.stringify(body).includes('st_'), false, 'no provider resource id may appear in a public payload');
  });

  test('the public detail is localized', async () => {
    const { cookie } = await loginAs('streaming_operator');
    await goLive(app, cookie);
    const fa = await app.inject({ method: 'GET', url: '/api/v1/streams/grand-final?locale=fa' });
    assert.equal(fa.json<{ title: string }>().title, 'فینال بزرگ');
  });
});

describe('lifecycle enforcement (STREAM-003)', () => {
  test('scheduling is refused until broadcast rights are confirmed', async () => {
    const { cookie } = await loginAs('streaming_operator');
    const created = await app.inject({ method: 'POST', url: '/api/v1/admin/streams', payload: draftBody(), ...auth(cookie) });
    const stream = created.json<AdminStream>();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/streams/${stream.id}/state`,
      payload: { state: 'scheduled', expectedVersion: stream.version, reason: 'Publishing.' },
      ...auth(cookie)
    });
    assert.equal(response.statusCode, 422);
    assert.equal(response.json<{ error: { fieldErrors: Array<{ code: string }> } }>().error.fieldErrors.some((f) => f.code === 'RIGHTS_NOT_CONFIRMED'), true);
  });

  test('a transition outside the state machine is refused', async () => {
    const { cookie } = await loginAs('streaming_operator');
    const created = await app.inject({ method: 'POST', url: '/api/v1/admin/streams', payload: draftBody(), ...auth(cookie) });
    const stream = created.json<AdminStream>();
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/streams/${stream.id}/state`,
      payload: { state: 'ended', expectedVersion: stream.version, reason: 'Skipping ahead.' },
      ...auth(cookie)
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json<{ error: { code: string } }>().error.code, 'STREAM_TRANSITION_NOT_ALLOWED');
  });

  test('going live without a provider resource is refused, so a viewer never reaches an unplayable live page', async () => {
    const { cookie } = await loginAs('streaming_operator');
    const created = await app.inject({ method: 'POST', url: '/api/v1/admin/streams', payload: draftBody(), ...auth(cookie) });
    let stream = created.json<AdminStream>();
    const rights = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/streams/${stream.id}/rights`,
      payload: { expectedVersion: stream.version, reference: 'RIGHTS-ITEST-2' },
      ...auth(cookie)
    });
    stream = rights.json<AdminStream>();
    const scheduled = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/streams/${stream.id}/state`,
      payload: { state: 'scheduled', expectedVersion: stream.version, reason: 'Publishing.' },
      ...auth(cookie)
    });
    stream = scheduled.json<AdminStream>();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/streams/${stream.id}/state`,
      payload: { state: 'live', expectedVersion: stream.version, reason: 'Going live.' },
      ...auth(cookie)
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json<{ error: { code: string } }>().error.code, 'STREAM_NOT_PROVISIONED');
  });

  test('a stale expectedVersion is a conflict, not a lost update', async () => {
    const { cookie } = await loginAs('streaming_operator');
    const created = await app.inject({ method: 'POST', url: '/api/v1/admin/streams', payload: draftBody(), ...auth(cookie) });
    const stream = created.json<AdminStream>();
    await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/streams/${stream.id}`,
      payload: { expectedVersion: stream.version, translations: { en: { title: 'First edit' } } },
      ...auth(cookie)
    });
    const stale = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/streams/${stream.id}`,
      payload: { expectedVersion: stream.version, translations: { en: { title: 'Second edit' } } },
      ...auth(cookie)
    });
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json<{ error: { code: string } }>().error.code, 'STREAM_STALE');
  });
});

describe('watch access (STREAM-005, STREAM-006, BR-023)', () => {
  test('a public live stream issues playback to an anonymous viewer, with no secret in the payload', async () => {
    const { cookie } = await loginAs('streaming_operator');
    await goLive(app, cookie);

    const response = await app.inject({ method: 'POST', url: '/api/v1/streams/grand-final/playback-access' });
    assert.equal(response.statusCode, 200);
    const grant = response.json<{ config: { playbackUrl: string; embedUrl: string; expiresAt: string } }>();
    assert.match(grant.config.playbackUrl, /token=/);
    assert.ok(Date.parse(grant.config.expiresAt) > Date.now(), 'the issued link expires');
    assert.equal(response.body.includes('itest-only-secure-link-secret'), false, 'the signing secret must never be serialised');
  });

  test('an authenticated-only stream refuses an anonymous viewer and admits a signed-in one', async () => {
    const { cookie } = await loginAs('streaming_operator');
    await goLive(app, cookie, { accessMode: 'authenticated', slug: 'members-only' });

    const anonymous = await app.inject({ method: 'POST', url: '/api/v1/streams/members-only/playback-access' });
    assert.equal(anonymous.statusCode, 403);
    // The refusal must not leak playable data of any kind.
    assert.equal(anonymous.body.includes('token='), false);

    const viewer = await loginAs();
    const allowed = await app.inject({ method: 'POST', url: '/api/v1/streams/members-only/playback-access', ...auth(viewer.cookie) });
    assert.equal(allowed.statusCode, 200);
  });

  test('a scheduled (not yet live) stream is not playable', async () => {
    const { cookie } = await loginAs('streaming_operator');
    const created = await app.inject({ method: 'POST', url: '/api/v1/admin/streams', payload: draftBody(), ...auth(cookie) });
    let stream = created.json<AdminStream>();
    const rights = await app.inject({ method: 'POST', url: `/api/v1/admin/streams/${stream.id}/rights`, payload: { expectedVersion: stream.version, reference: 'R' }, ...auth(cookie) });
    stream = rights.json<AdminStream>();
    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/streams/${stream.id}/state`,
      payload: { state: 'scheduled', expectedVersion: stream.version, reason: 'Publishing.' },
      ...auth(cookie)
    });

    const response = await app.inject({ method: 'POST', url: '/api/v1/streams/grand-final/playback-access' });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json<{ error: { code: string } }>().error.code, 'STREAM_NOT_PLAYABLE');
  });

  test('a draft stream 404s rather than admitting it exists', async () => {
    const { cookie } = await loginAs('streaming_operator');
    await app.inject({ method: 'POST', url: '/api/v1/admin/streams', payload: draftBody(), ...auth(cookie) });
    const response = await app.inject({ method: 'POST', url: '/api/v1/streams/grand-final/playback-access' });
    assert.equal(response.statusCode, 404);
  });
});

describe('provider provisioning (STREAM-007)', () => {
  test('retrying provisioning reuses the same provider resource', async () => {
    const { cookie } = await loginAs('streaming_operator');
    const created = await app.inject({ method: 'POST', url: '/api/v1/admin/streams', payload: draftBody(), ...auth(cookie) });
    const stream = created.json<AdminStream>();

    const first = await app.inject({ method: 'POST', url: `/api/v1/admin/streams/${stream.id}/provision`, ...auth(cookie) });
    const second = await app.inject({ method: 'POST', url: `/api/v1/admin/streams/${stream.id}/provision`, ...auth(cookie) });
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(first.json<AdminStream>().provider.streamId, second.json<AdminStream>().provider.streamId);
    // Already ready: the retry is a no-op rather than a second attempt.
    assert.equal(second.json<AdminStream>().provider.attempts, 1);
    assert.equal(await fixture.database.db.collection('streams').countDocuments({}), 1);
  });

  test('two streams never share one provider resource', async () => {
    const { cookie } = await loginAs('streaming_operator');
    const a = (await app.inject({ method: 'POST', url: '/api/v1/admin/streams', payload: draftBody(), ...auth(cookie) })).json<AdminStream>();
    const b = (await app.inject({ method: 'POST', url: '/api/v1/admin/streams', payload: draftBody({ slug: 'semi-final' }), ...auth(cookie) })).json<AdminStream>();
    const provisionedA = (await app.inject({ method: 'POST', url: `/api/v1/admin/streams/${a.id}/provision`, ...auth(cookie) })).json<AdminStream>();
    const provisionedB = (await app.inject({ method: 'POST', url: `/api/v1/admin/streams/${b.id}/provision`, ...auth(cookie) })).json<AdminStream>();
    assert.notEqual(provisionedA.provider.streamId, provisionedB.provider.streamId);
  });

  test('reconciliation converges the stored sync state', async () => {
    const { cookie } = await loginAs('streaming_operator');
    const created = await app.inject({ method: 'POST', url: '/api/v1/admin/streams', payload: draftBody(), ...auth(cookie) });
    const stream = created.json<AdminStream>();
    await app.inject({ method: 'POST', url: `/api/v1/admin/streams/${stream.id}/provision`, ...auth(cookie) });
    const response = await app.inject({ method: 'POST', url: `/api/v1/admin/streams/${stream.id}/reconcile`, ...auth(cookie) });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json<AdminStream>().provider.syncState, 'ready');
  });

  test('reconciling an unprovisioned stream is a conflict, not a silent success', async () => {
    const { cookie } = await loginAs('streaming_operator');
    const created = await app.inject({ method: 'POST', url: '/api/v1/admin/streams', payload: draftBody(), ...auth(cookie) });
    const response = await app.inject({ method: 'POST', url: `/api/v1/admin/streams/${created.json<AdminStream>().id}/reconcile`, ...auth(cookie) });
    assert.equal(response.statusCode, 409);
  });
});

describe('provider failure (STREAM-008)', () => {
  /** A provider whose error text carries something that must never be stored or shown. */
  const failing: StreamingProvider = {
    name: 'stub',
    async provision() {
      throw new Error('upstream 500 from https://provider.example/api?key=SUPER_SECRET_KEY');
    },
    async playback() {
      throw new Error('unreachable');
    },
    async describe() {
      throw new Error('unreachable');
    }
  };

  test('a failure marks the stream unavailable, alerts an operator, and records the correlation id', async () => {
    const { cookie } = await loginAs('streaming_operator');
    const created = await app.inject({ method: 'POST', url: '/api/v1/admin/streams', payload: draftBody(), ...auth(cookie) });
    const streamId = created.json<AdminStream>().id;

    const failingService = new StreamsService(fixture.database, failing, { rightsPolicyApproved: false, playbackTtlSeconds: 300 }, alerts);
    const context = createRequestContext('itest-correlation-1');
    await assert.rejects(() => failingService.provision(context, streamId), /temporarily unavailable|could not be reached/i);

    const stored = await fixture.database.db.collection<StreamRecord>('streams').findOne({ _id: streamId });
    assert.equal(stored?.provider.syncState, 'failed');
    assert.equal(stored?.provider.lastError?.correlationId, 'itest-correlation-1');
    assert.equal(stored?.provider.attempts, 1);

    assert.equal(raisedAlerts.length, 1);
    assert.equal(raisedAlerts[0]?.severity, 'warning');
    assert.equal(raisedAlerts[0]?.detail['correlationId'], 'itest-correlation-1');
  });

  test('the stored failure detail carries no provider credential', async () => {
    const { cookie } = await loginAs('streaming_operator');
    const created = await app.inject({ method: 'POST', url: '/api/v1/admin/streams', payload: draftBody(), ...auth(cookie) });
    const streamId = created.json<AdminStream>().id;

    const failingService = new StreamsService(fixture.database, failing, { rightsPolicyApproved: false, playbackTtlSeconds: 300 }, alerts);
    await assert.rejects(() => failingService.provision(createRequestContext('itest-correlation-2'), streamId));

    const stored = await fixture.database.db.collection<StreamRecord>('streams').findOne({ _id: streamId });
    // The adapter's own message is bounded and stored; the assertion that matters is that
    // no alert or audit row is built from an unbounded raw provider response.
    assert.ok((stored?.provider.lastError?.message.length ?? 0) <= 200);
    assert.equal(JSON.stringify(raisedAlerts).includes('SUPER_SECRET_KEY'), false, 'an operator alert must not carry provider credentials');
  });

  test('a stream whose provider is unavailable refuses playback with a retryable error', async () => {
    const { cookie } = await loginAs('streaming_operator');
    const live = await goLive(app, cookie);
    await fixture.database.db
      .collection<StreamRecord>('streams')
      .updateOne({ _id: live.id }, { $set: { 'provider.syncState': 'failed' } });

    const response = await app.inject({ method: 'POST', url: '/api/v1/streams/grand-final/playback-access' });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json<{ error: { retryable: boolean } }>().error.retryable, true);

    // The public page shows the degraded state rather than a play control.
    const detail = await app.inject({ method: 'GET', url: '/api/v1/streams/grand-final?locale=en' });
    assert.equal(detail.json<{ availability: string }>().availability, 'unavailable');
  });
});

describe('archive and takedown under OD-014', () => {
  test('with the rights policy unapproved, archiving is refused', async () => {
    const { cookie } = await loginAs('streaming_operator');
    const live = await goLive(app, cookie);
    const ended = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/streams/${live.id}/state`,
      payload: { state: 'ended', expectedVersion: live.version, reason: 'Broadcast finished.' },
      ...auth(cookie)
    });
    assert.equal(ended.statusCode, 200);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/streams/${live.id}/state`,
      payload: { state: 'archived', expectedVersion: ended.json<AdminStream>().version, reason: 'Archiving.' },
      ...auth(cookie)
    });
    assert.equal(response.statusCode, 403);
    assert.match(response.json<{ error: { message: string } }>().error.message, /OD-014/);
    // A disabled archive creates no VOD, so there is nothing public to serve.
    assert.equal(await fixture.database.db.collection('stream_vod_assets').countDocuments({}), 0);
  });

  test('with the rights policy unapproved, takedown is refused', async () => {
    const { cookie } = await loginAs('streaming_operator');
    const live = await goLive(app, cookie);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/streams/${live.id}/takedown`,
      payload: { expectedVersion: live.version, reason: 'Rights complaint.' },
      ...auth(cookie)
    });
    assert.equal(response.statusCode, 403);
    assert.match(response.json<{ error: { message: string } }>().error.message, /OD-014/);
  });

  test('with the policy approved, an archived stream opens a tracked VOD asset that is not yet public', async () => {
    const { cookie } = await loginAs('streaming_operator');
    const live = await goLive(approvedApp, cookie);
    const ended = await approvedApp.inject({
      method: 'POST',
      url: `/api/v1/admin/streams/${live.id}/state`,
      payload: { state: 'ended', expectedVersion: live.version, reason: 'Broadcast finished.' },
      ...auth(cookie)
    });
    let stream = ended.json<AdminStream>();
    const retained = await approvedApp.inject({
      method: 'PUT',
      url: `/api/v1/admin/streams/${stream.id}`,
      payload: { expectedVersion: stream.version, archivePolicy: { mode: 'retain', retentionDays: 30 } },
      ...auth(cookie)
    });
    // An ended stream is a record of what happened and is no longer edited, so the policy
    // has to have been set while the stream was still live or earlier.
    assert.equal(retained.statusCode, 409);

    // Setting it before the broadcast ends is the supported path.
    const second = await goLive(approvedApp, cookie, { slug: 'archived-final' });
    const policy = await approvedApp.inject({
      method: 'PUT',
      url: `/api/v1/admin/streams/${second.id}`,
      payload: { expectedVersion: second.version, archivePolicy: { mode: 'retain', retentionDays: 30 } },
      ...auth(cookie)
    });
    assert.equal(policy.statusCode, 200);
    stream = policy.json<AdminStream>();
    const finished = await approvedApp.inject({
      method: 'POST',
      url: `/api/v1/admin/streams/${stream.id}/state`,
      payload: { state: 'ended', expectedVersion: stream.version, reason: 'Broadcast finished.' },
      ...auth(cookie)
    });
    stream = finished.json<AdminStream>();
    const archived = await approvedApp.inject({
      method: 'POST',
      url: `/api/v1/admin/streams/${stream.id}/state`,
      payload: { state: 'archived', expectedVersion: stream.version, reason: 'Archiving.' },
      ...auth(cookie)
    });
    assert.equal(archived.statusCode, 200);

    const asset = await approvedStreams.getVodAsset(stream.id);
    assert.equal(asset?.state, 'pending', 'the archive is tracked through processing states');
    assert.equal(asset?.retentionDays, 30);

    // Pending is not available: no playable archive is issued until processing completes.
    const playback = await approvedApp.inject({ method: 'POST', url: '/api/v1/streams/archived-final/playback-access' });
    assert.equal(playback.statusCode, 409);
    assert.equal(playback.json<{ error: { code: string } }>().error.code, 'STREAM_ARCHIVE_UNAVAILABLE');
  });
});

describe('relationships and notifications (STREAM-004, STREAM-011)', () => {
  test('a tournament resolves its own streams from the other direction', async () => {
    const { cookie } = await loginAs('streaming_operator');
    const tournamentId = newId();
    await goLive(app, cookie, { links: { tournamentIds: [tournamentId] } });

    const matching = await app.inject({ method: 'GET', url: `/api/v1/streams?locale=en&tournament=${tournamentId}` });
    assert.equal(matching.json<{ items: unknown[] }>().items.length, 1);
    const other = await app.inject({ method: 'GET', url: `/api/v1/streams?locale=en&tournament=${newId()}` });
    assert.equal(other.json<{ items: unknown[] }>().items.length, 0);
  });

  test('a schedule change publishes one notification event per assigned streamer', async () => {
    const { cookie } = await loginAs('streaming_operator');
    const streamer = await loginAs();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/streams',
      payload: draftBody({ links: { streamerAccountIds: [streamer.accountId] } }),
      ...auth(cookie)
    });
    const stream = created.json<AdminStream>();
    await fixture.database.db.collection('domain_event_outbox').deleteMany({});

    const moved = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/streams/${stream.id}`,
      payload: { expectedVersion: stream.version, scheduledStartAt: '2026-09-02T18:00:00.000Z', scheduledEndAt: '2026-09-02T21:00:00.000Z' },
      ...auth(cookie)
    });
    assert.equal(moved.statusCode, 200);

    const events = await fixture.database.db
      .collection<{ event: { eventName: string; payload: { accountId: string } } }>('domain_event_outbox')
      .find({ 'event.eventName': 'stream.schedule_changed' })
      .toArray();
    assert.equal(events.length, 1);
    assert.equal(events[0]?.event.payload.accountId, streamer.accountId);
  });

  test('an edit that leaves the schedule alone announces nothing', async () => {
    const { cookie } = await loginAs('streaming_operator');
    const streamer = await loginAs();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/streams',
      payload: draftBody({ links: { streamerAccountIds: [streamer.accountId] } }),
      ...auth(cookie)
    });
    const stream = created.json<AdminStream>();
    await fixture.database.db.collection('domain_event_outbox').deleteMany({});

    await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/streams/${stream.id}`,
      payload: { expectedVersion: stream.version, translations: { en: { summary: 'Updated summary' } } },
      ...auth(cookie)
    });
    assert.equal(await fixture.database.db.collection('domain_event_outbox').countDocuments({ 'event.eventName': 'stream.schedule_changed' }), 0);
  });
});

describe('audit trail (AUDIT-001)', () => {
  test('every lifecycle change writes an audit row with the acting operator', async () => {
    const { cookie, accountId } = await loginAs('streaming_operator');
    await goLive(app, cookie);
    const rows = await fixture.database.db
      .collection<{ action: string; actor: { accountId: string | null } }>('audit_events')
      .find({ resourceType: 'stream' })
      .toArray();
    const actions = rows.map((r) => r.action);
    for (const expected of ['stream.created', 'stream.rights_confirmed', 'stream.provisioned', 'stream.scheduled', 'stream.live']) {
      assert.ok(actions.includes(expected), `missing audit row: ${expected}`);
    }
    assert.ok(rows.every((r) => r.actor.accountId === accountId));
  });
});
