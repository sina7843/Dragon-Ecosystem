import type { FastifyInstance, FastifyRequest } from 'fastify';
import { NotFoundError } from '../../shared/errors.ts';
import { PERMISSIONS } from '../../shared/authz/permissions.ts';
import { createSessionGuards, type IdentityService } from '../identity/index.ts';
import { requirePermission, type AuthorizationService } from '../admin/index.ts';
import type { StreamsService } from './service.ts';
import { STREAM_STATES, PUBLIC_STREAM_STATES, type Locale, type StreamRecord, type StreamState } from './state.ts';

/**
 * Stream HTTP surface (API-066..070).
 *
 * The public side never carries a provider identifier. That is the STREAM-001 acceptance
 * criterion in practice: a public payload built only from Dragon fields cannot change
 * when the provider behind it is replaced. Playback configuration is issued by its own
 * endpoint, after Dragon has decided access (STREAM-006, BR-023).
 */

export interface StreamsDeps {
  identity: IdentityService;
  authorization: AuthorizationService;
  streams: StreamsService;
}

const errorResponses = {
  400: { $ref: 'ErrorResponse#' },
  401: { $ref: 'ErrorResponse#' },
  403: { $ref: 'ErrorResponse#' },
  404: { $ref: 'ErrorResponse#' },
  409: { $ref: 'ErrorResponse#' },
  422: { $ref: 'ErrorResponse#' },
  503: { $ref: 'ErrorResponse#' }
} as const;

const idParam = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } };
const slugParam = { type: 'object', required: ['slug'], additionalProperties: false, properties: { slug: { type: 'string' } } };
const localeQuery = { type: 'string', enum: ['fa', 'en'] } as const;
const reasonProperty = { type: 'string', minLength: 1, maxLength: 500 } as const;

function localeOf(request: FastifyRequest): Locale {
  return (request.query as { locale?: string }).locale === 'en' ? 'en' : 'fa';
}

/**
 * Whether a viewer can be offered a play control right now.
 *
 * `unavailable` is the user-visible degraded state STREAM-008 requires: the page says the
 * stream cannot be played and offers a retry, without disclosing what failed provider-side.
 */
function availability(stream: StreamRecord): 'playable' | 'unavailable' | 'not_playing' {
  if (stream.rights.takedownAt !== null) return 'unavailable';
  if (stream.state !== 'live' && stream.state !== 'archived') return 'not_playing';
  return stream.provider.syncState === 'ready' ? 'playable' : 'unavailable';
}

/** Public projection: Dragon fields only. No provider id, sync detail, or error text. */
function publicView(stream: StreamRecord, locale: Locale) {
  const translation = stream.translations[locale];
  return {
    id: stream._id,
    slug: stream.slug,
    locale,
    state: stream.state,
    accessMode: stream.accessMode,
    title: translation.title,
    summary: translation.summary,
    scheduledStartAt: stream.scheduledStartAt,
    scheduledEndAt: stream.scheduledEndAt,
    actualStartAt: stream.actualStartAt,
    actualEndAt: stream.actualEndAt,
    coverImageUrl: stream.coverImageUrl,
    availability: availability(stream),
    // Relationship ids so a watch page can link back to the game/tournament it belongs to.
    links: { gameIds: stream.links.gameIds, tournamentIds: stream.links.tournamentIds, matchIds: stream.links.matchIds, channelKeys: stream.links.channelKeys },
    archiveAvailable: stream.state === 'archived' && stream.archivePolicy.mode === 'retain'
  };
}

/** Operator projection: everything except anything that could carry a credential. */
function adminView(stream: StreamRecord) {
  const { _id, ...rest } = stream;
  return { id: _id, ...rest };
}

