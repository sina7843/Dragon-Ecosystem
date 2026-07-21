import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isIranianMobile, maskMobile, normalizeIranianMobile, toLocalMobile } from './mobile.ts';
import { generateOtpCode, generateSessionToken, hashOtpCode, hashSessionToken, safeEquals, OTP_LENGTH } from './crypto.ts';
import {
  MINIMUM_AGE,
  assertMinimumAge,
  calculateAge,
  normalizeUsername,
  validateDisplayName,
  validateTimeZone
} from './profile-rules.ts';

describe('Iranian mobile normalization (ASM-001)', () => {
  test('every accepted input form produces the same canonical number', () => {
    const canonical = '+989123456789';
    for (const input of [
      '09123456789',
      '9123456789',
      '+989123456789',
      '00989123456789',
      '989123456789',
      '0912 345 6789',
      '0912-345-6789',
      '۰۹۱۲۳۴۵۶۷۸۹',
      '٠٩١٢٣٤٥٦٧٨٩'
    ]) {
      assert.equal(normalizeIranianMobile(input), canonical, `failed for ${input}`);
    }
  });

  test('non-Iranian and malformed numbers are rejected', () => {
    for (const input of ['', '0912345678', '091234567890', '08123456789', '+447911123456', 'not-a-number']) {
      assert.equal(isIranianMobile(input), false, `should reject ${input}`);
      assert.throws(() => normalizeIranianMobile(input), /not valid/);
    }
  });

  test('the local display form is restored from canonical', () => {
    assert.equal(toLocalMobile('+989123456789'), '09123456789');
  });

  test('masking never reveals the full subscriber number (SEC-012, ADMIN-008)', () => {
    const masked = maskMobile('+989123456789');
    assert.equal(masked, '+98912***89');
    assert.ok(!masked.includes('3456789'), 'masked value must not contain the subscriber digits');
    assert.equal(maskMobile('garbage'), '***');
  });
});

describe('OTP and session secrets (AUTH-003)', () => {
  const secret = 'a'.repeat(32);

  test('codes are numeric, fixed length, and vary', () => {
    const codes = new Set<string>();
    for (let index = 0; index < 50; index += 1) {
      const code = generateOtpCode();
      assert.match(code, new RegExp(`^\\d{${String(OTP_LENGTH)}}$`));
      codes.add(code);
    }
    assert.ok(codes.size > 1, 'generated codes must not be constant');
  });

  test('the stored OTP hash does not contain the code and is not reversible', () => {
    const hash = hashOtpCode(secret, 'challenge-1', '123456');
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.ok(!hash.includes('123456'));
  });

  test('the same code hashes differently per challenge', () => {
    assert.notEqual(hashOtpCode(secret, 'challenge-1', '123456'), hashOtpCode(secret, 'challenge-2', '123456'));
  });

  test('a wrong code produces a different hash', () => {
    assert.notEqual(hashOtpCode(secret, 'c', '123456'), hashOtpCode(secret, 'c', '123457'));
  });

  test('session tokens are unguessable and stored only as a hash', () => {
    const token = generateSessionToken();
    assert.ok(token.length >= 32);
    const hash = hashSessionToken(secret, token);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.ok(!hash.includes(token));
    assert.notEqual(generateSessionToken(), generateSessionToken());
  });

  test('comparison is constant time and length safe', () => {
    assert.equal(safeEquals('abc', 'abc'), true);
    assert.equal(safeEquals('abc', 'abd'), false);
    assert.equal(safeEquals('abc', 'abcd'), false);
  });
});

describe('username rules (OD-028 keeps policy minimal)', () => {
  test('usernames are normalized to lowercase', () => {
    assert.equal(normalizeUsername('  DragonPlayer  '), 'dragonplayer');
    assert.equal(normalizeUsername('player_42'), 'player_42');
  });

  test('invalid length or characters are rejected', () => {
    assert.throws(() => normalizeUsername('ab'), /not valid/);
    assert.throws(() => normalizeUsername('a'.repeat(21)), /not valid/);
    assert.throws(() => normalizeUsername('has space'), /not valid/);
    assert.throws(() => normalizeUsername('has-dash'), /not valid/);
    assert.throws(() => normalizeUsername('emoji🎮'), /not valid/);
  });

  test('display names are trimmed and length checked', () => {
    assert.equal(validateDisplayName('  Dragon Player  '), 'Dragon Player');
    assert.throws(() => validateDisplayName(''), /not valid/);
    assert.throws(() => validateDisplayName('x'.repeat(51)), /not valid/);
  });
});

describe('minimum age (DEC-003)', () => {
  const now = new Date('2026-07-21T00:00:00.000Z');

  test('age is calculated in whole years', () => {
    assert.equal(calculateAge('2000-07-21', now), 26);
    assert.equal(calculateAge('2000-07-22', now), 25, 'a birthday one day away has not happened yet');
    assert.equal(calculateAge('2000-06-30', now), 26);
  });

  test('accounts at or above the minimum age are accepted', () => {
    assert.equal(MINIMUM_AGE, 13);
    assert.doesNotThrow(() => assertMinimumAge('2013-07-21', now));
    assert.doesNotThrow(() => assertMinimumAge('1990-01-01', now));
  });

  test('accounts below the minimum age are rejected', () => {
    assert.throws(() => assertMinimumAge('2013-07-22', now), /minimum age/);
    assert.throws(() => assertMinimumAge('2020-01-01', now), /minimum age/);
  });

  test('future and malformed birth dates are rejected', () => {
    assert.throws(() => assertMinimumAge('2030-01-01', now), /not valid/);
    assert.throws(() => assertMinimumAge('not-a-date', now), /not valid/);
  });
});

describe('time zone preference', () => {
  test('supported zones are accepted', () => {
    assert.equal(validateTimeZone('Asia/Tehran'), 'Asia/Tehran');
    assert.equal(validateTimeZone('UTC'), 'UTC');
  });

  test('unknown zones are rejected', () => {
    assert.throws(() => validateTimeZone('Mars/Olympus'), /not valid/);
  });
});
