import { apiFetch } from '../api.ts';
import type { Locale } from '../i18n/locale.ts';

/**
 * Typed client for commerce (COMMERCE-001..014).
 *
 * No total is ever computed here. Every figure the cart and checkout render comes from the
 * server, which reprices from the catalog on each call (COMMERCE-004) — a client that did
 * its own arithmetic would eventually disagree with the order it produced.
 */

export interface MoneyView {
  assetCode: 'IRR' | 'DRC';
  amountInteger: number;
  scale: number;
}

export type ProductType = 'physical' | 'digital';
export type OrderState = 'pending_payment' | 'paid' | 'cancelled' | 'failed';
export type FulfillmentState = 'pending' | 'packed' | 'shipped' | 'delivered' | 'cancelled' | 'failed';

export interface StoreConfig {
  physicalFulfillmentEnabled: boolean;
  entitlementRevocationEnabled: boolean;
  returnsWorkflow: 'not_offered';
}

export interface ProductCard {
  id: string;
  slug: string;
  type: ProductType;
  title: string;
  summary: string;
  coverImageUrl: string | null;
  fromPrice: MoneyView[];
  available: boolean;
}

export interface ProductVariantView {
  id: string;
  sku: string;
  name: string;
  price: MoneyView[];
  available: boolean;
  stockOnHand: number | null;
}

export interface ProductDetail {
  id: string;
  slug: string;
  type: ProductType;
  title: string;
  summary: string;
  description: string;
  mediaUrls: string[];
  variants: ProductVariantView[];
  /** Stated by the server so the page cannot offer a checkout the API will refuse. */
  purchasable: boolean;
  purchasableReason: string | null;
}

export interface CartTotals {
  itemSubtotal: MoneyView[];
  discountTotal: MoneyView[];
  shippingTotal: MoneyView[];
  grandTotal: MoneyView[];
  discountApplied: { code: string; version: number; percentOff: number } | null;
}

export interface CartView {
  id: string;
  version: number;
  discountCode: string | null;
  discountProblem: string | null;
  items: Array<{ id: string; variantId: string; sku: string; name: string; quantity: number; unitPrice: MoneyView[]; lineTotal: MoneyView[] }>;
  totals: CartTotals;
  /** Non-null when something in the cart cannot be bought yet (OD-019). */
  blocked: string | null;
  /** True when a physical line is present, so checkout must collect a delivery address. */
  requiresAddress: boolean;
}

export interface OrderView {
  id: string;
  reference: string;
  state: OrderState;
  itemSubtotal: MoneyView[];
  discountTotal: MoneyView[];
  shippingTotal: MoneyView[];
  grandTotal: MoneyView[];
  discountSnapshot: { code: string; version: number; percentOff: number } | null;
  addressSnapshot: ShippingAddress | null;
  failureReason: string | null;
  createdAt: string;
  paidAt: string | null;
}

export interface ShippingAddress {
  fullName: string;
  mobile: string;
  province: string;
  city: string;
  postalCode: string;
  line1: string;
}

export interface OrderDetail {
  order: OrderView;
  items: Array<{ id: string; skuSnapshot: string; titleSnapshot: Record<Locale, string>; quantity: number; unitPrice: MoneyView[]; lineTotal: MoneyView[]; type: ProductType }>;
  fulfillments: Array<{ id: string; type: ProductType; state: FulfillmentState }>;
  entitlements: Array<{ id: string; productId: string; grantedAt: string }>;
  /** The server recomputes the line sum; a false `reconciles` is a visible mismatch. */
  receipt: { lineTotal: MoneyView[]; reconciles: boolean };
}

export function getStoreConfig(): Promise<StoreConfig> {
  return apiFetch('/store/config');
}

export function listProducts(query: { locale: Locale; type?: ProductType; q?: string; available?: boolean }): Promise<{ items: ProductCard[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ locale: query.locale });
  if (query.type !== undefined) params.set('type', query.type);
  if (query.q !== undefined && query.q !== '') params.set('q', query.q);
  if (query.available === true) params.set('available', 'true');
  return apiFetch(`/products?${params.toString()}`);
}

