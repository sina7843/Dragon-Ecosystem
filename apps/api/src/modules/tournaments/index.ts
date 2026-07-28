/** Public surface of the tournaments module (section 32.1). */
export { TournamentsService, type GameLookup } from './service.ts';
export { registerTournamentsRoutes, type TournamentsDeps } from './routes.ts';
export type { TournamentRecord, TournamentState, FeeDefinition, FeeKind, PrizeDefinition, PrizePlacement } from './state.ts';
/** The approved maximum field size (DEC-046); other modules bound their reads by it. */
export { MAX_CAPACITY } from './state.ts';
