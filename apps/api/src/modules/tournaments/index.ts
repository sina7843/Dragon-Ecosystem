/** Public surface of the tournaments module (section 32.1). */
export { TournamentsService, type GameLookup } from './service.ts';
export { registerTournamentsRoutes, type TournamentsDeps } from './routes.ts';
export type { TournamentRecord, TournamentState } from './state.ts';
