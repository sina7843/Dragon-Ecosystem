// Deterministic release-decision integrity checks for DRAGON-17c.
// Validates RELEASE_DECISION.md against the repository so the recorded decision cannot
// silently drift from config gates, runbooks, or the production/sign-off invariants.
// Run: npm run decision:check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const DECISION = read('RELEASE_DECISION.md');
const CONFIG = read('apps/api/src/config.ts');
const ENVDOC = read('ENVIRONMENT_VARIABLES.md');
const RUNBOOKS = read('RUNBOOKS.md');

const VOCAB = ['GO WITH CONDITIONS', 'GO', 'NO-GO'];

test('exactly one primary release decision, using approved vocabulary', () => {
  const m = DECISION.match(/^## Decision:\s*(.+?)\s*$/m);
  assert.ok(m, 'no "## Decision:" heading found');
  const decision = m[1].trim();
  assert.ok(VOCAB.includes(decision), `decision "${decision}" not in ${VOCAB.join(' | ')}`);
  // Only one Decision heading.
  const count = (DECISION.match(/^## Decision:/gm) || []).length;
  assert.equal(count, 1, `expected exactly one Decision heading, found ${count}`);
});

test('tested Git commit is recorded', () => {
  const m = DECISION.match(/Tested commit:\s*`([0-9a-f]{7,40})`/);
  assert.ok(m, 'tested commit hash not recorded');
});

test('approved and excluded scopes are both nonempty', () => {
  for (const heading of ['## Approved scope', '## Excluded scope']) {
    const idx = DECISION.indexOf(heading);
    assert.ok(idx >= 0, `missing ${heading}`);
    const body = DECISION.slice(idx + heading.length).split(/^## /m)[0];
    const bullets = (body.match(/^- /gm) || []).length;
    assert.ok(bullets >= 3, `${heading} should list several items, found ${bullets}`);
  }
});

test('production deployment authorization is explicit and NOT yes', () => {
  const m = DECISION.match(/Production deployment authorized:\s*\*?\*?(NO|YES)/i);
  assert.ok(m, 'missing "Production deployment authorized:" statement');
  assert.equal(m[1].toUpperCase(), 'NO', 'production must not be authorized while sign-off pends');
});

test('human sign-off requirement is explicit and pending', () => {
  assert.match(DECISION, /Awaiting authorized human sign-off/, 'human sign-off must be explicitly pending');
});

test('no bare-GO decision coexists with an unresolved production authorization', () => {
  const decision = DECISION.match(/^## Decision:\s*(.+?)\s*$/m)[1].trim();
  const prodYes = /Production deployment authorized:\s*\*?\*?YES/i.test(DECISION);
  if (decision === 'GO') assert.ok(!prodYes || !/Awaiting authorized human sign-off/.test(DECISION),
    'a bare GO cannot authorize production while sign-off is pending');
  assert.ok(true);
});

test('every gate name in the decision resolves to config.ts or ENVIRONMENT_VARIABLES.md', () => {
  // Backticked UPPER_SNAKE_CASE tokens used as gates/secrets in the decision.
  const tokens = [...DECISION.matchAll(/`([A-Z][A-Z0-9]*_[A-Z0-9_]+)`/g)].map((m) => m[1]);
  const gateLike = [...new Set(tokens)].filter((t) => /(ENABLED|SECRET|ORIGIN|ROUTES|SALT|INTEGRATED|DISABLED)/.test(t));
  assert.ok(gateLike.length >= 6, `expected several gate references, found ${gateLike.length}`);
  const unresolved = gateLike.filter((t) => !CONFIG.includes(t) && !ENVDOC.includes(t)
    // fail-closed error codes live in module services, not config; accept if referenced as a code word in the doc's module note
    && !/(FEATURE_DISABLED|CLASS_DISABLED|APPROVAL_DISABLED|TRACKER_INTEGRATED)/.test(t));
  assert.deepEqual(unresolved, [], `gate names not found in config or env docs: ${unresolved.join(', ')}`);
});

test('referenced runbook sections exist in RUNBOOKS.md', () => {
  const idx = DECISION.indexOf('## Runbook readiness');
  assert.ok(idx >= 0, 'missing Runbook readiness section');
  const body = DECISION.slice(idx).split(/^## /m).slice(0, 2).join('');
  // Quoted section titles in the "Present in RUNBOOKS.md" list.
  const quoted = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const present = quoted.filter((q) => /administrator|migration|persistence|forward-fix|stalled|Reversing/i.test(q));
  assert.ok(present.length >= 3, `expected >=3 referenced runbook sections, found ${present.length}`);
  const missing = present.filter((q) => !RUNBOOKS.includes(q));
  assert.deepEqual(missing, [], `runbook sections referenced but absent: ${missing.join(' | ')}`);
});

test('the 362 Evidence pending rows are explicitly accounted for and not bulk-accepted', () => {
  assert.match(DECISION, /362/, 'the 362 figure must appear');
  assert.match(DECISION, /Evidence pending/, 'Evidence pending category must be named');
  // Must state final acceptance is withheld/blocked for them — not silently accepted.
  assert.match(DECISION, /final[- ]acceptance[- ]blocking|withheld|Not accepted|final Phase 1 acceptance is withheld/i,
    'the 362 rows must be marked final-acceptance-blocking, not accepted');
});

test('mock/local operation is not described as live production readiness', () => {
  assert.doesNotMatch(DECISION, /production[- ]ready\b/i, 'must not claim production-ready');
  assert.doesNotMatch(DECISION, /live provider (?:ready|integrated|enabled)/i, 'must not claim live-provider readiness');
  assert.match(DECISION, /mock-provider-only|mock adapters? only|deterministic mock/i, 'mock-only operation must be stated');
});

test('blocked-feature inventory rows each reference a known decision/gate/boundary', () => {
  const heading = '## Blocked / disabled capability inventory';
  const idx = DECISION.indexOf(heading);
  assert.ok(idx >= 0, 'missing blocked-feature inventory');
  const table = DECISION.slice(idx + heading.length).split(/^## /m)[0];
  const rows = table.split('\n').filter((l) => l.startsWith('|') && !/^\|\s*Capability/.test(l) && !/^\|\s*-+/.test(l));
  assert.ok(rows.length >= 10, `expected a substantial inventory, found ${rows.length} rows`);
  const known = /(OD-\d{3}|DEC-\d{3}|PAY-\d{3}|WALLET-\d{3}|deployment boundary|bounded runner|SEO reqs|media reqs)/;
  const bad = rows.filter((r) => !known.test(r.split('|')[2] || ''));
  assert.deepEqual(bad.map((r) => r.slice(0, 40)), [], 'every inventory row must cite a known decision ID or boundary');
});

test('slice/parent status is consistent with the decision (DRAGON-17 open)', () => {
  assert.match(DECISION, /DRAGON-17 status:\s*\*?\*?open/i, 'DRAGON-17 must be recorded open while sign-off pends');
});
