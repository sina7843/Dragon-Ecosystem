import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/**
 * Negative scope guard for the DRAGON-R1 rollback to the DRAGON-17 / Phase-One product.
 *
 * The removed capabilities have no page, no route, no navigation entry, no API client and no
 * locale string. Anything reachable by a direct URL would be a half-removed module, which is
 * exactly the failure this file exists to catch — so it asserts absence at the source of each
 * inventory rather than at a rendered page.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const read = (...parts: string[]): string => readFileSync(join(SRC, ...parts), 'utf8');

/** Paths a visitor must not be able to reach, including by typing the URL. */
const REMOVED_ROUTES = [
  '/streams',
  '/academy',
  '/store',
  '/cart',
  '/checkout',
  '/community',
  '/help',
  '/account/orders',
  '/account/registrations',
  '/account/matches',
  '/admin/streams',
  '/admin/chat',
  '/admin/courses',
  '/admin/store',
  '/admin/orders',
  '/admin/community',
  '/admin/prizes'
];

/** Views and API clients deleted with their capability. */
const REMOVED_FILES = [
  'views/StreamsListView.vue',
  'views/StreamDetailView.vue',
  'views/AcademyCatalogView.vue',
  'views/CourseDetailView.vue',
  'views/CoursePlayerView.vue',
  'views/StoreCatalogView.vue',
  'views/StoreProductView.vue',
  'views/CartView.vue',
  'views/CheckoutView.vue',
  'views/CommunityFeedView.vue',
  'views/CommunityPostView.vue',
  'views/HelpView.vue',
  'views/AccountOrdersView.vue',
  'views/AccountRegistrationsView.vue',
  'views/AccountMatchesView.vue',
  'views/AdminStreamsView.vue',
  'views/AdminChatView.vue',
  'views/AdminCoursesView.vue',
  'views/AdminStoreView.vue',
  'views/AdminOrdersView.vue',
  'views/AdminCommunityView.vue',
  'views/AdminPrizesView.vue',
  'components/ChatPanel.vue',
  'composables/useStreamsApi.ts',
  'composables/useChatApi.ts',
  'composables/useEducationApi.ts',
  'composables/useSocialApi.ts',
  'composables/useStoreApi.ts',
  'composables/useEconomyApi.ts'
];

/** Locale namespaces that only ever labelled a removed capability. */
const REMOVED_LOCALE_PREFIXES = [
  'streams.',
  'academy.',
  'adminCourses.',
  'adminStreams.',
  'chat.',
  'adminChat.',
  'community.',
  'adminCommunity.',
  'store.',
  'adminStore.',
  'cart.',
  'help.',
  'nav.streams',
  'nav.academy',
  'admin.area.streams',
  'admin.area.chat',
  'admin.area.courses',
  'admin.area.store',
  'admin.area.orders',
  'admin.area.community',
  'admin.area.prizes'
];

function flatten(bundle: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(bundle).flatMap(([key, value]) => {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    return typeof value === 'object' && value !== null ? flatten(value as Record<string, unknown>, path) : [path];
  });
}

test('the router registers no route for a removed capability', () => {
  const router = read('router.ts');
  const declared = [...router.matchAll(/path:\s*'([^']+)'/g)].map((match) => match[1] as string);
  for (const removed of REMOVED_ROUTES) {
    const hit = declared.find((path) => path.includes(removed));
    assert.equal(hit, undefined, `router.ts still declares ${String(hit)} for the removed ${removed}`);
  }
  // The catch-all must still be last, so a removed URL lands on not-found rather than a match.
  assert.equal(declared[declared.length - 1], '/:pathMatch(.*)*', 'the not-found catch-all is not the last route');
});

test('no view, component or API client survives for a removed capability', () => {
  for (const path of REMOVED_FILES) {
    const [folder, name] = path.split('/') as [string, string];
    assert.ok(!readdirSync(join(SRC, folder)).includes(name), `${path} is back in the source tree`);
  }
});

test('no navigation entry or admin card points at a removed capability', () => {
  for (const file of ['components/AppShell.vue', 'composables/useAdminAreas.ts']) {
    const source = read(...file.split('/'));
    for (const removed of REMOVED_ROUTES) {
      assert.ok(!source.includes(`${removed}'`), `${file} still links to ${removed}`);
    }
  }
});

test('no locale key remains for a removed capability, in either locale', () => {
  for (const locale of ['fa', 'en']) {
    const keys = flatten(JSON.parse(read('i18n', 'locales', `${locale}.json`)) as Record<string, unknown>);
    for (const prefix of REMOVED_LOCALE_PREFIXES) {
      const hit = keys.find((key) => key === prefix.replace(/\.$/, '') || key.startsWith(prefix));
      assert.equal(hit, undefined, `${locale}.json still carries ${String(hit)}`);
    }
  }
});
