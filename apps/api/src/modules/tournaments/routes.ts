import type { FastifyInstance, FastifyRequest } from 'fastify';
import { NotFoundError } from '../../shared/errors.ts';
import { PERMISSIONS } from '../../shared/authz/permissions.ts';
import { createSessionGuards, type IdentityService } from '../identity/index.ts';
import { requirePermission, type AuthorizationService } from '../admin/index.ts';
import type { TournamentsService } from './service.ts';
import type { Locale, TournamentRecord, TournamentState } from './state.ts';

/**
 * Tournament HTTP surface: a public discovery side (published tournaments only)
 * and an admin authoring side gated on `tournament.manage`. Drafts, cancelled, and
 * archived tournaments are unreachable from the public routes.
 */

export interface TournamentsDeps {
  identity: IdentityService;
  authorization: AuthorizationService;
  tournaments: TournamentsService;
}

const errorResponses = {
  400: { $ref: 'ErrorResponse#' },
  401: { $ref: 'ErrorResponse#' },
  403: { $ref: 'ErrorResponse#' },
  404: { $ref: 'ErrorResponse#' },
  409: { $ref: 'ErrorResponse#' },
  422: { $ref: 'ErrorResponse#' }
} as const;

const localeQuery = { type: 'string', enum: ['fa', 'en'] } as const;

function localeOf(request: FastifyRequest): Locale {
  return (request.query as { locale?: string }).locale === 'en' ? 'en' : 'fa';
}

function adminView(t: TournamentRecord) {
  const { _id, ...rest } = t;
  return { id: _id, ...rest };
}

/** Public card: the minimal fields a discovery list or calendar cell needs. */
function publicCard(t: TournamentRecord, locale: Locale) {
  const tr = t.translations[locale];
  return {
    id: t._id,
    slug: t.slug,
    name: tr.name,
    summary: tr.summary,
    gameId: t.gameId,
    participantType: t.participantType,
    format: t.format,
    feeKind: t.fee.kind,
    startAt: t.schedule.startAt,
    endAt: t.schedule.endAt,
    capacity: t.capacity
  };
}

/** Public detail: descriptive config, fee, and prizes — never the internal question set (TOURN-029). */
function publicDetail(t: TournamentRecord, locale: Locale) {
  const tr = t.translations[locale];
  return {
    ...publicCard(t, locale),
    locale,
    description: tr.description,
    seoTitle: tr.seoTitle,
    seoDescription: tr.seoDescription,
    rules: t.ruleProfile.text[locale],
    registration: t.registration,
    approvalMode: t.approvalMode,
    waitlistMode: t.waitlistMode,
    eligibility: t.eligibility,
    fee: t.fee,
    prizes: t.prizes,
    refundPolicy: { kind: t.refundPolicy.kind, text: t.refundPolicy.text[locale] },
    publishedAt: t.publishedAt
  };
}

