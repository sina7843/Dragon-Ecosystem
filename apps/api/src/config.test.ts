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

/** Every value a production startup requires. Extended as new required secrets land. */
const PRODUCTION_BASE: Readonly<Record<string, string>> = {
  NODE_ENV: 'production',
  MONGODB_URI: 'mongodb://mongo:27017/dragon',
  AUTH_SECRET: PRODUCTION_SECRET,
  PAYMENTS_CALLBACK_SECRET: PRODUCTION_SECRET,
  ANALYTICS_PSEUDONYM_SALT: PRODUCTION_SECRET,
  STREAM_SECURE_LINK_SECRET: PRODUCTION_SECRET,
  PUBLIC_ORIGIN: 'https://dragon.example'
};

test('production accepts an explicit connection string and secret', () => {
  const config = loadConfig({ ...PRODUCTION_BASE });
  assert.equal(config.env, 'production');
  assert.equal(config.mongoUri, 'mongodb://mongo:27017/dragon');
  assert.equal(config.auth.secret, PRODUCTION_SECRET);
});

test('production without PAYMENTS_CALLBACK_SECRET fails startup (callbacks must be verifiable)', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', MONGODB_URI: 'mongodb://mongo:27017/dragon', AUTH_SECRET: PRODUCTION_SECRET }),
    /PAYMENTS_CALLBACK_SECRET is required when NODE_ENV=production/
  );
});

test('the mock payment provider is fail-closed: off in production unless explicitly enabled', () => {
  // Defaults on outside production; a dev placeholder callback secret is used.
  assert.equal(loadConfig({}).payments.mockEnabled, true);
  assert.equal(loadConfig({ PAYMENTS_MOCK_ENABLED: 'false' }).payments.mockEnabled, false);
  // Production: off by default even with a callback secret present.
  assert.equal(loadConfig({ ...PRODUCTION_BASE }).payments.mockEnabled, false);
  // Production: on only when explicitly set.
  assert.equal(loadConfig({ ...PRODUCTION_BASE, PAYMENTS_MOCK_ENABLED: 'true' }).payments.mockEnabled, true);
});

test('trusted proxies default to none, so request.ip is the real peer in dev and test', () => {
  assert.deepEqual(loadConfig({}).trustedProxies, []);
});

test('paid tournament checkout is fail-closed: off unless explicitly enabled (OD-007)', () => {
  assert.equal(loadConfig({}).paidTournamentsEnabled, false);
  assert.equal(loadConfig({ PAID_TOURNAMENTS_ENABLED: 'false' }).paidTournamentsEnabled, false);
  assert.equal(loadConfig({ PAID_TOURNAMENTS_ENABLED: '1' }).paidTournamentsEnabled, false);
  assert.equal(loadConfig({ PAID_TOURNAMENTS_ENABLED: 'true' }).paidTournamentsEnabled, true);
});

test('notification SMS and email channels are fail-closed (OD-008 / OD-003)', () => {
  assert.equal(loadConfig({}).notificationsSmsEnabled, false);
  assert.equal(loadConfig({}).notificationsEmailEnabled, false);
  assert.equal(loadConfig({ NOTIFICATIONS_SMS_ENABLED: '1' }).notificationsSmsEnabled, false);
  assert.equal(loadConfig({ NOTIFICATIONS_SMS_ENABLED: 'true' }).notificationsSmsEnabled, true);
  assert.equal(loadConfig({ NOTIFICATIONS_EMAIL_ENABLED: 'true' }).notificationsEmailEnabled, true);
});

test('external analytics forwarding is fail-closed (OD-026)', () => {
  assert.equal(loadConfig({}).analyticsExternalEnabled, false);
  assert.equal(loadConfig({ ANALYTICS_EXTERNAL_ENABLED: '1' }).analyticsExternalEnabled, false);
  assert.equal(loadConfig({ ANALYTICS_EXTERNAL_ENABLED: 'TRUE' }).analyticsExternalEnabled, true);
});