export function getProduct(slug: string, locale: Locale): Promise<ProductDetail> {
  return apiFetch(`/products/${encodeURIComponent(slug)}?locale=${locale}`);
}

export function getCart(locale: Locale): Promise<CartView> {
  return apiFetch(`/me/cart?locale=${locale}`);
}

export function setCartItem(locale: Locale, variantId: string, quantity: number): Promise<CartView> {
  return apiFetch(`/me/cart?locale=${locale}`, { method: 'PATCH', body: JSON.stringify({ variantId, quantity }) });
}

export function setCartDiscount(locale: Locale, discountCode: string | null): Promise<CartView> {
  return apiFetch(`/me/cart?locale=${locale}`, { method: 'PATCH', body: JSON.stringify({ discountCode }) });
}

export function placeOrder(body: { cartVersion: number; idempotencyKey: string; consent: boolean; address?: ShippingAddress }): Promise<OrderView> {
  return apiFetch('/orders', { method: 'POST', body: JSON.stringify(body) });
}

export function listMyOrders(): Promise<{ items: OrderView[]; nextCursor: string | null }> {
  return apiFetch('/me/orders');
}

export function getMyOrder(id: string): Promise<OrderDetail> {
  return apiFetch(`/me/orders/${encodeURIComponent(id)}`);
}

// --- Store administration (PAGE-056, PAGE-057) ---

export function createProduct(body: { slug?: string; type: ProductType; translations: Record<Locale, { title: string; summary?: string; description?: string }> }): Promise<{ id: string; slug: string }> {
  return apiFetch('/admin/store/products', { method: 'POST', body: JSON.stringify(body) });
}

export function setProductStatus(id: string, state: 'draft' | 'published' | 'archived', reason: string): Promise<unknown> {
  return apiFetch(`/admin/store/products/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify({ state, reason }) });
}

export function createVariant(productId: string, body: { sku: string; translations: Record<Locale, { name: string }>; price: { dragonCoinAmount: number; tomanAmount?: number }; stockOnHand?: number }): Promise<{ id: string }> {
  return apiFetch(`/admin/store/products/${encodeURIComponent(productId)}/variants`, { method: 'POST', body: JSON.stringify(body) });
}

export function adjustInventory(variantId: string, quantityDelta: number, reason: string): Promise<{ id: string; stockOnHand: number }> {
  return apiFetch(`/admin/store/variants/${encodeURIComponent(variantId)}/inventory`, { method: 'POST', body: JSON.stringify({ quantityDelta, reason }) });
}

export function listInventoryMovements(variantId: string): Promise<{ items: Array<{ id: string; quantityDelta: number; source: string; reason: string; resultingQuantity: number; createdAt: string }> }> {
  return apiFetch(`/admin/store/variants/${encodeURIComponent(variantId)}/inventory`);
}

export function listOperatorOrders(state?: string): Promise<{ items: OrderView[] }> {
  return apiFetch(`/admin/store/orders${state === undefined || state === '' ? '' : `?state=${encodeURIComponent(state)}`}`);
}

export function listOrderFulfillments(orderId: string): Promise<{ items: Array<{ id: string; type: ProductType; state: FulfillmentState }> }> {
  return apiFetch(`/admin/store/orders/${encodeURIComponent(orderId)}/fulfillments`);
}

export function setFulfillmentState(id: string, state: FulfillmentState, reason: string): Promise<unknown> {
  return apiFetch(`/admin/store/fulfillments/${encodeURIComponent(id)}/state`, { method: 'POST', body: JSON.stringify({ state, reason }) });
}

export function getReconciliation(): Promise<{ paidOrders: number; itemSum: number; orderSum: number; differences: Array<{ orderId: string; reference: string; itemSum: number; orderSum: number }> }> {
  return apiFetch('/admin/store/reconciliation');
}
