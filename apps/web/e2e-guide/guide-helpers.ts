import { expect, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Shared machinery for the Persian manual's capture and walkthrough verification.
 *
 * Two rules run through everything here.
 *
 * **Nothing real.** Every account is generated for the manual and exists only in the
 * disposable capture database. No screenshot may carry a real mobile number, token, cookie,
 * stream key or provider secret, so identifiers are fictional by construction and the
 * capture step scrubs the rendered page before the shot is taken.
 *
 * **Nothing claimed that was not observed.** Each capture records what it actually found —
 * including a refusal — into the verification map, so a blocked flow is documented as blocked
 * rather than quietly omitted from the manual.
 */

export const ASSETS = join(dirname(new URL(import.meta.url).pathname.slice(1)), '..', '..', '..', 'docs', 'user-guides', 'assets', 'screenshots');
export const MAP_DIR = join(dirname(new URL(import.meta.url).pathname.slice(1)), '..', '..', '..', 'docs', 'user-guides');

/** How a capability presented itself when the manual was produced. */
export type Availability =
  | 'available'
  | 'permission-required'
  | 'feature-gated'
  | 'provider-unavailable'
  | 'decision-blocked'
  | 'not-implemented';

export interface CaptureRecord {
  screenshot: string;
  chapter: string;
  procedure: string;
  step: string;
  route: string;
  control: string;
  expected: string;
  observed: string;
  availability: Availability;
  locale: 'fa' | 'en';
  viewport: string;
  captionFa: string;
  altFa: string;
}

const records: CaptureRecord[] = [];

export function recorded(): readonly CaptureRecord[] {
  return records;
}

/** Fictional Iranian mobile in the documentation range; unique per call, never a real number. */
let sequence = 0;
const RUN = String(Math.floor(Math.random() * 9000) + 1000);
export function docMobile(): string {
  sequence += 1;
  return `09${RUN}${String(sequence).padStart(5, '0')}`;
}
export function docSuffix(): string {
  sequence += 1;
  return `${RUN}${String(sequence).padStart(3, '0')}`;
}

/**
 * Patterns that must never reach a figure in the manual.
 *
 * The check runs against the rendered text of every captured page. It is deliberately a
 * hard failure rather than a warning: a leaked credential in a distributed PDF cannot be
 * recalled, so the capture stops instead of producing a document someone has to re-audit.
 */
const FORBIDDEN: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: 'bearer token', pattern: /\bBearer\s+[A-Za-z0-9._-]{16,}/ },
  { label: 'session cookie', pattern: /dragon_session=/ },
  { label: 'private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: 'aws-style access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'signed url signature', pattern: /[?&](X-Amz-Signature|md5|token)=[A-Za-z0-9%._-]{16,}/i },
  { label: 'auth secret', pattern: /auth-secret|callback-secret|secure-link-secret/i },
  { label: 'stream key', pattern: /\bstream[_-]?key\b\s*[:=]\s*\S{8,}/i }
];

/** Redacts volatile or identifying values so a figure stays stable and safe. */
async function scrub(page: Page): Promise<void> {
  await page.evaluate(() => {
    const mask = (text: string): string =>
      text
        // A full mobile number never appears in a figure, even a fictional one.
        .replace(/\b09\d{9}\b/g, '09•••••••••')
        // Opaque 20+ char identifiers read as secrets to a reader; they are not useful in print.
        .replace(/\b[A-Za-z0-9_-]{24,}\b/g, (m) => `${m.slice(0, 6)}…`);
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let n = walk.nextNode(); n !== null; n = walk.nextNode()) nodes.push(n as Text);
    for (const node of nodes) {
      const next = mask(node.nodeValue ?? '');
      if (next !== node.nodeValue) node.nodeValue = next;
    }
  });
}

/**
 * Takes one numbered figure and records what it shows.
 *
 * `observed` and `availability` describe the state that was actually on screen. A capture of
 * a forbidden or gated page is a legitimate figure — the manual needs those — but it is
 * recorded as such so no chapter can present it as a working control.
 */
