import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

/**
 * Static guard on the served cache policy (PERF-009).
 *
 * Reads `nginx.conf` directly, the same approach `compose-topology.test.ts` takes for the
 * Compose topology, so a regression fails without needing Docker or a running container.
 *
 * The contract being guarded is the pair, not either half alone: hashed bundles may be kept
 * forever *because* `index.html` is never kept. Caching both would pin a browser to a stale
 * deployment; caching neither throws away the only cheap win the build's content hashing
 * already paid for.
 */

// apps/web/src/ -> apps/web/
const config = readFileSync(fileURLToPath(new URL('../nginx.conf', import.meta.url)), 'utf8');

/** The body of one `location <match> { … }` block, brace-matched. */
function locationBlock(match: string): string {
  const header = `location ${match} {`;
  const start = config.indexOf(header);
  assert.notEqual(start, -1, `no location block for "${match}"`);
  let depth = 0;
  for (let i = start + header.length - 1; i < config.length; i += 1) {
    if (config[i] === '{') depth += 1;
    else if (config[i] === '}') {
      depth -= 1;
      if (depth === 0) return config.slice(start, i + 1);
    }
  }
  assert.fail(`unterminated location block for "${match}"`);
}

describe('static cache policy (PERF-009)', () => {
  test('content-hashed bundles are cached long-term and immutably', () => {
    const assets = locationBlock('/assets/');
    const header = /add_header\s+Cache-Control\s+"([^"]+)"/.exec(assets);
    assert.notEqual(header, null, '/assets/ sets no Cache-Control');
    const value = header?.[1] as string;
    assert.match(value, /public/, 'hashed assets are publicly cacheable');
    assert.match(value, /immutable/, 'hashed assets never need revalidation');
    const maxAge = /max-age=(\d+)/.exec(value);
    assert.notEqual(maxAge, null, 'no max-age on hashed assets');
    // A year. Anything short throws away the benefit the content hash already paid for.
    assert.ok(Number(maxAge?.[1]) >= 31_536_000, `max-age ${String(maxAge?.[1])} is under one year`);
  });

  test('the SPA document is never cached, so a deployment is picked up immediately', () => {
    const root = locationBlock('/');
    const header = /add_header\s+Cache-Control\s+"([^"]+)"/.exec(root);
    assert.notEqual(header, null, 'the SPA fallback sets no Cache-Control');
    const value = header?.[1] as string;
    // `no-cache` permits storage but forces revalidation, which is what an ETag-driven 304
    // needs; `immutable` or a positive max-age here would pin browsers to a stale index.html.
    assert.match(value, /no-cache|no-store|max-age=0/, `index.html must revalidate, got "${value}"`);
    assert.doesNotMatch(value, /immutable/, 'index.html must never be immutable');
  });

  test('every location that sets a header restates the whole server-level security set', () => {
    /**
     * `add_header` in a location *replaces* the inherited set rather than adding to it, so a
     * location that sets Cache-Control silently drops every server-level security header
     * unless it restates them. This is the trap that makes a cache change security-relevant,
     * and the first version of this test walked into it: it hardcoded three header names, so
     * it passed while `/assets/` was quietly dropping X-Frame-Options, Content-Security-Policy
     * and Permissions-Policy.
     *
     * The required set is therefore *derived from the server block* rather than listed here.
     * Adding a security header to the server block now fails this test until every
     * header-setting location mirrors it, which is the only version of this check that cannot
     * drift out of date.
     */
    // Cut at the first `location` *directive*, matched at the start of a line. Searching for
    // the bare word finds it inside the Permissions-Policy value (`geolocation=()`), which
    // truncates the server block mid-line and silently loses the headers after it — the
    // sanity assertions below caught exactly that while this test was being written.
    const firstLocation = /^[ \t]*location[ \t]/m.exec(config);
    const serverBlock = config.slice(0, firstLocation?.index ?? config.length);
    const serverLevel = [...serverBlock.matchAll(/add_header\s+([A-Za-z-]+)/g)].map((m) => m[1] as string);
    // Sanity-check the derivation itself: if this stops finding the known headers, the parse
    // broke and every assertion below would vacuously pass.
    assert.ok(serverLevel.includes('Content-Security-Policy'), 'failed to parse the server-level headers');
    assert.ok(serverLevel.length >= 6, `expected at least 6 server-level headers, found ${String(serverLevel.length)}`);

    for (const match of ['/assets/', '/']) {
      const block = locationBlock(match);
      if (!/add_header/.test(block)) continue; // a location that sets nothing still inherits
      for (const header of serverLevel) {
        assert.match(block, new RegExp(`add_header\\s+${header}\\b`), `location ${match} drops ${header}`);
      }
    }
  });

  test('the built bundles really are content-hashed, which is the invalidation mechanism', () => {
    // The immutability above is only safe while the build emits hashed filenames. If the
    // build config ever stopped hashing, `immutable` would become a deployment bug.
    const viteConfig = readFileSync(fileURLToPath(new URL('../vite.config.ts', import.meta.url)), 'utf8');
    // Vite hashes by default; assert nothing has switched it off.
    assert.doesNotMatch(viteConfig, /entryFileNames|chunkFileNames|assetFileNames/, 'asset filenames are overridden — re-check that the hash is still present before trusting immutable');
  });
});
