import type { EntityId } from '../../shared/ids.ts';

/**
 * Dragon Coin purchase persistence contracts (DRAGON-11b, PAY-003/006, WALLET-005).
 *
 * A purchase is an immutable-identity order with a versioned lifecycle state
 * machine. Provider outcomes are never silently overwritten; a successful purchase
 * carries a durable link to exactly one ledger transaction, and terminal states
 * never return to pending.
 */

export type PurchaseState = 'created' | 'payment_pending' | 'succeeded' | 'failed' | 'cancelled' | 'expired' | 'corrected';

export const TERMINAL_STATES: readonly PurchaseState[] = ['succeeded', 'failed', 'cancelled', 'expired', 'corrected'];

export type CallbackVerification = 'unverified' | 'verified' | 'failed';

export interface PurchaseRecord {
  _id: EntityId;
  accountId: EntityId;
  packageCode: string;
  dragonCoin: number;
  /** Exact rial amount the provider must collect; Toman display is derived (÷10). */
  rialAmount: number;
  pricingVersion: number;
  provider: string;
  providerRequestId: string;
  /** Durable internal reference; also the ledger business reference on success. */
  businessRef: string;
  state: PurchaseState;
  callbackVerification: CallbackVerification;
  /** The single ledger transaction that credited the coins; null until success. */
  ledgerTransactionId: EntityId | null;
  /** The compensating ledger transaction, if the purchase was later corrected. */
  correctionTransactionId: EntityId | null;
  correctionRef: string | null;
  correlationId: string;
  metadata: Readonly<Record<string, string | number | boolean>>;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  completedAt: string | null;
  version: number;
}

/**
 * Immutable receipt of a provider callback (audit/debug). Stores the outcome and a
 * replay identity, never the signature secret or unnecessary personal data.
 */
export interface ProviderEventRecord {
  _id: EntityId;
  purchaseId: EntityId | null;
  provider: string;
  providerRequestId: string;
  /** Provider-supplied replay identity; unique per accepted event. */
  eventId: string;
  eventType: string;
  verification: 'verified' | 'rejected';
  /** Why a callback was rejected (e.g. signature_mismatch), for debugging only. */
  rejectionReason: string | null;
  rialAmount: number | null;
  receivedAt: string;
}

/** Allowed lifecycle transitions (BRACKET-style explicit state machine). */
const TRANSITIONS: Readonly<Record<PurchaseState, readonly PurchaseState[]>> = {
  created: ['payment_pending', 'cancelled', 'expired'],
  payment_pending: ['succeeded', 'failed', 'cancelled', 'expired'],
  succeeded: ['corrected'],
  failed: [],
  cancelled: [],
  expired: [],
  corrected: []
};

export function canTransition(from: PurchaseState, to: PurchaseState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(state: PurchaseState): boolean {
  return TERMINAL_STATES.includes(state);
}
