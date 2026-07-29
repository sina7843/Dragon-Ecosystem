/** Public surface of the store module (COMMERCE-001..014). */
export { StoreService, DEFAULT_STORE_CONFIG, type StoreConfig, type StorePayments, type ProductCard } from './service.ts';
export { registerStoreRoutes, type StoreDeps } from './routes.ts';
export { storeMigration } from './migrations.ts';
export { STORE_COLLECTIONS, STORE_INDEXES } from './collections.ts';
export {
  DOMESTIC_PROVINCES,
  SETTLEMENT_ASSET,
  addMoneyLists,
  buildVariantPrice,
  discountProblem,
  priceCart,
  settlementAmount,
  validAddress,
  type PricedCart
} from './pricing.ts';
export {
  canFulfillmentTransition,
  canOrderTransition,
  canProductTransition,
  isSellableProduct,
  FULFILLMENT_STATES,
  ORDER_STATES,
  PRODUCT_STATES,
  PRODUCT_TYPES,
  type FulfillmentRecord,
  type FulfillmentState,
  type OrderRecord,
  type OrderState,
  type ProductRecord,
  type ProductType,
  type ProductVariantRecord,
  type ShippingAddress
} from './state.ts';
