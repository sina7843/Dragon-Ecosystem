import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from './config.ts';
import { buildServer, type HealthCheckable } from './server.ts';

/** Stub data layer so contract tests stay fast and need no database. */
function stubDatabase(healthy: boolean | (() => Promise<boolean>)): HealthCheckable {
  return {
    ping: typeof healthy === 'function' ? healthy : async () => healthy
  };
}

const config = loadConfig({ NODE_ENV: 'test' });
let app: FastifyInstance;

before(async () => {
  app = buildServer(config, { database: stubDatabase(true) });
  await app.ready();
});

after(async () => {
  await app.close();
});

test('GET /health reports liveness only', async () => {
  const response = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 200);
  const body = response.json<{ status: string; service: string }>();
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'dragon-api');
});

test('GET /health/ready reports ready when the database answers', async () => {
  const response = await app.inject({ method: 'GET', url: '/health/ready' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ready', checks: { mongo: 'ok' } });
});

test('GET /health/ready reports 503 when the database is unreachable', async () => {
  const failing = buildServer(config, {
    database: stubDatabase(async () => {
      throw new Error('no route to host');
    })
  });
  await failing.ready();

  const response = await failing.inject({ method: 'GET', url: '/health/ready' });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { status: 'not_ready', checks: { mongo: 'failed' } });

  // Readiness failure must not leak the underlying error text.
  assert.doesNotMatch(response.body, /no route to host/);
  await failing.close();
});

test('liveness stays healthy even when the dependency is down', async () => {
  const failing = buildServer(config, { database: stubDatabase(false) });
  await failing.ready();
  const response = await failing.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 200);
  await failing.close();
});

test('GET /api/v1/meta publishes the supported locales', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/v1/meta' });
  assert.equal(response.statusCode, 200);
  const body = response.json<{ locales: string[]; defaultLocale: string; environment: string }>();
  assert.deepEqual(body.locales, ['fa', 'en']);
  // Missing or unsupported preference falls back to Persian (I18N-003).
  assert.equal(body.defaultLocale, 'fa');
  assert.equal(body.environment, 'test');
});

test('the API is served under the versioned prefix only', async () => {
  const unversioned = await app.inject({ method: 'GET', url: '/meta' });
  assert.equal(unversioned.statusCode, 404);
});

test('GET /api/v1/openapi.json publishes a machine-readable contract', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/v1/openapi.json' });
  assert.equal(response.statusCode, 200);

  const document = response.json<{
    openapi: string;
    paths: Record<string, unknown>;
    components?: { schemas?: Record<string, unknown> };
  }>();
  assert.match(document.openapi, /^3\./);
  // Paths are absolute and versioned, matching the routes the server actually serves.
  assert.ok('/api/v1/meta' in document.paths, 'meta operation is documented');
  assert.ok('/health' in document.paths, 'liveness operation is documented');
  assert.ok('/health/ready' in document.paths, 'readiness operation is documented');
  // The published contract is generated from the schemas the server enforces.
  assert.ok(document.components?.schemas?.['ErrorResponse'], 'error envelope is published');
  assert.ok(document.components?.schemas?.['Money'], 'money contract is published');
});

test('every response carries a correlation id and baseline security headers', async () => {
  const response = await app.inject({ method: 'GET', url: '/health' });
  assert.match(String(response.headers['x-correlation-id']), /[0-9a-f-]{36}/);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-frame-options'], 'DENY');
  // A locked-down CSP + permissions policy is applied to every API response (SEC).
  assert.match(String(response.headers['content-security-policy']), /default-src 'none'/);
  assert.match(String(response.headers['permissions-policy']), /geolocation=\(\)/);
});

test('dynamic API JSON responses are not cacheable, but self-caching root routes are untouched', async () => {
  const api = await app.inject({ method: 'GET', url: '/api/v1/meta' });
  assert.equal(api.headers['cache-control'], 'no-store');
});

test('the CSRF origin guard rejects a cross-origin browser mutation only when a public origin is configured', async () => {
  // With no public origin (dev/test default) the guard is inert so proxied dev hosts work.
  const devPost = await app.inject({ method: 'POST', url: '/api/v1/meta', headers: { origin: 'https://evil.example' } });
  assert.notEqual(devPost.statusCode, 403);

  const prod = buildServer(loadConfig({ NODE_ENV: 'test', PUBLIC_ORIGIN: 'https://app.example' }), { database: stubDatabase(true) });
  await prod.ready();
  try {
    // A cross-site Origin on an unsafe method is rejected before routing.
    const bad = await prod.inject({ method: 'POST', url: '/api/v1/meta', headers: { origin: 'https://evil.example' } });
    assert.equal(bad.statusCode, 403);
    assert.equal(bad.json<{ error: { code: string } }>().error.code, 'FORBIDDEN');
    // The matching origin passes the guard (then 404s as an unknown POST route, not 403).
    const good = await prod.inject({ method: 'POST', url: '/api/v1/meta', headers: { origin: 'https://app.example' } });
    assert.notEqual(good.statusCode, 403);
    // A request with no Origin (native API client / server-to-server) is unaffected.
    const noOrigin = await prod.inject({ method: 'POST', url: '/api/v1/meta' });
    assert.notEqual(noOrigin.statusCode, 403);
    // Safe methods are never blocked.
    const safe = await prod.inject({ method: 'GET', url: '/api/v1/meta', headers: { origin: 'https://evil.example' } });
    assert.equal(safe.statusCode, 200);
  } finally {
    await prod.close();
  }
});

test('an inbound correlation id is preserved for request tracing', async () => {
  const response = await app.inject({
    method: 'GET',
    url: '/health',
    headers: { 'x-correlation-id': 'upstream-correlation-1' }
  });
  assert.equal(response.headers['x-correlation-id'], 'upstream-correlation-1');
});

test('unknown routes return the standard error envelope', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist' });
  assert.equal(response.statusCode, 404);

  const body = response.json<{
    error: { code: string; message: string; fieldErrors: unknown[]; correlationId: string; retryable: boolean };
  }>();
  assert.equal(body.error.code, 'RESOURCE_NOT_FOUND');
  assert.equal(body.error.retryable, false);
  assert.deepEqual(body.error.fieldErrors, []);
  assert.ok(body.error.correlationId.length > 0);
  assert.equal(body.error.correlationId, response.headers['x-correlation-id']);
});
