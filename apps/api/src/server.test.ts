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
