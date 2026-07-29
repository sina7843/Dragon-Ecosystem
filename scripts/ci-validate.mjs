/**
 * Fast repository validation, run first in CI so an obvious problem fails in seconds
 * instead of after the browser suite.
 *
 * Everything here is a check the repository could not already make with an existing
 * command. The substantial guards — environment validation and fail-closed provider
 * selection (`config.test.ts`), the route registry (`server.test.ts`), locale keys
 * (`locales.test.ts`), release closure (`closure:check`) and the release decision
 * (`decision:check`) — stay where they are and are invoked as themselves; none of their
 * logic is copied here.
 *
 * Usage: npm run ci:validate
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const notes = [];

function check(label, fn) {
  try {
    const detail = fn();
    notes.push(`  ok   ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  } catch (error) {
    failures.push(`  FAIL ${label} — ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readJson(relative) {
  return JSON.parse(readFileSync(join(ROOT, relative), 'utf8'));
}

const rootPackage = readJson('package.json');

// --- Lockfile -----------------------------------------------------------------------

check('the npm lockfile is committed', () => {
  if (!existsSync(join(ROOT, 'package-lock.json'))) {
    throw new Error('package-lock.json is missing; `npm ci` cannot run reproducibly');
  }
  const lock = readJson('package-lock.json');
  if (lock.lockfileVersion < 3) throw new Error(`lockfileVersion ${String(lock.lockfileVersion)} is older than npm 9`);
  return `lockfileVersion ${String(lock.lockfileVersion)}`;
});

check('no competing lockfile is present', () => {
  const competing = ['yarn.lock', 'pnpm-lock.yaml', 'bun.lockb'].filter((f) => existsSync(join(ROOT, f)));
  if (competing.length > 0) throw new Error(`found ${competing.join(', ')}; this repository installs with npm`);
});

// --- Runtime ------------------------------------------------------------------------

/**
 * The pinned toolchain version and the packaged `engines` floor are two different
 * things, and CI has to satisfy the stricter of them.
 *
 * `engines.node` is `>=22.12.0`, which is what the production container image needs: it
 * runs compiled JavaScript. The repository's own scripts do not — `npm test` and
 * `npm run migrate` execute TypeScript sources directly, and unflagged type stripping
 * only arrived in Node 22.18.0. A host on 22.12.0 installs cleanly and then cannot run
 * a single test, so `.nvmrc` carries the real toolchain version and this asserts it.
 */
const TOOLCHAIN_FLOOR = [22, 18, 0];

function parseVersion(raw) {
  const parts = raw.trim().replace(/^v/, '').split('.').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) throw new Error(`cannot parse version "${raw}"`);
  return parts;
}

function atLeast(actual, floor) {
  for (let i = 0; i < 3; i += 1) {
    if (actual[i] > floor[i]) return true;
    if (actual[i] < floor[i]) return false;
  }
  return true;
}

check('.nvmrc pins one authoritative toolchain version', () => {
  const pinned = parseVersion(readFileSync(join(ROOT, '.nvmrc'), 'utf8'));
  if (!atLeast(pinned, TOOLCHAIN_FLOOR)) {
    throw new Error(`.nvmrc pins ${pinned.join('.')}, below the ${TOOLCHAIN_FLOOR.join('.')} type-stripping floor`);
  }
  const declared = String(rootPackage.engines?.node ?? '');
  const engineFloor = parseVersion(declared.replace(/^[^\d]*/, ''));
  if (!atLeast(pinned, engineFloor)) {
    throw new Error(`.nvmrc pins ${pinned.join('.')}, below engines.node ${declared}`);
  }
  return `${pinned.join('.')} (engines.node ${declared})`;
});

check('the running Node can execute the repository scripts', () => {
  const running = parseVersion(process.versions.node);
  if (!atLeast(running, TOOLCHAIN_FLOOR)) {
    throw new Error(
      `Node ${process.versions.node} cannot run TypeScript sources directly; ${TOOLCHAIN_FLOOR.join('.')} or newer is required`
    );
  }
  return `Node ${process.versions.node}`;
});

// --- Scripts CI depends on ----------------------------------------------------------

/**
 * Every root script the workflow invokes. A rename that CI would only discover at the
 * step that uses it is caught here instead.
 */
const REQUIRED_SCRIPTS = [
  'typecheck',
  'lint',
  'test',
  'test:integration',
  'build',
  'test:budget',
  'closure:check',
  'decision:check',
  'e2e',
  'migrate',
  'verify:migrations',
  'verify:persistence',
  'ci',
  'ci:validate'
];

check('every npm script CI invokes exists', () => {
  const missing = REQUIRED_SCRIPTS.filter((name) => typeof rootPackage.scripts?.[name] !== 'string');
  if (missing.length > 0) throw new Error(`missing root script(s): ${missing.join(', ')}`);
  return `${String(REQUIRED_SCRIPTS.length)} scripts present`;
});

