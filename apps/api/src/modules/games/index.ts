/** Public surface of the games module (section 32.1). */
export { GamesService } from './service.ts';
export { registerGamesRoutes, type GamesDeps } from './routes.ts';
export type { GameRecord, GameStatus } from './service.ts';
