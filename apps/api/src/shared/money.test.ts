import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addMoney,
  compareMoney,
  dragonCoin,
  isNegative,
  isZero,
  multiplyMoney,
  money,
  rial,
  rialToTomanParts,
  subtractMoney,
  tomanToRial
} from './money.ts';

test('money carries asset code, integer amount, and scale (DATA-061)', () => {
  assert.deepEqual(rial(1500), { assetCode: 'IRR', amountInteger: 1500, scale: 0 });
  assert.deepEqual(dragonCoin(7), { assetCode: 'DRC', amountInteger: 7, scale: 0 });
});

test('non-integer and unsafe amounts are rejected (CON-002)', () => {
  assert.throws(() => rial(10.5), RangeError);
  assert.throws(() => dragonCoin(0.1), RangeError);
  assert.throws(() => rial(Number.NaN), RangeError);
  assert.throws(() => rial(Number.MAX_SAFE_INTEGER + 1), RangeError);
});

test('unknown asset codes are rejected', () => {
  assert.throws(() => money('USD' as never, 100), TypeError);
});

test('arithmetic stays exact and refuses to mix assets', () => {
  assert.equal(addMoney(rial(1999), rial(1)).amountInteger, 2000);
  assert.equal(subtractMoney(rial(2000), rial(1)).amountInteger, 1999);
  assert.equal(multiplyMoney(rial(2500), 4).amountInteger, 10_000);
  assert.throws(() => addMoney(rial(1), dragonCoin(1)), TypeError);
  assert.throws(() => compareMoney(rial(1), dragonCoin(1)), TypeError);
});

test('fractional multiplication is rejected rather than rounded', () => {
  assert.throws(() => multiplyMoney(rial(100), 1.5), RangeError);
});

test('the classic float error cannot occur', () => {
  // 0.1 + 0.2 !== 0.3 in binary floating point; integer minor units avoid it entirely.
  const total = addMoney(rial(1), rial(2));
  assert.equal(total.amountInteger, 3);
});

test('comparison and sign helpers', () => {
  assert.equal(compareMoney(rial(1), rial(2)), -1);
  assert.equal(compareMoney(rial(2), rial(2)), 0);
  assert.equal(compareMoney(rial(3), rial(2)), 1);
  assert.equal(isNegative(rial(-1)), true);
  assert.equal(isZero(rial(0)), true);
});

test('Toman input converts to stored rial (DEC-020)', () => {
  assert.equal(tomanToRial(1).amountInteger, 10);
  assert.equal(tomanToRial(250_000).amountInteger, 2_500_000);
  assert.throws(() => tomanToRial(1.5), RangeError);
});

test('rial converts back to Toman without losing the remainder', () => {
  assert.deepEqual(rialToTomanParts(rial(2_500_000)), { toman: 250_000, rialRemainder: 0 });
  assert.deepEqual(rialToTomanParts(rial(105)), { toman: 10, rialRemainder: 5 });
  assert.deepEqual(rialToTomanParts(rial(-105)), { toman: -10, rialRemainder: -5 });
  assert.throws(() => rialToTomanParts(dragonCoin(10)), TypeError);
});

test('a Toman round trip is lossless', () => {
  for (const toman of [0, 1, 7, 999, 1_234_567]) {
    assert.equal(rialToTomanParts(tomanToRial(toman)).toman, toman);
    assert.equal(rialToTomanParts(tomanToRial(toman)).rialRemainder, 0);
  }
});
