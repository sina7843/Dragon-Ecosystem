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

test('production without MONGODB_URI fails startup instead of guessing', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production' }),
    /MONGODB_URI is required when NODE_ENV=production/
  );
});

test('production accepts an explicit connection string', () => {
  const config = loadConfig({ NODE_ENV: 'production', MONGODB_URI: 'mongodb://mongo:27017/dragon' });
  assert.equal(config.env, 'production');
  assert.equal(config.mongoUri, 'mongodb://mongo:27017/dragon');
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
