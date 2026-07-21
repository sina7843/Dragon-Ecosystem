/**
 * Proves MongoDB data survives an ordinary Compose stop/start (TEST-025, OPS-004).
 *
 * The check never deletes volumes: it only stops and starts the `mongo` service.
 * There is no application backup or restore step, per DEC-038.
 *
 * Usage: npm run verify:persistence
 */
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const SERVICE = 'mongo';
const DATABASE = 'dragon';
const COLLECTION = 'persistence_checks';
const MARKER_ID = 'dragon-00-persistence';
const HEALTH_TIMEOUT_MS = 120_000;
const HEALTH_POLL_MS = 2_000;

function compose(args, { capture = true } = {}) {
  return execFileSync('docker', ['compose', ...args], {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
}

/** Runs a mongosh expression inside the running container and returns trimmed stdout. */
function mongosh(expression) {
  return compose(['exec', '-T', SERVICE, 'mongosh', '--quiet', DATABASE, '--eval', expression]).trim();
}

function serviceHealth() {
  const raw = compose(['ps', '--format', 'json', SERVICE]).trim();
  if (raw === '') return 'missing';
  // `docker compose ps --format json` emits one JSON object per line.
  const line = raw.split('\n').filter(Boolean).at(-1);
  return JSON.parse(line).Health || 'unknown';
}

async function waitForHealthy(label) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  for (;;) {
    const health = serviceHealth();
    if (health === 'healthy') {
      console.log(`  ${label}: healthy`);
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${SERVICE} to become healthy (last state: ${health}).`);
    }
    await sleep(HEALTH_POLL_MS);
  }
}

async function main() {
  console.log('MongoDB persistence check (no volumes are removed)\n');

  console.log('1. Starting the mongo service');
  compose(['up', '-d', SERVICE]);
  await waitForHealthy('mongo');

  console.log('2. Writing a marker document');
  const writtenAt = new Date().toISOString();
  mongosh(
    `db.${COLLECTION}.replaceOne(` +
      `{_id:"${MARKER_ID}"},` +
      `{_id:"${MARKER_ID}", writtenAt:"${writtenAt}", prompt:"DRAGON-00"},` +
      `{upsert:true})`
  );
  const beforeRestart = mongosh(`JSON.stringify(db.${COLLECTION}.findOne({_id:"${MARKER_ID}"}))`);
  console.log(`  stored: ${beforeRestart}`);

  console.log('3. Stopping the mongo service');
  compose(['stop', SERVICE]);

  console.log('4. Starting the mongo service again');
  compose(['start', SERVICE]);
  await waitForHealthy('mongo');

  console.log('5. Reading the marker document back');
  const afterRestart = mongosh(`JSON.stringify(db.${COLLECTION}.findOne({_id:"${MARKER_ID}"}))`);
  console.log(`  found:  ${afterRestart}`);

  if (afterRestart === 'null' || afterRestart === '') {
    throw new Error('Persistence check FAILED: the marker document did not survive the restart.');
  }
  const parsed = JSON.parse(afterRestart);
  if (parsed.writtenAt !== writtenAt) {
    throw new Error(
      `Persistence check FAILED: expected writtenAt "${writtenAt}" but found "${parsed.writtenAt}".`
    );
  }

  console.log('\nPASS: committed MongoDB data survived a Compose stop/start on the named volume.');
}

try {
  await main();
} catch (error) {
  console.error(`\nFAIL: ${error.message}`);
  process.exitCode = 1;
}
