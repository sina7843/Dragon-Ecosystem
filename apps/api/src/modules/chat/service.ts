import type { Db } from 'mongodb';
import type { Database } from '../../shared/db/client.ts';
import { runUnitOfWork } from '../../shared/db/unit-of-work.ts';
import type { RequestContext } from '../../shared/context.ts';
import { ConflictError, ForbiddenError, NotFoundError, RateLimitError, ValidationError } from '../../shared/errors.ts';
import { utcNow } from '../../shared/events.ts';
import { newId, type EntityId } from '../../shared/ids.ts';
import { consumeRateLimit } from '../identity/rate-limit.ts';
import { toPlainText } from '../content/sanitize.ts';
import { CHAT_COLLECTIONS } from './collections.ts';
import {
  canRoomTransition,
  isRestrictionActive,
  type ChatMessageRecord,
  type ChatRestrictionRecord,
  type ChatRoomRecord,
  type RestrictionKind,
  type RoomState
} from './state.ts';

/**
 * Moderated live chat (CHAT-001..008).
 *
 * Invariants:
 * - A room exists only for a stream, and only a readable stream serves chat (CHAT-001).
 * - Ordering is by a per-room sequence allocated inside the write transaction, so it is
 *   total and independent of clock skew (CHAT-006, TEST-021).
 * - A retried send converges on the same message rather than duplicating it (CHAT-006).
 * - Sending is rate limited and refused under load rather than queued (CHAT-003, PERF-012).
 * - A timeout or ban blocks sending for its effective period, in that room only (CHAT-004).
 * - Removing a message hides the body from viewers but never destroys it, and a report
 *   snapshots the body independently so evidence survives removal (CHAT-005).
 * - There is no private direct-messaging path anywhere in this module (CHAT-008).
 */

const DUPLICATE_KEY = 11000;
function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === DUPLICATE_KEY;
}

/** Longest accepted message. Chat is conversational; a long post belongs in content. */
const BODY_MAX = 500;
/** Largest page a caller may request from the feed (backpressure, PERF-012). */
export const MAX_FEED_LIMIT = 100;
const DEFAULT_FEED_LIMIT = 50;

export interface ChatConfig {
  /** Messages one account may send per room within the window (CHAT-003). */
  readonly sendPerWindow: number;
  readonly sendWindowSeconds: number;
}

export const DEFAULT_CHAT_CONFIG: ChatConfig = { sendPerWindow: 10, sendWindowSeconds: 30 };

/**
 * What chat needs to know about a stream: whether a visitor may read it at all, and
 * whether watching requires a session. Chat never reads the streams module's internals.
 */
export interface ChatStreamAccess {
  getWatchable(streamId: EntityId): Promise<{ readable: boolean; accessMode: 'public' | 'authenticated' } | null>;
}

/**
 * Report intake, satisfied by the shared moderation service. Chat files into the same
 * case workflow every other subject uses rather than keeping a private report table
 * (CHAT-005, NOTIF-010's "no module creates an independent table" principle).
 */
export interface ChatModerationCases {
  fileReport(
    context: RequestContext,
    reporterId: EntityId,
    input: { subjectType: 'chat_message'; subjectId: EntityId; reason: string; details?: string }
  ): Promise<{ _id: EntityId; caseId: EntityId | null }>;
}

/** A message as an ordinary viewer sees it. A removed message keeps its place but loses its body. */
export interface MessageView {
  id: EntityId;
  sequence: number;
  senderId: EntityId;
  state: 'visible' | 'removed';
  /** Null once removed: the body is retained as evidence but never delivered to viewers. */
  body: string | null;
  createdAt: string;
}

export class ChatService {
  readonly #database: Database;
  readonly #streams: ChatStreamAccess;
  readonly #cases: ChatModerationCases;
  readonly #config: ChatConfig;

  constructor(database: Database, streams: ChatStreamAccess, cases: ChatModerationCases, config: ChatConfig = DEFAULT_CHAT_CONFIG) {
    this.#database = database;
    this.#streams = streams;
    this.#cases = cases;
    this.#config = config;
  }

