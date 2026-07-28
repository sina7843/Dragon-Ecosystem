import type { FastifyInstance, FastifyRequest } from 'fastify';
import { NotFoundError } from '../../shared/errors.ts';
import { PERMISSIONS } from '../../shared/authz/permissions.ts';
import type { ResourceScope } from '../../shared/authz/policy.ts';
import { createSessionGuards, requireIdentity, type IdentityService } from '../identity/index.ts';
import { requirePermission, type AuthorizationService } from '../admin/index.ts';
import { MAX_FEED_LIMIT, type ChatService } from './service.ts';
import { RESTRICTION_KINDS, ROOM_STATES, type ChatMessageRecord, type RestrictionKind, type RoomState } from './state.ts';

/**
 * Live chat HTTP surface (API-072..076, PAGE-053).
 *
 * There is deliberately no private-message route here, and none anywhere else: CHAT-008
 * requires that direct messaging is not shipped, and the route-registry guardrail in
 * `chat.test.ts` asserts that no registered path could serve one.
 *
 * Moderator routes are scoped to a room (`chat_room`), so a moderator assigned to one
 * broadcast cannot act on another (ROLE-013).
 */

export interface ChatDeps {
  identity: IdentityService;
  authorization: AuthorizationService;
  chat: ChatService;
}

const errorResponses = {
  400: { $ref: 'ErrorResponse#' },
  401: { $ref: 'ErrorResponse#' },
  403: { $ref: 'ErrorResponse#' },
  404: { $ref: 'ErrorResponse#' },
  409: { $ref: 'ErrorResponse#' },
  422: { $ref: 'ErrorResponse#' },
  429: { $ref: 'ErrorResponse#' }
} as const;

const idParam = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } };
const roomMessageParams = {
  type: 'object',
  required: ['id', 'mid'],
  additionalProperties: false,
  properties: { id: { type: 'string' }, mid: { type: 'string' } }
} as const;
const reasonProperty = { type: 'string', minLength: 1, maxLength: 500 } as const;

/** Room scope taken from the path, for routes that already name the room. */
const roomScope = (request: FastifyRequest): ResourceScope => ({ type: 'chat_room', id: (request.params as { id: string }).id });
/** Room scope taken from the body, for the user-targeted restriction routes (API-075/076). */
const bodyRoomScope = (request: FastifyRequest): ResourceScope => ({ type: 'chat_room', id: (request.body as { roomId: string }).roomId });

/** Moderator projection: keeps the retained body of a removed message as case evidence. */
function evidenceView(message: ChatMessageRecord) {
  const { _id, ...rest } = message;
  return { id: _id, ...rest };
}

