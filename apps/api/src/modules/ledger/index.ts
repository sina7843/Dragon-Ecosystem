/** Public surface of the ledger module (section 32.1); internal service only, no HTTP in DRAGON-11a. */
export { LedgerService, type BalanceView, type CompensateCommand } from './service.ts';
export { LedgerReconciliation, type ReconciliationFinding, type Severity, MAX_RECONCILIATION_ACCOUNTS } from './reconciliation.ts';
export { ledgerMigration } from './migrations.ts';
export { LEDGER_COLLECTIONS, LEDGER_INDEXES } from './collections.ts';
export {
  ACCOUNT_TYPES,
  TRANSACTION_TYPES,
  accountIdentityKey,
  isLedgerAccountType,
  isLedgerTransactionType,
  type AccountRef,
  type LedgerAccountType,
  type LedgerTransactionType
} from './accounts.ts';
export { buildJournal, canonicalHash, MAX_ENTRIES, type PostCommand, type PostEntryInput, type Journal } from './journal.ts';
export type { LedgerAccountRecord, LedgerTransactionRecord, LedgerEntryRecord, PostedTransaction, BoundedMetadata } from './state.ts';
