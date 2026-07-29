import type { IndexDeclaration } from '../../shared/db/collections.ts';

/** Collections owned by the store module (DATA-073..081). */
export const STORE_COLLECTIONS = {
  products: 'store_products',
  variants: 'store_variants',
  movements: 'store_inventory_movements',
  carts: 'store_carts',
  cartItems: 'store_cart_items',
  discounts: 'store_discounts',
  orders: 'store_orders',
  orderItems: 'store_order_items',
  fulfillments: 'store_fulfillments',
  entitlements: 'store_entitlements'
} as const;

export const STORE_INDEXES: readonly IndexDeclaration[] = [
  { collection: STORE_COLLECTIONS.products, name: 'product_slug_unique', keys: { slug: 1 }, options: { unique: true } },
  // The storefront lists published products by type and availability (COMMERCE-014).
  { collection: STORE_COLLECTIONS.products, name: 'product_state_type_created', keys: { state: 1, type: 1, createdAt: -1, _id: -1 } },

  // DATA-074: a SKU identifies exactly one variant across the whole catalog.
  { collection: STORE_COLLECTIONS.variants, name: 'variant_sku_unique', keys: { sku: 1 }, options: { unique: true } },
  { collection: STORE_COLLECTIONS.variants, name: 'variant_product_state', keys: { productId: 1, state: 1 } },

  // Append-only stock history, read newest-first per variant (COMMERCE-013).
  { collection: STORE_COLLECTIONS.movements, name: 'movement_variant_created', keys: { variantId: 1, createdAt: -1, _id: -1 } },
  { collection: STORE_COLLECTIONS.movements, name: 'movement_order', keys: { orderId: 1 } },

  // One open cart per account: the partial filter lets ordered and expired carts remain.
  { collection: STORE_COLLECTIONS.carts, name: 'cart_open_unique', keys: { accountId: 1 }, options: { unique: true, partialFilterExpression: { state: 'open' } } },
  // One row per (cart, variant): quantity changes update in place rather than duplicating.
  { collection: STORE_COLLECTIONS.cartItems, name: 'cart_item_unique', keys: { cartId: 1, variantId: 1 }, options: { unique: true } },

  { collection: STORE_COLLECTIONS.discounts, name: 'discount_code_unique', keys: { code: 1 }, options: { unique: true } },

  { collection: STORE_COLLECTIONS.orders, name: 'order_reference_unique', keys: { reference: 1 }, options: { unique: true } },
  { collection: STORE_COLLECTIONS.orders, name: 'order_account_created', keys: { accountId: 1, createdAt: -1, _id: -1 } },
  { collection: STORE_COLLECTIONS.orders, name: 'order_state_created', keys: { state: 1, createdAt: -1, _id: -1 } },
  { collection: STORE_COLLECTIONS.orderItems, name: 'order_item_order', keys: { orderId: 1, createdAt: 1 } },

  { collection: STORE_COLLECTIONS.fulfillments, name: 'fulfillment_order', keys: { orderId: 1 } },
  { collection: STORE_COLLECTIONS.fulfillments, name: 'fulfillment_state_created', keys: { state: 1, createdAt: -1 } },

  // DATA: one entitlement per purchased order item, so a replayed grant cannot duplicate it.
  { collection: STORE_COLLECTIONS.entitlements, name: 'entitlement_order_item_unique', keys: { orderItemId: 1 }, options: { unique: true } },
  { collection: STORE_COLLECTIONS.entitlements, name: 'entitlement_account_granted', keys: { accountId: 1, grantedAt: -1 } }
];
