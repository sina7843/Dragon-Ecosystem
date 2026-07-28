import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../config.ts';
import { buildServer, resolveTrustProxy, type HealthCheckable } from '../server.ts';

/**
 * Regression coverage for the DRAGON-03 security remediation: the per-IP OTP
 * rate limit must key on the real client behind the proxy, and a direct or
 * untrusted caller must not be able to spoof X-Forwarded-For (SEC-009).
 *
 * The rate-limit bucket is a pure function of `request.ip`
 * (service.ts `bucketKey('otp:ip', input.ip)`), so proving the resolved client
 * IP is correct proves the bucketing is correct.
 */

const stubDatabase: HealthCheckable = { ping: async () => true };
const servers: FastifyInstance[] = [];

after(async () => {
  await Promise.all(servers.map((server) => server.close()));
});

/** Builds a real server with the given env overrides and tracks it for cleanup. */
async function serverWith(env: Record<string, string>): Promise<FastifyInstance> {
  const config = loadConfig({ NODE_ENV: 'test', ...env });
  const app = buildServer(config, { database: stubDatabase });
  await app.ready();
  servers.push(app);
  return app;
}

async function resolvedIp(app: FastifyInstance, forwardedFor?: string): Promise<string> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/dev/client-ip',
    headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor }
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<{ ip: string }>().ip;
}

describe('resolveTrustProxy', () => {
  test('an empty list trusts nothing (real socket peer, correct for dev and test)', () => {
    assert.equal(resolveTrustProxy([]), false);
  });

  test('a non-empty list is passed through as explicit trusted addresses', () => {
    assert.deepEqual(resolveTrustProxy(['172.28.0.10']), ['172.28.0.10']);
    assert.deepEqual(resolveTrustProxy(['172.28.0.10', '10.0.0.0/8']), ['172.28.0.10', '10.0.0.0/8']);
  });

  test('it never returns true or a hop count', () => {
    // Guards against a regression to an unrestricted or spoofable configuration.
    const result = resolveTrustProxy(['loopback']);
    assert.notEqual(result, true);
    assert.equal(typeof result, 'object');
  });
});

describe('trusted forwarding gives distinct client IP buckets', () => {
  test('X-Forwarded-For from the trusted peer becomes the client IP', async () => {
    // inject connects from 127.0.0.1, so trust that as the proxy.
    const app = await serverWith({ TRUSTED_PROXIES: '127.0.0.1' });

    const first = await resolvedIp(app, '203.0.113.7');
    const second = await resolvedIp(app, '198.51.100.9');

    assert.equal(first, '203.0.113.7');
    assert.equal(second, '198.51.100.9');
    // Different forwarded clients resolve to different IPs, hence different buckets.
    assert.notEqual(first, second);
  });

  test('only the address nginx appends is trusted, not one the browser injected', async () => {
    const app = await serverWith({ TRUSTED_PROXIES: '127.0.0.1' });
    // nginx appends the real peer as the rightmost entry; a client-supplied value
    // sits to its left and must be ignored.
    const ip = await resolvedIp(app, '9.9.9.9, 203.0.113.7');
    assert.equal(ip, '203.0.113.7');
  });
});

describe('untrusted and direct requests cannot spoof X-Forwarded-For', () => {
  test('with no trusted proxy the header is ignored and the socket peer wins', async () => {
    const app = await serverWith({});
    const ip = await resolvedIp(app, '203.0.113.7');
    assert.equal(ip, '127.0.0.1');
  });

  test('a peer outside the trusted set cannot spoof, even with the production proxy configured', async () => {
    // The real production value: only nginx's fixed address is trusted. The inject
    // peer (127.0.0.1) is not that address, so its forwarded-for is ignored.
    const app = await serverWith({ TRUSTED_PROXIES: '172.28.0.10' });
    const ip = await resolvedIp(app, '203.0.113.7');
    assert.equal(ip, '127.0.0.1');
  });

  test('a peer outside a trusted CIDR cannot spoof', async () => {
    const app = await serverWith({ TRUSTED_PROXIES: '10.0.0.0/8' });
    const ip = await resolvedIp(app, '203.0.113.7');
    assert.equal(ip, '127.0.0.1');
  });
});

describe('the client-ip probe is development and test only', () => {
  test('it is not registered in production', async () => {
    const app = await serverWith({
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://mongo:27017/dragon',
      AUTH_SECRET: 'x'.repeat(32),
      PAYMENTS_CALLBACK_SECRET: 'x'.repeat(32),
      ANALYTICS_PSEUDONYM_SALT: 'x'.repeat(32),
      STREAM_SECURE_LINK_SECRET: 'x'.repeat(32),
      PUBLIC_ORIGIN: 'https://dragon.example',
      TRUSTED_PROXIES: '172.28.0.10'
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/dev/client-ip' });
    assert.equal(response.statusCode, 404);
  });
});
