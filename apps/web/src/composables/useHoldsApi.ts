import { apiFetch } from '../api.ts';

/**
 * Dragon Coin wallet summary and holds (DRAGON-11c). The server owns balances and
 * hold state; these calls only read the caller's own data. No internal ledger
 * account id or business reference is returned.
 */

export interface WalletSummary {
  ledgerBalance: number;
  heldAmount: number;
  availableBalance: number;
}

export type HoldState = 'active' | 'partially_captured' | 'captured' | 'released' | 'expired' | 'cancelled';

export interface HoldView {
  id: string;
  purpose: string;
  originalAmount: number;
  remainingAmount: number;
  capturedAmount: number;
  releasedAmount: number;
  state: HoldState;
  createdAt: string;
  expiresAt: string;
  version: number;
}

export function getWalletSummary(): Promise<WalletSummary> {
  return apiFetch('/wallet/summary');
}

export function listHolds(cursor?: string): Promise<{ items: HoldView[]; nextCursor: string | null }> {
  const q = cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`;
  return apiFetch(`/wallet/holds${q}`);
}
