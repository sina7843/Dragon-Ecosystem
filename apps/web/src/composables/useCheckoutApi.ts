import { apiFetch } from '../api.ts';

/**
 * Paid tournament checkout client (DRAGON-12). The server owns the fee, provider
 * request, and activation; these calls only shape requests. A registration is only
 * activated once the server reports the checkout activated — never on initiation.
 */

export type CheckoutState = 'awaiting_payment' | 'awaiting_confirmation' | 'activated' | 'cancelled' | 'expired' | 'failed';

export interface CheckoutView {
  id: string;
  tournamentId: string;
  irrAmount: number;
  tomanAmount: number;
  drcAmount: number;
  state: CheckoutState;
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
  version: number;
}

export function newCheckoutKey(): string {
  return `checkout-${crypto.randomUUID()}`;
}

export function startCheckout(tournamentId: string, idempotencyKey: string): Promise<CheckoutView> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/checkout`, { method: 'POST', body: JSON.stringify({ idempotencyKey }) });
}

export function getCheckout(id: string): Promise<CheckoutView> {
  return apiFetch(`/checkouts/${encodeURIComponent(id)}`);
}

/** The caller's own checkouts, newest first. */
export function listCheckouts(): Promise<{ items: CheckoutView[]; nextCursor: string | null }> {
  return apiFetch('/checkouts?limit=50');
}

/** States a checkout can still be carried forward from; anything else is finished. */
const RESUMABLE: readonly CheckoutState[] = ['awaiting_payment', 'awaiting_confirmation'];

/**
 * The caller's unfinished checkout for one tournament, if any.
 *
 * A payment that is still settling leaves a real seat reserved (`pending_payment`), so
 * returning to the page must show that rather than offering to start again — a second
 * attempt is rejected by the server as a duplicate anyway.
 */
export async function findOpenCheckout(tournamentId: string): Promise<CheckoutView | null> {
  const page = await listCheckouts();
  return page.items.find((c) => c.tournamentId === tournamentId && RESUMABLE.includes(c.state)) ?? null;
}

export function confirmCheckout(id: string): Promise<CheckoutView> {
  return apiFetch(`/checkouts/${encodeURIComponent(id)}/confirm`, { method: 'POST' });
}

export function cancelCheckout(id: string, reason: string): Promise<CheckoutView> {
  return apiFetch(`/checkouts/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
}

/** Mock-only: simulate the provider settling the Toman fee (non-production control). */
export function mockPayCheckout(checkoutId: string, outcome: 'success' | 'failed' | 'cancelled'): Promise<CheckoutView> {
  return apiFetch('/checkout/mock/pay', { method: 'POST', body: JSON.stringify({ checkoutId, outcome }) });
}

export interface EntitlementView {
  id: string;
  tournamentId: string;
  rank: number;
  amount: number;
  tomanAmount: number;
  state: 'pending' | 'approved' | 'paid' | 'failed' | 'superseded';
  createdAt: string;
}

export function listEntitlements(): Promise<{ items: EntitlementView[]; nextCursor: string | null }> {
  return apiFetch('/wallet/entitlements');
}
