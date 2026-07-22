import type { FastifyInstance, FastifyRequest } from 'fastify';
import { NotFoundError } from '../../shared/errors.ts';
import { PERMISSIONS } from '../../shared/authz/permissions.ts';
import { createSessionGuards, type IdentityService } from '../identity/index.ts';
import type { AuthorizationService} from '../admin/index.ts';
import { requirePermission } from '../admin/index.ts';
import type { GamesService} from './service.ts';
import { type GameRecord } from './service.ts';

/**
 * Games catalog HTTP surface: public read side (published games only) and an
 * admin CRUD side gated on `games.manage`.
 */

export interface GamesDeps {
  identity: IdentityService;
  authorization: AuthorizationService;
  games: GamesService;
}

const errorResponses = {
  400: { $ref: 'ErrorResponse#' },
  401: { $ref: 'ErrorResponse#' },
  403: { $ref: 'ErrorResponse#' },
  404: { $ref: 'ErrorResponse#' },
  409: { $ref: 'ErrorResponse#' },
  422: { $ref: 'ErrorResponse#' }
} as const;

function localeOf(request: FastifyRequest): 'fa' | 'en' {
  return (request.query as { locale?: string }).locale === 'en' ? 'en' : 'fa';
}

function adminView(game: GameRecord) {
  const { _id, ...rest } = game;
  return { id: _id, ...rest };
}

export function registerGamesRoutes(app: FastifyInstance, deps: GamesDeps): void {
  const guards = createSessionGuards(deps.identity);
  const gate = () => ({
    preHandler: [guards.requireSession, requirePermission(deps.authorization, PERMISSIONS.gamesManage)]
  });

  // --- Public ---

  app.get(
    '/games',
    {
      schema: {
        tags: ['games'],
        summary: 'List published games.',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            locale: { type: 'string', enum: ['fa', 'en'] },
            cursor: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 }
          }
        },
        response: { 200: { type: 'object', additionalProperties: true }, 400: { $ref: 'ErrorResponse#' } }
      }
    },
    async (request) => {
      const q = request.query as { cursor?: string; limit?: number };
      return deps.games.listPublished({
        locale: localeOf(request),
        ...(q.cursor === undefined ? {} : { cursor: q.cursor }),
        ...(q.limit === undefined ? {} : { limit: q.limit })
      });
    }
  );

  app.get(
    '/games/:slug',
    {
      schema: {
        tags: ['games'],
        summary: 'Published game detail by slug. Draft/archived return 404.',
        params: { type: 'object', required: ['slug'], additionalProperties: false, properties: { slug: { type: 'string' } } },
        querystring: { type: 'object', additionalProperties: false, properties: { locale: { type: 'string', enum: ['fa', 'en'] } } },
        response: { 200: { type: 'object', additionalProperties: true }, 404: { $ref: 'ErrorResponse#' } }
      }
    },
    async (request) => {
      const { slug } = request.params as { slug: string };
      const locale = localeOf(request);
      const game = await deps.games.getPublishedBySlug(slug);
      if (game === null) throw new NotFoundError();
      const t = game.translations[locale];
      return {
        id: game._id,
        slug: game.slug,
        locale,
        name: t.name,
        description: t.description,
        seoTitle: t.seoTitle,
        seoDescription: t.seoDescription,
        coverImageUrl: game.coverImageUrl,
        publishedAt: game.publishedAt
      };
    }
  );

  // --- Admin ---

  app.get(
    '/admin/games',
    {
      ...gate(),
      schema: {
        tags: ['games'],
        summary: 'List games in any status.',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: 'string' },
            cursor: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 }
          }
        },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const page = await deps.games.listForAdmin(request.query as Record<string, never>);
      return { items: page.items.map(adminView), nextCursor: page.nextCursor };
    }
  );

  app.post(
    '/admin/games',
    {
      ...gate(),
      schema: {
        tags: ['games'],
        summary: 'Create a game (draft).',
        body: { type: 'object', additionalProperties: true, required: ['translations'], properties: {} },
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const record = await deps.games.create(request.requestContext, request.body as Parameters<GamesService['create']>[1]);
      reply.status(201);
      return adminView(record);
    }
  );

  app.get(
    '/admin/games/:id',
    {
      ...gate(),
      schema: {
        tags: ['games'],
        summary: 'Full game for editing.',
        params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const game = await deps.games.getById((request.params as { id: string }).id);
      if (game === null) throw new NotFoundError('Unknown game.');
      return adminView(game);
    }
  );

  app.put(
    '/admin/games/:id',
    {
      ...gate(),
      schema: {
        tags: ['games'],
        summary: 'Update a game.',
        params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } },
        body: { type: 'object', additionalProperties: true, required: ['translations'], properties: {} },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const record = await deps.games.update(
        request.requestContext,
        (request.params as { id: string }).id,
        request.body as Parameters<GamesService['update']>[2]
      );
      return adminView(record);
    }
  );

  app.post(
    '/admin/games/:id/status',
    {
      ...gate(),
      schema: {
        tags: ['games'],
        summary: 'Publish, archive, or return a game to draft.',
        params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } },
        body: {
          type: 'object',
          required: ['status', 'reason'],
          additionalProperties: false,
          properties: {
            status: { type: 'string', enum: ['draft', 'published', 'archived'] },
            reason: { type: 'string', minLength: 1, maxLength: 500 }
          }
        },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as { status: 'draft' | 'published' | 'archived'; reason: string };
      return adminView(await deps.games.setStatus(request.requestContext, id, body.status, body.reason));
    }
  );
}
