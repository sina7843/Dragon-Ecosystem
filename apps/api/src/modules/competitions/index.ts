/** Public surface of the competitions module (section 32.1). */
export { CompetitionsService, type TournamentAccess, type RegistrationAccess, type GenerateOptions } from './service.ts';
export type { CompetitionRecord, MatchRecord, ParticipantRef, CompetitionFormat } from './state.ts';
export type { ManualGraphSpec, ManualFixtureSpec } from './manual.ts';
