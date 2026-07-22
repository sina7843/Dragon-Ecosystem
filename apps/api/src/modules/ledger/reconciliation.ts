import type { Db } from 'mongodb';
import type { Database } from '../../shared/db/client.ts';
import { ValidationError } from '../../shared/errors.ts';
import type { EntityId } from '../../shared/ids.ts';
import { LEDGER_COLLECTIONS } from './collections.ts';
import type { LedgerAccountRecord, LedgerEntryRecord, LedgerTransactionRecord } from './state.ts';

/**
 * Read-only ledger reconciliation (DRAGON-11a).
 *
 * These primitives verify integrity and report structured findings; they never
 * repair data. Every scan is bounded (one account, one transaction, or an explicit
 * bounded account list) so reconciliation cannot become an unbounded operation.
 * Findings carry only opaque identifiers — never user data.
 */

export type Severity = 'info' | 'warning' | 'critical';

export interface ReconciliationFinding {
  checkId: string;
  entityRef: string;
  expected: string | number | null;
  actual: string | number | null;
  severity: Severity;
  explanation: string;
}

export const MAX_RECONCILIATION_ACCOUNTS = 100;

export class LedgerReconciliation {
  readonly #db: Db;

  constructor(database: Database) {
    this.#db = database.db;
  }
  #accounts() {
    return this.#db.collection<LedgerAccountRecord>(LEDGER_COLLECTIONS.accounts);
  }
  #transactions() {
    return this.#db.collection<LedgerTransactionRecord>(LEDGER_COLLECTIONS.transactions);
  }
  #entries() {
    return this.#db.collection<LedgerEntryRecord>(LEDGER_COLLECTIONS.entries);
  }

  /** Verifies one transaction balances to zero and its lines are consistent. */
  async reconcileTransaction(transactionId: EntityId): Promise<ReconciliationFinding[]> {
    const findings: ReconciliationFinding[] = [];
    const transaction = await this.#transactions().findOne({ _id: transactionId });
    const entries = await this.#entries().find({ transactionId }).sort({ lineNumber: 1 }).toArray();

    if (transaction === null) {
      if (entries.length > 0) findings.push({ checkId: 'orphan_entries', entityRef: transactionId, expected: 'a journal header', actual: `${String(entries.length)} orphan entries`, severity: 'critical', explanation: 'Entries exist with no journal header.' });
      return findings;
    }
    if (entries.length < 2) findings.push({ checkId: 'entry_count', entityRef: transactionId, expected: '>= 2', actual: entries.length, severity: 'critical', explanation: 'A posted transaction must have at least two entries.' });
    if (entries.length !== transaction.entryCount) findings.push({ checkId: 'entry_count_header', entityRef: transactionId, expected: transaction.entryCount, actual: entries.length, severity: 'critical', explanation: 'The stored entry count does not match the number of entries.' });

    const sum = entries.reduce((total, entry) => total + entry.amount, 0);
    if (sum !== 0) findings.push({ checkId: 'balances_to_zero', entityRef: transactionId, expected: 0, actual: sum, severity: 'critical', explanation: 'The transaction entries do not sum to zero.' });

    for (const entry of entries) {
      if (entry.assetCode !== transaction.assetCode || entry.scale !== transaction.scale) {
        findings.push({ checkId: 'asset_scale_match', entityRef: entry._id, expected: `${transaction.assetCode}/${String(transaction.scale)}`, actual: `${entry.assetCode}/${String(entry.scale)}`, severity: 'critical', explanation: 'An entry asset or scale does not match its transaction.' });
      }
    }
    const lineNumbers = entries.map((entry) => entry.lineNumber).sort((a, b) => a - b);
    const contiguous = lineNumbers.every((line, index) => line === index);
    if (new Set(lineNumbers).size !== lineNumbers.length || !contiguous) {
      findings.push({ checkId: 'line_numbers', entityRef: transactionId, expected: `0..${String(entries.length - 1)}`, actual: lineNumbers.join(','), severity: 'critical', explanation: 'Line numbers must be unique and contiguous from zero.' });
    }
    return findings;
  }

  /** Recomputes an account balance from immutable entries (the authoritative source). */
  async recomputeAccountBalance(accountId: EntityId): Promise<{ sum: number; count: number }> {
    const rows = await this.#entries()
      .aggregate<{ sum: number; count: number }>([{ $match: { accountId } }, { $group: { _id: null, sum: { $sum: '$amount' }, count: { $sum: 1 } } }])
      .toArray();
    return rows[0] ?? { sum: 0, count: 0 };
  }

  /** Compares the recomputed balance and entry count with the stored projection. */
  async reconcileAccount(accountId: EntityId): Promise<ReconciliationFinding[]> {
    const findings: ReconciliationFinding[] = [];
    const account = await this.#accounts().findOne({ _id: accountId });
    if (account === null) {
      findings.push({ checkId: 'account_exists', entityRef: accountId, expected: 'an account', actual: null, severity: 'critical', explanation: 'The account does not exist.' });
      return findings;
    }
    const recomputed = await this.recomputeAccountBalance(accountId);
    if (recomputed.sum !== account.balance) findings.push({ checkId: 'balance_projection', entityRef: accountId, expected: recomputed.sum, actual: account.balance, severity: 'critical', explanation: 'The stored balance projection drifted from the entries.' });
    if (recomputed.count !== account.entryCount) findings.push({ checkId: 'entry_count_projection', entityRef: accountId, expected: recomputed.count, actual: account.entryCount, severity: 'warning', explanation: 'The stored entry count drifted from the entries.' });
    if (!account.allowsNegative && account.balance < 0) findings.push({ checkId: 'negative_balance', entityRef: accountId, expected: '>= 0', actual: account.balance, severity: 'critical', explanation: 'A non-credit account holds a negative balance.' });
    return findings;
  }

  /** Bounded reconciliation report over an explicit account list. Rejects unbounded requests. */
  async report(accountIds: readonly EntityId[]): Promise<{ findings: ReconciliationFinding[]; checkedAccounts: number }> {
    if (accountIds.length === 0) throw new ValidationError('A bounded account list is required.', [{ field: 'accountIds', code: 'RECONCILIATION_UNBOUNDED', message: 'Provide at least one account.' }]);
    if (accountIds.length > MAX_RECONCILIATION_ACCOUNTS) throw new ValidationError('Too many accounts to reconcile at once.', [{ field: 'accountIds', code: 'RECONCILIATION_UNBOUNDED', message: `Reconcile at most ${String(MAX_RECONCILIATION_ACCOUNTS)} accounts per report.` }]);
    const findings: ReconciliationFinding[] = [];
    for (const accountId of accountIds) findings.push(...(await this.reconcileAccount(accountId)));
    return { findings, checkedAccounts: accountIds.length };
  }
}
