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
 * Raised from 320 KB, then to 344 KB, and now to 380 KB in DRAGON-18. Nothing has leaked —
 * the split assertions below all still hold.
 *
 * The previous note said the locale split was the change to make before raising this again.
 * That was tried in DRAGON-18 and reverted, and the finding is why this number moved anyway:
 * loading message bundles per locale means deferring the mount behind a network fetch, so
 * the page is still unmounted when `load` fires — the skip link and every other keyboard
 * entry point are simply absent for that window. Trading a working skip link for 90 KB is
 * not a trade worth making. Doing it properly means inlining the active locale into the
 * document or serving it per locale at the edge, not a client-side fetch before the mount.
 *
 * What DRAGON-18 did bank instead: the secondary public surfaces (team/player directories,
 * the tournament calendar) and the two never-indexed utility views (sign-in, forbidden) are
 * now lazy routes. That is ~7 KB, which is honestly all route splitting has left to give —
 * the remaining mass is the framework plus ~100 KB of locale strings, and no amount of
 * further route splitting touches either. The next real lever is the locale strings.
 */
const ENTRY_BUDGET_BYTES = 380 * 1024;

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

  // The secondary public surfaces stay lazy (DRAGON-18). Folding them back into the entry
  // is what put it over budget in the first place.
  for (const marker of ['TeamsDirectoryView', 'PlayersDirectoryView', 'TournamentCalendarView', 'StreamsListView']) {
    assert.ok(
      files.some((f) => f.startsWith(`${marker}-`) && f.endsWith('.js')),
      `${marker} must stay a separate lazy chunk, not be folded into the entry bundle`
    );
  }
});