export async function capture(
  page: Page,
  info: TestInfo,
  record: Omit<CaptureRecord, 'locale' | 'viewport'> & { fullPage?: boolean }
): Promise<void> {
  const viewport = page.viewportSize();
  const suffix = info.project.name;
  const file = `${record.screenshot}-${suffix}.png`;

  await scrub(page);
  const body = await page.locator('body').innerText();
  for (const { label, pattern } of FORBIDDEN) {
    expect(pattern.test(body), `figure ${file} would publish a ${label}`).toBe(false);
  }

  mkdirSync(ASSETS, { recursive: true });
  await page.screenshot({ path: join(ASSETS, file), fullPage: record.fullPage ?? false });

  records.push({
    ...record,
    screenshot: file,
    locale: suffix.startsWith('fa') ? 'fa' : 'en',
    viewport: viewport === null ? 'unknown' : `${String(viewport.width)}x${String(viewport.height)}`
  });
}

/**
 * Merges this run's records into the map.
 *
 * Each project (fa-desktop, fa-mobile, en-desktop) and each spec file contributes its own
 * records, so the map is merged rather than overwritten — otherwise the last project to
 * finish would silently erase the evidence gathered by the other two, and the manual would
 * cite figures with no recorded provenance.
 */
export function writeMap(name: string): void {
  mkdirSync(MAP_DIR, { recursive: true });
  const path = join(MAP_DIR, name);
  let existing: CaptureRecord[] = [];
  try {
    existing = (JSON.parse(readFileSync(path, 'utf8')) as { steps?: CaptureRecord[] }).steps ?? [];
  } catch {
    existing = [];
  }
  const byScreenshot = new Map(existing.map((s) => [s.screenshot, s]));
  for (const r of records) byScreenshot.set(r.screenshot, r);
  const steps = [...byScreenshot.values()].sort((a, b) => a.screenshot.localeCompare(b.screenshot));
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        note: 'Generated by npm run guide:capture. Each entry is an observed state, not an intended one.',
        steps
      },
      null,
      2
    )}\n`,
    'utf8'
  );
}

// --- Accounts and roles ----------------------------------------------------

/** Signs a fresh documentation account in through the real UI, as a reader would. */
export async function signIn(page: Page, locale: 'fa' | 'en', mobile = docMobile()): Promise<string> {
  await page.goto(`/${locale}/auth/mobile`);
  await page.locator('#auth-mobile').fill(mobile);
  await page.getByTestId('request-code').click();
  await expect(page.getByTestId('code-sent')).toBeVisible();
  const inbox = await page.request.get(`/api/v1/dev/sms-inbox?mobile=${mobile}`);
  const code = ((await inbox.json()) as Array<{ code: string }>)[0]?.code ?? '';
  await page.locator('#auth-code').fill(code);
  await page.getByTestId('verify-code').click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/account(?:/profile)?$`));
  return mobile;
}

/** Completes the profile the platform requires before most participation. */
export async function completeProfile(page: Page): Promise<void> {
  const saved = await page.request.put('/api/v1/account/profile', {
    data: {
      username: `doc_${docSuffix()}`,
      displayName: `کاربر نمونه ${docSuffix()}`,
      birthDate: '2000-01-01',
      visibility: 'public'
    }
  });
  expect(saved.ok()).toBe(true);
}

/**
 * Grants a role through the development-only route.
 *
 * This is a capture convenience, not a documented operational workflow. The manual states
 * the real mechanism: one `bootstrap:superadmin` run, then role assignment over the roles
 * API by a holder of `roles.assign`.
 */
export async function grantRole(api: APIRequestContext, mobile: string, role: string): Promise<void> {
  const granted = await api.post('/api/v1/dev/grant-role', { data: { mobile, role } });
  expect(granted.ok(), `granting ${role} should succeed in the capture environment`).toBe(true);
}