export function registerStreamsRoutes(app: FastifyInstance, deps: StreamsDeps): void {
  const guards = createSessionGuards(deps.identity);
  const gate = () => ({ preHandler: [guards.requireSession, requirePermission(deps.authorization, PERMISSIONS.streamManage)] });

  // --- Public discovery (API-066) ---

  app.get(
    '/streams',
    {
      schema: {
        tags: ['streams'],
        summary: 'Discover streams. Defaults to the live and upcoming shelf.',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            locale: localeQuery,
            state: { type: 'string', enum: [...PUBLIC_STREAM_STATES] },
            game: { type: 'string' },
            tournament: { type: 'string' },
            match: { type: 'string' },
            q: { type: 'string', maxLength: 100 },
            cursor: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 }
          }
        },
        response: { 200: { type: 'object', additionalProperties: true }, 400: { $ref: 'ErrorResponse#' } }
      }
    },
    async (request) => {
      const q = request.query as { state?: StreamState; game?: string; tournament?: string; match?: string; q?: string; cursor?: string; limit?: number };
      const locale = localeOf(request);
      const page = await deps.streams.listPublic({
        locale,
        ...(q.state === undefined ? {} : { state: q.state }),
        ...(q.game === undefined ? {} : { gameId: q.game }),
        ...(q.tournament === undefined ? {} : { tournamentId: q.tournament }),
        ...(q.match === undefined ? {} : { matchId: q.match }),
        ...(q.q === undefined ? {} : { q: q.q }),
        ...(q.cursor === undefined ? {} : { cursor: q.cursor }),
        ...(q.limit === undefined ? {} : { limit: q.limit })
      });
      return { items: page.items.map((stream) => publicView(stream, locale)), nextCursor: page.nextCursor };
    }
  );

  // --- Public detail (API-067) ---

  app.get(
    '/streams/:slug',
    {
      schema: {
        tags: ['streams'],
        summary: 'Stream metadata and access state by slug. A draft stream returns 404.',
        params: slugParam,
        querystring: { type: 'object', additionalProperties: false, properties: { locale: localeQuery } },
        response: { 200: { type: 'object', additionalProperties: true }, 404: { $ref: 'ErrorResponse#' } }
      }
    },
    async (request) => {
      const { slug } = request.params as { slug: string };
      const stream = await deps.streams.getPublicBySlug(slug);
      if (stream === null) throw new NotFoundError('Unknown stream.');
      return publicView(stream, localeOf(request));
    }
  );

  // --- Playback access (API-068, STREAM-005/006, BR-023) ---

  /**
   * A public stream is watchable anonymously, so this route loads a session rather than
   * requiring one; the service then refuses an anonymous caller on an authenticated-mode
   * stream. Requiring a session here instead would make every public stream sign-in-only.
   */
  app.post(
    '/streams/:slug/playback-access',
    {
      preHandler: [guards.loadSession],
      schema: {
        tags: ['streams'],
        summary: 'Issue provider-safe playback configuration after Dragon validates access.',
        params: slugParam,
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const { slug } = request.params as { slug: string };
      return deps.streams.issuePlaybackAccess(request.requestContext, slug, request.identity?.account._id ?? null);
    }
  );

  // --- Operator console (API-069, API-070, PAGE-052) ---

  app.get(
    '/admin/streams/config',
    {
      ...gate(),
      schema: {
        tags: ['streams'],
        summary: 'Which streaming provider is active and which rights controls are gated.',
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async () => deps.streams.configView()
  );

  app.get(
    '/admin/streams',
    {
      ...gate(),
      schema: {
        tags: ['streams'],
        summary: 'List streams in any state.',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { state: { type: 'string', enum: [...STREAM_STATES] }, cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }
        },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const page = await deps.streams.listForAdmin(request.query as Record<string, never>);
      return { items: page.items.map(adminView), nextCursor: page.nextCursor };
    }
  );

  app.post(
    '/admin/streams',
    {
      ...gate(),
      schema: {
        tags: ['streams'],
        summary: 'Create a stream (draft).',
        body: { type: 'object', additionalProperties: true, properties: {} },
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const record = await deps.streams.create(request.requestContext, request.body as Parameters<StreamsService['create']>[1]);
      reply.status(201);
      return adminView(record);
    }
  );

  app.get(
    '/admin/streams/:id',
    {
      ...gate(),
      schema: { tags: ['streams'], summary: 'Full stream for editing.', params: idParam, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } }
    },
    async (request) => {
      const stream = await deps.streams.getById((request.params as { id: string }).id);
      if (stream === null) throw new NotFoundError('Unknown stream.');
      return adminView(stream);
    }
  );

  app.put(
    '/admin/streams/:id',
    {
      ...gate(),
      schema: {
        tags: ['streams'],
        summary: 'Update a stream. A schedule change notifies the assigned streamers.',
        params: idParam,
        body: { type: 'object', additionalProperties: true, required: ['expectedVersion'], properties: { expectedVersion: { type: 'integer', minimum: 1 } } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const record = await deps.streams.update(
        request.requestContext,
        (request.params as { id: string }).id,
        request.body as Parameters<StreamsService['update']>[2]
      );
      return adminView(record);
    }
  );

  app.post(
    '/admin/streams/:id/rights',
    {
      ...gate(),
      schema: {
        tags: ['streams'],
        summary: 'Record the broadcast-rights approval this stream relies on (required before scheduling).',
        params: idParam,
        body: {
          type: 'object',
          required: ['expectedVersion', 'reference'],
          additionalProperties: false,
          properties: { expectedVersion: { type: 'integer', minimum: 1 }, reference: { type: 'string', minLength: 1, maxLength: 300 } }
        },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const body = request.body as { expectedVersion: number; reference: string };
      return adminView(await deps.streams.confirmRights(request.requestContext, (request.params as { id: string }).id, body));
    }
  );

  app.post(
    '/admin/streams/:id/state',
    {
      ...gate(),
      schema: {
        tags: ['streams'],
        summary: 'Move a stream through its lifecycle. Only transitions allowed by the state machine succeed.',
        params: idParam,
        body: {
          type: 'object',
          required: ['state', 'expectedVersion', 'reason'],
          additionalProperties: false,
          properties: { state: { type: 'string', enum: [...STREAM_STATES] }, expectedVersion: { type: 'integer', minimum: 1 }, reason: reasonProperty }
        },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const body = request.body as { state: StreamState; expectedVersion: number; reason: string };
      const { id } = request.params as { id: string };
      return adminView(await deps.streams.setState(request.requestContext, id, body.state, { expectedVersion: body.expectedVersion, reason: body.reason }));
    }
  );

  app.post(
    '/admin/streams/:id/provision',
    {
      ...gate(),
      schema: {
        tags: ['streams'],
        summary: 'Create or reuse the provider resource. Retrying never creates a second one.',
        params: idParam,
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => adminView(await deps.streams.provision(request.requestContext, (request.params as { id: string }).id))
  );

  app.post(
    '/admin/streams/:id/reconcile',
    {
      ...gate(),
      schema: {
        tags: ['streams'],
        summary: 'Re-read the provider and converge the stored sync state.',
        params: idParam,
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => adminView(await deps.streams.reconcile(request.requestContext, (request.params as { id: string }).id))
  );

  app.post(
    '/admin/streams/:id/takedown',
    {
      ...gate(),
      schema: {
        tags: ['streams'],
        summary: 'Withdraw a stream under the rights policy. Refused until that policy is approved (OD-014).',
        params: idParam,
        body: {
          type: 'object',
          required: ['expectedVersion', 'reason'],
          additionalProperties: false,
          properties: { expectedVersion: { type: 'integer', minimum: 1 }, reason: reasonProperty }
        },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const body = request.body as { expectedVersion: number; reason: string };
      return adminView(await deps.streams.takedown(request.requestContext, (request.params as { id: string }).id, body));
    }
  );
}
