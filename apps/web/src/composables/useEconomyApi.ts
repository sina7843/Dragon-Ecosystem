import { apiFetch } from '../api.ts';

/**
 * Typed client for Dragon Coin rewards and transfers (REWARD-002..008).
 *
 * There is no redemption, cash-out, or exchange function here, and there is no server
 * route for one either (DEC-024, DEC-023). A transfer moves coin between two players and
 * changes no asset.
 */

export type TransferState = 'completed' | 'manual_review' | 'rejected';

export interface EconomyConfig {
  limits: {
    maxTransferAmount: number;
    transferAmountPerWindow: number;
    transfersPerWindow: number;
    windowSeconds: number;
    manualReviewThreshold: number;
    payoutReviewThreshold: number;
  };
  cashRedemption: 'never';
  orderBookTrading: 'never';
  peerCommerce: 'gated';
  internalTomanWallet: 'disabled';
}

export interface CoinTransferView {
  id: string;
  senderId: string;
  recipientId: string;
  amount: number;
  note: string;
  state: TransferState;
  reviewReason: string | null;
  createdAt: string;
}

export function getEconomyConfig(): Promise<EconomyConfig> {
  return apiFetch('/economy/config');
}

export function sendCoins(body: { recipientUsername: string; amount: number; note?: string; idempotencyKey: string }): Promise<CoinTransferView> {
  return apiFetch('/me/coin-transfers', { method: 'POST', body: JSON.stringify(body) });
}

export function listMyTransfers(): Promise<{ items: CoinTransferView[] }> {
  return apiFetch('/me/coin-transfers');
}

// --- Finance operations ---

export function listTransfersForReview(): Promise<{ items: CoinTransferView[] }> {
  return apiFetch('/admin/coin-transfers/review');
}

export function approveTransfer(id: string, reason: string): Promise<CoinTransferView> {
  return apiFetch(`/admin/coin-transfers/${encodeURIComponent(id)}/approve`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export function rejectTransfer(id: string, reason: string): Promise<CoinTransferView> {
  return apiFetch(`/admin/coin-transfers/${encodeURIComponent(id)}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export interface RewardRuleView {
  id: string;
  code: string;
  source: string;
  amount: number;
  description: string;
  state: string;
  maxGrants: number | null;
  grantCount: number;
}

export function listRewardRules(): Promise<{ items: RewardRuleView[] }> {
  return apiFetch('/admin/reward-rules');
}

export function createRewardRule(body: { code: string; source: string; amount: number; description: string; maxGrants?: number }): Promise<RewardRuleView> {
  return apiFetch('/admin/reward-rules', { method: 'POST', body: JSON.stringify(body) });
}

export function grantReward(ruleId: string, accountId: string, reason: string): Promise<{ id: string; amount: number }> {
  return apiFetch(`/admin/reward-rules/${encodeURIComponent(ruleId)}/grants`, { method: 'POST', body: JSON.stringify({ accountId, reason }) });
}

export function getEconomyReconciliation(): Promise<{
  grants: { count: number; amount: number };
  transfers: { completed: number; amount: number; heldForReview: number; rejected: number };
  differences: Array<{ kind: string; detail: string }>;
}> {
  return apiFetch('/admin/economy/reconciliation');
}

// --- Prize settlement (PAYOUT-006..012) ---

export interface EntitlementView {
  id: string;
  tournamentId: string;
  rank: number;
  amount: number;
  tomanAmount: number;
  state: string;
  accountId?: string;
  settlementEvidence?: string | null;
  approvedBy?: string | null;
  paidBy?: string | null;
  recipientVerifiedBy?: string | null;
  retryCount?: number;
  reversalReason?: string | null;
  version: number;
}

export function listAdminEntitlements(state?: string): Promise<{ items: EntitlementView[] }> {
  return apiFetch(`/admin/entitlements${state === undefined || state === '' ? '' : `?state=${encodeURIComponent(state)}`}`);
}

function entitlementAction(id: string, action: string, body: Record<string, unknown>): Promise<EntitlementView> {
  return apiFetch(`/admin/entitlements/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: JSON.stringify(body) });
}

export const verifyRecipient = (id: string, expectedVersion: number, reason: string): Promise<EntitlementView> =>
  entitlementAction(id, 'verify-recipient', { expectedVersion, reason });
export const approveEntitlement = (id: string, expectedVersion: number, reason: string): Promise<EntitlementView> =>
  entitlementAction(id, 'approve', { expectedVersion, reason });
export const payEntitlement = (id: string, expectedVersion: number, reason: string, settlementEvidence: string): Promise<EntitlementView> =>
  entitlementAction(id, 'pay', { expectedVersion, reason, settlementEvidence });
export const failEntitlement = (id: string, expectedVersion: number, reason: string): Promise<EntitlementView> =>
  entitlementAction(id, 'fail', { expectedVersion, reason });
export const retryEntitlement = (id: string, expectedVersion: number, reason: string): Promise<EntitlementView> =>
  entitlementAction(id, 'retry', { expectedVersion, reason });
export const reverseEntitlement = (id: string, expectedVersion: number, reason: string): Promise<EntitlementView> =>
  entitlementAction(id, 'reverse', { expectedVersion, reason });

export function getFinanceReconciliation(): Promise<{
  allocations: number;
  dragonCoin: { allocatedAmount: number; ledgerAmount: number; missingTransactions: string[] };
  cash: { outstandingAmount: number; settledAmount: number; reversedAmount: number; byState: Record<string, { count: number; amount: number }> };
  differences: Array<{ kind: string; detail: string }>;
}> {
  return apiFetch('/admin/finance/reconciliation');
}
