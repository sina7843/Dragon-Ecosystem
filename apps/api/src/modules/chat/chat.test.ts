import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { newId } from '../../shared/ids.ts';
import { canRoomTransition, isRestrictionActive, type ChatRestrictionRecord } from './state.ts';

/** Pure restriction/lifecycle rules, plus the CHAT-008 no-direct-messaging guardrail. */

function restriction(overrides: Partial<ChatRestrictionRecord> = {}): ChatRestrictionRecord {
  return {
    _id: newId(),
    roomId: newId(),
    accountId: newId(),
    kind: 'timeout',
    reason: 'Spam',
    moderatorId: newId(),
    expiresAt: '2026-09-01T18:05:00.000Z',
    liftedAt: null,
    liftedBy: null,
    createdAt: '2026-09-01T18:00:00.000Z',
    ...overrides
  };
}

describe('restriction effectiveness (CHAT-004)', () => {
  test('a timeout blocks until its expiry and not after', () => {
    const timeout = restriction();
    assert.equal(isRestrictionActive(timeout, '2026-09-01T18:04:59.000Z'), true);
    assert.equal(isRestrictionActive(timeout, '2026-09-01T18:05:00.000Z'), false, 'expiry is exclusive');
    assert.equal(isRestrictionActive(timeout, '2026-09-01T18:06:00.000Z'), false);
  });

  test('a ban has no expiry, so it never lapses on its own', () => {
    const ban = restriction({ kind: 'ban', expiresAt: null });
    assert.equal(isRestrictionActive(ban, '2026-09-01T18:00:00.000Z'), true);
    assert.equal(isRestrictionActive(ban, '2099-01-01T00:00:00.000Z'), true);
  });

  test('a lifted restriction stops blocking immediately, whatever its expiry says', () => {
    const lifted = restriction({ kind: 'ban', expiresAt: null, liftedAt: '2026-09-01T18:02:00.000Z', liftedBy: newId() });
    assert.equal(isRestrictionActive(lifted, '2026-09-01T18:03:00.000Z'), false);
  });
});

describe('room lifecycle (CHAT-001)', () => {
  test('a room can be closed and reopened, and never transitions to itself', () => {
    assert.equal(canRoomTransition('open', 'closed'), true);
    assert.equal(canRoomTransition('closed', 'open'), true);
    assert.equal(canRoomTransition('open', 'open'), false);
    assert.equal(canRoomTransition('closed', 'closed'), false);
  });
});

describe('CHAT-008: private direct messaging is not shipped', () => {
  /**
   * Proven against the route registry itself rather than documentation: these
   * `.get/.post(...)` path literals *are* the registered Fastify surface, so a
   * direct-message endpoint could not exist without appearing here. This mirrors the
   * TOURN-024 check-in guardrail in `scripts/closure-check.test.mjs`.
   */
  const apiSrc = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const ROUTE_RE = /\.(get|post|put|patch|delete|route|all)\(\s*[`'"]([^`'"]+)[`'"]/g;
  const DIRECT_MESSAGE = /(direct[-_]?message|\bdms?\b|private[-_]?message|conversations?|inbox\/[^/]*message)/i;

  test('no registered API route could serve a private conversation', () => {
    const files = readdirSync(apiSrc, { recursive: true }).filter(
      (f): f is string => typeof f === 'string' && (f.endsWith('routes.ts') || f === 'server.ts')
    );
    const offenders: string[] = [];
    for (const relative of files) {
      const source = readFileSync(join(apiSrc, relative), 'utf8');
      for (const match of source.matchAll(ROUTE_RE)) {
        if (DIRECT_MESSAGE.test(match[2] as string)) offenders.push(`${relative}: ${(match[1] as string).toUpperCase()} ${match[2] as string}`);
      }
    }
    assert.deepEqual(offenders, [], `direct-messaging routes are registered (violates CHAT-008): ${offenders.join('; ')}`);
  });

  test('every chat route is scoped to a stream room, never to a pair of accounts', () => {
    const source = readFileSync(join(apiSrc, 'modules', 'chat', 'routes.ts'), 'utf8');
    const paths = [...source.matchAll(ROUTE_RE)].map((m) => m[2] as string);
    assert.ok(paths.length > 0, 'the chat module registers routes');
    for (const path of paths) {
      const roomScoped = path.includes('/streams/:id/chat') || path.includes('/admin/chat/') || path.startsWith('/chat/messages/');
      assert.ok(roomScoped, `chat route "${path}" is not room-scoped`);
    }
  });
});
