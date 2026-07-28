/** Public surface of the chat module (section 32.1). */
export {
  ChatService,
  DEFAULT_CHAT_CONFIG,
  MAX_FEED_LIMIT,
  type ChatConfig,
  type ChatStreamAccess,
  type ChatModerationCases,
  type MessageView
} from './service.ts';
export { registerChatRoutes, type ChatDeps } from './routes.ts';
export { chatMigration } from './migrations.ts';
export { CHAT_COLLECTIONS, CHAT_INDEXES } from './collections.ts';
export {
  canRoomTransition,
  isRestrictionActive,
  MESSAGE_STATES,
  RESTRICTION_KINDS,
  ROOM_STATES,
  type ChatMessageRecord,
  type ChatRestrictionRecord,
  type ChatRoomRecord,
  type MessageState,
  type RestrictionKind,
  type RoomState
} from './state.ts';
