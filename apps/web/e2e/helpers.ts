import { expect, type Page } from '@playwright/test';

/**
 * Shared fixtures for the browser suite.
 *
 * Every spec used to carry its own copy of the identifier generators, all of them
 * drawing from `Math.random()` over a 10^7 space (`0912` + seven digits). The browser
 * suite runs against one long-lived database: it had accumulated 22,597 accounts by
 * the time DRAGON-29A measured it, so a run of roughly 800 sign-ins reused an already
 * existing account about twice — silently, because a reused number still signs in and
 * only shows up later as a username clash, a non-zero starting balance, or a role the
 * test never granted. The generators here are unique by construction.
 */

/**
 * Uniqueness is split into two independent parts, and neither of them wraps.
 *
 * A nonce drawn once when the worker process starts separates the workers from each
 * other; a monotonic counter separates every call inside one worker. That ordering
 * matters: a counter alone would collide across workers, because every worker counts
 * from one, and per-call randomness alone is what let the previous generators reuse an
 * account. Both fields below are sized so the counter cannot roll over — one full-suite
 * worker issues a few hundred identifiers against budgets of ten thousand and up.
 */
const MOBILE_NONCE = String(Math.floor(Math.random() * 100_000)).padStart(5, '0');
const SUFFIX_NONCE = Math.floor(Math.random() * 1_679_616).toString(36).padStart(4, '0');
let sequence = 0;

function nextSequence(): number {
  sequence += 1;
  return sequence;
}

/**
 * A fresh Iranian mobile number.
 *
 * `09` followed by nine digits is the whole space the server accepts, rather than the
 * single `0912` prefix the specs had settled on. Two numbers can only collide if two
 * worker processes drew the same five-digit nonce.
 */
export function uniqueMobile(): string {
  return `09${MOBILE_NONCE}${String(nextSequence() % 10_000).padStart(4, '0')}`;
}

/**
 * An eight-character lowercase token for usernames, slugs, and display names.
 *
 * Usernames are capped at twenty characters, so this stays short enough to prefix.
 */
export function uniqueSuffix(): string {
  return `${SUFFIX_NONCE}${(nextSequence() % 1_679_616).toString(36).padStart(4, '0')}`;
}

/**
 * Runs `action` and waits for the API call it triggers to answer successfully.
 *
 * A toast is not a signal that the work finished. The toast queue is module state that
 * survives client-side navigation and nothing expires it, so an earlier message keeps
 * `expect(toast).toHaveCount(1)` satisfied the instant it is evaluated and the test
 * races ahead of the request it meant to wait for. Waiting on the response is the real
 * application condition, and a non-2xx answer fails here instead of surfacing as an
 * unexplained missing element several steps later.
 */
export async function actAndAwaitApi(
  page: Page,
  method: string,
  pathPattern: RegExp,
  action: () => Promise<void>
): Promise<void> {
  const settled = page.waitForResponse(
    (response) => response.request().method() === method && pathPattern.test(new URL(response.url()).pathname)
  );
  await action();
  const response = await settled;
  expect(response.ok(), `${method} ${response.url()} answered ${String(response.status())}`).toBe(true);
}
