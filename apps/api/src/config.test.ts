import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from './config.ts';

test('applies safe development defaults when nothing is set', () => {
  const config = loadConfig({});
  assert.equal(config.env, 'development');
  assert.equal(config.port, 3000);
  assert.equal(config.host, '0.0.0.0');
  // Internal Compose address, never a published host port (IMPLEMENTATION_DECISIONS section 8).
  assert.equal(config.mongoUri, 'mongodb://mongo:27017/dragon');
});

const PRODUCTION_SECRET = 'x'.repeat(32);

test('production without MONGODB_URI fails startup instead of guessing', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', AUTH_SECRET: PRODUCTION_SECRET }),
    /MONGODB_URI is required when NODE_ENV=production/
  );
});

test('production without AUTH_SECRET fails startup', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', MONGODB_URI: 'mongodb://mongo:27017/dragon' }),
    /AUTH_SECRET is required when NODE_ENV=production/
  );
});

test('a short AUTH_SECRET is rejected', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', MONGODB_URI: 'mongodb://mongo:27017/dragon', AUTH_SECRET: 'short' }),
    /at least 32 characters/
  );
});

test('production accepts an explicit connection string and secret', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    MONGODB_URI: 'mongodb://mongo:27017/dragon',
    AUTH_SECRET: PRODUCTION_SECRET
  });
  assert.equal(config.env, 'production');
  assert.equal(config.mongoUri, 'mongodb://mongo:27017/dragon');
  assert.equal(config.auth.secret, PRODUCTION_SECRET);
});

test('trusted proxies default to none, so request.ip is the real peer in dev and test', () => {
  assert.deepEqual(loadConfig({}).trustedProxies, []);
});

test('trusted proxies parse from a comma-separated list of IPs and CIDRs', () => {
  assert.deepEqual(loadConfig({ TRUSTED_PROXIES: '172.28.0.10' }).trustedProxies, ['172.28.0.10']);
  assert.deepEqual(
    loadConfig({ TRUSTED_PROXIES: '172.28.0.10, 10.0.0.0/8 , loopback' }).trustedProxies,
    ['172.28.0.10', '10.0.0.0/8', 'loopback']
  );
});

test('an invalid trusted-proxy entry fails startup', () => {
  assert.throws(() => loadConfig({ TRUSTED_PROXIES: 'not-an-ip' }), /TRUSTED_PROXIES entry "not-an-ip"/);
  assert.throws(() => loadConfig({ TRUSTED_PROXIES: '999.1.1.1' }), /TRUSTED_PROXIES entry "999\.1\.1\.1"/);
  assert.throws(() => loadConfig({ TRUSTED_PROXIES: '10.0.0.0/40' }), /TRUSTED_PROXIES entry "10\.0\.0\.0\/40"/);
});

test('OTP security settings are configurable with safe defaults (section 16.1)', () => {
  const defaults = loadConfig({}).auth;
  assert.equal(defaults.otpTtlSeconds, 120);
  assert.equal(defaults.otpMaxAttempts, 5);

  const custom = loadConfig({ OTP_TTL_SECONDS: '300', OTP_MAX_ATTEMPTS: '3' }).auth;
  assert.equal(custom.otpTtlSeconds, 300);
  assert.equal(custom.otpMaxAttempts, 3);

  assert.throws(() => loadConfig({ OTP_TTL_SECONDS: '0' }), /OTP_TTL_SECONDS must be a positive integer/);
});

test('rejects an unknown environment', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'staging-ish' }), /NODE_ENV must be one of/);
});

test('rejects a non-numeric or out-of-range port', () => {
  assert.throws(() => loadConfig({ PORT: 'http' }), /PORT must be an integer/);
  assert.throws(() => loadConfig({ PORT: '70000' }), /PORT must be an integer/);
});

test('rejects a connection string that is not a MongoDB URI', () => {
  assert.throws(() => loadConfig({ MONGODB_URI: 'postgres://localhost/dragon' }), /must start with mongodb/);
});

test('reports every problem in one failure', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', PORT: 'nope' }),
    (error: unknown) => {
      const message = String(error);
      assert.match(message, /PORT must be an integer/);
      assert.match(message, /MONGODB_URI is required/);
      return true;
    }
  );
});
