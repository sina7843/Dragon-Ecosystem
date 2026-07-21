import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_LOCALE, detectLocale, isLocale } from './locale.ts';

test('Persian is the fallback locale (I18N-003)', () => {
  assert.equal(DEFAULT_LOCALE, 'fa');
  assert.equal(detectLocale(null, []), 'fa');
  assert.equal(detectLocale(null, ['de-DE', 'fr']), 'fa');
  assert.equal(detectLocale('klingon', []), 'fa');
});

test('a stored preference wins over browser preference (I18N-006)', () => {
  assert.equal(detectLocale('en', ['fa-IR']), 'en');
  assert.equal(detectLocale('fa', ['en-US']), 'fa');
});

test('browser preference is matched on the base language (I18N-002)', () => {
  assert.equal(detectLocale(null, ['en-GB']), 'en');
  assert.equal(detectLocale(null, ['FA-ir']), 'fa');
  assert.equal(detectLocale(null, ['de', 'en-US']), 'en');
});

test('isLocale rejects unsupported values', () => {
  assert.equal(isLocale('fa'), true);
  assert.equal(isLocale('en'), true);
  assert.equal(isLocale('ar'), false);
  assert.equal(isLocale(undefined), false);
});
