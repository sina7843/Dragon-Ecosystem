import type { AssetCode } from '../../shared/money.ts';
import type { ActorContext } from '../../shared/context.ts';
import type { EntityId } from '../../shared/ids.ts';
import type { LedgerAccountType, LedgerTransactionType } from './accounts.ts';

/**
 * Immutable double-entry ledger persistence contracts (DRAGON-11a).
 *
 * Sign convention: an entry's `amount` is a signed integer added directly to its
 * account balance — positive raises the balance, negative lowers it. A journal
 * transaction is balanced when every entry amount sums to exactly zero for the
 * single asset and scale it carries. There is no separate debit/credit column.
 *
 * History is append-only: posted transactions and entries are never updated or
 * deleted. Corrections are made by posting a compensating transaction.
 */

/** Bounded free-form metadata: primitive values only, so it stays queryable and hash-stable. */
export type BoundedMetadata = Readonly<Record<string, string | number | boolean>>;

export interface LedgerAccountRecord {
  _id: EntityId;
  accountType: LedgerAccountType;
  ownerKind: 'user' | 'system';
  /** The owning account identity for a user account; null for a system account. */
  ownerId: EntityId | null;
  /** Stable semantic key for a system account; null for a user account. */
  systemKey: string | null;
  /** Canonical identity; unique across the ledger (one account per role/owner/asset/scale). */
  identityKey: string;
  assetCode: AssetCode;
  scale: number;
  allowsNegative: boolean;
  status: 'active' | 'disabled';
  /** Balance projection (entries remain authoritative); maintained inside the posting transaction. */
  balance: number;
  /**
   * Sum of active uncaptured hold reservations against this account (DRAGON-11c).
   * Available balance is `balance - heldAmount`; holds never change `balance`.
   */
  heldAmount: number;
  /** Monotonic guard for projection maintenance and drift detection. */
  balanceVersion: number;
  entryCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Immutable journal header. `status` records only durable posting state, never workflow state. */
export interface LedgerTransactionRecord {
  _id: EntityId;
  type: LedgerTransactionType;
  assetCode: AssetCode;
  scale: number;
  /** Durable, globally-unique business reference — the second duplicate-posting safeguard. */
  businessRef: string;
  idempotencyScope: string;
  idempotencyKey: string;
  /** The original transaction this one reverses; null for an ordinary posting. */
  reversalOf: EntityId | null;
  actor: ActorContext;
  correlationId: string;
  description: string;
  metadata: BoundedMetadata;
  status: 'posted';
  effectiveAt: string;
  recordedAt: string;
  entryCount: number;
}

/** Immutable journal line. `(transactionId, lineNumber)` is unique within the transaction. */
export interface LedgerEntryRecord {
  _id: EntityId;
  transactionId: EntityId;
  accountId: EntityId;
  /** Signed integer added to the account balance; the per-transaction sum is exactly zero. */
  amount: number;
  assetCode: AssetCode;
  scale: number;
  lineNumber: number;
  reference: BoundedMetadata | null;
  recordedAt: string;
}

/** The result of a successful (or replayed) posting. */
export interface PostedTransaction {
  transaction: LedgerTransactionRecord;
  entries: LedgerEntryRecord[];
}
