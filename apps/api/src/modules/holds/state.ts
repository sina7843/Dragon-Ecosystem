import type { EntityId } from '../../shared/ids.ts';
import type { AssetCode } from '../../shared/money.ts';
import type { HoldPurpose } from './purposes.ts';

/**
 * Dragon Coin hold persistence contract (DRAGON-11c).
 *
 * A hold reserves available balance without changing the ledger balance. Capture
 * converts part or all of a hold into an immutable ledger transaction; release and
 * expiry return reserved availability without any journal. Amounts always conserve:
 * `originalAmount = capturedAmount + releasedAmount + remainingAmount`. Holds are
 * immutable after a terminal state except for append-only capture links.
 */

export type HoldState = 'active' | 'partially_captured' | 'captured' | 'released' | 'expired' | 'cancelled';

export const TERMINAL_HOLD_STATES: readonly HoldState[] = ['captured', 'released', 'expired', 'cancelled'];

export interface HoldRecord {
  _id: EntityId;
  /** The user account that owns the reserved funds (session-derived). */
  ownerId: EntityId;
  /** The ledger DRC account the reservation is held against. */
  ledgerAccountId: EntityId;
  assetCode: AssetCode;
  scale: number;
  originalAmount: number;
  remainingAmount: number;
  capturedAmount: number;
  releasedAmount: number;
  purpose: HoldPurpose;
  /** Durable business reference; the second duplicate-hold safeguard. */
  businessRef: string;
  /** Link to the originating domain entity (tournament, correction, …); null when none. */
  domainRef: string | null;
  state: HoldState;
  /** Append-only links to the ledger transactions this hold has been captured into. */
  captureTransactionIds: EntityId[];
  captureCount: number;
  actorId: EntityId;
  correlationId: string;
  metadata: Readonly<Record<string, string | number | boolean>>;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  terminalAt: string | null;
  version: number;
}

/** Allowed hold lifecycle transitions. */
const TRANSITIONS: Readonly<Record<HoldState, readonly HoldState[]>> = {
  active: ['partially_captured', 'captured', 'released', 'expired', 'cancelled'],
  partially_captured: ['partially_captured', 'captured', 'released', 'expired', 'cancelled'],
  captured: [],
  released: [],
  expired: [],
  cancelled: []
};

export function canHoldTransition(from: HoldState, to: HoldState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isHoldTerminal(state: HoldState): boolean {
  return TERMINAL_HOLD_STATES.includes(state);
}

/** A hold can still be captured/released only while it holds a remaining reservation. */
export function isHoldOpen(state: HoldState): boolean {
  return state === 'active' || state === 'partially_captured';
}
