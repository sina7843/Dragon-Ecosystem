import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatTomanValue,
  normalizeDigits,
  rialToTomanParts
} from './format.ts';

describe('numbers', () => {
  test('grouping and digits are locale-aware without changing the value', () => {
    const en = formatNumber(1234567, 'en');
    const fa = formatNumber(1234567, 'fa');
    assert.equal(en, '1,234,567');
    // Persian formatting uses Persian digits, so the two differ in presentation only.
    assert.notEqual(fa, en);
    assert.match(fa, /[۰-۹]/, 'Persian output must use Persian digits');
    assert.equal(normalizeDigits(fa).replace(/[^0-9]/g, ''), '1234567');
  });
});

describe('dates', () => {
  test('the same instant renders differently per locale', () => {
    const instant = '2026-03-21T09:30:00.000Z';
    const en = formatDate(instant, 'en');
    const fa = formatDate(instant, 'fa');
    assert.match(en, /2026/);
    assert.notEqual(fa, en);
  });

  test('display honours the selected time zone (DEC-005)', () => {
    const instant = '2026-03-21T20:30:00.000Z';
    const tehran = formatDateTime(instant, 'en', 'Asia/Tehran');
    const utc = formatDateTime(instant, 'en', 'UTC');
    assert.notEqual(tehran, utc, 'time zone must change the rendered time');
  });

  test('an invalid date is rejected rather than rendered as a broken string', () => {
    assert.throws(() => formatDate('not-a-date', 'en'), TypeError);
  });
});

describe('money', () => {
  test('rial converts to Toman and keeps the remainder', () => {
    assert.deepEqual(rialToTomanParts(2_500_000), { toman: 250_000, rialRemainder: 0 });
    assert.deepEqual(rialToTomanParts(105), { toman: 10, rialRemainder: 5 });
    assert.deepEqual(rialToTomanParts(-105), { toman: -10, rialRemainder: -5 });
  });

  test('non-integer rial amounts are rejected (CON-002)', () => {
    assert.throws(() => rialToTomanParts(10.5), RangeError);
    assert.throws(() => rialToTomanParts(Number.NaN), RangeError);
  });

  test('the Toman display matches the API conversion rule', () => {
    // 1 Toman = 10 rial, identical to apps/api/src/shared/money.ts.
    assert.equal(formatTomanValue(2_500_000, 'en'), '250,000');
    assert.match(formatTomanValue(2_500_000, 'fa'), /[۰-۹]/);
  });
});

describe('digit normalisation', () => {
  test('Persian and Arabic-Indic digits become Latin', () => {
    assert.equal(normalizeDigits('۰۹۱۲۳۴۵۶۷۸۹'), '09123456789');
    assert.equal(normalizeDigits('٠١٢٣٤٥٦٧٨٩'), '0123456789');
  });

  test('non-digit characters are preserved', () => {
    assert.equal(normalizeDigits('کد ۱۲۳-۴۵'), 'کد 123-45');
    assert.equal(normalizeDigits('already-latin-42'), 'already-latin-42');
    assert.equal(normalizeDigits(''), '');
  });
});
