import type { EntityId } from '../../shared/ids.ts';

/**
 * Prize allocation and entitlements (DRAGON-12).
 *
 * A versioned allocation maps final standings to organizer-defined rewards. Dragon
 * Coin prizes are credited immediately through the ledger (idempotent per
 * participant/rank). Cash (Toman) prizes become pending entitlements that authorized
 * finance staff manually mark approved → paid, or failed, with a reason and
 * settlement evidence. No external payout provider and no cash-out ledger movement
 * exist. Re-allocation after a standings correction supersedes prior unpaid cash
 * entitlements without clawing back an already-credited Dragon Coin prize.
 */

/**
 * Payout lifecycle (PAYOUT-007).
 *
 * Every state here has real behaviour behind it; none is decorative.
 *
 * - `pending` — allocated from confirmed standings, not yet looked at.
 * - `manual_review` — the amount crossed the configured threshold, so it cannot be
 *   approved until a reviewer clears it (PAYOUT-011, DEC-049).
 * - `approved` — a finance operator authorised it. The approver is recorded, because the
 *   settling actor must be someone else (PAYOUT-006).
 * - `processing` — settlement is under way off-platform. Made explicit so a settlement in
 *   flight is distinguishable from one nobody has started, which is what makes a retry
 *   safe rather than a guess (PAYOUT-009).
 * - `paid` — settled, with immutable evidence.
 * - `failed` — settlement did not complete. Retryable back to `approved`, reusing the
 *   same entitlement id so a retry cannot become a second payment.
 * - `cancelled` — will not be settled at all; terminal.
 * - `reversed` — a settled payout was undone by an explicit adjustment (PAYOUT-010). The
 *   original allocation is untouched; the reversal is recorded on the entitlement.
 * - `superseded` — replaced by a later allocation after a standings correction.
 */
export const ENTITLEMENT_STATES = [
  'pending',
  'manual_review',
  'approved',
  'processing',
  'paid',
  'failed',
  'cancelled',
  'reversed',
  'superseded'
] as const;
export type EntitlementState = (typeof ENTITLEMENT_STATES)[number];

export interface PrizeEntitlementRecord {
  _id: EntityId;
  tournamentId: EntityId;
  allocationVersion: number;
  rank: number;
  registrationId: EntityId;
  /** The account that receives the cash prize (the registrant/owner). */
  accountId: EntityId;
  assetCode: 'IRR';
  /** Exact rial amount (Toman displayed ÷ 10). */
  amount: number;
  state: EntitlementState;
  reason: string | null;
  /** Off-platform settlement evidence recorded when marked paid. */
  settlementEvidence: string | null;
  approvedBy: EntityId | null;
  paidBy: EntityId | null;
  /**
   * Recipient verification required before settlement (PAYOUT-011). Null until a finance
   * actor records it; settlement is refused while it is null, because paying an
   * unverified recipient is exactly the failure this control exists to prevent.
   */
  recipientVerifiedBy?: EntityId | null;
  recipientVerifiedAt?: string | null;
  /** How many settlement attempts have failed; a retry reuses this record (PAYOUT-009). */
  retryCount?: number;
  /** Set when a settled payout is explicitly undone (PAYOUT-010). */
  reversedBy?: EntityId | null;
  reversalReason?: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface DragonCoinPrizeCredit {
  rank: number;
  registrationId: EntityId;
  accountId: EntityId;
  amount: number;
  ledgerTransactionId: EntityId;
}

export interface PrizeAllocationRecord {
  _id: EntityId;
  tournamentId: EntityId;
  version: number;
  prizeVersion: number;
  /** The standings calculation version this allocation was derived from. */
  standingsVersion: number;
  actorId: EntityId;
  drcCredits: DragonCoinPrizeCredit[];
  cashEntitlementIds: EntityId[];
  createdAt: string;
}

const ALLOWED: Readonly<Record<EntitlementState, readonly EntitlementState[]>> = {
  pending: ['manual_review', 'approved', 'failed', 'cancelled', 'superseded'],
  manual_review: ['approved', 'failed', 'cancelled', 'superseded'],
  approved: ['processing', 'paid', 'failed', 'cancelled', 'superseded'],
  processing: ['paid', 'failed'],
  // `paid` is terminal except for an explicit, audited reversal (PAYOUT-010).
  paid: ['reversed'],
  // A failed settlement is retryable, which is the whole point of the state: it returns to
  // `approved` on the same entitlement id, so the retry cannot become a second payment.
  failed: ['approved', 'cancelled'],
  cancelled: [],
  reversed: [],
  superseded: []
};

export function canEntitlementTransition(from: EntitlementState, to: EntitlementState): boolean {
  return ALLOWED[from].includes(to);
}

/** States where the money is still owed, so a finance queue must surface them. */
export function isOutstandingEntitlement(state: EntitlementState): boolean {
  return state === 'pending' || state === 'manual_review' || state === 'approved' || state === 'processing';
}

/** States where money actually left the platform, for reconciliation (PAYOUT-012). */
export function isSettledEntitlement(state: EntitlementState): boolean {
  return state === 'paid';
}
