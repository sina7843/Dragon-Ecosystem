/** Public surface of the teams module (section 32.1). */
export { TeamsService, type GameLookup, type IdentityLookup } from './service.ts';
export { registerTeamsRoutes, type TeamsDeps } from './routes.ts';
export type { TeamRecord, MembershipRecord, InvitationRecord, RosterSnapshotRecord, TeamRole } from './state.ts';
export { TEAM_ROLES, DELEGATABLE_TEAM_ROLES, canAdministerTeam, canManageRoster } from './state.ts';
