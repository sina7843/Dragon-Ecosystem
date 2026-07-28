import type { EntityId } from '../../shared/ids.ts';

/**
 * Live chat contracts (CHAT-001..008, DATA-046, DATA-047).
 *
 * A room belongs to exactly one stream and carries the moderation scope that gates every
 * moderator action, so an unlinked room cannot exist and a moderator cannot act outside
 * the rooms they were assigned (CHAT-001, ROLE-013).
 *
 * Public display and evidence are deliberately separate fields. Removing a message hides
 * it from viewers but never destroys what was said — a moderation case filed against it
 * keeps its own snapshot as well, so evidence survives even a later hard delete (CHAT-005,
 * DATA-047).
 */

export const ROOM_STATES = ['open', 'closed'] as const;
export type RoomState = (typeof ROOM_STATES)[number];

export interface ChatRoomRecord {
  _id: EntityId;
  /** The stream this room exists for. One room per stream (unique index). */
  streamId: EntityId;
  state: RoomState;
  /**
   * Monotonic per-room message counter. Ordering comes from this rather than a timestamp:
   * two messages written in the same millisecond, or on hosts with skewed clocks, still
   * have one unambiguous order, and the read cursor is exact rather than approximate.
   */
  lastSequence: number;
  /** Bounded, so a room cannot grow without limit under load (PERF-012). */
  messageCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const MESSAGE_STATES = ['visible', 'removed'] as const;
export type MessageState = (typeof MESSAGE_STATES)[number];

export interface ChatMessageRecord {
  _id: EntityId;
  roomId: EntityId;
  streamId: EntityId;
  senderId: EntityId;
  sequence: number;
  /**
   * Plain text only — chat carries no markup at all, so there is nothing to sanitise on
   * render. Stored stripped (CHAT-007) and served as text, never as HTML.
   */
  body: string;
  state: MessageState;
  /** Set when a moderator removes the message; the body itself is retained as evidence. */
  removedBy: EntityId | null;
  removedReason: string | null;
  removedAt: string | null;
  /** Caller-supplied key that makes a retried send converge instead of duplicating. */
  clientMessageId: string;
  createdAt: string;
}

export const RESTRICTION_KINDS = ['timeout', 'ban'] as const;
export type RestrictionKind = (typeof RESTRICTION_KINDS)[number];

/**
 * A moderator restriction on one account in one room (CHAT-004).
 *
 * A timeout carries an expiry; a ban does not (`expiresAt` null means indefinite). Both
 * are stored rather than applied as a flag on the account, so chat moderation can never
 * reach outside its room into the shared identity boundary.
 */
export interface ChatRestrictionRecord {
  _id: EntityId;
  roomId: EntityId;
  accountId: EntityId;
  kind: RestrictionKind;
  reason: string;
  moderatorId: EntityId;
  /** Null for a ban (indefinite). An ISO instant for a timeout. */
  expiresAt: string | null;
  liftedAt: string | null;
  liftedBy: EntityId | null;
  createdAt: string;
}

/** True while the restriction still blocks sending. */
export function isRestrictionActive(restriction: ChatRestrictionRecord, now: string): boolean {
  if (restriction.liftedAt !== null) return false;
  if (restriction.expiresAt === null) return true;
  return Date.parse(restriction.expiresAt) > Date.parse(now);
}

const ROOM_TRANSITIONS: Readonly<Record<RoomState, readonly RoomState[]>> = {
  open: ['closed'],
  closed: ['open']
};

export function canRoomTransition(from: RoomState, to: RoomState): boolean {
  return ROOM_TRANSITIONS[from].includes(to);
}
