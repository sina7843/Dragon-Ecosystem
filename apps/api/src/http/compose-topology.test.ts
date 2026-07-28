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
 *
 * The web service's *host* port is configurable through `WEB_PORT` (a host may already
 * have reserved 8080), so the public mapping is parsed rather than matched as a literal
 * string. The contract that stays fixed is asserted piece by piece: one published mapping,
 * container target 8080, default host 8080, and nothing else in the stack published.
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

/**
 * The published port mappings a service block declares, unquoted, in order.
 *
 * Returns an empty list when the service declares no `ports:` key at all, which is the
 * normal state for every service except `web`.
 */
function publishedPorts(block: string): string[] {
  const lines = block.split('\n');
  const start = lines.findIndex((line) => /^\s*ports:\s*$/.test(line));
  if (start === -1) return [];
  const entries: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (/^\s*#/.test(line) || line.trim() === '') continue; // comment or blank line
    const item = /^\s*-\s*(.+?)\s*$/.exec(line);
    if (item === null) break; // the list ended and the next key started
    entries.push((item[1] as string).replace(/^["']|["']$/g, ''));
  }
  return entries;
}

/**
 * The one shape the public mapping may take: `host:container`, where the host part is
 * either a literal port or a `${VAR:-default}` substitution carrying its default.
 *
 * Anything else — an added interface prefix, a bare container port, a second variable
 * without a default — fails to match and therefore fails the test, which is the point:
 * the host port is configurable, the contract around it is not.
 */
const PUBLISHED_MAPPING = /^(?:(?<literal>\d{1,5})|\$\{(?<variable>[A-Z][A-Z0-9_]*):-(?<fallback>\d{1,5})\}):(?<container>\d{1,5})$/;

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

  /**
   * The host port is deliberately configurable (`WEB_PORT`) so a host that has already
   * reserved 8080 can move it, but everything around it is fixed. This parses the mapping
   * instead of substring-matching it, so the default, the container target, and the number
   * of published mappings are each asserted separately and a change to any one of them
   * fails on its own.
   */
  test('nginx publishes exactly one mapping, defaulting to host 8080', () => {
    const mappings = publishedPorts(web);
    assert.equal(mappings.length, 1, `web must publish exactly one mapping, found ${JSON.stringify(mappings)}`);

    const parsed = PUBLISHED_MAPPING.exec(mappings[0] as string);
    assert.notEqual(parsed, null, `web port mapping "${mappings[0] as string}" is not a recognised host:container form`);
    const { literal, fallback, container } = parsed?.groups ?? {};

    // The container target never changes: nginx listens on 8080 inside the image.
    assert.equal(container, '8080', 'the container port must remain 8080');
    // The default host port never changes either; only an explicit override moves it.
    assert.equal(literal ?? fallback, '8080', 'the default host port must remain 8080');
  });

  test('web is the only service that publishes a host port', () => {
    assert.deepEqual(publishedPorts(api), [], 'api must publish nothing');
    assert.deepEqual(publishedPorts(mongo), [], 'mongo must publish nothing');
    assert.equal(publishedPorts(web).length, 1, 'web is the single public entry point');
    // Belt and braces across the whole file: exactly one `ports:` key exists in the stack.
    assert.equal((compose.match(/^\s{4}ports:\s*$/gm) ?? []).length, 1, 'only one service may declare ports');
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
