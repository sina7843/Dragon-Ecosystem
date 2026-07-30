import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { templateForEvent, renderTemplate, KNOWN_TEMPLATE_KEYS } from './templates.ts';
import { maskRecipient } from './channels.ts';

/** Event mapping, template rendering, and recipient masking (DRAGON-13) — database-free. */

// apps/api/src/modules/notifications/ -> apps/api/src/
const apiSrc = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const webLocales = join(apiSrc, '..', '..', 'web', 'src', 'i18n', 'locales');

describe('every template key is renderable in every locale', () => {
  /**
   * The inbox renders `notifications.template.<templateKey>`, a *computed* key, so the
   * literal-key guard in `locales.test.ts` cannot see it and a template added without its
   * strings would reach a user as an empty message. This closes that gap from the side that
   * owns the key list: adding a row to `EVENT_TEMPLATES` now fails until both locales have
   * a string for it.
   */
  for (const locale of ['fa', 'en']) {
    test(`${locale} has a message for every mapped template key`, () => {
      const messages = JSON.parse(readFileSync(join(webLocales, `${locale}.json`), 'utf8')) as {
        notifications?: { template?: Record<string, string> };
      };
      const templates = messages.notifications?.template ?? {};
      const missing = KNOWN_TEMPLATE_KEYS.filter((key) => (templates[key] ?? '').trim() === '');
      assert.deepEqual(missing, [], `${locale}.json is missing notifications.template entries: ${missing.join(', ')}`);
    });
  }
});

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
