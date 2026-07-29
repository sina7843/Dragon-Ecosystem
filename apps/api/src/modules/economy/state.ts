import type { EntityId } from '../../shared/ids.ts';

/**
 * Dragon Coin transfer and reward contracts (REWARD-002..008, DEC-021..024, DEC-049).
 *
 * Two rules shape this module:
 *
 * - **Nothing here can turn Dragon Coin back into money.** There is no cash-out, no
 *   sell-back, no exchange rate, and no order book — not disabled, absent (REWARD-006,
 *   DEC-024). A transfer moves coin between two user accounts and changes no asset.
 * - **Every movement is a balanced ledger post.** This module owns no balance of its
 *   own; it asks the ledger to move value and records why.
 */

export const TRANSFER_STATES = ['completed', 'manual_review', 'rejected'] as const;
export type TransferState = (typeof TRANSFER_STATES)[number];

/**
 * A direct user-to-user Dragon Coin transfer (REWARD-005, DEC-022, DEC-023).
 *
 * DEC-023 defines "trading" as exactly this — a direct transfer between two people, not
 * an order-book exchange. There is no price, no counter-asset, and no matching: one
 * person sends coin to another, and that is the whole operation.
 */
export interface CoinTransferRecord {
  _id: EntityId;
  senderId: EntityId;
  recipientId: EntityId;
  amount: number;
  note: string;
  state: TransferState;
  /** Set once the ledger has moved the value; null while awaiting review. */
  ledgerTransactionId: EntityId | null;
  /** Why the transfer was held, when it was (REWARD-007). */
  reviewReason: string | null;
  reviewedBy: EntityId | null;
  reviewedAt: string | null;
  /** Caller-supplied key: the same key never moves value twice (REWARD-005). */
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

/** Sources a Dragon Coin issuance can come from; each stays distinguishable (REWARD-002). */
export const REWARD_SOURCES = ['promotion', 'compensation', 'administrative_grant'] as const;
export type RewardSource = (typeof REWARD_SOURCES)[number];

/**
 * A reward rule an operator defines once and grants from (REWARD-002, REWARD-003).
 *
 * The rule carries the amount and the reason, so every grant made under it is traceable
 * to an approved definition rather than to a number somebody typed at the time.
 */
export interface RewardRuleRecord {
  _id: EntityId;
  code: string;
  source: RewardSource;
  amount: number;
  description: string;
  state: 'active' | 'disabled';
  /** Null means unlimited; otherwise the rule stops granting once it is reached. */
  maxGrants: number | null;
  grantCount: number;
  createdBy: EntityId;
  createdAt: string;
  updatedAt: string;
}

/** One issuance made under a rule. Unique per (rule, recipient) so a replay cannot double-grant. */
export interface RewardGrantRecord {
  _id: EntityId;
  ruleId: EntityId;
  ruleCode: string;
  source: RewardSource;
  accountId: EntityId;
  amount: number;
  reason: string;
  grantedBy: EntityId;
  ledgerTransactionId: EntityId;
  createdAt: string;
}

/**
 * Configurable limits and thresholds (REWARD-007, DEC-049).
 *
 * These are engineering controls, not business policy: the numbers are configuration and
 * the *behaviour* — reject over the limit, hold over the threshold — is what this module
 * guarantees regardless of what the numbers are set to.
 */
export interface EconomyLimits {
  /** Largest single transfer accepted at all. */
  readonly maxTransferAmount: number;
  /** Total a sender may transfer inside the rolling window. */
  readonly transferAmountPerWindow: number;
  /** Number of transfers a sender may make inside the rolling window. */
  readonly transfersPerWindow: number;
  readonly windowSeconds: number;
  /** At or above this amount a transfer is held for manual review rather than completed. */
  readonly manualReviewThreshold: number;
  /** Cash payouts at or above this amount must be flagged for review before approval. */
  readonly payoutReviewThreshold: number;
}

export const DEFAULT_ECONOMY_LIMITS: EconomyLimits = {
  maxTransferAmount: 10_000,
  transferAmountPerWindow: 20_000,
  transfersPerWindow: 20,
  windowSeconds: 86_400,
  manualReviewThreshold: 5_000,
  payoutReviewThreshold: 50_000_000
};

/** Why a transfer was refused or held; each maps to one configurable control. */
export type TransferDecision =
  | { outcome: 'allow' }
  | { outcome: 'review'; reason: string }
  | { outcome: 'reject'; code: string; message: string };

/**
 * Decides what happens to a proposed transfer, from the limits and the sender's recent
 * activity. Pure, so the policy can be tested without a database or a ledger.
 */
export function decideTransfer(
  limits: EconomyLimits,
  proposed: { amount: number; senderId: EntityId; recipientId: EntityId },
  recent: { count: number; amount: number }
): TransferDecision {
  if (proposed.senderId === proposed.recipientId) {
    return { outcome: 'reject', code: 'SELF_TRANSFER', message: 'You cannot transfer coin to yourself.' };
  }
  if (!Number.isSafeInteger(proposed.amount) || proposed.amount <= 0) {
    return { outcome: 'reject', code: 'INVALID_AMOUNT', message: 'Use a whole number of Dragon Coin greater than zero.' };
  }
  if (proposed.amount > limits.maxTransferAmount) {
    return { outcome: 'reject', code: 'TRANSFER_LIMIT_EXCEEDED', message: 'That is larger than a single transfer allows.' };
  }
  if (recent.count + 1 > limits.transfersPerWindow) {
    return { outcome: 'reject', code: 'TRANSFER_COUNT_LIMIT', message: 'You have made too many transfers recently.' };
  }
  if (recent.amount + proposed.amount > limits.transferAmountPerWindow) {
    return { outcome: 'reject', code: 'TRANSFER_WINDOW_LIMIT', message: 'That would pass the amount you can transfer in this period.' };
  }
  // Held rather than rejected: a large transfer may well be legitimate, and refusing it
  // outright would push the decision onto support with no record of what was attempted.
  if (proposed.amount >= limits.manualReviewThreshold) {
    return { outcome: 'review', reason: `Amount ${String(proposed.amount)} reached the manual-review threshold.` };
  }
  return { outcome: 'allow' };
}
