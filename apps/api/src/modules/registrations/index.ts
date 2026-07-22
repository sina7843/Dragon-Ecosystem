/** Public surface of the registrations module (section 32.1). */
export { RegistrationsService, type TournamentAccess, type ProfileAccess, type TeamAccess } from './service.ts';
export { registerRegistrationsRoutes, type RegistrationsDeps } from './routes.ts';
export type { RegistrationRecord, RegistrationState } from './state.ts';
