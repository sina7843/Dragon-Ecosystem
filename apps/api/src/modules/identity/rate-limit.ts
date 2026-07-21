import type { Db } from 'mongodb';
import { IDENTITY_COLLECTIONS } from './collections.ts';

/**
 * Fixed-window rate limiting (AUTH-002, SEC-009).
 *
 * Counters live in MongoDB with a TTL so they expire on their own. OTP buckets
 * are keyed separately from any other traffic class, so a campaign can never
 * exhaust the OTP quota (SMS-005).
 *
 * ponytail: fixed window, not a sliding window — a caller can burst across a
 * window boundary. Move to a sliding window or token bucket if abuse patterns
 * show that mattering.
 */

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

interface RateLimitRecord {
  _id: string;
  count: number;
  expiresAt: Date;
}

const DUPLICATE_KEY = 11000;

export async function consumeRateLimit(
  db: Db,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitDecision> {
  const collection = db.collection<RateLimitRecord>(IDENTITY_COLLECTIONS.rateLimits);
  const now = new Date();

  // Increment inside the live window if one exists.
  const updated = await collection.findOneAndUpdate(
    { _id: key, expiresAt: { $gt: now } },
    { $inc: { count: 1 } },
    { returnDocument: 'after' }
  );

  if (updated !== null) {
    const retryAfterSeconds = Math.max(1, Math.ceil((updated.expiresAt.getTime() - now.getTime()) / 1000));
    return { allowed: updated.count <= limit, retryAfterSeconds };
  }

  // No live window: start one. A stale record is replaced.
  const expiresAt = new Date(now.getTime() + windowSeconds * 1000);
  try {
    await collection.replaceOne({ _id: key }, { count: 1, expiresAt }, { upsert: true });
    return { allowed: limit >= 1, retryAfterSeconds: windowSeconds };
  } catch (error) {
    // Another request created the window first; count against that one.
    if (typeof error === 'object' && error !== null && (error as { code?: number }).code === DUPLICATE_KEY) {
      return consumeRateLimit(db, key, limit, windowSeconds);
    }
    throw error;
  }
}
