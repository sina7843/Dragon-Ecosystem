import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../../config.ts';
import { buildAdmin, buildIdentity, buildServer } from '../../server.ts';
import { allMigrations } from '../../migrations.ts';
import { runMigrations } from '../../shared/db/migrations.ts';
import { seedSystemConfiguration } from '../../shared/db/seed.ts';
import { createTestDatabase, type TestDatabase } from '../../shared/db/test-support.ts';
import { SESSION_COOKIE } from '../identity/index.ts';

/**
 * Fail-closed gating of the development-only /dev/grant-role route (security
 * hardening). The route must exist ONLY when ENABLE_DEV_ROUTES=true and the
 * environment is not production. Requires the disposable test database.
 */

let fixture: TestDatabase;

before(async () => {
  fixture = await createTestDatabase();
  await runMigrations(fixture.database.db, allMigrations);
  await seedSystemConfiguration(fixture.database.db);
});

after(async () => {
  await fixture.dispose();
});

/** Builds a server against the shared test database with the given env overrides. */
function buildWith(env: Record<string, string>): FastifyInstance {
  const config = loadConfig(env);
  return buildServer(config, {
    database: fixture.database,
    identity: buildIdentity(fixture.database, config),
    admin: buildAdmin(fixture.database)
  });
}

let counter = 5_000_000;
/** Creates a real account on the given app and returns its mobile. */
async function createAccount(app: FastifyInstance): Promise<string> {
  counter += 1;
  const mobile = `0912${String(counter)}`;
  await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { mobile } });
  const inbox = await app.inject({ method: 'GET', url: `/api/v1/dev/sms-inbox?mobile=${mobile}` });
  const code = inbox.json<Array<{ code: string }>>()[0]?.code as string;
  const verify = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { mobile, code } });
  assert.ok(verify.cookies.find((c) => c.name === SESSION_COOKIE));
  return mobile;
}

async function grantAttempt(app: FastifyInstance, mobile: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/dev/grant-role',
    payload: { mobile, role: 'content_publisher' }
  });
}

describe('/dev/grant-role registration is fail-closed', () => {
  test('missing flag in test → route is 404 (not registered)', async () => {
    const app = buildWith({ NODE_ENV: 'test' });
    await app.ready();
    try {
      const mobile = await createAccount(app);
      const response = await grantAttempt(app, mobile);
      // Even with a valid account, the route does not exist without the flag.
      assert.equal(response.statusCode, 404);
    } finally {
      await app.close();
    }
  });

  test('explicit false flag → route is 404', async () => {
    const app = buildWith({ NODE_ENV: 'test', ENABLE_DEV_ROUTES: 'false' });
    await app.ready();
    try {
      const mobile = await createAccount(app);
      assert.equal((await grantAttempt(app, mobile)).statusCode, 404);
    } finally {
      await app.close();
    }
  });

  test('explicit true in test → route is available and grants the role', async () => {
    const app = buildWith({ NODE_ENV: 'test', ENABLE_DEV_ROUTES: 'true' });
    await app.ready();
    try {
      const mobile = await createAccount(app);
      const response = await grantAttempt(app, mobile);
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json<{ granted: boolean }>().granted, true);
    } finally {
      await app.close();
    }
  });

  test('explicit true in development → route is available', async () => {
    const app = buildWith({ NODE_ENV: 'development', ENABLE_DEV_ROUTES: 'true' });
    await app.ready();
    try {
      const mobile = await createAccount(app);
      assert.equal((await grantAttempt(app, mobile)).statusCode, 200);
    } finally {
      await app.close();
    }
  });

  test('production with the flag set → route is still 404', async () => {
    const app = buildWith({
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://mongo:27017/dragon',
      AUTH_SECRET: 'x'.repeat(32),
      PAYMENTS_CALLBACK_SECRET: 'x'.repeat(32),
      ANALYTICS_PSEUDONYM_SALT: 'x'.repeat(32),
      STREAM_SECURE_LINK_SECRET: 'x'.repeat(32),
      PUBLIC_ORIGIN: 'https://dragon.example',
      ENABLE_DEV_ROUTES: 'true'
    });
    await app.ready();
    try {
      // The production build never registers the route, even with a valid account
      // and the flag explicitly set. Create the account under a dev app so the row
      // exists; the production app must still refuse to expose the route.
      const devApp = buildWith({ NODE_ENV: 'test', ENABLE_DEV_ROUTES: 'true' });
      await devApp.ready();
      const mobile = await createAccount(devApp);
      await devApp.close();

      assert.equal((await grantAttempt(app, mobile)).statusCode, 404);
    } finally {
      await app.close();
    }
  });
});
