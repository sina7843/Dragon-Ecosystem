/**
 * Starts the throwaway test database and waits until it reports healthy.
 * Used by `npm run test:integration` and `npm run e2e`.
 */
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const COMPOSE_FILE = 'docker-compose.test.yml';
const SERVICE = 'mongo-test';
const TIMEOUT_MS = 120_000;
const POLL_MS = 2_000;

function compose(args) {
  return execFileSync('docker', ['compose', '-f', COMPOSE_FILE, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function health() {
  const raw = compose(['ps', '--format', 'json', SERVICE]).trim();
  if (raw === '') return 'missing';
  const line = raw.split('\n').filter(Boolean).at(-1);
  return JSON.parse(line).Health || 'unknown';
}

compose(['up', '-d', SERVICE]);

const deadline = Date.now() + TIMEOUT_MS;
for (;;) {
  const state = health();
  if (state === 'healthy') {
    console.log(`${SERVICE} is healthy on 127.0.0.1:27018`);
    break;
  }
  if (Date.now() > deadline) {
    console.error(`Timed out waiting for ${SERVICE} (last state: ${state}).`);
    process.exitCode = 1;
    break;
  }
  await sleep(POLL_MS);
}
