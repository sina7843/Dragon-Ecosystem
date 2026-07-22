import type { Db } from 'mongodb';
import type { Database } from '../../shared/db/client.ts';
import { ValidationError } from '../../shared/errors.ts';
import type { EntityId } from '../../shared/ids.ts';
import { LEDGER_COLLECTIONS } from '../ledger/index.ts';
import type { ReconciliationFinding } from '../ledger/index.ts';
import { HOLDS_COLLECTIONS } from './collections.ts';
import { isHoldOpen, type HoldRecord } from './state.ts';
import type { LedgerAccountRecord, LedgerTransactionRecord } from '../ledger/index.ts';

/**
 * Read-only hold reconciliation (DRAGON-11c). Verifies amount conservation, the
 * held-vs-available equation, capture-to-ledger linkage, and terminal consistency;
 * never repairs data. Bounded to an explicit account list. Findings carry only
 * opaque references and no personal data.
 */

export const MAX_HOLD_RECONCILIATION_ACCOUNTS = 100;

export class HoldsReconciliation {
  readonly #db: Db;

  constructor(database: Database) {
    this.#db = database.db;
  }
  #holds() {
    return this.#db.collection<HoldRecord>(HOLDS_COLLECTIONS.holds);
  }
  #accounts() {
    return this.#db.collection<LedgerAccountRecord>(LEDGER_COLLECTIONS.accounts);
  }
  #transactions() {
    return this.#db.collection<LedgerTransactionRecord>(LEDGER_COLLECTIONS.transactions);
  }

  /** Reconciles holds and the held/available equation for one ledger account. */
  async reconcileAccountHolds(ledgerAccountId: EntityId): Promise<ReconciliationFinding[]> {
    const findings: ReconciliationFinding[] = [];
    const account = await this.#accounts().findOne({ _id: ledgerAccountId });
    if (account === null) {
      findings.push({ checkId: 'account_exists', entityRef: ledgerAccountId, expected: 'an account', actual: null, severity: 'critical', explanation: 'The account does not exist.' });
      return findings;
    }
    const holds = await this.#holds().find({ ledgerAccountId }).toArray();
    const now = Date.now();

    // Amount conservation per hold: original = captured + released + remaining.
    for (const hold of holds) {
      if (hold.originalAmount !== hold.capturedAmount + hold.releasedAmount + hold.remainingAmount) {
        findings.push({ checkId: 'amount_conservation', entityRef: hold._id, expected: hold.originalAmount, actual: hold.capturedAmount + hold.releasedAmount + hold.remainingAmount, severity: 'critical', explanation: 'A hold does not conserve original = captured + released + remaining.' });
      }
      if (isHoldOpen(hold.state) && Date.parse(hold.expiresAt) < now) {
        findings.push({ checkId: 'expired_still_open', entityRef: hold._id, expected: 'terminal', actual: hold.state, severity: 'warning', explanation: 'A hold is past expiry but still open.' });
      }
      // Each captured hold must link at least one ledger transaction.
      if (hold.capturedAmount > 0 && hold.captureTransactionIds.length === 0) {
        findings.push({ checkId: 'missing_capture_journal', entityRef: hold._id, expected: 'a linked ledger transaction', actual: 'none', severity: 'critical', explanation: 'A captured hold has no linked ledger transaction.' });
      }
      for (const txId of hold.captureTransactionIds) {
        if ((await this.#transactions().countDocuments({ _id: txId })) === 0) {
          findings.push({ checkId: 'orphan_capture_link', entityRef: hold._id, expected: txId, actual: 'missing', severity: 'critical', explanation: 'A hold references a ledger transaction that does not exist.' });
        }
      }
    }

    // heldAmount projection must equal the sum of open holds' remaining amounts.
    const openRemaining = holds.filter((h) => isHoldOpen(h.state)).reduce((sum, h) => sum + h.remainingAmount, 0);
    const storedHeld = account.heldAmount ?? 0;
    if (storedHeld !== openRemaining) {
      findings.push({ checkId: 'held_projection', entityRef: ledgerAccountId, expected: openRemaining, actual: storedHeld, severity: 'critical', explanation: 'The stored held amount drifted from the open holds.' });
    }
    // Available balance never negative.
    if (account.balance - storedHeld < 0) {
      findings.push({ checkId: 'negative_available', entityRef: ledgerAccountId, expected: '>= 0', actual: account.balance - storedHeld, severity: 'critical', explanation: 'The available balance is negative.' });
    }
    return findings;
  }

  /** Bounded reconciliation over an explicit ledger-account list. Rejects unbounded requests. */
  async report(ledgerAccountIds: readonly EntityId[]): Promise<{ findings: ReconciliationFinding[]; checkedAccounts: number }> {
    if (ledgerAccountIds.length === 0) throw new ValidationError('A bounded account list is required.', [{ field: 'accountIds', code: 'RECONCILIATION_UNBOUNDED', message: 'Provide at least one account.' }]);
    if (ledgerAccountIds.length > MAX_HOLD_RECONCILIATION_ACCOUNTS) throw new ValidationError('Too many accounts to reconcile at once.', [{ field: 'accountIds', code: 'RECONCILIATION_UNBOUNDED', message: `Reconcile at most ${String(MAX_HOLD_RECONCILIATION_ACCOUNTS)} accounts per report.` }]);
    const findings: ReconciliationFinding[] = [];
    for (const id of ledgerAccountIds) findings.push(...(await this.reconcileAccountHolds(id)));
    return { findings, checkedAccounts: ledgerAccountIds.length };
  }
}
