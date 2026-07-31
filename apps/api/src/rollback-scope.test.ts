import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { loadConfig } from './config.ts';
import { allMigrations } from './migrations.ts';
import { PERMISSIONS, ROLE_PERMISSIONS } from './shared/authz/permissions.ts';

/**
 * Negative scope guard for the DRAGON-R1 rollback to the DRAGON-17 / Phase-One product.
 *
 * Post-Phase-One capabilities were removed, not disabled. A regression that re-registers one
 * of them — a route, a permission, a role, a feature gate, or a migration — must fail here
 * rather than quietly reappear in the product. Asserting absence is the whole point, so this
 * reads the source registries directly instead of probing a running server: a route that is
 * never registered cannot be probed, and a 404 from an unbuilt server would prove nothing.
 */

const API = dirname(fileURLToPath(import.meta.url));

/** Module directories that must not come back without a new product decision. */
const REMOVED_MODULES = ['streams', 'chat', 'education', 'social', 'store', 'economy'];

/** Route prefixes whose capability was removed. Each is matched against every registration. */
const REMOVED_ROUTE_PREFIXES = [
  '/streams',
  '/chat',
  '/courses',
  '/enrollments',
  '/coaches',
  '/posts',
  '/follows',
  '/feed',
  '/products',
  '/cart',
  '/orders',
  '/transfers',
  '/rewards',
  '/admin/streams',
  '/admin/chat',
  '/admin/courses',
  '/admin/store',
  '/admin/orders',
  '/admin/community',
  '/admin/economy',
  '/admin/finance/reconciliation'
];

/** Permission codes that existed only for a removed capability. */
const REMOVED_PERMISSIONS = ['stream.manage', 'chat.moderate', 'education.manage', 'store.manage'];

/** Roles seeded only for a removed capability. */
const REMOVED_ROLES = ['streaming_operator', 'live_chat_moderator', 'education_manager', 'shop_operator'];

/** Environment variables read only by a removed capability. */
const REMOVED_ENV_VARS = [
  'PAID_COURSES_ENABLED',
  'STREAMING_PROVIDER',
  'STREAM_SECURE_LINK_SECRET',
  'STREAM_PLAYBACK_TTL_SECONDS',
  'STREAM_RIGHTS_POLICY_APPROVED',
  'SOCIAL_BLOCKING_ENABLED',
  'MODERATION_APPEALS_ENABLED',
  'PUSH_NOTIFICATIONS_ENABLED',
  'PHYSICAL_FULFILLMENT_ENABLED',
  'ENTITLEMENT_REVOCATION_ENABLED'
];

/** Migrations that only ever served a removed capability. */
const REMOVED_MIGRATIONS = [
  '024-streams',
  '025-chat',
  '026-education',
  '027-social',
  '028-store',
  '029-economy',
  '030-recovery-indexes',
  '031-match-scheduling',
  '032-registration-history'
];

/** Every `routes.ts` under `modules/`, so a new module is covered without editing this list. */
function routeSources(): { file: string; source: string }[] {
  const modules = join(API, 'modules');
  return readdirSync(modules, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) =>
      readdirSync(join(modules, entry.name))
        .filter((name) => name.endsWith('routes.ts'))
        .map((name) => ({
          file: `${entry.name}/${name}`,
          source: readFileSync(join(modules, entry.name, name), 'utf8')
        }))
    );
}

test('no module directory exists for a removed capability', () => {
  const present = readdirSync(join(API, 'modules'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  for (const removed of REMOVED_MODULES) {
    assert.ok(!present.includes(removed), `module "${removed}" is back in apps/api/src/modules`);
  }
});

test('no route is registered under a removed capability prefix', () => {
  for (const { file, source } of routeSources()) {
    // Registrations are `app.<verb>('<path>'` — the path is always a literal at this layer.
    for (const match of source.matchAll(/app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
      const path = match[2] as string;
      for (const prefix of REMOVED_ROUTE_PREFIXES) {
        assert.ok(
          path !== prefix && !path.startsWith(`${prefix}/`),
          `${file} registers ${path}, which belongs to a removed capability (${prefix})`
        );
      }
    }
  }
});

test('no permission or role remains for a removed capability', () => {
  const codes = Object.values(PERMISSIONS) as string[];
  for (const removed of REMOVED_PERMISSIONS) {
    assert.ok(!codes.includes(removed), `permission "${removed}" is back in the catalogue`);
  }
  for (const removed of REMOVED_ROLES) {
    assert.ok(!(removed in ROLE_PERMISSIONS), `role "${removed}" is back in the seeded catalogue`);
  }
  // No role may grant a permission the catalogue no longer defines.
  const defined = new Set<string>([...codes, '*']);
  for (const [role, granted] of Object.entries(ROLE_PERMISSIONS)) {
    for (const permission of granted) {
      assert.ok(defined.has(permission), `role "${role}" grants unknown permission "${permission}"`);
    }
  }
});

test('the configuration loader reads no removed feature gate or provider variable', () => {
  const source = readFileSync(join(API, 'config.ts'), 'utf8');
  for (const name of REMOVED_ENV_VARS) {
    assert.ok(!source.includes(name), `config.ts still reads ${name}`);
  }
  // And nothing survives on the loaded shape either.
  const config = loadConfig({ NODE_ENV: 'test' }) as unknown as Record<string, unknown>;
  for (const field of ['streaming', 'paidCoursesEnabled', 'socialBlockingEnabled', 'physicalFulfillmentEnabled']) {
    assert.equal(config[field], undefined, `AppConfig still carries ${field}`);
  }
});

test('the fresh-database migration path contains no removed migration', () => {
  const versions = allMigrations.map((migration) => migration.version);
  for (const removed of REMOVED_MIGRATIONS) {
    assert.ok(!versions.includes(removed), `migration ${removed} is back in the registry`);
  }
  // Versions stay unique and ordered, so a re-added migration cannot hide behind a duplicate.
  assert.equal(new Set(versions).size, versions.length, 'duplicate migration version');
  assert.deepEqual(versions, [...versions].sort(), 'migrations are not in version order');
});
