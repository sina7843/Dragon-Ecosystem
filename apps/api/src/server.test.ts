import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from './config.ts';
import { buildServer } from './server.ts';

let app: FastifyInstance;

before(async () => {
  app = buildServer(loadConfig({ NODE_ENV: 'test' }));
  await app.ready();
});

after(async () => {
  await app.close();
});

test('GET /health reports liveness', async () => {
  const response = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 200);
  const body = response.json<{ status: string; service: string }>();
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'dragon-api');
});

test('GET /api/v1/meta publishes the supported locales', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/v1/meta' });
  assert.equal(response.statusCode, 200);
  const body = response.json<{ locales: string[]; defaultLocale: string }>();
  assert.deepEqual(body.locales, ['fa', 'en']);
  // Missing or unsupported preference falls back to Persian (I18N-003).
  assert.equal(body.defaultLocale, 'fa');
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
  const body = response.json<{ error: { code: string; correlationId: string; retryable: boolean } }>();
  assert.equal(body.error.code, 'RESOURCE_NOT_FOUND');
  assert.equal(body.error.retryable, false);
  assert.ok(body.error.correlationId.length > 0);
});
