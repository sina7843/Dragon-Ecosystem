import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * One-way secrets for OTP codes and session tokens.
 *
 * AUTH-003: OTP values must never be stored in reversible plaintext.
 * Both OTPs and session tokens are stored only as keyed hashes, so a database
 * read cannot recover a usable credential.
 */

export const OTP_LENGTH = 6;
const SESSION_TOKEN_BYTES = 32;

/** Cryptographically random numeric code; `randomInt` avoids modulo bias. */
export function generateOtpCode(): string {
  let code = '';
  for (let index = 0; index < OTP_LENGTH; index += 1) code += String(randomInt(0, 10));
  return code;
}

export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

/** Keyed hash. The challenge id salts the digest so identical codes differ per challenge. */
export function hashOtpCode(secret: string, challengeId: string, code: string): string {
  return createHmac('sha256', secret).update(`otp:${challengeId}:${code}`).digest('hex');
}

export function hashSessionToken(secret: string, token: string): string {
  return createHmac('sha256', secret).update(`session:${token}`).digest('hex');
}

/** Constant-time comparison so a mismatch cannot be found by timing. */
export function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
