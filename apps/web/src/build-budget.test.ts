import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Bundle budget guardrail (DRAGON-16c). Runs only against a produced build (skips when
 * `dist/` is absent, e.g. a plain unit run). It pins two measured invariants: the anonymous
 * public entry chunk stays under a budget with tooling headroom, and admin/account screens
 * remain in their own lazy chunks (route splitting is not silently collapsed into the entry).
 *
 * Budgets are set from the measured baseline (~272 KB raw entry after the DRAGON-16c split)
 * with generous headroom so hash-name/source-map/minifier variance never fails the build.
 */

const assetsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'assets');

/**
 * Raised from 320 KB once the entry legitimately outgrew it. Nothing had leaked: the split
 * assertions below still hold, and the growth is the public team/player directories (which
 * are crawlable, so they belong in the first-paint bundle) plus the accumulated UI strings.
 *
 * Both locale files ship to every visitor and are ~100 KB of source between them, so they
 * dominate this number. Loading only the active locale is the real lever if the entry keeps
 * growing — that would roughly halve their contribution — and is the change to make before
 * raising this again.
 */
const ENTRY_BUDGET_BYTES = 344 * 1024;

test('production bundle respects the entry budget and keeps admin/account code split out', { skip: existsSync(assetsDir) ? false : 'no dist/ build present' }, () => {
  const files = readdirSync(assetsDir);
  const entry = files.find((f) => /^index-.*\.js$/.test(f));
  assert.ok(entry, 'an entry chunk (index-*.js) exists');
  const entrySize = statSync(join(assetsDir, entry)).size;
  assert.ok(
    entrySize <= ENTRY_BUDGET_BYTES,
    `entry chunk ${entry} is ${entrySize} bytes, over the ${ENTRY_BUDGET_BYTES}-byte budget — a heavy dependency or an admin/account view may have leaked into the public shell`
  );

  // Route-level code splitting must remain: privileged/personalized screens are separate chunks.
  for (const marker of ['AdminUsersView', 'AccountWalletView', 'AdminModerationView']) {
    assert.ok(
      files.some((f) => f.startsWith(`${marker}-`) && f.endsWith('.js')),
      `${marker} must be a separate lazy chunk, not folded into the entry bundle`
    );
  }
});
