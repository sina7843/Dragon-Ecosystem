import type { LedgerAccountType } from '../ledger/index.ts';

/**
 * Hold purposes and typed transfer boundaries (DRAGON-11c).
 *
 * Purposes and transfer relationships are code-owned — a client never chooses a
 * source, destination, treasury, escrow, or prize account. Every purpose whose
 * downstream workflow is still gated (OD-007, prize payout, refunds, transfers) is
 * fail-closed: creation or execution returns a stable disabled error and produces
 * no hold, journal, audit, or outbox effect. Only Dragon Coin (DRC) holds exist in
 * this slice, so every capture destination is a DRC account.
 */

export type HoldPurpose = 'admin_correction' | 'tournament_entry_fee' | 'prize_reservation';

export interface HoldPurposePolicy {
  /** Fail-closed gate: a hold for a disabled purpose cannot be created. */
  readonly enabled: boolean;
  /** Code-owned DRC destination a capture transfers into. */
  readonly captureDestination: LedgerAccountType;
  readonly partialCaptureAllowed: boolean;
  /** Why the purpose is gated, when disabled (for the report/decision trail). */
  readonly gateReason: string | null;
}

export const HOLD_PURPOSES: Readonly<Record<HoldPurpose, HoldPurposePolicy>> = {
  // Enabled: a finance-authorized reservation on a user's Dragon Coin, captured to
  // the platform treasury. Not a gated user workflow (it is an internal correction).
  admin_correction: { enabled: true, captureDestination: 'platform_dragon_coin_treasury', partialCaptureAllowed: true, gateReason: null },
  // Gated: paid tournament entry capture stays disabled under OD-007.
  tournament_entry_fee: { enabled: false, captureDestination: 'platform_dragon_coin_treasury', partialCaptureAllowed: true, gateReason: 'OD-007: paid tournament registration is not activated' },
  // Gated: prize payout is owned by a later prompt.
  prize_reservation: { enabled: false, captureDestination: 'prize_payable', partialCaptureAllowed: false, gateReason: 'Prize payout is deferred beyond DRAGON-11' }
};

export function isHoldPurpose(value: unknown): value is HoldPurpose {
  return typeof value === 'string' && value in HOLD_PURPOSES;
}

/**
 * Typed transfer boundaries required by later tournament/prize workflows. All are
 * gated in this slice — captures use the purpose relationship directly; these exist
 * so a gated transfer returns a stable disabled error with no side effect.
 */
export type TransferType = 'user_to_user' | 'refund_execution' | 'prize_payout' | 'withdrawal';

export interface TransferTypePolicy {
  readonly enabled: boolean;
  readonly source: LedgerAccountType;
  readonly destination: LedgerAccountType;
  readonly gateReason: string;
}

export const TRANSFER_TYPES: Readonly<Record<TransferType, TransferTypePolicy>> = {
  user_to_user: { enabled: false, source: 'user_dragon_coin', destination: 'user_dragon_coin', gateReason: 'User-to-user transfers are not enabled' },
  refund_execution: { enabled: false, source: 'refund_clearing', destination: 'user_dragon_coin', gateReason: 'Refund execution is deferred' },
  prize_payout: { enabled: false, source: 'prize_payable', destination: 'user_dragon_coin', gateReason: 'Prize payout is deferred' },
  withdrawal: { enabled: false, source: 'user_dragon_coin', destination: 'cash_clearing', gateReason: 'Withdrawable cash is not enabled' }
};

export function isTransferType(value: unknown): value is TransferType {
  return typeof value === 'string' && value in TRANSFER_TYPES;
}
