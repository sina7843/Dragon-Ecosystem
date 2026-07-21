import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

/**
 * Static guard on the Compose topology (DRAGON-03 security remediation).
 *
 * The default stack must not publish the API to the host: browsers reach the API
 * only through nginx. This reads the Compose files directly, so a regression that
 * re-adds the host port fails the check without needing Docker.
 */

// apps/api/src/http/ -> repository root
const root = new URL('../../../../', import.meta.url);

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, root)), 'utf8');
}

/** Extracts one 2-space-indented service block from a compose file's services map. */
function serviceBlock(compose: string, name: string): string {
  const lines = compose.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${name}:`);
  assert.notEqual(start, -1, `service ${name} not found`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    // Next top-level key or next sibling service ends the block.
    if (/^\S/.test(line) || /^ {2}\S/.test(line)) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

describe('default docker-compose.yml', () => {
  const compose = read('docker-compose.yml');
  const api = serviceBlock(compose, 'api');
  const web = serviceBlock(compose, 'web');
  const mongo = serviceBlock(compose, 'mongo');

  test('the api service publishes no host port', () => {
    assert.equal(/^\s*ports:/m.test(api), false, 'api must not declare a ports mapping');
    assert.equal(/3000:3000/.test(api), false, 'api must not publish 3000 to the host');
  });

  test('nothing in the stack publishes port 3000 to the host', () => {
    // A published mapping is `host:container` (optionally `ip:host:container`), so
    // it always has a numeric host part before `:3000`. The bare internal `expose`
    // entry (`"3000"`) and the `PORT: "3000"` env var have no such colon form.
    assert.equal(/\d+:3000\b/.test(compose), false, 'a host:container mapping to 3000 is present');
  });

  test('nginx remains the public entry point on 8080', () => {
    assert.match(web, /8080:8080/);
  });

  test('mongo never publishes a host port', () => {
    assert.equal(/27017:27017/.test(mongo), false);
    assert.equal(/^\s*ports:/m.test(mongo), false);
  });

  test('the api trusts nginx as its reverse proxy', () => {
    assert.match(api, /TRUSTED_PROXIES:\s*172\.28\.0\.10/);
    assert.match(web, /ipv4_address:\s*172\.28\.0\.10/);
  });
});

describe('docker-compose.test.yml', () => {
  const composeTest = read('docker-compose.test.yml');

  test('the approved loopback-only Mongo test binding is unchanged', () => {
    assert.match(composeTest, /127\.0\.0\.1:27018:27017/);
    // It must never bind to all interfaces.
    assert.equal(/(?:^|\s)-\s*["']?27018:27017/m.test(composeTest), false);
  });
});