/**
 * A verification command that swallows its own exit code is worse than no command: the
 * pipeline reports a check that cannot fail. Guard the scripts CI relies on.
 */
const SUPPRESSION = [/\|\|\s*true\b/, /\|\|\s*:\s*$/, /;\s*exit\s+0\b/, /\|\|\s*exit\s+0\b/, /--if-present\s*$/];

check('no CI-required script suppresses its exit status', () => {
  const offenders = [];
  for (const [file, pkg] of [
    ['package.json', rootPackage],
    ['apps/api/package.json', readJson('apps/api/package.json')],
    ['apps/web/package.json', readJson('apps/web/package.json')]
  ]) {
    for (const [name, body] of Object.entries(pkg.scripts ?? {})) {
      // `--if-present` is legitimate in the workspace fan-out scripts, which must tolerate
      // a workspace that genuinely has no such script; it is only a problem elsewhere.
      const patterns = name === 'typecheck' || name === 'test' || name === 'build' ? SUPPRESSION.slice(0, 4) : SUPPRESSION;
      const hit = patterns.find((p) => p.test(body));
      if (hit !== undefined) offenders.push(`${file} → ${name}: ${body}`);
    }
  }
  if (offenders.length > 0) throw new Error(`failure suppression found:\n    ${offenders.join('\n    ')}`);
});

// --- Migrations ---------------------------------------------------------------------

const { allMigrations } = await import('../apps/api/src/migrations.ts');

check('no migration version is duplicated', () => {
  const seen = new Map();
  const duplicates = [];
  for (const migration of allMigrations) {
    if (seen.has(migration.version)) duplicates.push(migration.version);
    seen.set(migration.version, true);
  }
  if (duplicates.length > 0) throw new Error(`duplicate version(s): ${duplicates.join(', ')}`);
  return `${String(allMigrations.length)} migrations, all distinct`;
});

check('every migration declares a version and a description', () => {
  const bad = allMigrations
    .filter((m) => typeof m.version !== 'string' || m.version === '' || typeof m.description !== 'string' || m.description === '')
    .map((m) => String(m.version));
  if (bad.length > 0) throw new Error(`incomplete migration metadata: ${bad.join(', ')}`);
});

check('migration versions are ordered by their numeric prefix', () => {
  const prefixes = allMigrations.map((m) => Number(m.version.slice(0, 3)));
  for (let i = 1; i < prefixes.length; i += 1) {
    if (prefixes[i] < prefixes[i - 1]) {
      throw new Error(`${allMigrations[i].version} is registered after ${allMigrations[i - 1].version}`);
    }
  }
});

// --- Committed secrets --------------------------------------------------------------

function tracked() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean);
}

const trackedFiles = tracked();

check('no environment file or key material is tracked by Git', () => {
  const forbidden = trackedFiles.filter(
    (f) => /(^|\/)\.env($|\.)/.test(f) && !/\.env\.example$/.test(f)
  );
  const keys = trackedFiles.filter((f) => /\.(pem|key|p12|pfx|jks|keystore)$/i.test(f));
  const all = [...forbidden, ...keys];
  if (all.length > 0) throw new Error(`tracked secret-bearing file(s): ${all.join(', ')}`);
  return `${String(trackedFiles.length)} tracked files scanned`;
});

check('no private key or provider credential is committed in a text file', () => {
  // Deliberately narrow: unambiguous key headers and provider token shapes, not entropy
  // heuristics. A broad scanner belongs in the dedicated secret-scanning tooling that
  // SEC-016 asks for, and this must not be mistaken for one.
  const markers = [
    /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bghp_[A-Za-z0-9]{36}\b/,
    /\bsk-[A-Za-z0-9]{32,}\b/
  ];
  const textish = /\.(ts|tsx|js|mjs|cjs|json|vue|md|yml|yaml|env\.example|cmd|sh|conf|txt)$/i;
  const hits = [];
  for (const file of trackedFiles) {
    if (!textish.test(file)) continue;
    // The lockfile is large, machine-generated, and contains no credentials.
    if (file === 'package-lock.json') continue;
    let body;
    try {
      body = readFileSync(join(ROOT, file), 'utf8');
    } catch {
      continue;
    }
    if (markers.some((m) => m.test(body))) hits.push(file);
  }
  if (hits.length > 0) throw new Error(`credential-shaped content in: ${hits.join(', ')}`);
});

// --- Result -------------------------------------------------------------------------

console.log('Repository validation\n');
for (const line of notes) console.log(line);
if (failures.length > 0) {
  console.error('\n' + failures.join('\n'));
  console.error(`\n${String(failures.length)} validation check(s) failed.`);
  process.exit(1);
}
console.log(`\n${String(notes.length)} validation checks passed.`);