export function registerTournamentsRoutes(app: FastifyInstance, deps: TournamentsDeps): void {
  const guards = createSessionGuards(deps.identity);
  const gate = () => ({ preHandler: [guards.requireSession, requirePermission(deps.authorization, PERMISSIONS.tournamentManage)] });
  const idParam = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } };

  // --- Public discovery ---

  app.get(
    '/tournaments',
    {
      schema: {
        tags: ['tournaments'],
        summary: 'List published tournaments (upcoming first).',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            locale: localeQuery,
            game: { type: 'string' },
            participantType: { type: 'string', enum: ['individual', 'team'] },
            format: { type: 'string' },
            cursor: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 }
          }
        },
        response: { 200: { type: 'object', additionalProperties: true }, 400: { $ref: 'ErrorResponse#' } }
      }
    },
    async (request) => {
      const q = request.query as { game?: string; participantType?: string; format?: string; cursor?: string; limit?: number };
      const locale = localeOf(request);
      const page = await deps.tournaments.listPublished({
        ...(q.game === undefined ? {} : { gameId: q.game }),
        ...(q.participantType === undefined ? {} : { participantType: q.participantType }),
        ...(q.format === undefined ? {} : { format: q.format }),
        ...(q.cursor === undefined ? {} : { cursor: q.cursor }),
        ...(q.limit === undefined ? {} : { limit: q.limit })
      });
      return { items: page.items.map((t) => publicCard(t, locale)), nextCursor: page.nextCursor };
    }
  );

  app.get(
    '/tournaments-calendar',
    {
      schema: {
        tags: ['tournaments'],
        summary: 'Published tournaments starting within a date range.',
        querystring: {
          type: 'object',
          required: ['from', 'to'],
          additionalProperties: false,
          properties: { locale: localeQuery, from: { type: 'string' }, to: { type: 'string' } }
        },
        response: { 200: { type: 'object', additionalProperties: true }, 400: { $ref: 'ErrorResponse#' } }
      }
    },
    async (request) => {
      const { from, to } = request.query as { from: string; to: string };
      const locale = localeOf(request);
      const rows = await deps.tournaments.calendar(from, to);
      return { items: rows.map((t) => publicCard(t, locale)) };
    }
  );

  app.get(
    '/tournaments/:slug',
    {
      schema: {
        tags: ['tournaments'],
        summary: 'Published tournament detail by slug. Draft/cancelled/archived return 404.',
        params: { type: 'object', required: ['slug'], additionalProperties: false, properties: { slug: { type: 'string' } } },
        querystring: { type: 'object', additionalProperties: false, properties: { locale: localeQuery } },
        response: { 200: { type: 'object', additionalProperties: true }, 404: { $ref: 'ErrorResponse#' } }
      }
    },
    async (request) => {
      const t = await deps.tournaments.getPublishedBySlug((request.params as { slug: string }).slug);
      if (t === null) throw new NotFoundError();
      return publicDetail(t, localeOf(request));
    }
  );

  // --- Admin authoring ---

  app.get(
    '/admin/tournaments',
    {
      ...gate(),
      schema: {
        tags: ['tournaments'],
        summary: 'List tournaments in any state.',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { state: { type: 'string' }, game: { type: 'string' }, cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }
        },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const q = request.query as { state?: TournamentState; game?: string; cursor?: string; limit?: number };
      const page = await deps.tournaments.listForAdmin({
        ...(q.state === undefined ? {} : { state: q.state }),
        ...(q.game === undefined ? {} : { gameId: q.game }),
        ...(q.cursor === undefined ? {} : { cursor: q.cursor }),
        ...(q.limit === undefined ? {} : { limit: q.limit })
      });
      return { items: page.items.map(adminView), nextCursor: page.nextCursor };
    }
  );

  app.post(
    '/admin/tournaments',
    {
      ...gate(),
      schema: {
        tags: ['tournaments'],
        summary: 'Create a tournament draft.',
        body: { type: 'object', additionalProperties: true, required: ['gameId'], properties: { gameId: { type: 'string' } } },
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const record = await deps.tournaments.createDraft(request.requestContext, request.body as Parameters<TournamentsService['createDraft']>[1]);
      reply.status(201);
      return adminView(record);
    }
  );

  app.get(
    '/admin/tournaments/:id',
    { ...gate(), schema: { tags: ['tournaments'], summary: 'Full tournament for editing.', params: idParam, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } },
    async (request) => {
      const t = await deps.tournaments.getById((request.params as { id: string }).id);
      if (t === null) throw new NotFoundError('Unknown tournament.');
      return adminView(t);
    }
  );

  app.get(
    '/admin/tournaments/:id/preview',
    { ...gate(), schema: { tags: ['tournaments'], summary: 'Preview a tournament as it would appear publicly.', params: idParam, querystring: { type: 'object', additionalProperties: false, properties: { locale: localeQuery } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } },
    async (request) => {
      const t = await deps.tournaments.getById((request.params as { id: string }).id);
      if (t === null) throw new NotFoundError('Unknown tournament.');
      return publicDetail(t, localeOf(request));
    }
  );

  app.put(
    '/admin/tournaments/:id',
    {
      ...gate(),
      schema: {
        tags: ['tournaments'],
        summary: 'Update a draft tournament.',
        params: idParam,
        body: { type: 'object', additionalProperties: true, required: ['expectedVersion'], properties: { expectedVersion: { type: 'integer', minimum: 1 } } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const record = await deps.tournaments.updateDraft(
        request.requestContext,
        (request.params as { id: string }).id,
        request.body as Parameters<TournamentsService['updateDraft']>[2]
      );
      return adminView(record);
    }
  );

  app.post(
    '/admin/tournaments/:id/transition',
    {
      ...gate(),
      schema: {
        tags: ['tournaments'],
        summary: 'Publish, cancel, or archive a tournament.',
        params: idParam,
        body: {
          type: 'object',
          required: ['to', 'reason'],
          additionalProperties: false,
          properties: { to: { type: 'string', enum: ['published', 'cancelled', 'archived'] }, reason: { type: 'string', minLength: 1, maxLength: 500 } }
        },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as { to: TournamentState; reason: string };
      return adminView(await deps.tournaments.transition(request.requestContext, id, body.to, body.reason));
    }
  );

  app.post(
    '/admin/tournaments/:id/clone',
    { ...gate(), schema: { tags: ['tournaments'], summary: 'Clone a tournament into a new draft.', params: idParam, response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses } } },
    async (request, reply) => {
      const record = await deps.tournaments.clone(request.requestContext, (request.params as { id: string }).id);
      reply.status(201);
      return adminView(record);
    }
  );

  app.get(
    '/admin/tournaments/:id/revisions',
    { ...gate(), schema: { tags: ['tournaments'], summary: 'Version history for a tournament.', params: idParam, response: { 200: { type: 'array', items: { type: 'object', additionalProperties: true } }, ...errorResponses } } },
    async (request) => deps.tournaments.listRevisions((request.params as { id: string }).id)
  );
}
