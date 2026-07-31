/**
 * Builds the machine-readable site inventory the Persian guide is written from.
 *
 * The guide must not describe a route, permission or gate that does not exist, and a guide
 * maintained by hand drifts from the code the moment either changes. So every factual claim
 * in `DRAGON_CAPABILITY_MATRIX.md` traces back to this extraction rather than to a reading
 * of the source that nobody can reproduce.
 *
 * It reads, and never writes, product code:
 *   - API routes and the permission gate each one sits behind;
 *   - frontend routes, their shell and their title key;
 *   - the administration areas and the capability that reveals each card;
 *   - the role -> permission catalogue;
 *   - feature gates and the environment variable that controls each;
 *   - every environment variable the configuration loader reads.
 *
 * Usage: node scripts/guide/extract-inventory.mjs [--out <path>]
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API = join(ROOT, 'apps', 'api', 'src');
const WEB = join(ROOT, 'apps', 'web', 'src');

const read = (p) => readFileSync(p, 'utf8');
const rel = (p) => relative(ROOT, p).split('\\').join('/');

// --- Roles and permissions -------------------------------------------------

/**
 * Parsed out of the source rather than imported, because importing would execute product
 * code inside a documentation tool. The shapes below are plain literals, so a regex read is
 * both sufficient and side-effect free.
 */
function extractPermissions() {
  const src = read(join(API, 'shared', 'authz', 'permissions.ts'));

  const permissions = {};
  const permBlock = src.slice(src.indexOf('export const PERMISSIONS'), src.indexOf('} as const;'));
  for (const m of permBlock.matchAll(/^\s*([a-zA-Z]+):\s*'([^']+)'/gm)) permissions[m[1]] = m[2];

  const roles = {};
  const roleBlock = src.slice(src.indexOf('export const ROLE_PERMISSIONS'));
  // Each entry is `role_code: [ ... ],` possibly spanning lines.
  for (const m of roleBlock.matchAll(/^\s{2}([a-z_]+):\s*\[([^\]]*)\]/gms)) {
    const granted = [];
    if (/WILDCARD/.test(m[2])) granted.push('*');
    for (const p of m[2].matchAll(/PERMISSIONS\.([a-zA-Z]+)/g)) granted.push(permissions[p[1]] ?? p[1]);
    roles[m[1]] = granted;
  }
  return { permissions, roles };
}

// --- API routes ------------------------------------------------------------

/**
 * Resolves the option-spread a route uses (`...manageGate()`) to the permission that helper
 * enforces. A helper carrying only `requireSession` means "any signed-in account"; a route
 * with no spread at all is public.
 */
function gateMapFor(src, permissions) {
  const gates = {};
  for (const m of src.matchAll(/const\s+([a-zA-Z]+)\s*=\s*\([^)]*\)\s*=>\s*\(\{\s*preHandler:\s*\[([^\]]*)\]/g)) {
    const body = m[2];
    const perm = /PERMISSIONS\.([a-zA-Z]+)/.exec(body);
    gates[m[1]] = {
      permission: perm ? (permissions[perm[1]] ?? perm[1]) : null,
      session: /requireSession/.test(body),
      optionalSession: /optionalSession/.test(body),
      scoped: /Scope\b|scope\)/.test(body)
    };
  }
  return gates;
}

