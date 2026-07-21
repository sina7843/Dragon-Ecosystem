import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { loadConfig, type AppConfig } from '../../config.ts';
import { buildIdentity, buildServer } from '../../server.ts';
import { allMigrations } from '../../migrations.ts';
import { runMigrations } from '../../shared/db/migrations.ts';
import { createTestDatabase, type TestDatabase } from '../../shared/db/test-support.ts';
import { createRequestContext, SYSTEM_ACTOR } from '../../shared/context.ts';
import { IDENTITY_COLLECTIONS } from './collections.ts';
import { SESSION_COOKIE } from './routes.ts';
import type { IdentityService } from './service.ts';

/**
 * Identity integration and security coverage.
 * Requires the disposable test database: `npm run db:test:up`.
 */

let fixture: TestDatabase;
let app: FastifyInstance;
let service: IdentityService;
let config: AppConfig;

const MOBILE = '09123456789';
const CANONICAL = '+989123456789';

before(async () => {
  fixture = await createTestDatabase();
  await runMigrations(fixture.database.db, allMigrations);
  config = loadConfig({ NODE_ENV: 'test' });
  const identity = buildIdentity(fixture.database, config);
  service = identity.service;
  app = buildServer(config, { database: fixture.database, identity });
  await app.ready();
});

after(async () => {
  await app.close();
  await fixture.dispose();
});

beforeEach(async () => {
  // Each test starts from a clean identity state so limits and challenges never leak.
  for (const name of Object.values(IDENTITY_COLLECTIONS)) {
    await fixture.database.db.collection(name).deleteMany({});
  }
});

async function requestOtp(mobile = MOBILE) {
  return app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { mobile } });
}

