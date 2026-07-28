import { apiFetch } from '../api.ts';

/**
 * Typed client for moderated live chat (CHAT-001..008).
 *
 * Delivery is at-least-once: the feed is polled with the highest sequence held, and a
 * reconnect deliberately re-reads an overlapping range. Callers must deduplicate by
 * message id (CHAT-006) — `mergeMessages` below is the shared implementation, so no view
 * has to reinvent it.
 *
 * There is no direct-message client here, and none anywhere else: CHAT-008 requires that
 * private messaging is not shipped.
 */

export type MessageState = 'visible' | 'removed';

export interface ChatMessage {
  id: string;
  sequence: number;
  senderId: string;
  state: MessageState;
  /** Null once removed: the body is retained server-side as evidence but never delivered. */
  body: string | null;
  createdAt: string;
}

export interface ChatFeed {
  roomId: string;
  roomState: 'open' | 'closed';
  lastSequence: number;
  items: ChatMessage[];
}

export function getChatMessages(streamId: string, afterSequence = 0, limit?: number): Promise<ChatFeed> {
  const params = new URLSearchParams({ afterSequence: String(afterSequence) });
  if (limit !== undefined) params.set('limit', String(limit));
  return apiFetch(`/streams/${encodeURIComponent(streamId)}/chat/messages?${params.toString()}`);
}

export function sendChatMessage(streamId: string, body: { body: string; clientMessageId: string }): Promise<ChatMessage> {
  return apiFetch(`/streams/${encodeURIComponent(streamId)}/chat/messages`, { method: 'POST', body: JSON.stringify(body) });
}

export function reportChatMessage(messageId: string, body: { reason: string; details?: string }): Promise<{ reportId: string; caseId: string | null }> {
  return apiFetch(`/chat/messages/${encodeURIComponent(messageId)}/reports`, { method: 'POST', body: JSON.stringify(body) });
}

/** Key for a send, so a retry after a timeout converges instead of posting twice. */
export function newClientMessageId(): string {
  return `msg-${crypto.randomUUID()}`;
}

/**
 * Folds an incoming page into the held list, deduplicating by id and keeping sequence
 * order. A re-delivered message replaces its earlier copy rather than appearing twice,
 * which is also how a removal turns an already-rendered message into a tombstone.
 */
export function mergeMessages(held: readonly ChatMessage[], incoming: readonly ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return [...held];
  const byId = new Map(held.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.sequence - b.sequence);
}

// --- Moderation console (PAGE-053) ---

export interface ChatRoom {
  id: string;
  streamId: string;
  state: 'open' | 'closed';
  lastSequence: number;
  messageCount: number;
  version: number;
  updatedAt: string;
}

export interface ChatRestriction {
  id: string;
  roomId: string;
  accountId: string;
  kind: 'timeout' | 'ban';
  reason: string;
  moderatorId: string;
  expiresAt: string | null;
  liftedAt: string | null;
  createdAt: string;
}

export function listChatRooms(state?: 'open' | 'closed'): Promise<{ items: ChatRoom[] }> {
  return apiFetch(`/admin/chat/rooms${state === undefined ? '' : `?state=${state}`}`);
}

export function openChatRoom(streamId: string): Promise<ChatRoom> {
  return apiFetch('/admin/chat/rooms', { method: 'POST', body: JSON.stringify({ streamId }) });
}

export function setChatRoomState(roomId: string, body: { state: 'open' | 'closed'; expectedVersion: number }): Promise<ChatRoom> {
  return apiFetch(`/admin/chat/rooms/${encodeURIComponent(roomId)}/state`, { method: 'POST', body: JSON.stringify(body) });
}

/** Moderator feed: keeps the retained body of a removed message for case review. */
export function getModeratorFeed(roomId: string, afterSequence = 0): Promise<ChatFeed> {
  return apiFetch(`/admin/chat/rooms/${encodeURIComponent(roomId)}/messages?afterSequence=${String(afterSequence)}`);
}

export function removeChatMessage(roomId: string, messageId: string, reason: string): Promise<ChatMessage> {
  return apiFetch(`/admin/chat/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}/remove`, {
    method: 'POST',
    body: JSON.stringify({ reason })
  });
}

export function listChatRestrictions(roomId: string): Promise<{ items: ChatRestriction[] }> {
  return apiFetch(`/admin/chat/rooms/${encodeURIComponent(roomId)}/restrictions`);
}

export function timeoutChatUser(accountId: string, body: { roomId: string; reason: string; durationSeconds: number }): Promise<ChatRestriction> {
  return apiFetch(`/admin/chat/users/${encodeURIComponent(accountId)}/timeouts`, { method: 'POST', body: JSON.stringify(body) });
}

export function banChatUser(accountId: string, body: { roomId: string; reason: string }): Promise<ChatRestriction> {
  return apiFetch(`/admin/chat/users/${encodeURIComponent(accountId)}/bans`, { method: 'POST', body: JSON.stringify(body) });
}

export function liftChatRestriction(roomId: string, restrictionId: string, reason: string): Promise<ChatRestriction> {
  return apiFetch(`/admin/chat/rooms/${encodeURIComponent(roomId)}/restrictions/${encodeURIComponent(restrictionId)}/lift`, {
    method: 'POST',
    body: JSON.stringify({ reason })
  });
}