function extractApiRoutes(permissions) {
  const routes = [];
  const modulesDir = join(API, 'modules');
  const files = readdirSync(modulesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(modulesDir, d.name, 'routes.ts'))
    .filter((f) => {
      try {
        readFileSync(f);
        return true;
      } catch {
        return false;
      }
    });
  // Non-module route files (health, dev) still serve documented endpoints.
  for (const extra of ['modules/admin/dev-routes.ts', 'http/health.ts', 'server.ts']) {
    const f = join(API, extra);
    try {
      readFileSync(f);
      files.push(f);
    } catch {
      /* not present */
    }
  }

  for (const file of files) {
    const src = read(file);
    const module = /modules[\\/]([a-z]+)[\\/]/.exec(file)?.[1] ?? 'core';
    const gates = gateMapFor(src, permissions);

    // Each registration is parsed from its own slice, running to the next registration.
    // A fixed look-ahead window was tried first and silently dropped roughly half the
    // routes, because an inline JSON schema easily runs past any window worth choosing.
    const starts = [...src.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*\n?\s*'([^']+)'/g)];
    for (let i = 0; i < starts.length; i += 1) {
      const m = starts[i];
      const method = m[1];
      const path = m[2];
      const chunk = src.slice(m.index, starts[i + 1]?.index ?? src.length);
      // Options end where the handler begins; beyond that lies unrelated body code.
      const handlerAt = chunk.search(/\basync\s*\(|\(request[,)]|\(\)\s*=>/);
      const opts = handlerAt === -1 ? chunk : chunk.slice(0, handlerAt);
      const spread = /\.\.\.([a-zA-Z]+)\(([^)]*)\)/.exec(opts);
      const inline = /requirePermission\(\s*deps\.authorization\s*,\s*PERMISSIONS\.([a-zA-Z]+)/.exec(opts);
      const gate = spread ? gates[spread[1]] : undefined;
      /**
       * Some helpers take the permission as an argument (`...gate(PERMISSIONS.rolesAssign)`)
       * rather than closing over a fixed one. Reading only the helper definition marked every
       * route in those modules as merely session-guarded, which understated the administration
       * surface in the capability matrix — so the call site is read first.
       */
      const fromArgument = spread ? /PERMISSIONS\.([a-zA-Z]+)/.exec(spread[2]) : null;
      const permission = fromArgument
        ? (permissions[fromArgument[1]] ?? fromArgument[1])
        : inline
          ? (permissions[inline[1]] ?? inline[1])
          : (gate?.permission ?? null);
      const session = gate?.session ?? /requireSession/.test(opts);
      routes.push({
        module,
        method: method.toUpperCase(),
        path: `/api/v1${path}`,
        permission,
        auth: permission !== null ? 'permission' : session ? 'session' : 'public',
        gateHelper: spread?.[1] ?? null,
        source: rel(file)
      });
    }
  }
  // A path can be registered once per method; de-duplicate defensively so a parse quirk
  // cannot inflate the counts the guide reports.
  const seen = new Set();
  const unique = routes.filter((r) => {
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  /**
   * Coverage check, because a documentation tool that under-reports is worse than one that
   * fails. Registrations built from a template literal cannot be read as a string, so they
   * are counted here and surfaced rather than silently dropped: the guide states how many
   * endpoints exist, and that number has to be defensible.
   */
  let rawRegistrations = 0;
  const dynamic = [];
  for (const file of files) {
    const src = read(file);
    rawRegistrations += [...src.matchAll(/\bapp\.(get|post|put|patch|delete)\(/g)].length;

    // Built from a template literal: the varying segment comes from the enclosing loop.
    for (const m of src.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*`([^`]+)`/g)) {
      const options = [...m[2].matchAll(/'([a-z_]+)'/g)].map((o) => o[1]);
      dynamic.push({ method: m[1].toUpperCase(), form: 'template', template: m[2], options, source: rel(file) });
    }
    // Registered through a variable whose value is chosen just above the call.
    for (const m of src.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*\n?\s*([a-zA-Z][a-zA-Z0-9]*)\s*,/g)) {
      const before = src.slice(Math.max(0, m.index - 500), m.index);
      const decl = new RegExp(`const\\s+${m[2]}\\s*=([^;]*);`, 's').exec(before);
      const paths = decl ? [...decl[1].matchAll(/'(\/[^']*)'/g)].map((p) => p[1]) : [];
      dynamic.push({ method: m[1].toUpperCase(), form: 'variable', variable: m[2], paths, source: rel(file) });
    }
  }
  const unaccounted = rawRegistrations - routes.length - dynamic.length;

  /**
   * The four dynamic registrations expand to concrete endpoints the guide has to name, and
   * the segments come from loop literals a regex cannot evaluate. They are resolved from an
   * explicit table rather than guessed — and each entry re-checks that its literals are still
   * present in the source, so a rename fails the extraction instead of quietly publishing a
   * route that no longer exists.
   */
  const EXPANSIONS = [
    { file: 'apps/api/src/modules/admin/routes.ts', base: '/admin/users/:id/', segments: ['suspend', 'reactivate'], evidence: "['suspend', 'suspended']", permission: 'users.suspend' },
    { file: 'apps/api/src/modules/chat/routes.ts', base: '/admin/chat/users/:id/', segments: ['timeouts', 'bans'], evidence: "'/admin/chat/users/:id/timeouts'", permission: 'chat.moderate' },
    { file: 'apps/api/src/modules/moderation/routes.ts', base: '/admin/support/cases/:id/', segments: ['assign', 'resolve', 'close'], evidence: "'assign'", permission: 'support.manage' },
    { file: 'apps/api/src/modules/registrations/routes.ts', base: '/admin/tournaments/:id/registrations/:rid/', segments: ['approve', 'reject', 'waitlist', 'promote', 'cancel'], evidence: "decision('approve'", permission: 'tournament.manage' }
  ];
  const expanded = [];
  for (const e of EXPANSIONS) {
    const src = read(join(ROOT, e.file));
    if (!src.includes(e.evidence)) {
      throw new Error(`inventory: expansion for ${e.base} is stale — ${e.evidence} no longer appears in ${e.file}`);
    }
    for (const segment of e.segments) {
      expanded.push({
        module: /modules\/([a-z]+)\//.exec(e.file)[1],
        method: 'POST',
        path: `/api/v1${e.base}${segment}`,
        permission: e.permission,
        auth: 'permission',
        gateHelper: null,
        dynamic: true,
        source: e.file
      });
    }
  }

  return { routes: [...unique, ...expanded], rawRegistrations, literalParsed: routes.length, dynamic, unaccounted, expanded: expanded.length };
}

// --- Frontend routes and administration areas ------------------------------

/**
 * Reads each route from its own slice of the router.
 *
 * A single regex spanning `path` to `meta` was tried first and paired every route with the
 * *next* route's view: not all components are lazy imports — several views are imported
 * eagerly at the top of the file — so the pattern skipped past those routes to the following
 * `import(...)`. Every path in the manual's route tables was therefore attributed to the
 * wrong view. Slicing per route removes the possibility of that class of error entirely.
 */
function extractWebRoutes() {
  const src = read(join(WEB, 'router.ts'));
  const starts = [...src.matchAll(/path:\s*'([^']+)',\s*\n?\s*name:\s*'([^']+)'/g)];
  const routes = [];

  for (let i = 0; i < starts.length; i += 1) {
    const m = starts[i];
    const chunk = src.slice(m.index, starts[i + 1]?.index ?? src.length);
    const lazy = /component:\s*\(\)\s*=>\s*import\('\.\/views\/([^']+)'\)/.exec(chunk);
    const eager = /component:\s*([A-Za-z][A-Za-z0-9]*)\s*[,\n]/.exec(chunk);
    // An eagerly imported component is named by its identifier; resolve it back to the file.
    const resolved =
      lazy?.[1] ??
      (eager === null ? null : new RegExp(`import\\s+${eager[1]}\\s+from\\s+'\\./views/([^']+)'`).exec(src)?.[1] ?? `${eager[1]}.vue`);
    const meta = /meta:\s*\{([^}]*)\}/.exec(chunk)?.[1] ?? '';

    routes.push({
      path: m[1],
      name: m[2],
      view: resolved ?? 'unknown',
      shell: /shell:\s*'([a-z]+)'/.exec(meta)?.[1] ?? null,
      indexable: /indexable:\s*true/.test(meta),
      titleKey: /titleKey:\s*'([^']+)'/.exec(meta)?.[1] ?? null
    });
  }
  return routes;
}

