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

export type EntitlementState = 'pending' | 'approved' | 'paid' | 'failed' | 'superseded';

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
  pending: ['approved', 'failed', 'superseded'],
  approved: ['paid', 'failed', 'superseded'],
  paid: [],
  failed: [],
  superseded: []
};

export function canEntitlementTransition(from: EntitlementState, to: EntitlementState): boolean {
  return ALLOWED[from].includes(to);
}
