/** Public surface of the competitions module (section 32.1). */
export { CompetitionsService, type TournamentAccess, type RegistrationAccess, type GenerateOptions } from './service.ts';
export { registerCompetitionsRoutes, type CompetitionsDeps } from './routes.ts';
export type { CompetitionRecord, MatchRecord, ParticipantRef, CompetitionFormat, StandingsSnapshotRecord, ResultCorrectionRecord } from './state.ts';
export type { ManualGraphSpec, ManualFixtureSpec } from './manual.ts';
export type { StandingRow, StandingsStatus } from './standings.ts';
