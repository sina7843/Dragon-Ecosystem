import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CONTENT_STATES, POST_VISIBILITIES, hasTombstone, isContentReadable, type ContentState } from './state.ts';
import { SOCIAL_COLLECTIONS, SOCIAL_INDEXES } from './collections.ts';
import { DEFAULT_SOCIAL_CONFIG } from './service.ts';
import { DELEGATABLE_TEAM_ROLES, TEAM_ROLES, canAdministerTeam, canManageRoster } from '../teams/state.ts';

/** Pure community rules, the delegated team-role matrix, and the OD-017/OD-027 guardrails. */

const apiSrc = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROUTE_RE = /\.(get|post|put|patch|delete|route|all)\(\s*[`'"]([^`'"]+)[`'"]/g;

function routeFiles(): string[] {
  return readdirSync(apiSrc, { recursive: true }).filter(
    (f): f is string => typeof f === 'string' && (f.endsWith('routes.ts') || f === 'server.ts')
  );
}

describe('route registry integrity', () => {
  /**
   * Fastify refuses a duplicate (method, path) at `ready()`, so a collision between two
   * modules is a startup crash rather than a test failure — and it only surfaces in a
   * composition that registers *both* modules. Several modules are nested behind
   * `deps.tournaments`, so a module suite that omits tournaments never sees them. This
   * check reads the path literals directly, so it holds regardless of composition.
   */
  test('no two modules register the same method and path', () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const relative of routeFiles()) {
      const source = readFileSync(join(apiSrc, relative), 'utf8');
      for (const match of source.matchAll(ROUTE_RE)) {
        const key = `${(match[1] as string).toUpperCase()} ${match[2] as string}`;
        const previous = seen.get(key);
        if (previous !== undefined && previous !== relative) duplicates.push(`${key} in ${previous} and ${relative}`);
        else seen.set(key, relative);
      }
    }
    assert.deepEqual(duplicates, [], `duplicate route registrations would crash startup: ${duplicates.join('; ')}`);
  });
});

describe('content state (SOCIAL-005)', () => {
  test('only a published item is readable, and both removal kinds leave a tombstone', () => {
    assert.equal(isContentReadable('published'), true);
    assert.equal(hasTombstone('published'), false);
    for (const state of ['removed', 'deleted'] as const) {
      assert.equal(isContentReadable(state), false, `${state} must not be readable`);
      assert.equal(hasTombstone(state), true, `${state} must keep its place in the thread`);
    }
  });

  test('every declared state is classified, so a new one cannot default to readable', () => {
    for (const state of CONTENT_STATES) {
      const classified = isContentReadable(state as ContentState) || hasTombstone(state as ContentState);
      assert.ok(classified, `state "${state}" is neither readable nor a tombstone`);
    }
  });
});

describe('privacy by default (SOCIAL-004, BR-025)', () => {
  test('the narrower audience is listed first, so a UI that defaults to the first option defaults to private', () => {
    assert.equal(POST_VISIBILITIES[0], 'followers');
    assert.deepEqual([...POST_VISIBILITIES], ['followers', 'public']);
  });
});

describe('OD-017: social blocking and muting are not built', () => {
  /**
   * Proven against the registered route surface and the module's own collections rather
   * than against a comment: a half-built block table that nothing consults is exactly the
   * failure this gate exists to prevent, so the check is that the concept is absent
   * altogether — not merely disabled.
   */
  const BLOCKING = /(^|[/_-])(blocks?|blocked|mutes?|muted|blocklist|mutelist)([/_-]|$)/i;

  test('the gate is fail-closed by default', () => {
    assert.equal(DEFAULT_SOCIAL_CONFIG.blockingEnabled, false);
    assert.equal(DEFAULT_SOCIAL_CONFIG.appealsEnabled, false, 'OD-024 appeals stay closed');
    assert.equal(DEFAULT_SOCIAL_CONFIG.pushEnabled, false, 'OD-027 push stays closed');
  });

  test('no registered API route exposes blocking or muting', () => {
    const offenders: string[] = [];
    for (const relative of routeFiles()) {
      const source = readFileSync(join(apiSrc, relative), 'utf8');
      for (const match of source.matchAll(ROUTE_RE)) {
        const path = match[2] as string;
        if (path.split(/[/:]/).some((segment) => BLOCKING.test(segment))) {
          offenders.push(`${relative}: ${(match[1] as string).toUpperCase()} ${path}`);
        }
      }
    }
    assert.deepEqual(offenders, [], `blocking/muting routes are registered while OD-017 is open: ${offenders.join('; ')}`);
  });

  test('the social module stores no block or mute collection', () => {
    for (const name of Object.values(SOCIAL_COLLECTIONS)) {
      assert.ok(!BLOCKING.test(name), `collection "${name}" implies blocking state while OD-017 is open`);
    }
    for (const declaration of SOCIAL_INDEXES) {
      assert.ok(!BLOCKING.test(declaration.name), `index "${declaration.name}" implies blocking state while OD-017 is open`);
    }
  });
});