function extractAdminAreas(permissions) {
  const src = read(join(WEB, 'composables', 'useAdminAreas.ts'));
  const capability = read(join(WEB, 'composables', 'useAdmin.ts'));
  // `canManageEducation` -> the permission string its computed property tests.
  const capPermission = {};
  for (const m of capability.matchAll(/(can[A-Za-z]+):\s*computed\(\(\)\s*=>\s*has\('([^']+)'\)/g)) capPermission[m[1]] = m[2];

  const areas = [];
  for (const m of src.matchAll(/\{\s*path:\s*'([^']+)',\s*labelKey:\s*'([^']+)',\s*visible:\s*([a-zA-Z]+)\.value,\s*testid:\s*'([^']+)'/g)) {
    areas.push({
      path: m[1],
      labelKey: m[2],
      capability: m[3],
      permission: capPermission[m[3]] ?? null,
      testid: m[4]
    });
  }
  return { areas, capPermission, knownPermissions: Object.values(permissions) };
}

function extractNav() {
  const src = read(join(WEB, 'components', 'AppShell.vue'));
  const block = src.slice(src.indexOf('const NAV_KEYS'), src.indexOf('const navItems'));
  const nav = {};
  for (const m of block.matchAll(/(public|account|admin):\s*\[([^\]]*)\]/gs)) {
    nav[m[1]] = [...m[2].matchAll(/path:\s*'([^']*)',\s*key:\s*'([^']+)'/g)].map((i) => ({ path: i[1], key: i[2] }));
  }
  return nav;
}

// --- Feature gates and environment ----------------------------------------

function extractConfig() {
  const src = read(join(API, 'config.ts'));

  const gates = [];
  for (const m of src.matchAll(
    /\/\/\s*(OD-\d+[^\n]*?)fail-closed:([^\n]*)\n\s*([a-zA-Z]+):\s*\(source\['([A-Z0-9_]+)'\]/g
  )) {
    // Groups: 1 = the OD reference, 2 = the note, 3 = the config field, 4 = the variable.
    gates.push({ decision: /OD-\d+/.exec(m[1])[0], field: m[3], env: m[4], note: m[2].trim() });
  }

  const env = new Map();
  for (const m of src.matchAll(/source\['([A-Z0-9_]+)'\]/g)) env.set(m[1], (env.get(m[1]) ?? 0) + 1);
  for (const m of src.matchAll(/process\.env\['([A-Z0-9_]+)'\]/g)) env.set(m[1], (env.get(m[1]) ?? 0) + 1);

  const example = (() => {
    try {
      return read(join(ROOT, '.env.example'))
        .split(/\r?\n/)
        .filter((l) => /^[A-Z0-9_]+=/.test(l))
        .map((l) => l.split('=')[0]);
    } catch {
      return [];
    }
  })();

  // The streaming provider is selected in code, not by configuration alone; record the
  // literal the loader forces so the guide cannot imply a provider that cannot be selected.
  const forcedStreamProvider = /provider:\s*'([a-z]+)'/.exec(src.slice(src.indexOf('function parseStreaming')))?.[1] ?? null;
  const rejectedStreamProviders = [...src.matchAll(/STREAMING_PROVIDER=([a-z]+) is not available/g)].map((m) => m[1]);

  return {
    gates,
    envVars: [...env.keys()].sort(),
    envExample: example,
    envInCodeNotInExample: [...env.keys()].filter((k) => !example.includes(k)).sort(),
    envInExampleNotInCode: example.filter((k) => !env.has(k)).sort(),
    forcedStreamProvider,
    rejectedStreamProviders
  };
}

// --- Assemble --------------------------------------------------------------

const { permissions, roles } = extractPermissions();
const apiScan = extractApiRoutes(permissions);
const apiRoutes = apiScan.routes;
const webRoutes = extractWebRoutes();
const adminAreas = extractAdminAreas(permissions);
const nav = extractNav();
const config = extractConfig();

/** Which permissions are reachable at all, and by which roles. */
const permissionHolders = {};
for (const p of Object.values(permissions)) {
  permissionHolders[p] = Object.entries(roles)
    .filter(([, granted]) => granted.includes(p) || granted.includes('*'))
    .map(([code]) => code);
}

const inventory = {
  generatedFrom: {
    note: 'Extracted from source by scripts/guide/extract-inventory.mjs. Do not hand-edit.',
    apiRouteFiles: [...new Set(apiRoutes.map((r) => r.source))].length,
    rawRegistrations: apiScan.rawRegistrations,
    literalRegistrationsParsed: apiScan.literalParsed,
    dynamicRegistrations: apiScan.dynamic,
    unaccountedRegistrations: apiScan.unaccounted
  },
  permissions,
  roles,
  permissionHolders,
  apiRoutes,
  webRoutes,
  adminAreas: adminAreas.areas,
  capabilityPermission: adminAreas.capPermission,
  navigation: nav,
  featureGates: config.gates,
  streaming: { forcedProvider: config.forcedStreamProvider, rejectedProviders: config.rejectedStreamProviders },
  environment: {
    variables: config.envVars,
    example: config.envExample,
    inCodeNotInExample: config.envInCodeNotInExample,
    inExampleNotInCode: config.envInExampleNotInCode
  },
  totals: {
    apiRoutes: apiRoutes.length,
    publicApiRoutes: apiRoutes.filter((r) => r.auth === 'public').length,
    sessionApiRoutes: apiRoutes.filter((r) => r.auth === 'session').length,
    permissionApiRoutes: apiRoutes.filter((r) => r.auth === 'permission').length,
    webRoutes: webRoutes.length,
    adminAreas: adminAreas.areas.length,
    roles: Object.keys(roles).length,
    permissions: Object.keys(permissions).length,
    featureGates: config.gates.length,
    environmentVariables: config.envVars.length
  }
};

const outIndex = process.argv.indexOf('--out');
const out = outIndex === -1 ? join(ROOT, 'docs', 'user-guides', 'SITE_INVENTORY.json') : process.argv[outIndex + 1];
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');

console.log(`site inventory -> ${rel(out)}`);
for (const [k, v] of Object.entries(inventory.totals)) console.log(`  ${k.padEnd(22)} ${String(v)}`);
if (config.envInCodeNotInExample.length > 0) {
  console.log(`  note: ${String(config.envInCodeNotInExample.length)} env var(s) read by code but absent from .env.example`);
}
