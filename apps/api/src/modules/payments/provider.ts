import { createHmac, timingSafeEqual } from 'node:crypto';
import { ConflictError, ValidationError } from '../../shared/errors.ts';

/**
 * Payment provider boundary (DRAGON-11b, PAY-004/012).
 *
 * A narrow interface a real provider could implement later without changing any
 * ledger rule. The in-repository mock is the approved provider for the current
 * scope (PAY-012): it performs no network call, produces deterministic outcomes,
 * and authenticates callbacks with a keyed HMAC. Every callback is untrusted input
 * and is verified before the domain layer trusts any field.
 */

export type ProviderEventType = 'success' | 'failed' | 'cancelled';
const EVENT_TYPES: readonly ProviderEventType[] = ['success', 'failed', 'cancelled'];

export interface ProviderRequestInput {
  readonly purchaseId: string;
  readonly businessRef: string;
  readonly rialAmount: number;
  readonly correlationId: string;
}

export interface ProviderRequest {
  readonly providerRequestId: string;
}

/** The raw, untrusted callback payload as received from the provider. */
export interface RawCallback {
  readonly provider: string;
  readonly providerRequestId: string;
  readonly purchaseId: string;
  readonly rialAmount: number;
  readonly asset: string;
  readonly eventType: string;
  readonly eventId: string;
  readonly signature: string;
}

/** A callback whose authenticity and shape have been verified. */
export interface VerifiedCallback {
  readonly provider: string;
  readonly providerRequestId: string;
  readonly purchaseId: string;
  readonly rialAmount: number;
  readonly asset: string;
  readonly eventType: ProviderEventType;
  readonly eventId: string;
}

export interface PaymentProvider {
  readonly name: string;
  createRequest(input: ProviderRequestInput): Promise<ProviderRequest>;
  /** Verifies authenticity + shape; throws a stable error on any failure. Never logs the secret. */
  verifyCallback(raw: RawCallback): VerifiedCallback;
}

/** Canonical string signed by the provider — fixed field order, no volatile data. */
function canonicalCallback(fields: Omit<RawCallback, 'signature'>): string {
  return [fields.provider, fields.providerRequestId, fields.purchaseId, String(fields.rialAmount), fields.asset, fields.eventType, fields.eventId].join('|');
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';
  readonly #secret: string;

  constructor(secret: string) {
    this.#secret = secret;
  }

  createRequest(input: ProviderRequestInput): Promise<ProviderRequest> {
    // Deterministic, no network call: the provider reference is derived from the purchase.
    return Promise.resolve({ providerRequestId: `mock_${input.purchaseId}` });
  }

  /** Signs a callback (used by the mock pay control and tests to simulate the provider). */
  sign(fields: Omit<RawCallback, 'signature'>): string {
    return createHmac('sha256', this.#secret).update(canonicalCallback(fields)).digest('hex');
  }

  verifyCallback(raw: RawCallback): VerifiedCallback {
    if (typeof raw.providerRequestId !== 'string' || typeof raw.purchaseId !== 'string' || typeof raw.eventId !== 'string' || typeof raw.signature !== 'string') {
      throw new ValidationError('The callback payload is malformed.', [{ field: 'callback', code: 'CALLBACK_VERIFICATION_FAILED', message: 'Malformed callback.' }]);
    }
    if (!Number.isSafeInteger(raw.rialAmount) || raw.rialAmount < 0) {
      throw new ValidationError('The callback amount is invalid.', [{ field: 'rialAmount', code: 'CALLBACK_VERIFICATION_FAILED', message: 'Invalid amount.' }]);
    }
    const expected = this.sign({ provider: raw.provider, providerRequestId: raw.providerRequestId, purchaseId: raw.purchaseId, rialAmount: raw.rialAmount, asset: raw.asset, eventType: raw.eventType, eventId: raw.eventId });
    const provided = raw.signature;
    // Constant-time comparison; unequal lengths are an immediate mismatch.
    if (provided.length !== expected.length || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
      throw new ConflictError('CALLBACK_VERIFICATION_FAILED', 'The callback signature is not valid.');
    }
    if (!EVENT_TYPES.includes(raw.eventType as ProviderEventType)) {
      throw new ConflictError('CALLBACK_VERIFICATION_FAILED', 'The callback event type is not recognized.');
    }
    return {
      provider: raw.provider,
      providerRequestId: raw.providerRequestId,
      purchaseId: raw.purchaseId,
      rialAmount: raw.rialAmount,
      asset: raw.asset,
      eventType: raw.eventType as ProviderEventType,
      eventId: raw.eventId
    };
  }
}
