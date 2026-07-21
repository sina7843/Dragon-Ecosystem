import { createHash } from 'node:crypto';
import type { Db } from 'mongodb';
import { COLLECTIONS } from './collections.ts';
import { ConflictError } from '../errors.ts';
import { utcNow } from '../events.ts';

/**
 * Idempotency-Key support (section 15.1, SEC-020).
 *
 * Financial, registration, order, transfer, allocation, and provider operations
 * must produce exactly one effect per key. A replay returns the stored outcome
 * instead of repeating the work.
 */

export type IdempotencyStatus = 'in_progress' | 'completed';

export interface IdempotencyRecord<TResult = unknown> {
  _id: string;
  scope: string;
  key: string;
  requestHash: string;
  status: IdempotencyStatus;
  result: TResult | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: Date;
}

export interface IdempotencyOptions {
  readonly scope: string;
  readonly key: string;
  /** Distinguishes a genuine replay from key reuse with a different request body. */
  readonly request: unknown;
  readonly ttlSeconds?: number;
}

export interface IdempotentOutcome<TResult> {
  readonly result: TResult;
  readonly replayed: boolean;
}

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const DUPLICATE_KEY = 11000;

export function hashRequest(request: unknown): string {
  return createHash('sha256').update(JSON.stringify(request ?? null)).digest('hex');
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === DUPLICATE_KEY;
}

/**
 * Runs `work` at most once per (scope, key).
 *
 * - First call reserves the key, runs the work, and stores the result.
 * - Replay with the same request returns the stored result without re-running.
 * - Replay with a different request is a client error (409).
 * - A concurrent in-flight request for the same key is rejected (409) rather than
 *   duplicated; the caller retries once the first attempt completes.
 */
export async function withIdempotency<TResult>(
  db: Db,
  options: IdempotencyOptions,
  work: () => Promise<TResult>
): Promise<IdempotentOutcome<TResult>> {
  const collection = db.collection<IdempotencyRecord<TResult>>(COLLECTIONS.idempotencyKeys);
  const requestHash = hashRequest(options.request);
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const recordId = `${options.scope}:${options.key}`;

  try {
    await collection.insertOne({
      _id: recordId,
      scope: options.scope,
      key: options.key,
      requestHash,
      status: 'in_progress',
      result: null,
      createdAt: utcNow(),
      completedAt: null,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000)
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;

    const existing = await collection.findOne({ _id: recordId });
    if (existing === null) {
      // The reservation expired between the insert and the read; the caller may retry.
      throw new ConflictError('IDEMPOTENCY_KEY_EXPIRED', 'The idempotency key expired. Retry the request.');
    }
    if (existing.requestHash !== requestHash) {
      throw new ConflictError(
        'IDEMPOTENCY_KEY_REUSED',
        'This idempotency key was already used with a different request.'
      );
    }
    if (existing.status === 'in_progress') {
      throw new ConflictError(
        'IDEMPOTENT_REQUEST_IN_PROGRESS',
        'An identical request is still being processed.'
      );
    }
    return { result: existing.result as TResult, replayed: true };
  }

  try {
    const result = await work();
    await collection.updateOne(
      { _id: recordId },
      { $set: { status: 'completed', result, completedAt: utcNow() } }
    );
    return { result, replayed: false };
  } catch (error) {
    // A failed attempt must not block a legitimate retry of the same key.
    await collection.deleteOne({ _id: recordId });
    throw error;
  }
}
