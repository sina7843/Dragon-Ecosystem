import type { IndexDeclaration } from '../../shared/db/collections.ts';

/** Collections owned by the chat module (DATA-046, DATA-047). */
export const CHAT_COLLECTIONS = {
  rooms: 'chat_rooms',
  messages: 'chat_messages',
  restrictions: 'chat_restrictions'
} as const;

export const CHAT_INDEXES: readonly IndexDeclaration[] = [
  // CHAT-001: one room per stream, so a room can never be linked to two streams or a
  // stream end up with two competing rooms.
  { collection: CHAT_COLLECTIONS.rooms, name: 'chat_room_stream_unique', keys: { streamId: 1 }, options: { unique: true } },
  // The read feed walks a room in sequence order; the index carries the whole sort key so
  // a cursor read is an index scan rather than a scan-and-sort (PERF-010, PERF-012).
  { collection: CHAT_COLLECTIONS.messages, name: 'chat_message_room_sequence', keys: { roomId: 1, sequence: 1 } },
  // CHAT-006: a retried send with the same client key converges on the existing message
  // instead of creating a second one.
  {
    collection: CHAT_COLLECTIONS.messages,
    name: 'chat_message_client_key_unique',
    keys: { roomId: 1, senderId: 1, clientMessageId: 1 },
    options: { unique: true }
  },
  // The moderation console lists a sender's recent messages when reviewing a case.
  { collection: CHAT_COLLECTIONS.messages, name: 'chat_message_sender', keys: { senderId: 1, createdAt: -1 } },
  // The send path checks restrictions on every message, so the lookup must be indexed.
  { collection: CHAT_COLLECTIONS.restrictions, name: 'chat_restriction_room_account', keys: { roomId: 1, accountId: 1, createdAt: -1 } },
  { collection: CHAT_COLLECTIONS.restrictions, name: 'chat_restriction_room_created', keys: { roomId: 1, createdAt: -1 } }
];
