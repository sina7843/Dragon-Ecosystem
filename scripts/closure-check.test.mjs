import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Phase 1 requirement/decision closure checks (DRAGON-17a).
 *
 * Deterministic integrity + coverage guardrails over the reconciliation documents. It does
 * NOT rewrite anything — it fails with the offending IDs named so a maintainer fixes the
 * source. Authoritative order: code/tests/config > decisions > requirements > traceability
 * docs.
 *
 * Phase 1 membership is derived from repository-owned metadata in Requirements.md:
 *   - a requirement's FIRST definition line (the test-matrix appendix re-lists ids and is
 *     ignored via first-occurrence);
 *   - its inline phase tag (`FOUNDATION` / `PHASE_1` / `PHASE_2..5` / `OUT_OF_SCOPE`);
 *   - requirements in the untagged foundational sections (prefixes in FOUNDATIONAL_UNTAGGED)
 *     are Phase 1 — those sections (i18n, accessibility, security, documentation) omit a
 *     per-line tag. Membership is NEVER inferred from traceability presence (non-circular).
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const STATUS_VOCAB = new Set([
  'Implemented', 'Verified', 'Partial', 'In progress', 'Gated', 'Deferred',
  'Blocked', 'Not applicable', 'Superseded', 'Not started',
  'Deferred by phase', 'Blocked by open decision',
  // Neutral, non-completion disposition (DRAGON-17a): the requirement has a canonical row
  // but NO implementation/verification/acceptance claim — evidence reconciliation is still
  // required, owner remains within DRAGON-17 closure.
  'Evidence pending'
]);
const NEUTRAL_STATUS = new Set(['Evidence pending']);
const OWNER_REQUIRED_STATUS = new Set(['Gated', 'Deferred', 'Blocked', 'Deferred by phase', 'Blocked by open decision']);
const PHASE1_EXPECTED_COUNT = 596;
const DEFERRED_STATUS = new Set(['Deferred', 'Deferred by phase', 'Blocked', 'Blocked by open decision', 'Not applicable', 'In progress', 'Partial']);
// Non-requirement ID families (decisions, goals, use-cases, assumptions) tracked elsewhere.
const META_PREFIX = new Set(['OD', 'DEC', 'GOAL', 'UC', 'ASM']);
// Foundational sections whose requirements carry no inline phase tag but are Phase 1.
const FOUNDATIONAL_UNTAGGED = new Set(['I18N', 'A11Y', 'SEC', 'DOC', 'SMS', 'INT']);

const prefixOf = (id) => id.split('-')[0];

/** id -> inline phase-tag string, from the FIRST definition line (both authoring formats). */
function requirementTags() {
  const tag = {};
  for (const line of read('Requirements.md').split('\n')) {
    const m = /^([A-Z][A-Z0-9]*-\d{3})\t([^\t]*)/.exec(line) || /^([A-Z][A-Z0-9]*-\d{3}) \[([^\]]*)\]/.exec(line);
    if (m && !(m[1] in tag)) tag[m[1]] = m[2];
  }
  return tag;
}
const isP1Tag = (t) => /\bFOUNDATION\b/.test(t) || /\bPHASE_1\b/.test(t);
const isLaterTag = (t) => /\bPHASE_[2-5]\b/.test(t);
const isOosTag = (t) => /\bOUT_OF_SCOPE\b/.test(t);

/** Canonical requirement ids (metadata families excluded) + their phase classification. */
function requirementModel() {
  const tag = requirementTags();
  const ids = Object.keys(tag).filter((id) => !META_PREFIX.has(prefixOf(id)));
  const phase1 = new Set();
  const later = new Set();
  const oos = new Set();
  const untaggedUnknownPrefix = [];
  for (const id of ids) {
    const t = tag[id];
    if (isP1Tag(t)) phase1.add(id);
    else if (isLaterTag(t)) later.add(id);
    else if (isOosTag(t)) oos.add(id);
    else if (FOUNDATIONAL_UNTAGGED.has(prefixOf(id))) phase1.add(id); // untagged foundational section
    else untaggedUnknownPrefix.push(id);
  }
  return { ids: new Set(ids), phase1, later, oos, untaggedUnknownPrefix, tag };
}

function definedDecisionIds() {
  const ids = new Set();
  for (const m of read('DECISIONS.md').matchAll(/\b((?:OD|DEC)-\d+)\b/g)) ids.add(m[1]);
  return ids;
}

/** Parsed traceability rows. */
function traceabilityRows() {
  const rows = [];
  read('REQUIREMENTS_TRACEABILITY.md').split('\n').forEach((line, i) => {
    if (!line.startsWith('| ')) return;
    const cols = line.split('|').map((c) => c.trim());
    const rawId = cols[1] ?? '';
    if (rawId === '' || rawId === 'Requirement ID' || /^-+$/.test(rawId)) return;
    const idMatch = /^([A-Za-z][A-Za-z0-9-]*)(?:\s*\(([^)]*)\))?$/.exec(rawId);
    rows.push({
      raw: rawId,
      id: idMatch ? idMatch[1] : rawId,
      phase: cols[3] ?? '',
      status: cols[4] ?? '',
      implementation: cols[5] ?? '',
      schema: cols[6] ?? '',
      tests: cols[7] ?? '',
      browser: cols[8] ?? '',
      verification: cols[9] ?? '',
      note: cols[10] ?? '',
      reviewer: cols[11] ?? '',
      reviewStatus: cols[12] ?? '',
      openDecision: cols[cols.length - 2] ?? '',
      line: i + 1
    });
  });
  return rows;
}