/** Reads the code from the development inbox, exactly as the browser tests do. */
async function latestCode(mobile = MOBILE): Promise<string> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/dev/sms-inbox?mobile=${encodeURIComponent(mobile)}`
  });
  const messages = response.json<Array<{ code: string }>>();
  assert.ok(messages.length > 0, 'the mock provider produced no message');
  return messages[0]?.code as string;
}

async function login(mobile = MOBILE): Promise<string> {
  await requestOtp(mobile);
  const code = await latestCode(mobile);
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/otp/verify',
    payload: { mobile, code }
  });
  assert.equal(response.statusCode, 200, response.body);
  const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
  assert.ok(cookie, 'no session cookie was set');
  return cookie.value;
}

describe('OTP request', () => {
  test('issues a code and records a traceable delivery without the code or full number', async () => {
    const response = await requestOtp();
    assert.equal(response.statusCode, 202);

    const delivery = await fixture.database.db.collection(IDENTITY_COLLECTIONS.smsDeliveries).findOne({});
    assert.ok(delivery);
    // SMS-004 and SEC-012: masked recipient, no message body, no code.
    assert.equal(delivery?.['recipientMasked'], '+98912***89');
    assert.equal(JSON.stringify(delivery).includes(await latestCode()), false, 'delivery record leaked the code');
    assert.ok(!('code' in (delivery ?? {})));
  });

  test('the stored challenge never contains the code in reversible form (AUTH-003)', async () => {
    await requestOtp();
    const code = await latestCode();
    const challenge = await fixture.database.db.collection(IDENTITY_COLLECTIONS.otpChallenges).findOne({});

    assert.ok(challenge);
    const serialized = JSON.stringify(challenge);
    assert.equal(serialized.includes(code), false, 'the challenge stored the plaintext code');
    assert.match(String(challenge?.['codeHash']), /^[0-9a-f]{64}$/);
  });

  test('unknown and known numbers get identical responses (AUTH-012)', async () => {
    const unknown = await requestOtp('09120000009');
    await login();
    const known = await requestOtp();

    assert.equal(unknown.statusCode, known.statusCode);
    assert.deepEqual(unknown.json(), known.json());
  });

  test('an invalid mobile number is rejected with a field error', async () => {
    const response = await requestOtp('12345');
    assert.equal(response.statusCode, 422);
    const body = response.json<{ error: { fieldErrors: Array<{ field: string }> } }>();
    assert.equal(body.error.fieldErrors[0]?.field, 'mobile');
  });

  test('the resend interval is enforced', async () => {
    assert.equal((await requestOtp()).statusCode, 202);
    const second = await requestOtp();
    assert.equal(second.statusCode, 429);
  });

  test('excess requests are rate limited without issuing more codes (AUTH-002)', async () => {
    // Bypass the resend interval by using a different number for each request.
    const responses: number[] = [];
    for (let index = 0; index < config.auth.otpRequestsPerMobile + 2; index += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/otp/request',
        payload: { mobile: MOBILE },
        headers: { 'x-forwarded-for': '203.0.113.9' }
      });
      responses.push(response.statusCode);
      await fixture.database.db.collection(IDENTITY_COLLECTIONS.otpChallenges).deleteMany({});
    }
    assert.ok(responses.includes(429), 'the limiter never triggered');
  });
});

describe('OTP verification', () => {
  test('a valid code authenticates once and starts a session (AUTH-001)', async () => {
    await requestOtp();
    const code = await latestCode();

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/verify',
      payload: { mobile: MOBILE, code }
    });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json<{ profileComplete: boolean }>().profileComplete, false);

    // Reuse of the same code must fail.
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/verify',
      payload: { mobile: MOBILE, code }
    });
    assert.equal(replay.statusCode, 422);
  });

  test('a wrong code fails with the same generic error as an unknown number', async () => {
    await requestOtp();
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/verify',
      payload: { mobile: MOBILE, code: '000000' }
    });
    const unknownNumber = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/verify',
      payload: { mobile: '09129999999', code: '000000' }
    });

    assert.equal(wrong.statusCode, 422);
    assert.equal(unknownNumber.statusCode, 422);
    assert.deepEqual(
      wrong.json<{ error: { code: string } }>().error.code,
      unknownNumber.json<{ error: { code: string } }>().error.code
    );
  });

  test('an expired code is rejected', async () => {
    await requestOtp();
    const code = await latestCode();
    await fixture.database.db
      .collection(IDENTITY_COLLECTIONS.otpChallenges)
      .updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/verify',
      payload: { mobile: MOBILE, code }
    });
    assert.equal(response.statusCode, 422);
  });

  test('attempts are capped and the challenge locks', async () => {
    await requestOtp();
    for (let index = 0; index <= config.auth.otpMaxAttempts; index += 1) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/otp/verify',
        payload: { mobile: MOBILE, code: '111111' }
      });
    }

    // Even the correct code cannot rescue a locked challenge.
    const code = await latestCode();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/verify',
      payload: { mobile: MOBILE, code }
    });
    assert.equal(response.statusCode, 422);
  });

  test('a returning user reuses the same account (UC-001)', async () => {
    await login();
    const first = await fixture.database.db.collection(IDENTITY_COLLECTIONS.accounts).countDocuments();
    await login();
    const second = await fixture.database.db.collection(IDENTITY_COLLECTIONS.accounts).countDocuments();

    assert.equal(first, 1);
    assert.equal(second, 1, 'a second login created a duplicate account');
    assert.equal(
      await fixture.database.db.collection(IDENTITY_COLLECTIONS.identityMethods).countDocuments({ canonical: CANONICAL }),
      1
    );
  });
});

describe('sessions', () => {
  test('the session cookie is httpOnly and scoped', async () => {
    await requestOtp();
    const code = await latestCode();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/verify',
      payload: { mobile: MOBILE, code }
    });

    const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
    assert.equal(cookie?.httpOnly, true);
    assert.equal(cookie?.sameSite?.toLowerCase(), 'lax');
    assert.equal(cookie?.path, '/');
  });

  test('protected routes reject anonymous callers with 401', async () => {
    for (const url of ['/api/v1/account/profile', '/api/v1/account/sessions', '/api/v1/account/security-events']) {
      const response = await app.inject({ method: 'GET', url });
      assert.equal(response.statusCode, 401, `${url} was not protected`);
    }
  });

  test('a tampered or unknown token is not accepted', async () => {
    const token = await login();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/account/sessions',
      cookies: { [SESSION_COOKIE]: `${token}tampered` }
    });
    assert.equal(response.statusCode, 401);
  });

  test('logout revokes the session for subsequent requests (AUTH-006)', async () => {
    const token = await login();
    const cookies = { [SESSION_COOKIE]: token };

    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/account/sessions', cookies })).statusCode, 200);
    await app.inject({ method: 'POST', url: '/api/v1/auth/logout', cookies });
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/account/sessions', cookies })).statusCode, 401);
  });

  test('revoking other sessions leaves the current one working', async () => {
    const first = await login();
    const second = await login();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/account/sessions/revoke-others',
      cookies: { [SESSION_COOKIE]: second }
    });
    assert.equal(response.statusCode, 200);
    assert.ok(response.json<{ revoked: number }>().revoked >= 1);

    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/v1/account/sessions', cookies: { [SESSION_COOKIE]: first } }))
        .statusCode,
      401,
      'the older session was not revoked'
    );
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/v1/account/sessions', cookies: { [SESSION_COOKIE]: second } }))
        .statusCode,
      200
    );
  });

  test('security events are recorded and readable by the owner (AUTH-013)', async () => {
    const token = await login();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/account/security-events',
      cookies: { [SESSION_COOKIE]: token }
    });

    assert.equal(response.statusCode, 200);
    const types = response.json<Array<{ type: string }>>().map((event) => event.type);
    assert.ok(types.includes('session.created'));
  });
});

describe('profile', () => {
  const validProfile = { username: 'DragonPlayer', displayName: 'Dragon Player', birthDate: '2000-01-01' };

  test('a profile is created, normalized, and private by default', async () => {
    const token = await login();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/account/profile',
      cookies: { [SESSION_COOKIE]: token },
      payload: validProfile
    });

    assert.equal(response.statusCode, 200, response.body);
    const profile = response.json<{ username: string; visibility: string }>();
    assert.equal(profile.username, 'dragonplayer');
    // Privacy by default (DEC-043).
    assert.equal(profile.visibility, 'private');
  });

  test('an account below the minimum age is rejected (DEC-003)', async () => {
    const token = await login();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/account/profile',
      cookies: { [SESSION_COOKIE]: token },
      payload: { ...validProfile, birthDate: '2020-01-01' }
    });

    assert.equal(response.statusCode, 422);
    const body = response.json<{ error: { fieldErrors: Array<{ code: string }> } }>();
    assert.equal(body.error.fieldErrors[0]?.code, 'BELOW_MINIMUM_AGE');
  });

  test('a username cannot be taken twice', async () => {
    const first = await login();
    await app.inject({
      method: 'PUT',
      url: '/api/v1/account/profile',
      cookies: { [SESSION_COOKIE]: first },
      payload: validProfile
    });

    const second = await login('09121112233');
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/account/profile',
      cookies: { [SESSION_COOKIE]: second },
      payload: validProfile
    });

    assert.equal(response.statusCode, 422);
    assert.equal(
      response.json<{ error: { fieldErrors: Array<{ code: string }> } }>().error.fieldErrors[0]?.code,
      'USERNAME_TAKEN'
    );
  });

  test('a private profile is not publicly readable and looks missing (section 16.4)', async () => {
    const token = await login();
    await app.inject({
      method: 'PUT',
      url: '/api/v1/account/profile',
      cookies: { [SESSION_COOKIE]: token },
      payload: validProfile
    });

    const hidden = await app.inject({ method: 'GET', url: '/api/v1/players/dragonplayer' });
    assert.equal(hidden.statusCode, 404);

    await app.inject({
      method: 'PUT',
      url: '/api/v1/account/profile',
      cookies: { [SESSION_COOKIE]: token },
      payload: { ...validProfile, visibility: 'public' }
    });

    const visible = await app.inject({ method: 'GET', url: '/api/v1/players/dragonplayer' });
    assert.equal(visible.statusCode, 200);
    // Only public identity fields are exposed; no birth date, no contact.
    assert.deepEqual(Object.keys(visible.json<Record<string, unknown>>()).sort(), ['displayName', 'username']);
  });
});

describe('account state (AUTH-009, AUTH-010)', () => {
  test('a suspended account cannot use protected routes', async () => {
    const token = await login();
    const account = await fixture.database.db.collection(IDENTITY_COLLECTIONS.accounts).findOne({});
    assert.ok(account);

    await service.transitionAccountState(
      String(account?.['_id']),
      'suspended',
      createRequestContext('itest', SYSTEM_ACTOR),
      'integration test'
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/account/sessions',
      cookies: { [SESSION_COOKIE]: token }
    });
    assert.equal(response.statusCode, 403);
  });

  test('an invalid transition is rejected', async () => {
    await login();
    const account = await fixture.database.db.collection(IDENTITY_COLLECTIONS.accounts).findOne({});
    await assert.rejects(
      service.transitionAccountState(
        String(account?.['_id']),
        'anonymizing',
        createRequestContext('itest', SYSTEM_ACTOR),
        'invalid'
      ),
      /Cannot move an account/
    );
  });
});

describe('mock provider boundaries', () => {
  test('delivery failure is simulated deterministically without breaking the request', async () => {
    // The mock fails for numbers ending 0000 (DEC-041 failure simulation).
    const response = await requestOtp('09120000000');
    assert.equal(response.statusCode, 202);

    const delivery = await fixture.database.db
      .collection(IDENTITY_COLLECTIONS.smsDeliveries)
      .findOne({ recipientMasked: '+98912***00' });
    assert.equal(delivery?.['status'], 'failed');
  });

  test('the development inbox is a separate store from the delivery record', async () => {
    await requestOtp();
    const inbox = await fixture.database.db.collection(IDENTITY_COLLECTIONS.devSmsInbox).countDocuments();
    assert.equal(inbox, 1);
  });
});
