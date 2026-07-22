/** Public surface of the payments module (section 32.1). */
export { PaymentsService, type PackageView, type PaymentsConfigView } from './service.ts';
export { registerPaymentsRoutes, type PaymentsDeps } from './routes.ts';
export { MockPaymentProvider, type PaymentProvider, type RawCallback, type VerifiedCallback, type ProviderEventType } from './provider.ts';
export { paymentsMigration } from './migrations.ts';
export { PAYMENTS_COLLECTIONS, PAYMENTS_INDEXES } from './collections.ts';
export { DRAGON_COIN_PACKAGES, PRICING_VERSION, findPackage, packageToman } from './packages.ts';
export type { PurchaseRecord, PurchaseState, ProviderEventRecord } from './state.ts';
export { canTransition, isTerminal } from './state.ts';