/** Accepted Phase-1 coverage-gap manifest (repository-owned list of currently-unrowed ids). */
function coverageGapManifest() {
  return new Set(
    read('scripts/phase1-coverage-gap.txt').split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'))
  );
}

test('every traceability row uses a canonical XXX-NNN id (no synthetic ids)', () => {
  const bad = traceabilityRows().filter((r) => !/^[A-Z][A-Z0-9]*-\d{3}$/.test(r.id));
  assert.equal(bad.length, 0, `non-canonical traceability ids: ${bad.map((r) => `${r.raw}@L${r.line}`).join(', ')}`);
});

test('every traceability row refers to a defined requirement or a known metadata id', () => {
  const { ids } = requirementModel();
  const unknown = traceabilityRows().filter(
    (r) => /^[A-Z][A-Z0-9]*-\d{3}$/.test(r.id) && !ids.has(r.id) && !META_PREFIX.has(prefixOf(r.id))
  );
  assert.equal(unknown.length, 0, `unknown ids in traceability: ${unknown.map((r) => `${r.id}@L${r.line}`).join(', ')}`);
});

test('each id has exactly one traceability row (no duplicates)', () => {
  const seen = new Map();
  for (const r of traceabilityRows()) if (/^[A-Z][A-Z0-9]*-\d{3}$/.test(r.id)) seen.set(r.id, [...(seen.get(r.id) ?? []), r.line]);
  const dupes = [...seen].filter(([, ls]) => ls.length > 1);
  assert.equal(dupes.length, 0, `duplicate ids: ${dupes.map(([id, ls]) => `${id}@L${ls.join('/')}`).join(', ')}`);
});

test('traceability status values use the approved vocabulary', () => {
  const bad = traceabilityRows().filter((r) => !STATUS_VOCAB.has(r.status));
  assert.equal(bad.length, 0, `non-standard status: ${bad.map((r) => `"${r.status}"@L${r.line}(${r.id})`).join(', ')}`);
});

test('every decision id in the open-decision column resolves to DECISIONS.md', () => {
  const decisions = definedDecisionIds();
  const missing = [];
  for (const r of traceabilityRows()) for (const m of r.openDecision.matchAll(/\b((?:OD|DEC)-\d+)\b/g)) if (!decisions.has(m[1])) missing.push(`${m[1]}@L${r.line}(${r.id})`);
  assert.equal(missing.length, 0, `unresolved decision references: ${missing.join(', ')}`);
});

test('status documents do not contain the 16b/16c slice reversal (security=16b, performance=16c)', () => {
  const offenders = [];
  for (const file of ['IMPLEMENTATION_STATUS.md', 'DECISIONS.md', 'PROJECT_STATUS.md', 'REQUIREMENTS_TRACEABILITY.md']) {
    read(file).split('\n').forEach((line, i) => {
      const has16b = /DRAGON-16b\b/.test(line);
      const has16c = /DRAGON-16c\b/.test(line);
      if (has16b && has16c) return;
      if (/security/i.test(line) && has16c) offenders.push(`${file}:${i + 1} security→16c`);
      if (/performance/i.test(line) && has16b) offenders.push(`${file}:${i + 1} performance→16b`);
    });
  }
  assert.equal(offenders.length, 0, `16b/16c reversal: ${offenders.join('; ')}`);
});

test('DRAGON slice identifiers in the open-decision column are valid', () => {
  const valid = /^DRAGON-(0[0-9]|1[0-6])[abc]?$|^DRAGON-17[a-d]?$/;
  const bad = [];
  for (const r of traceabilityRows()) for (const m of r.openDecision.matchAll(/\bDRAGON-[0-9A-Za-z]+\b/g)) if (!valid.test(m[0])) bad.push(`${m[0]}@L${r.line}(${r.id})`);
  assert.equal(bad.length, 0, `invalid DRAGON slice ids: ${bad.join(', ')}`);
});

test('Phase 1 membership is determinable for every requirement (no untagged non-foundational id)', () => {
  const { untaggedUnknownPrefix } = requirementModel();
  assert.equal(
    untaggedUnknownPrefix.length, 0,
    `requirements with no inline phase tag and an unmapped section prefix (phase indeterminate): ${untaggedUnknownPrefix.join(', ')} — add the prefix to FOUNDATIONAL_UNTAGGED or tag the requirement`
  );
});

