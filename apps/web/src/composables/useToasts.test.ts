import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { MAX_VISIBLE_TOASTS, useToasts } from './useToasts.ts';

const { toasts, push, dismiss, clear } = useToasts();

beforeEach(() => {
  clear();
});

describe('toast queue', () => {
  test('messages are queued in order with their tone', () => {
    push('success', 'Saved');
    push('danger', 'Failed');

    assert.equal(toasts.value.length, 2);
    assert.equal(toasts.value[0]?.message, 'Saved');
    assert.equal(toasts.value[0]?.tone, 'success');
    assert.equal(toasts.value[1]?.tone, 'danger');
  });

  test('each message gets a distinct id', () => {
    const first = push('info', 'One');
    const second = push('info', 'Two');
    assert.notEqual(first, second);
  });

  test('dismissing removes only the targeted message', () => {
    const first = push('info', 'One');
    push('info', 'Two');

    dismiss(first);

    assert.equal(toasts.value.length, 1);
    assert.equal(toasts.value[0]?.message, 'Two');
  });

  test('dismissing an unknown id is harmless', () => {
    push('info', 'One');
    dismiss(9999);
    assert.equal(toasts.value.length, 1);
  });

  test('the queue is capped so announcements cannot flood (A11Y-016)', () => {
    for (let index = 0; index < MAX_VISIBLE_TOASTS + 3; index += 1) {
      push('info', `Message ${String(index)}`);
    }

    assert.equal(toasts.value.length, MAX_VISIBLE_TOASTS);
    // The oldest messages drop out, so the newest remain visible.
    assert.equal(toasts.value.at(-1)?.message, `Message ${String(MAX_VISIBLE_TOASTS + 2)}`);
  });
});
