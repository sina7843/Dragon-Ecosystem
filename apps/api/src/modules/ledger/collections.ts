import type { IndexDeclaration } from '../../shared/db/collections.ts';

/** Collections owned by the ledger module (DRAGON-11a). */
export const LEDGER_COLLECTIONS = {
  accounts: 'ledger_accounts',
  transactions: 'ledger_transactions',
  entries: 'ledger_entries'
} as const;

/**
 * Ledger integrity safeguards. These unique constraints — not read-before-write
 * checks — are the authority behind one-account-per-identity, one-posting-per
 * business-reference, one-compensation-per-transaction, and unique line numbers,
 * so concurrent creation/posting collapses to a single durable record.
 */
export const LEDGER_INDEXES: readonly IndexDeclaration[] = [
  // One canonical account per role/owner/asset/scale; account-creation races collapse here.
  { collection: LEDGER_COLLECTIONS.accounts, name: 'account_identity_unique', keys: { identityKey: 1 }, options: { unique: true } },
  { collection: LEDGER_COLLECTIONS.accounts, name: 'account_owner', keys: { ownerId: 1, accountType: 1 } },

  // One journal transaction per durable business reference (the second duplicate-posting safeguard).
  { collection: LEDGER_COLLECTIONS.transactions, name: 'transaction_business_ref_unique', keys: { businessRef: 1 }, options: { unique: true } },
  // At most one compensation per reversed transaction.
  { collection: LEDGER_COLLECTIONS.transactions, name: 'transaction_reversal_unique', keys: { reversalOf: 1 }, options: { unique: true, partialFilterExpression: { reversalOf: { $type: 'string' } } } },
  { collection: LEDGER_COLLECTIONS.transactions, name: 'transaction_correlation', keys: { correlationId: 1 } },

  // Unique deterministic line numbers within a transaction.
  { collection: LEDGER_COLLECTIONS.entries, name: 'entry_transaction_line_unique', keys: { transactionId: 1, lineNumber: 1 }, options: { unique: true } },
  // Account-entry pagination in stable (recordedAt, id) order.
  { collection: LEDGER_COLLECTIONS.entries, name: 'entry_account_recordedAt', keys: { accountId: 1, recordedAt: 1, _id: 1 } }
];
