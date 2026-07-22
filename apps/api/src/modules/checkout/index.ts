/** Public surface of the checkout module (section 32.1). */
export { CheckoutService, computeFee, type CheckoutConfigView } from './service.ts';
export { registerCheckoutRoutes, type CheckoutDeps } from './routes.ts';
export { checkoutMigration } from './migrations.ts';
export { CHECKOUT_COLLECTIONS, CHECKOUT_INDEXES } from './collections.ts';
export { isCheckoutTerminal, type CheckoutRecord, type CheckoutState } from './state.ts';
