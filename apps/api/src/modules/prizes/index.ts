/** Public surface of the prizes module (section 32.1). */
export { PrizesService, type StandingsAccess, type RegistrationAccess, type AllocationSummary } from './service.ts';
export { registerPrizesRoutes, type PrizesDeps } from './routes.ts';
export { prizesMigration } from './migrations.ts';
export { PRIZES_COLLECTIONS, PRIZES_INDEXES } from './collections.ts';
export { canEntitlementTransition, type PrizeEntitlementRecord, type PrizeAllocationRecord, type EntitlementState } from './state.ts';