  get #db(): Db {
    return this.#database.db;
  }
  #rooms(db: Db = this.#db) {
    return db.collection<ChatRoomRecord>(CHAT_COLLECTIONS.rooms);
  }
  #messages(db: Db = this.#db) {
    return db.collection<ChatMessageRecord>(CHAT_COLLECTIONS.messages);
  }
  #restrictions(db: Db = this.#db) {
    return db.collection<ChatRestrictionRecord>(CHAT_COLLECTIONS.restrictions);
  }

  // --- Rooms (CHAT-001) ---

  /**
   * Opens the room for a stream, or returns the existing one.
   *
   * Rooms are opened deliberately by an operator rather than implicitly by the stream
   * lifecycle: a room carries a moderation scope, and creating one is the act of saying
   * this broadcast will be moderated. It also keeps chat and streams independent modules.
   */
  async openRoom(context: RequestContext, streamId: EntityId): Promise<ChatRoomRecord> {
    const stream = await this.#streams.getWatchable(streamId);
    if (stream === null || !stream.readable) throw new NotFoundError('Unknown stream.');

    const existing = await this.#rooms().findOne({ streamId });
    if (existing !== null) {
      return existing.state === 'open' ? existing : this.setRoomState(context, existing._id, 'open', existing.version);
    }
    const now = utcNow();
    const record: ChatRoomRecord = {
      _id: newId(),
      streamId,
      state: 'open',
      lastSequence: 0,
      messageCount: 0,
      version: 1,
      createdAt: now,
      updatedAt: now
    };
    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        await this.#rooms(uow.db).insertOne(record, { session: uow.session });
        uow.audit({ action: 'chat.room_opened', resourceType: 'chat_room', resourceId: record._id, after: { streamId, state: 'open' }, reason: 'Chat room opened.' });
      });
    } catch (error) {
      // A concurrent open won the unique index; converge on the room that exists.
      if (!isDuplicateKey(error)) throw error;
      const raced = await this.#rooms().findOne({ streamId });
      if (raced === null) throw error;
      return raced;
    }
    return record;
  }

  async setRoomState(context: RequestContext, roomId: EntityId, to: RoomState, expectedVersion: number): Promise<ChatRoomRecord> {
    const current = await this.#requireRoom(roomId);
    if (current.version !== expectedVersion) throw new ConflictError('CHAT_ROOM_STALE', 'This room changed since you opened it. Reload and retry.');
    if (current.state === to) return current;
    if (!canRoomTransition(current.state, to)) throw new ConflictError('CHAT_ROOM_TRANSITION_NOT_ALLOWED', `A ${current.state} room cannot move to ${to}.`);
    const now = utcNow();
    return runUnitOfWork(this.#database, context, async (uow) => {
      const result = await this.#rooms(uow.db).updateOne(
        { _id: roomId, version: expectedVersion },
        { $set: { state: to, updatedAt: now }, $inc: { version: 1 } },
        { session: uow.session }
      );
      if (result.matchedCount === 0) throw new ConflictError('CHAT_ROOM_STALE', 'This room changed. Reload and retry.');
      uow.audit({ action: `chat.room_${to}`, resourceType: 'chat_room', resourceId: roomId, before: { state: current.state }, after: { state: to }, reason: `Room ${to}.` });
      return { ...current, state: to, version: current.version + 1, updatedAt: now };
    });
  }

  async getRoomByStream(streamId: EntityId): Promise<ChatRoomRecord | null> {
    return this.#rooms().findOne({ streamId });
  }

  async listRooms(query: { state?: RoomState } = {}): Promise<ChatRoomRecord[]> {
    const filter: Record<string, unknown> = {};
    if (query.state !== undefined) filter['state'] = query.state;
    return this.#rooms().find(filter).sort({ updatedAt: -1 }).limit(MAX_FEED_LIMIT).toArray();
  }

  // --- Reading (CHAT-002, CHAT-006, API-072) ---

  /**
   * Ordered slice of a room's history.
   *
   * `afterSequence` is exclusive, so a caller polls with the highest sequence it holds.
   * Re-reading from a lower cursor after a reconnect deliberately re-delivers messages —
   * delivery is at-least-once and the client deduplicates by message id (CHAT-006).
   */
  async listMessages(
    streamId: EntityId,
    viewer: { accountId: EntityId | null; asModerator?: boolean },
    query: { afterSequence?: number; limit?: number } = {}
  ): Promise<{ roomId: EntityId; roomState: RoomState; items: MessageView[]; lastSequence: number }> {
    const room = await this.#requireReadableRoom(streamId, viewer.accountId);
    const limit = Math.min(MAX_FEED_LIMIT, Math.max(1, Math.trunc(query.limit ?? DEFAULT_FEED_LIMIT)));
    const after = Number.isFinite(query.afterSequence) ? Math.max(0, Math.trunc(query.afterSequence as number)) : 0;

    const rows = await this.#messages()
      .find({ roomId: room._id, sequence: { $gt: after } })
      .sort({ sequence: 1 })
      .limit(limit)
      .toArray();

    const asModerator = viewer.asModerator === true;
    return {
      roomId: room._id,
      roomState: room.state,
      lastSequence: room.lastSequence,
      items: rows.map((row) => ({
        id: row._id,
        sequence: row.sequence,
        senderId: row.senderId,
        state: row.state,
        // A removed message keeps its position so a client that already rendered it can
        // replace it with a tombstone; only a moderator sees the retained evidence.
        body: row.state === 'removed' && !asModerator ? null : row.body,
        createdAt: row.createdAt
      }))
    };
  }

  // --- Sending (CHAT-003, CHAT-006, CHAT-007, API-073) ---

  async postMessage(
    context: RequestContext,
    streamId: EntityId,
    senderId: EntityId,
    input: { body: string; clientMessageId: string }
  ): Promise<MessageView> {
    const room = await this.#requireReadableRoom(streamId, senderId);
    if (room.state !== 'open') throw new ConflictError('CHAT_ROOM_CLOSED', 'This chat room is closed.');

    const clientMessageId = input.clientMessageId.trim().slice(0, 100);
    if (clientMessageId === '') {
      throw new ValidationError('A client message id is required.', [
        { field: 'clientMessageId', code: 'REQUIRED', message: 'Supply a unique id so a retry is not duplicated.' }
      ]);
    }

    // Chat is plain text: markup is stripped rather than escaped, so nothing unsafe is
    // ever stored and the client can render the value as text (CHAT-007).
    const body = toPlainText(input.body).slice(0, BODY_MAX);
    if (body === '') {
      throw new ValidationError('A message is required.', [{ field: 'body', code: 'REQUIRED', message: 'Write a message.' }]);
    }

    // An already-accepted send returns its original result, so a retry after a timeout is
    // free rather than a duplicate — and it does not consume rate-limit budget.
    const existing = await this.#messages().findOne({ roomId: room._id, senderId, clientMessageId });
    if (existing !== null) return this.#view(existing);

    await this.#assertNotRestricted(room._id, senderId);

    // Backpressure: the send is refused rather than queued once the window is spent.
    // ponytail: the budget is per room per sender, so a sender can spend a full budget in
    // every open room at once. Rooms are independent broadcasts, so that is the intended
    // scope; add a platform-wide bucket alongside this one if cross-room spam appears.
    const decision = await consumeRateLimit(this.#db, `chat_send:${room._id}:${senderId}`, this.#config.sendPerWindow, this.#config.sendWindowSeconds);
    if (!decision.allowed) throw new RateLimitError('You are sending messages too quickly. Wait a moment and try again.');

    const now = utcNow();
    try {
      return await runUnitOfWork(this.#database, context, async (uow) => {
        // The sequence is allocated inside the transaction, so an aborted insert cannot
        // leave a gap that a later reader would treat as a missing message.
        const claimed = await this.#rooms(uow.db).findOneAndUpdate(
          { _id: room._id, state: 'open' },
          { $inc: { lastSequence: 1, messageCount: 1 }, $set: { updatedAt: now } },
          { session: uow.session, returnDocument: 'after' }
        );
        if (claimed === null) throw new ConflictError('CHAT_ROOM_CLOSED', 'This chat room is closed.');

        const record: ChatMessageRecord = {
          _id: newId(),
          roomId: room._id,
          streamId,
          senderId,
          sequence: claimed.lastSequence,
          body,
          state: 'visible',
          removedBy: null,
          removedReason: null,
          removedAt: null,
          clientMessageId,
          createdAt: now
        };
        await this.#messages(uow.db).insertOne(record, { session: uow.session });
        return this.#view(record);
      });
    } catch (error) {
      // A concurrent send with the same client key won; return that one message.
      if (isDuplicateKey(error)) {
        const raced = await this.#messages().findOne({ roomId: room._id, senderId, clientMessageId });
        if (raced !== null) return this.#view(raced);
      }
      throw error;
    }
  }

  // --- Moderator actions (CHAT-002, CHAT-004, API-075, API-076) ---

  async removeMessage(context: RequestContext, messageId: EntityId, moderatorId: EntityId, reason: string): Promise<MessageView> {
    if (reason.trim() === '') {
      throw new ValidationError('A reason is required.', [{ field: 'reason', code: 'REASON_REQUIRED', message: 'Provide a reason.' }]);
    }
    const current = await this.#messages().findOne({ _id: messageId });
    if (current === null) throw new NotFoundError('Unknown message.');
    if (current.state === 'removed') return this.#view(current); // idempotent

    const now = utcNow();
    return runUnitOfWork(this.#database, context, async (uow) => {
      const result = await this.#messages(uow.db).updateOne(
        { _id: messageId, state: 'visible' },
        { $set: { state: 'removed', removedBy: moderatorId, removedReason: reason.slice(0, 500), removedAt: now } },
        { session: uow.session }
      );
      if (result.matchedCount === 0) throw new ConflictError('CHAT_MESSAGE_STALE', 'This message changed. Reload and retry.');
      // The audit row records that a removal happened and why; the body stays on the
      // message record as evidence rather than being copied into the audit trail.
      uow.audit({
        action: 'chat.message_removed',
        resourceType: 'chat_message',
        resourceId: messageId,
        before: { state: 'visible' },
        after: { state: 'removed', roomId: current.roomId, senderId: current.senderId },
        reason
      });
      return this.#view({ ...current, state: 'removed', removedBy: moderatorId, removedReason: reason, removedAt: now });
    });
  }

  /**
   * Applies a timeout or ban to one account in one room (CHAT-004).
   *
   * The restriction is scoped to the room, never to the account: chat moderation must not
   * reach into the shared identity boundary, which is what account suspension is for and
   * is reserved to the moderation module's own case workflow.
   */
  async restrict(
    context: RequestContext,
    roomId: EntityId,
    accountId: EntityId,
    input: { kind: RestrictionKind; reason: string; durationSeconds?: number }
  ): Promise<ChatRestrictionRecord> {
    const moderatorId = context.actor.accountId;
    if (moderatorId === null) throw new ForbiddenError();
    if (input.reason.trim() === '') {
      throw new ValidationError('A reason is required.', [{ field: 'reason', code: 'REASON_REQUIRED', message: 'Provide a reason.' }]);
    }
    await this.#requireRoom(roomId);

    let expiresAt: string | null = null;
    if (input.kind === 'timeout') {
      const seconds = input.durationSeconds ?? 0;
      if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 86_400) {
        throw new ValidationError('The timeout duration is not valid.', [
          { field: 'durationSeconds', code: 'INVALID_DURATION', message: 'Use 1 to 86400 seconds.' }
        ]);
      }
      expiresAt = new Date(Date.parse(utcNow()) + seconds * 1000).toISOString();
    }

    const record: ChatRestrictionRecord = {
      _id: newId(),
      roomId,
      accountId,
      kind: input.kind,
      reason: input.reason.slice(0, 500),
      moderatorId,
      expiresAt,
      liftedAt: null,
      liftedBy: null,
      createdAt: utcNow()
    };
    await runUnitOfWork(this.#database, context, async (uow) => {
      await this.#restrictions(uow.db).insertOne(record, { session: uow.session });
      uow.audit({
        action: `chat.${input.kind}`,
        resourceType: 'chat_restriction',
        resourceId: record._id,
        after: { roomId, accountId, kind: input.kind, expiresAt },
        reason: input.reason
      });
    });
    return record;
  }

  async liftRestriction(context: RequestContext, restrictionId: EntityId, reason: string): Promise<ChatRestrictionRecord> {
    const moderatorId = context.actor.accountId;
    if (moderatorId === null) throw new ForbiddenError();
    const current = await this.#restrictions().findOne({ _id: restrictionId });
    if (current === null) throw new NotFoundError('Unknown restriction.');
    if (current.liftedAt !== null) return current;
    const now = utcNow();
    return runUnitOfWork(this.#database, context, async (uow) => {
      const result = await this.#restrictions(uow.db).updateOne(
        { _id: restrictionId, liftedAt: null },
        { $set: { liftedAt: now, liftedBy: moderatorId } },
        { session: uow.session }
      );
      if (result.matchedCount === 0) throw new ConflictError('CHAT_RESTRICTION_STALE', 'This restriction changed. Reload and retry.');
      uow.audit({ action: 'chat.restriction_lifted', resourceType: 'chat_restriction', resourceId: restrictionId, after: { roomId: current.roomId, accountId: current.accountId }, reason });
      return { ...current, liftedAt: now, liftedBy: moderatorId };
    });
  }

  async listRestrictions(roomId: EntityId): Promise<ChatRestrictionRecord[]> {
    return this.#restrictions().find({ roomId }).sort({ createdAt: -1 }).limit(MAX_FEED_LIMIT).toArray();
  }

  /** The restrictions currently blocking an account in a room, for the console and the send path. */
  async activeRestrictions(roomId: EntityId, accountId: EntityId): Promise<ChatRestrictionRecord[]> {
    const now = utcNow();
    const rows = await this.#restrictions().find({ roomId, accountId, liftedAt: null }).sort({ createdAt: -1 }).limit(20).toArray();
    return rows.filter((row) => isRestrictionActive(row, now));
  }

  // --- Reports (CHAT-005, API-074) ---

  /**
   * Files a report against a message into the shared moderation workflow, snapshotting the
   * body as evidence at the moment of reporting.
   *
   * The snapshot is what makes "deleting a public message does not delete case evidence"
   * true even if the message record is later purged: the case carries its own copy.
   */
  async reportMessage(
    context: RequestContext,
    messageId: EntityId,
    reporterId: EntityId,
    input: { reason: string; details?: string }
  ): Promise<{ reportId: EntityId; caseId: EntityId | null }> {
    const message = await this.#messages().findOne({ _id: messageId });
    if (message === null) throw new NotFoundError('Unknown message.');
    // A viewer may only report from a room they can actually read.
    await this.#requireReadableRoom(message.streamId, reporterId);

    const evidence = [
      `chat message ${message._id} (room ${message.roomId}, sequence ${String(message.sequence)}, sender ${message.senderId})`,
      `body at report time: ${message.body}`,
      input.details === undefined ? '' : `reporter detail: ${input.details}`
    ]
      .filter((line) => line !== '')
      .join('\n');

    const report = await this.#cases.fileReport(context, reporterId, {
      subjectType: 'chat_message',
      subjectId: messageId,
      reason: input.reason,
      details: evidence
    });
    return { reportId: report._id, caseId: report.caseId };
  }

  async getMessage(messageId: EntityId): Promise<ChatMessageRecord | null> {
    return this.#messages().findOne({ _id: messageId });
  }

  // --- Internals ---

  async #requireRoom(roomId: EntityId): Promise<ChatRoomRecord> {
    const room = await this.#rooms().findOne({ _id: roomId });
    if (room === null) throw new NotFoundError('Unknown chat room.');
    return room;
  }

  /**
   * Resolves the room for a stream and enforces watch access on it.
   *
   * Chat inherits the stream's access decision rather than making its own: a room attached
   * to a sign-in-only stream is sign-in-only, and a room whose stream is not publicly
   * readable does not exist as far as a visitor is concerned (CHAT-001).
   */
  async #requireReadableRoom(streamId: EntityId, accountId: EntityId | null): Promise<ChatRoomRecord> {
    const stream = await this.#streams.getWatchable(streamId);
    if (stream === null || !stream.readable) throw new NotFoundError('Unknown stream.');
    if (stream.accessMode === 'authenticated' && accountId === null) {
      throw new ForbiddenError('Sign in to take part in this chat.');
    }
    const room = await this.#rooms().findOne({ streamId });
    if (room === null) throw new NotFoundError('This stream has no chat room.');
    return room;
  }

  async #assertNotRestricted(roomId: EntityId, accountId: EntityId): Promise<void> {
    const active = await this.activeRestrictions(roomId, accountId);
    const ban = active.find((r) => r.kind === 'ban');
    if (ban !== undefined) throw new ForbiddenError('You are banned from this chat room.');
    const timeout = active.find((r) => r.kind === 'timeout');
    if (timeout !== undefined) throw new ForbiddenError('You are timed out from this chat room.');
  }

  #view(record: ChatMessageRecord): MessageView {
    return {
      id: record._id,
      sequence: record.sequence,
      senderId: record.senderId,
      state: record.state,
      body: record.state === 'removed' ? null : record.body,
      createdAt: record.createdAt
    };
  }
}
