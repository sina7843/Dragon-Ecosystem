import { apiFetch } from '../api.ts';

/**
 * Dragon Coin purchase client (DRAGON-11b). The server owns pricing, provider
 * requests, callback verification, and crediting; these calls only shape requests.
 * A purchase is never shown as successful until the server reports the verified,
 * credited state.
 */

export interface PackageView {
  code: string;
  dragonCoin: number;
  rialAmount: number;
  tomanAmount: number;
  pricingVersion: number;
}

export type PurchaseState = 'created' | 'payment_pending' | 'succeeded' | 'failed' | 'cancelled' | 'expired' | 'corrected';

export interface PurchaseView {
  id: string;
  packageCode: string;
  dragonCoin: number;
  rialAmount: number;
  tomanAmount: number;
  state: PurchaseState;
  callbackVerification: 'unverified' | 'verified' | 'failed';
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
  version: number;
}

export function listPackages(): Promise<{ packages: PackageView[] }> {
  return apiFetch('/payments/packages');
}

export function getDragonCoinBalance(): Promise<{ balance: number }> {
  return apiFetch('/payments/balance');
}

export function newPurchaseKey(): string {
  return `buy-${crypto.randomUUID()}`;
}

export function createPurchase(packageCode: string, idempotencyKey: string): Promise<PurchaseView> {
  return apiFetch('/payments/purchases', { method: 'POST', body: JSON.stringify({ packageCode, idempotencyKey }) });
}

export function getPurchase(id: string): Promise<PurchaseView> {
  return apiFetch(`/payments/purchases/${encodeURIComponent(id)}`);
}

export function listPurchases(cursor?: string): Promise<{ items: PurchaseView[]; nextCursor: string | null }> {
  const q = cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`;
  return apiFetch(`/payments/purchases${q}`);
}

/** Mock-only: simulates the provider completing the payment (non-production control). */
export function mockPay(purchaseId: string, outcome: 'success' | 'failed' | 'cancelled'): Promise<PurchaseView> {
  return apiFetch('/payments/mock/pay', { method: 'POST', body: JSON.stringify({ purchaseId, outcome }) });
}
