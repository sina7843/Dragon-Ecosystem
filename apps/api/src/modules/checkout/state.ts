import type { EntityId } from '../../shared/ids.ts';

/**
 * Paid tournament registration checkout (DRAGON-12).
 *
 * A checkout reserves a seat (a `pending_payment` registration) and, for a Dragon
 * Coin fee, a hold; the Toman/rial fee is collected through the mock provider. When
 * every required portion is settled the registration is activated and the fee
 * effects are posted — all atomically. It never touches ledger history on cancel or
 * expiry (the hold is released, no journal). Gated by OD-007.
 */

export type CheckoutState = 'awaiting_payment' | 'awaiting_confirmation' | 'activated' | 'cancelled' | 'expired' | 'failed';

export const TERMINAL_CHECKOUT_STATES: readonly CheckoutState[] = ['activated', 'cancelled', 'expired', 'failed'];

export interface CheckoutRecord {
  _id: EntityId;
  tournamentId: EntityId;
  accountId: EntityId;
  /** Canonical participant key (accountId or teamId) — one active checkout per participant. */
  subjectId: EntityId;
  /** The reserved `pending_payment` registration this checkout activates. */
  registrationId: EntityId;
  /** Snapshot of the tournament revision the fee was recalculated from (server-owned). */
  feeVersion: number;
  /** Exact server-recomputed fee amounts (never client-supplied). */
  irrAmount: number;
  drcAmount: number;
  provider: string;
  /** Provider reference for the Toman portion; null when the fee has no Toman component. */
  providerRequestId: string | null;
  /** The Dragon Coin hold reserving the coin portion; null when there is none. */
  holdId: EntityId | null;
  irrPaid: boolean;
  drcCaptured: boolean;
  /** Durable business reference; one checkout per participant per tournament. */
  businessRef: string;
  /** Ledger transaction that recorded the collected Toman fee; null until paid. */
  feeTransactionId: EntityId | null;
  state: CheckoutState;
  correlationId: string;
  metadata: Readonly<Record<string, string | number | boolean>>;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  completedAt: string | null;
  version: number;
}

export function isCheckoutTerminal(state: CheckoutState): boolean {
  return TERMINAL_CHECKOUT_STATES.includes(state);
}
