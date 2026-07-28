import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mergeMessages, type ChatMessage } from './useChatApi.ts';

/**
 * Client-side deduplication (CHAT-006).
 *
 * Delivery is at-least-once, so the server may re-deliver a message the client already
 * holds — after a reconnect, or on any overlapping poll. The client contract is that a
 * duplicate renders once, which is exactly what `mergeMessages` has to guarantee.
 */

function message(overrides: Partial<ChatMessage> & { id: string; sequence: number }): ChatMessage {
  return {
    senderId: 'sender-1',
    state: 'visible',
    body: `body ${String(overrides.sequence)}`,
    createdAt: '2026-09-01T18:00:00.000Z',
    ...overrides
  };
}

describe('mergeMessages', () => {
  test('an empty page leaves the held list untouched', () => {
    const held = [message({ id: 'a', sequence: 1 })];
    assert.deepEqual(mergeMessages(held, []), held);
  });

  test('a re-delivered message renders once, not twice', () => {
    const held = [message({ id: 'a', sequence: 1 }), message({ id: 'b', sequence: 2 })];
    const merged = mergeMessages(held, [message({ id: 'b', sequence: 2 }), message({ id: 'c', sequence: 3 })]);
    assert.deepEqual(merged.map((m) => m.id), ['a', 'b', 'c']);
  });

  test('a whole page replayed after a reconnect adds nothing new', () => {
    const held = [message({ id: 'a', sequence: 1 }), message({ id: 'b', sequence: 2 })];
    assert.deepEqual(mergeMessages(held, held).map((m) => m.id), ['a', 'b']);
  });

  test('ordering follows the sequence, whatever order the page arrived in', () => {
    const merged = mergeMessages(
      [message({ id: 'c', sequence: 3 })],
      [message({ id: 'a', sequence: 1 }), message({ id: 'b', sequence: 2 })]
    );
    assert.deepEqual(merged.map((m) => m.sequence), [1, 2, 3]);
  });

  test('a removal replaces an already-rendered message with its tombstone', () => {
    const held = [message({ id: 'a', sequence: 1, body: 'offending text' })];
    const merged = mergeMessages(held, [message({ id: 'a', sequence: 1, state: 'removed', body: null })]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.state, 'removed');
    assert.equal(merged[0]?.body, null, 'the body must not survive on the client either');
  });

  test('the held list is never mutated in place', () => {
    const held = [message({ id: 'a', sequence: 1 })];
    const merged = mergeMessages(held, [message({ id: 'b', sequence: 2 })]);
    assert.equal(held.length, 1);
    assert.equal(merged.length, 2);
  });
});