test('the analytics pseudonym salt is production-required and length-checked (not a source constant)', () => {
  // Production fails fast without it, so no deployment pseudonymizes with a committed salt.
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', MONGODB_URI: 'mongodb://mongo:27017/dragon', AUTH_SECRET: PRODUCTION_SECRET, PAYMENTS_CALLBACK_SECRET: PRODUCTION_SECRET }),
    /ANALYTICS_PSEUDONYM_SALT is required when NODE_ENV=production/
  );
  // A too-short salt is rejected.
  const problems = () => loadConfig({ NODE_ENV: 'production', MONGODB_URI: 'mongodb://mongo:27017/dragon', AUTH_SECRET: PRODUCTION_SECRET, PAYMENTS_CALLBACK_SECRET: PRODUCTION_SECRET, ANALYTICS_PSEUDONYM_SALT: 'short' });
  assert.throws(problems, /ANALYTICS_PSEUDONYM_SALT must be at least/);
  // Development uses a placeholder without failing.
  assert.equal(typeof loadConfig({}).pseudonymSalt, 'string');
  assert.notEqual(loadConfig({}).pseudonymSalt, '');
});

test('PUBLIC_ORIGIN is production-required (the CSRF origin guard depends on it) and format-checked', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', MONGODB_URI: 'mongodb://mongo:27017/dragon', AUTH_SECRET: PRODUCTION_SECRET, PAYMENTS_CALLBACK_SECRET: PRODUCTION_SECRET, ANALYTICS_PSEUDONYM_SALT: PRODUCTION_SECRET }),
    /PUBLIC_ORIGIN is required when NODE_ENV=production/
  );
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', MONGODB_URI: 'mongodb://mongo:27017/dragon', AUTH_SECRET: PRODUCTION_SECRET, PAYMENTS_CALLBACK_SECRET: PRODUCTION_SECRET, ANALYTICS_PSEUDONYM_SALT: PRODUCTION_SECRET, PUBLIC_ORIGIN: 'not-an-origin' }),
    /PUBLIC_ORIGIN must be an absolute origin/
  );
  // Outside production it is optional and empty is allowed.
  assert.equal(loadConfig({}).publicOrigin, '');
});

test('media size cap defaults to 5 MB and honours a valid override; public origin trims trailing slashes', () => {
  assert.equal(loadConfig({}).mediaMaxBytes, 5_000_000);
  assert.equal(loadConfig({ MEDIA_MAX_BYTES: '1048576' }).mediaMaxBytes, 1_048_576);
  assert.equal(loadConfig({}).publicOrigin, '');
  assert.equal(loadConfig({ PUBLIC_ORIGIN: 'https://dragon.example//' }).publicOrigin, 'https://dragon.example');
});

test('SMS provider: mock outside production, Kavenegar in production or on explicit request', () => {
  const creds = { KAVENEGAR_API_KEY: 'k-abc', KAVENEGAR_SENDER: '10004346', KAVENEGAR_OTP_TEMPLATE: 'dragon-otp' };
  const productionBase = PRODUCTION_BASE;

  // No key: the deterministic mock.
  assert.deepEqual(loadConfig({}).sms, { provider: 'mock', kavenegar: null });

  // Development/test keep the mock even with a key, so the dev OTP inbox that local
  // sign-in, the seeder, and the browser suite depend on keeps being written.
  assert.equal(loadConfig({ ...creds }).sms.provider, 'mock');
  assert.equal(loadConfig({ NODE_ENV: 'test', ...creds }).sms.provider, 'mock');

  // Production with a key selects the real provider and carries the credentials through.
  const prod = loadConfig({ ...productionBase, ...creds }).sms;
  assert.equal(prod.provider, 'kavenegar');
  assert.deepEqual(prod.kavenegar, { apiKey: 'k-abc', sender: '10004346', otpTemplate: 'dragon-otp' });

  // Explicit opt-in forces the real provider anywhere (local delivery smoke-test).
  assert.equal(loadConfig({ SMS_PROVIDER: 'kavenegar', ...creds }).sms.provider, 'kavenegar');
  // Explicit mock wins even in production.
  assert.equal(loadConfig({ ...productionBase, ...creds, SMS_PROVIDER: 'mock' }).sms.provider, 'mock');

  // Selecting the real provider without credentials is a hard configuration error.
  assert.throws(() => loadConfig({ SMS_PROVIDER: 'kavenegar' }), /KAVENEGAR_API_KEY is required/);
  assert.throws(() => loadConfig({ SMS_PROVIDER: 'kavenegar', KAVENEGAR_API_KEY: 'k-abc' }), /KAVENEGAR_OTP_TEMPLATE is required/);
  assert.throws(() => loadConfig({ SMS_PROVIDER: 'sms.ir' }), /SMS_PROVIDER must be/);
});

