/** Public surface of the social module (SOCIAL-001..012). */
export {
  SocialService,
  DEFAULT_SOCIAL_CONFIG,
  type SocialConfig,
  type SocialDirectory,
  type SocialModerationCases,
  type PostView
} from './service.ts';
export { registerSocialRoutes, type SocialDeps } from './routes.ts';
export { socialMigration } from './migrations.ts';
export { SOCIAL_COLLECTIONS, SOCIAL_INDEXES } from './collections.ts';
export {
  isContentReadable,
  hasTombstone,
  CONTENT_STATES,
  FOLLOW_TARGET_TYPES,
  POST_VISIBILITIES,
  REACTION_TARGET_TYPES,
  REACTION_TYPES,
  type ContentState,
  type FollowRecord,
  type FollowTargetType,
  type PostVisibility,
  type ReactionRecord,
  type ReactionTargetType,
  type SocialCommentRecord,
  type SocialPostRecord,
  type SocialProfileRecord,
  type SocialStatistic
} from './state.ts';