describe('OD-027: push is not a candidate channel for community activity', () => {
  test('no notification template lists a push channel', async () => {
    const { EVENT_TEMPLATES } = await import('../notifications/templates.ts');
    const social = EVENT_TEMPLATES.find((t) => t.eventName === 'social.mentioned');
    assert.ok(social !== undefined, 'the mention event is mapped to a template (NOTIF-011)');
    assert.deepEqual([...social.channels], ['in_app']);
    for (const template of EVENT_TEMPLATES) {
      assert.ok(!template.channels.some((c) => String(c).includes('push')), `template "${template.templateKey}" lists a push channel while OD-027 is open`);
    }
  });

  test('a mention notification carries ids only, never the post body', async () => {
    const { EVENT_TEMPLATES } = await import('../notifications/templates.ts');
    const social = EVENT_TEMPLATES.find((t) => t.eventName === 'social.mentioned');
    assert.ok(social !== undefined);
    // The body would leak the text of a post the recipient may not be allowed to read.
    assert.ok(!social.paramFields.includes('body'), 'the post body must not travel into a notification');
  });
});

describe('social notifications respect the shared channel policy (SOCIAL-011, NOTIF-010)', () => {
  test('the mention event is a transactional template, so it inherits the shared preference check', async () => {
    const { EVENT_TEMPLATES } = await import('../notifications/templates.ts');
    const { DEFAULT_PREFERENCES } = await import('../notifications/state.ts');
    const social = EVENT_TEMPLATES.find((t) => t.eventName === 'social.mentioned');
    assert.ok(social !== undefined);
    assert.equal(social.category, 'transactional');
    // Every non-in-app channel is consent-checked against these categories before a
    // delivery row is queued, so a social notification cannot bypass a disabled channel:
    // it has no delivery path of its own.
    assert.equal(DEFAULT_PREFERENCES[social.category].sms, false, 'SMS is off by default (OD-008)');
    assert.equal(DEFAULT_PREFERENCES[social.category].email, false, 'email is off by default (OD-003)');
  });

  test('the social module writes no notification table of its own (NOTIF-010)', () => {
    for (const name of Object.values(SOCIAL_COLLECTIONS)) {
      assert.ok(!/notif/i.test(name), `collection "${name}" duplicates the shared notification service`);
    }
    const source = readFileSync(join(apiSrc, 'modules', 'social', 'service.ts'), 'utf8');
    // The only way out is the shared outbox, which the notifications service consumes.
    assert.ok(source.includes("eventName: 'social.mentioned'"), 'mentions publish a domain event');
    assert.ok(!/collection<[^>]*Notification/.test(source), 'the social module opens no notification collection');
  });
});

describe('community content cannot leak through global search (SOCIAL-003, ANALYTICS-005)', () => {
  /**
   * Global search fans out to five public list endpoints on the client. Community posts
   * are not one of them, and they must not become one while visibility is decided
   * per-viewer at read time — an aggregate index would answer from whatever it last
   * ingested rather than from the viewer's current relationship to the author.
   */
  test('the search view queries no community source', () => {
    const webSrc = join(apiSrc, '..', '..', 'web', 'src');
    const source = readFileSync(join(webSrc, 'views', 'SearchView.vue'), 'utf8');
    assert.ok(!/useSocialApi/.test(source), 'search imports the community client');
    for (const term of ['/feed', '/posts', 'social']) {
      assert.ok(!source.includes(term), `search references "${term}"`);
    }
  });

  test('no API route offers an unauthenticated community search surface', () => {
    const offenders: string[] = [];
    for (const relative of routeFiles()) {
      const source = readFileSync(join(apiSrc, relative), 'utf8');
      for (const match of source.matchAll(ROUTE_RE)) {
        const path = match[2] as string;
        if (/search/i.test(path) && /(post|feed|social|community)/i.test(path)) offenders.push(`${relative}: ${path}`);
      }
    }
    assert.deepEqual(offenders, [], `a community search route exists: ${offenders.join('; ')}`);
  });
});

describe('delegated team roles (ROLE-006, ROLE-007, TEAM-011)', () => {
  test('the Phase 1 roles still exist unchanged, so no membership record needs rewriting', () => {
    assert.ok(TEAM_ROLES.includes('owner'));
    assert.ok(TEAM_ROLES.includes('member'));
  });

  test('ownership is never delegatable — it moves only through transfer', () => {
    assert.ok(!DELEGATABLE_TEAM_ROLES.includes('owner'));
    assert.deepEqual([...DELEGATABLE_TEAM_ROLES], ['manager', 'captain', 'member']);
  });

  test('a captain manages the roster but not team settings', () => {
    assert.equal(canManageRoster('captain'), true);
    assert.equal(canAdministerTeam('captain'), false, 'ROLE-006 is competition-focused only');
  });

  test('a manager administers the team and the roster', () => {
    assert.equal(canAdministerTeam('manager'), true);
    assert.equal(canManageRoster('manager'), true);
  });

  test('a plain member has no delegated authority at all', () => {
    assert.equal(canAdministerTeam('member'), false);
    assert.equal(canManageRoster('member'), false);
  });

  test('the owner retains every delegated capability', () => {
    assert.equal(canAdministerTeam('owner'), true);
    assert.equal(canManageRoster('owner'), true);
  });
});