test('dev routes are fail-closed: enabled only by an explicit flag, never in production', () => {
  // Default: off.
  assert.equal(loadConfig({}).devRoutesEnabled, false);
  assert.equal(loadConfig({ NODE_ENV: 'test' }).devRoutesEnabled, false);
  // A non-"true" value stays off.
  assert.equal(loadConfig({ ENABLE_DEV_ROUTES: 'false' }).devRoutesEnabled, false);
  assert.equal(loadConfig({ ENABLE_DEV_ROUTES: '1' }).devRoutesEnabled, false);
  // Explicit true in development or test enables it.
  assert.equal(loadConfig({ NODE_ENV: 'development', ENABLE_DEV_ROUTES: 'true' }).devRoutesEnabled, true);
  assert.equal(loadConfig({ NODE_ENV: 'test', ENABLE_DEV_ROUTES: 'true' }).devRoutesEnabled, true);
  // Production never enables it, even with the flag set.
  assert.equal(loadConfig({ ...PRODUCTION_BASE, ENABLE_DEV_ROUTES: 'true' }).devRoutesEnabled, false);
});

test('the streaming provider boundary refuses the uncontracted provider (OD-013)', () => {
  // Only the deterministic stub is implemented; the default and an explicit "stub" agree.
  assert.equal(loadConfig({}).streaming.provider, 'stub');
  assert.equal(loadConfig({ STREAMING_PROVIDER: 'stub' }).streaming.provider, 'stub');
  // Naming the contracted provider fails startup loudly rather than running against an
  // adapter whose capabilities have never been validated in a sandbox.
  assert.throws(() => loadConfig({ STREAMING_PROVIDER: 'arvan' }), /OD-013/);
  assert.throws(() => loadConfig({ STREAMING_PROVIDER: 'cloudflare' }), /STREAMING_PROVIDER must be "stub"/);
});

test('stream archive and takedown are fail-closed until the rights policy is approved (OD-014)', () => {
  assert.equal(loadConfig({}).streaming.rightsPolicyApproved, false);
  assert.equal(loadConfig({ STREAM_RIGHTS_POLICY_APPROVED: '1' }).streaming.rightsPolicyApproved, false);
  assert.equal(loadConfig({ STREAM_RIGHTS_POLICY_APPROVED: 'TRUE' }).streaming.rightsPolicyApproved, true);
});

test('the stream secure-link secret is production-required and length-checked', () => {
  const { STREAM_SECURE_LINK_SECRET: _omitted, ...withoutSecret } = PRODUCTION_BASE;
  assert.throws(() => loadConfig(withoutSecret), /STREAM_SECURE_LINK_SECRET is required when NODE_ENV=production/);
  assert.throws(
    () => loadConfig({ ...PRODUCTION_BASE, STREAM_SECURE_LINK_SECRET: 'short' }),
    /STREAM_SECURE_LINK_SECRET must be at least/
  );
  // Development uses a placeholder rather than failing, and the link TTL has a safe default.
  assert.notEqual(loadConfig({}).streaming.secureLinkSecret, '');
  assert.equal(loadConfig({}).streaming.playbackTtlSeconds, 300);
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
