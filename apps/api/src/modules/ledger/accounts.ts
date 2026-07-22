import type { AssetCode } from '../../shared/money.ts';

/**
 * Ledger account and transaction policies (DRAGON-11a).
 *
 * These are code-owned: clients never choose arbitrary debit/credit accounts or
 * invent transaction shapes. A posting names a transaction *type* and resolves
 * accounts by role; the policy here decides which account roles a type may touch,
 * which asset each account holds, and whether an account may go negative.
 */

export type LedgerAccountType =
  | 'user_dragon_coin'
  | 'platform_dragon_coin_treasury'
  | 'cash_clearing'
  | 'tournament_fee_holding'
  | 'refund_clearing'
  | 'prize_payable';

export interface AccountTypePolicy {
  readonly ownerKind: 'user' | 'system';
  readonly assetCode: AssetCode;
  readonly scale: number;
  /**
   * Whether the account's balance may fall below zero. User Dragon Coin balances
   * are liabilities the platform owes the user and must never go negative (no
   * credit, DEC-049). System control/clearing accounts are the counterparties that
   * issue or hold value and are expected to carry a negative running balance.
   */
  readonly allowsNegative: boolean;
  /** Stable semantic key for a singleton system account; absent for user-owned accounts. */
  readonly systemKey?: string;
}

export const ACCOUNT_TYPES: Readonly<Record<LedgerAccountType, AccountTypePolicy>> = {
  user_dragon_coin: { ownerKind: 'user', assetCode: 'DRC', scale: 0, allowsNegative: false },
  platform_dragon_coin_treasury: { ownerKind: 'system', assetCode: 'DRC', scale: 0, allowsNegative: true, systemKey: 'platform_dragon_coin_treasury' },
  cash_clearing: { ownerKind: 'system', assetCode: 'IRR', scale: 0, allowsNegative: true, systemKey: 'cash_clearing' },
  tournament_fee_holding: { ownerKind: 'system', assetCode: 'IRR', scale: 0, allowsNegative: true, systemKey: 'tournament_fee_holding' },
  refund_clearing: { ownerKind: 'system', assetCode: 'IRR', scale: 0, allowsNegative: true, systemKey: 'refund_clearing' },
  prize_payable: { ownerKind: 'system', assetCode: 'DRC', scale: 0, allowsNegative: true, systemKey: 'prize_payable' }
};

export function isLedgerAccountType(value: unknown): value is LedgerAccountType {
  return typeof value === 'string' && value in ACCOUNT_TYPES;
}

export type LedgerTransactionType =
  | 'dragon_coin_issue'
  | 'dragon_coin_transfer'
  | 'dragon_coin_adjustment'
  | 'cash_fee_collection'
  | 'compensation';

export interface TransactionTypePolicy {
  /** The single asset every leg of this transaction must use; null means "inherit from the reversed transaction". */
  readonly assetCode: AssetCode | null;
  /** Account roles this transaction type may reference; 'any' is reserved for compensations. */
  readonly allowedAccountTypes: readonly LedgerAccountType[] | 'any';
}

export const TRANSACTION_TYPES: Readonly<Record<LedgerTransactionType, TransactionTypePolicy>> = {
  dragon_coin_issue: { assetCode: 'DRC', allowedAccountTypes: ['platform_dragon_coin_treasury', 'user_dragon_coin', 'prize_payable'] },
  dragon_coin_transfer: { assetCode: 'DRC', allowedAccountTypes: ['user_dragon_coin', 'platform_dragon_coin_treasury'] },
  dragon_coin_adjustment: { assetCode: 'DRC', allowedAccountTypes: ['user_dragon_coin', 'platform_dragon_coin_treasury', 'prize_payable'] },
  // Records a Toman/rial tournament fee collected by the mock provider into the fee holding
  // account (DRAGON-12). No user IRR ledger account exists (WALLET-009); cash enters via clearing.
  cash_fee_collection: { assetCode: 'IRR', allowedAccountTypes: ['cash_clearing', 'tournament_fee_holding', 'refund_clearing'] },
  compensation: { assetCode: null, allowedAccountTypes: 'any' }
};

export function isLedgerTransactionType(value: unknown): value is LedgerTransactionType {
  return typeof value === 'string' && value in TRANSACTION_TYPES;
}

/** How a posting names an account; the ledger resolves it to a canonical record. */
export type AccountRef =
  | { readonly kind: 'system'; readonly accountType: LedgerAccountType }
  | { readonly kind: 'user'; readonly ownerId: string; readonly accountType: LedgerAccountType };

/**
 * Deterministic identity of the account a ref resolves to. Used both for the
 * unique account constraint and for the canonical idempotency payload, so it must
 * never contain a generated id — only stable role/owner/asset facts.
 */
export function accountIdentityKey(ref: AccountRef): string {
  const policy = ACCOUNT_TYPES[ref.accountType];
  if (ref.kind === 'system') return `sys:${policy.systemKey ?? ref.accountType}:${policy.assetCode}:${String(policy.scale)}`;
  return `usr:${ref.ownerId}:${ref.accountType}:${policy.assetCode}:${String(policy.scale)}`;
}
