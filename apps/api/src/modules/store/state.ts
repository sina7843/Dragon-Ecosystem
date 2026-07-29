import type { Money } from '../../shared/money.ts';
import type { EntityId } from '../../shared/ids.ts';

/** Both product locales are authored together, matching games and content. */
export const LOCALES = ['fa', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * Commerce contracts and pure state rules (COMMERCE-001..014, DATA-073..081).
 *
 * Three rules shape everything here:
 *
 * - An order is a **snapshot**, not a set of references (COMMERCE-012). Renaming a
 *   product or changing its price must not rewrite what a customer already bought, so
 *   every order item carries the title, SKU, unit price, and discount as they were at
 *   checkout. The variant id is kept for operations, never for display or arithmetic.
 * - Stock never goes negative (BR-027). The claim is a single conditional `$inc`, so two
 *   concurrent checkouts for the last unit cannot both succeed — the loser matches
 *   nothing and is rejected rather than reserved.
 * - Money is exact integers throughout. Settlement is Dragon Coin; an IRR list price is
 *   carried for the rial representation the receipt requires (COMMERCE-009) and is never
 *   used in settlement arithmetic.
 */

export const PRODUCT_TYPES = ['physical', 'digital'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const PRODUCT_STATES = ['draft', 'published', 'archived'] as const;
export type ProductState = (typeof PRODUCT_STATES)[number];

/** Only a published product is discoverable or sellable (COMMERCE-014). */
export function isSellableProduct(state: ProductState): boolean {
  return state === 'published';
}

/** Archive rather than delete: an order snapshot may still reference the product (DATA-073). */
export function canProductTransition(from: ProductState, to: ProductState): boolean {
  if (from === to) return false;
  if (from === 'draft') return to === 'published' || to === 'archived';
  if (from === 'published') return to === 'draft' || to === 'archived';
  return false; // archived is terminal
}

export interface LocalizedText {
  title: string;
  summary: string;
  description: string;
}

export interface ProductRecord {
  _id: EntityId;
  slug: string;
  type: ProductType;
  state: ProductState;
  /** Both locales are authored together, like games and content (I18N). */
  translations: Record<Locale, LocalizedText>;
  categoryId: EntityId | null;
  /** Site media paths only, so product imagery stays moderation-compatible (MEDIA-014). */
  mediaUrls: string[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ProductVariantRecord {
  _id: EntityId;
  productId: EntityId;
  /** Unique across the catalog (DATA-074). */
  sku: string;
  translations: Record<Locale, { name: string }>;
  /** Dragon Coin settlement price, plus an optional IRR list price for the receipt. */
  price: Money[];
  /**
   * On-hand units for a physical variant. A digital variant is unlimited and carries
   * `null` — modelling it as a large number would let a bug sell "the last one".
   */
  stockOnHand: number | null;
  state: 'active' | 'retired';
  createdAt: string;
  updatedAt: string;
}

/** Append-only stock history: every movement says who, why, and what it left behind (COMMERCE-013). */
export interface InventoryMovementRecord {
  _id: EntityId;
  variantId: EntityId;
  /** Signed: negative claims stock, positive returns or restocks it. */
  quantityDelta: number;
  source: 'adjustment' | 'order_claim' | 'order_release';
  actorId: EntityId | null;
  reason: string;
  /** Stock after the movement, so the history reconciles without replaying every row. */
  resultingQuantity: number;
  orderId: EntityId | null;
  createdAt: string;
}

export const CART_STATES = ['open', 'ordered', 'expired'] as const;
export type CartState = (typeof CART_STATES)[number];

export interface CartRecord {
  _id: EntityId;
  accountId: EntityId;
  state: CartState;
  /** Bumped on every mutation; checkout must present the version it priced (FORM-020). */
  version: number;
  discountCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CartItemRecord {
  _id: EntityId;
  cartId: EntityId;
  variantId: EntityId;
  quantity: number;
  /** Preview only. Checkout reprices from the catalog and ignores this (COMMERCE-004). */
  unitPricePreview: Money[];
  createdAt: string;
}

export interface DiscountRecord {
  _id: EntityId;
  code: string;
  /** Bumped whenever the rule changes, so a used discount stays reproducible (COMMERCE-005). */
  version: number;
  /** Whole percent off the item subtotal. Percent-only keeps the arithmetic exact. */
  percentOff: number;
  startsAt: string;
  endsAt: string;
  /** Empty means every product qualifies. */
  productIds: EntityId[];
  /** Null means no cap. */
  maxRedemptions: number | null;
  redemptionCount: number;
  state: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
}

export const ORDER_STATES = ['pending_payment', 'paid', 'cancelled', 'failed'] as const;
export type OrderState = (typeof ORDER_STATES)[number];

export function canOrderTransition(from: OrderState, to: OrderState): boolean {
  if (from !== 'pending_payment') return false;
  return to === 'paid' || to === 'cancelled' || to === 'failed';
}

/**
 * Internal operational fulfillment states (COMMERCE-008). No carrier state appears here:
 * OD-019 has selected no carrier, so a state like `handed_to_courier` would name a
 * relationship that does not exist.
 */
export const FULFILLMENT_STATES = ['pending', 'packed', 'shipped', 'delivered', 'cancelled', 'failed'] as const;
export type FulfillmentState = (typeof FULFILLMENT_STATES)[number];

const FULFILLMENT_NEXT: Readonly<Record<FulfillmentState, readonly FulfillmentState[]>> = {
  pending: ['packed', 'cancelled', 'failed'],
  packed: ['shipped', 'cancelled', 'failed'],
  shipped: ['delivered', 'failed'],
  delivered: [],
  cancelled: [],
  failed: ['pending']
};

export function canFulfillmentTransition(from: FulfillmentState, to: FulfillmentState): boolean {
  return FULFILLMENT_NEXT[from].includes(to);
}

/** A delivery address, restricted to configured Iranian regions (COMMERCE-003, BR-026, CON-008). */
export interface ShippingAddress {
  fullName: string;
  mobile: string;
  /** Province code from the configured domestic list; anything else is rejected. */
  province: string;
  city: string;
  postalCode: string;
  line1: string;
}

/** Immutable snapshot of what was bought, priced at checkout (COMMERCE-012, DATA-080). */
export interface OrderItemRecord {
  _id: EntityId;
  orderId: EntityId;
  variantId: EntityId;
  productId: EntityId;
  type: ProductType;
  /** Snapshots: the catalog may change, this may not. */
  titleSnapshot: Record<Locale, string>;
  skuSnapshot: string;
  quantity: number;
  unitPrice: Money[];
  lineSubtotal: Money[];
  lineDiscount: Money[];
  lineTotal: Money[];
  createdAt: string;
}

export interface OrderRecord {
  _id: EntityId;
  accountId: EntityId;
  state: OrderState;
  /** Human-facing reference shown on the receipt. */
  reference: string;
  itemSubtotal: Money[];
  discountTotal: Money[];
  /** Always zero while OD-019 leaves shipping rules unapproved; present so the receipt reconciles. */
  shippingTotal: Money[];
  grandTotal: Money[];
  discountSnapshot: { code: string; version: number; percentOff: number } | null;
  addressSnapshot: ShippingAddress | null;
  /** The Dragon Coin hold that reserved the price, and the capture that settled it. */
  holdId: EntityId | null;
  paidAt: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FulfillmentRecord {
  _id: EntityId;
  orderId: EntityId;
  orderItemId: EntityId;
  type: ProductType;
  state: FulfillmentState;
  addressSnapshot: ShippingAddress | null;
  history: Array<{ state: FulfillmentState; at: string; actorId: EntityId | null; reason: string }>;
  createdAt: string;
  updatedAt: string;
}

/**
 * A digital entitlement, created only after a successful payment (COMMERCE-007).
 *
 * There is no `revoked` state and no revocation path: OD-020 has not confirmed the
 * revocation rules, and a state nothing can reach is worse than no state at all.
 */
export interface EntitlementRecord {
  _id: EntityId;
  accountId: EntityId;
  orderId: EntityId;
  orderItemId: EntityId;
  productId: EntityId;
  variantId: EntityId;
  state: 'active';
  grantedAt: string;
}