export function registerChatRoutes(app: FastifyInstance, deps: ChatDeps): void {
  const guards = createSessionGuards(deps.identity);
  /** Unscoped: opening a room and listing every room needs a platform-wide grant. */
  const globalGate = () => ({ preHandler: [guards.requireSession, requirePermission(deps.authorization, PERMISSIONS.chatModerate)] });
  const scopedGate = (scopeOf: typeof roomScope) => ({
    preHandler: [guards.requireSession, requirePermission(deps.authorization, PERMISSIONS.chatModerate, scopeOf)]
  });
  const actor = (request: FastifyRequest): string => requireIdentity(request).account._id;

  // --- Viewer feed (API-072) ---

  /**
   * Loads a session rather than requiring one: a public stream's chat is readable
   * anonymously, and the service refuses an anonymous reader on a sign-in-only stream.
   */
  app.get(
    '/streams/:id/chat/messages',
    {
      preHandler: [guards.loadSession],
      schema: {
        tags: ['chat'],
        summary: 'Ordered chat history for a stream. Poll with the highest sequence held; delivery is at-least-once.',
        params: idParam,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            afterSequence: { type: 'integer', minimum: 0 },
            limit: { type: 'integer', minimum: 1, maximum: MAX_FEED_LIMIT }
          }
        },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const query = request.query as { afterSequence?: number; limit?: number };
      return deps.chat.listMessages((request.params as { id: string }).id, { accountId: request.identity?.account._id ?? null }, query);
    }
  );

  // --- Sending (API-073) ---

  app.post(
    '/streams/:id/chat/messages',
    {
      preHandler: [guards.requireSession],
      schema: {
        tags: ['chat'],
        summary: 'Send a chat message. Rate limited; a repeated clientMessageId returns the original message.',
        params: idParam,
        body: {
          type: 'object',
          required: ['body', 'clientMessageId'],
          additionalProperties: false,
          properties: {
            body: { type: 'string', minLength: 1, maxLength: 2000 },
            clientMessageId: { type: 'string', minLength: 1, maxLength: 100 }
          }
        },
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const body = request.body as { body: string; clientMessageId: string };
      const message = await deps.chat.postMessage(request.requestContext, (request.params as { id: string }).id, actor(request), body);
      reply.status(201);
      return message;
    }
  );

  // --- Reports (API-074) ---

  app.post(
    '/chat/messages/:id/reports',
    {
      preHandler: [guards.requireSession],
      schema: {
        tags: ['chat'],
        summary: 'Report a chat message. Opens or joins a shared moderation case with the body snapshotted as evidence.',
        params: idParam,
        body: {
          type: 'object',
          required: ['reason'],
          additionalProperties: false,
          properties: { reason: reasonProperty, details: { type: 'string', maxLength: 2000 } }
        },
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const body = request.body as { reason: string; details?: string };
      const result = await deps.chat.reportMessage(request.requestContext, (request.params as { id: string }).id, actor(request), body);
      reply.status(201);
      return result;
    }
  );

  // --- Moderation console (PAGE-053) ---

  app.post(
    '/admin/chat/rooms',
    {
      ...globalGate(),
      schema: {
        tags: ['chat'],
        summary: 'Open the chat room for a stream (idempotent).',
        body: { type: 'object', required: ['streamId'], additionalProperties: false, properties: { streamId: { type: 'string' } } },
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const { streamId } = request.body as { streamId: string };
      const room = await deps.chat.openRoom(request.requestContext, streamId);
      reply.status(201);
      const { _id, ...rest } = room;
      return { id: _id, ...rest };
    }
  );

  app.get(
    '/admin/chat/rooms',
    {
      ...globalGate(),
      schema: {
        tags: ['chat'],
        summary: 'List chat rooms.',
        querystring: { type: 'object', additionalProperties: false, properties: { state: { type: 'string', enum: [...ROOM_STATES] } } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const query = request.query as { state?: RoomState };
      const rooms = await deps.chat.listRooms(query);
      return { items: rooms.map(({ _id, ...rest }) => ({ id: _id, ...rest })) };
    }
  );

  app.post(
    '/admin/chat/rooms/:id/state',
    {
      ...scopedGate(roomScope),
      schema: {
        tags: ['chat'],
        summary: 'Open or close a chat room. A closed room accepts no messages.',
        params: idParam,
        body: {
          type: 'object',
          required: ['state', 'expectedVersion'],
          additionalProperties: false,
          properties: { state: { type: 'string', enum: [...ROOM_STATES] }, expectedVersion: { type: 'integer', minimum: 1 } }
        },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const body = request.body as { state: RoomState; expectedVersion: number };
      const { _id, ...rest } = await deps.chat.setRoomState(request.requestContext, (request.params as { id: string }).id, body.state, body.expectedVersion);
      return { id: _id, ...rest };
    }
  );

  /**
   * Moderator feed. Unlike the viewer feed this keeps the retained body of a removed
   * message, which is the evidence a case is reviewed against (CHAT-005).
   */
  app.get(
    '/admin/chat/rooms/:id/messages',
    {
      ...scopedGate(roomScope),
      schema: {
        tags: ['chat'],
        summary: 'Room history including the retained bodies of removed messages.',
        params: idParam,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { afterSequence: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: MAX_FEED_LIMIT } }
        },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const roomId = (request.params as { id: string }).id;
      const rooms = await deps.chat.listRooms();
      const room = rooms.find((r) => r._id === roomId);
      if (room === undefined) throw new NotFoundError('Unknown chat room.');
      const query = request.query as { afterSequence?: number; limit?: number };
      return deps.chat.listMessages(room.streamId, { accountId: actor(request), asModerator: true }, query);
    }
  );

  app.post(
    '/admin/chat/rooms/:id/messages/:mid/remove',
    {
      ...scopedGate(roomScope),
      schema: {
        tags: ['chat'],
        summary: 'Remove a message from public display. The body is retained as evidence.',
        params: roomMessageParams,
        body: { type: 'object', required: ['reason'], additionalProperties: false, properties: { reason: reasonProperty } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const { id, mid } = request.params as { id: string; mid: string };
      const { reason } = request.body as { reason: string };
      // The message must belong to the room the caller was authorized against, or a
      // moderator scoped to one room could remove another room's messages.
      const message = await deps.chat.getMessage(mid);
      if (message === null || message.roomId !== id) throw new NotFoundError('Unknown message.');
      return deps.chat.removeMessage(request.requestContext, mid, actor(request), reason);
    }
  );

  app.get(
    '/admin/chat/rooms/:id/restrictions',
    {
      ...scopedGate(roomScope),
      schema: { tags: ['chat'], summary: 'Timeouts and bans in this room.', params: idParam, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } }
    },
    async (request) => {
      const rows = await deps.chat.listRestrictions((request.params as { id: string }).id);
      return { items: rows.map(({ _id, ...rest }) => ({ id: _id, ...rest })) };
    }
  );

  // API-075 / API-076: user-targeted restriction actions, scoped by the room in the body.
  for (const kind of RESTRICTION_KINDS) {
    const path = kind === 'timeout' ? '/admin/chat/users/:id/timeouts' : '/admin/chat/users/:id/bans';
    app.post(
      path,
      {
        ...scopedGate(bodyRoomScope),
        schema: {
          tags: ['chat'],
          summary:
            kind === 'timeout'
              ? 'Time an account out of one chat room for a bounded duration.'
              : 'Ban an account from one chat room. Scoped to the room; it never suspends the account.',
          params: idParam,
          body: {
            type: 'object',
            required: kind === 'timeout' ? ['roomId', 'reason', 'durationSeconds'] : ['roomId', 'reason'],
            additionalProperties: false,
            properties: {
              roomId: { type: 'string' },
              reason: reasonProperty,
              durationSeconds: { type: 'integer', minimum: 1, maximum: 86400 }
            }
          },
          response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
        }
      },
      async (request, reply) => {
        const body = request.body as { roomId: string; reason: string; durationSeconds?: number };
        const accountId = (request.params as { id: string }).id;
        const record = await deps.chat.restrict(request.requestContext, body.roomId, accountId, {
          kind: kind as RestrictionKind,
          reason: body.reason,
          ...(body.durationSeconds === undefined ? {} : { durationSeconds: body.durationSeconds })
        });
        reply.status(201);
        const { _id, ...rest } = record;
        return { id: _id, ...rest };
      }
    );
  }

  app.post(
    '/admin/chat/rooms/:id/restrictions/:mid/lift',
    {
      ...scopedGate(roomScope),
      schema: {
        tags: ['chat'],
        summary: 'Lift a timeout or ban early.',
        params: roomMessageParams,
        body: { type: 'object', required: ['reason'], additionalProperties: false, properties: { reason: reasonProperty } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const { id, mid } = request.params as { id: string; mid: string };
      const { reason } = request.body as { reason: string };
      const rows = await deps.chat.listRestrictions(id);
      if (!rows.some((r) => r._id === mid)) throw new NotFoundError('Unknown restriction.');
      const { _id, ...rest } = await deps.chat.liftRestriction(request.requestContext, mid, reason);
      return { id: _id, ...rest };
    }
  );

  // Evidence lookup for a moderation case opened from a chat report (CHAT-005).
  app.get(
    '/admin/chat/messages/:id',
    {
      ...globalGate(),
      schema: {
        tags: ['chat'],
        summary: 'One message with its retained body, for reviewing a moderation case.',
        params: idParam,
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const message = await deps.chat.getMessage((request.params as { id: string }).id);
      if (message === null) throw new NotFoundError('Unknown message.');
      return evidenceView(message);
    }
  );
}