test('the Phase 1 inventory is exactly 596 requirements (from Requirements.md metadata)', () => {
  const { phase1 } = requirementModel();
  assert.equal(phase1.size, PHASE1_EXPECTED_COUNT, `Phase 1 requirement count is ${phase1.size}, expected ${PHASE1_EXPECTED_COUNT} — the metadata or the FOUNDATIONAL_UNTAGGED mapping changed; reconcile before closing`);
});

test('every Phase 1 requirement has exactly one canonical row, and the coverage-gap fixture is empty', () => {
  const { phase1 } = requirementModel();
  const counts = new Map();
  for (const r of traceabilityRows()) if (/^[A-Z][A-Z0-9]*-\d{3}$/.test(r.id)) counts.set(r.id, (counts.get(r.id) ?? 0) + 1);
  const missing = [...phase1].filter((id) => !counts.has(id));
  const multi = [...phase1].filter((id) => (counts.get(id) ?? 0) > 1);
  assert.equal(missing.length, 0, `Phase 1 requirements with NO canonical row: ${missing.join(', ')}`);
  assert.equal(multi.length, 0, `Phase 1 requirements with more than one row: ${multi.join(', ')}`);
  // The gap fixture must contain no unresolved IDs at closure.
  const gap = [...coverageGapManifest()];
  assert.equal(gap.length, 0, `coverage-gap fixture is not empty — unresolved Phase 1 IDs: ${gap.join(', ')}`);
});

test('neutral (Evidence pending) rows make no implementation/verification/review/acceptance claim', () => {
  const bad = [];
  for (const r of traceabilityRows()) {
    if (!NEUTRAL_STATUS.has(r.status)) continue;
    const empty = (c) => c === '' || c === '—';
    if (!empty(r.implementation) || !empty(r.tests) || !empty(r.browser) || !empty(r.verification) || !empty(r.schema)) {
      bad.push(`${r.id}@L${r.line} (claims evidence)`);
    } else if (/verified|reviewed/i.test(r.reviewStatus) || /verified|reviewed/i.test(r.reviewer)) {
      bad.push(`${r.id}@L${r.line} (claims review/acceptance)`);
    }
  }
  assert.equal(bad.length, 0, `Evidence-pending rows must carry no evidence/review claim: ${bad.join(', ')}`);
});

test('gated/deferred/blocked rows carry an owner or decision reference', () => {
  const bad = [];
  for (const r of traceabilityRows()) {
    if (!OWNER_REQUIRED_STATUS.has(r.status)) continue;
    // Owner may be a decision, a future DRAGON slice, or — for deferred-by-phase — the
    // owning future phase named in the Phase-tags column.
    const ownerText = `${r.openDecision} ${r.note} ${r.phase}`;
    const hasOwner = /\b(OD|DEC)-\d+\b/.test(ownerText) || /\bDRAGON-[0-9]/.test(ownerText) || (r.status === 'Deferred by phase' && /\bPHASE_[2-5]\b/.test(r.phase));
    if (!hasOwner) bad.push(`${r.id}@L${r.line}[${r.status}]`);
  }
  assert.equal(bad.length, 0, `gated/deferred/blocked rows lacking an owner or decision reference: ${bad.join(', ')}`);
});

test('TOURN-024: no registered API route exposes player check-in (authoritative route registry)', () => {
  // Inspect the route-registration source (the Fastify route registry is defined by these
  // `.get/.post/...('<path>')` literals), not documentation comments — proves the Phase 1
  // "MUST NOT expose player check-in" constraint deterministically.
  const apiSrc = join(root, 'apps/api/src');
  const files = readdirSync(apiSrc, { recursive: true })
    .filter((f) => typeof f === 'string' && (f.endsWith('routes.ts') || f === 'server.ts'));
  const ROUTE_RE = /\.(get|post|put|patch|delete|route|all)\(\s*[`'"]([^`'"]+)[`'"]/g;
  const offenders = [];
  for (const rel of files) {
    const src = readFileSync(join(apiSrc, rel), 'utf8');
    for (const m of src.matchAll(ROUTE_RE)) {
      if (/check-?in/i.test(m[2])) offenders.push(`${rel}: ${m[1].toUpperCase()} ${m[2]}`);
    }
  }
  assert.equal(offenders.length, 0, `player check-in routes are registered (violates TOURN-024): ${offenders.join('; ')}`);
});

test('no later-phase / out-of-scope requirement is rowed as Phase-1-complete without an accepted cross-phase mapping', () => {
  const { phase1, ids } = requirementModel();
  const offenders = [];
  for (const r of traceabilityRows()) {
    if (!ids.has(r.id) || phase1.has(r.id)) continue; // only defined non-Phase-1 requirements
    if (DEFERRED_STATUS.has(r.status)) continue; // honestly deferred/blocked is fine
    if (/accepted cross-phase mapping/i.test(r.note)) continue; // explicit accepted mapping
    offenders.push(`${r.id}@L${r.line}[${r.status}]`);
  }
  assert.equal(offenders.length, 0, `later-phase/OOS requirements shown as Phase-1-complete without an accepted mapping: ${offenders.join(', ')}`);
});
