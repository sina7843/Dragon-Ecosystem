/** Public surface of the moderation module (section 32.1). */
export { ModerationService, type ModerationIdentityAccess } from './service.ts';
export { registerModerationRoutes, type ModerationDeps } from './routes.ts';
export { moderationMigration } from './migrations.ts';
export { MODERATION_COLLECTIONS, MODERATION_INDEXES } from './collections.ts';
export { canCaseTransition, canSupportTransition, maskAccountId, type ModerationCaseRecord, type SupportCaseRecord, type RecoveryRequestRecord, type ReportRecord } from './state.ts';
