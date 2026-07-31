import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { templateForEvent, renderTemplate, KNOWN_TEMPLATE_KEYS } from './templates.ts';
import { maskRecipient } from './channels.ts';

/** Event mapping, template rendering, and recipient masking (DRAGON-13) — database-free. */

describe('event-to-template mapping', () => {
  test('maps known transactional events; unknown events map to nothing', () => {
    assert.equal(templateForEvent('checkout.activated')?.templateKey, 'registration_confirmed');
    assert.equal(templateForEvent('payment.purchase_succeeded')?.category, 'transactional');
    assert.equal(templateForEvent('some.unmapped.event'), undefined);
  });
  test('every mapped template key is exported for admin template validation', () => {
    for (const key of ['registration_approved', 'registration_confirmed', 'coins_added', 'prize_paid']) {
      assert.ok(KNOWN_TEMPLATE_KEYS.includes(key));
    }
  });
});

describe('template rendering', () => {
  test('replaces known params and leaves unknown placeholders intact', () => {
    assert.equal(renderTemplate('You got {dragonCoin} coins', { dragonCoin: 100 }), 'You got 100 coins');
    assert.equal(renderTemplate('Hi {name}', {}), 'Hi {name}');
  });
});

describe('recipient masking (privacy)', () => {
  test('masks a mobile keeping only head and tail', () => {
    const masked = maskRecipient('+989121234567');
    assert.ok(!masked.includes('1234'));
    assert.match(masked, /\*\*\*/);
  });
  test('masks an email keeping only a short prefix and domain', () => {
    assert.equal(maskRecipient('player@example.com'), 'pl***@example.com');
  });
});
