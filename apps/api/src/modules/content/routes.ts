import type { FastifyInstance, FastifyRequest } from 'fastify';
import { NotFoundError } from '../../shared/errors.ts';
import { PERMISSIONS } from '../../shared/authz/permissions.ts';
import { createSessionGuards, requireIdentity, type IdentityService } from '../identity/index.ts';
import type { AuthorizationService} from '../admin/index.ts';
import { requirePermission } from '../admin/index.ts';
import type { ContentService } from './service.ts';
import type { ContentItemRecord, ContentLocale } from './store.ts';
import type { ContentState } from './state.ts';

/**
 * Content HTTP surface: a public read side (published items only) and an admin
 * authoring side (deny-by-default, permission-gated). Drafts and scheduled items
 * are unreachable from the public routes.
 */

export interface ContentDeps {
  identity: IdentityService;
  authorization: AuthorizationService;
  content: ContentService;
}

const localeQuery = { type: 'string', enum: ['fa', 'en'] } as const;
const errorResponses = {
  400: { $ref: 'ErrorResponse#' },
  401: { $ref: 'ErrorResponse#' },
  403: { $ref: 'ErrorResponse#' },
  404: { $ref: 'ErrorResponse#' },
  409: { $ref: 'ErrorResponse#' },
  422: { $ref: 'ErrorResponse#' }
} as const;

function localeOf(request: FastifyRequest): ContentLocale {
  const value = (request.query as { locale?: string }).locale;
  return value === 'en' ? 'en' : 'fa';
}

/** Full admin view of a content item, presenting `id` rather than `_id`. */
function adminView(item: ContentItemRecord) {
  const { _id, ...rest } = item;
  return { id: _id, ...rest };
}

export function registerContentRoutes(app: FastifyInstance, deps: ContentDeps): void {
  const guards = createSessionGuards(deps.identity);
  const gate = (permission: Parameters<typeof requirePermission>[1]) => ({
    preHandler: [guards.requireSession, requirePermission(deps.authorization, permission)]
  });

  // --- Public read side ---

  app.get(
    '/content',
    {
      schema: {
        tags: ['content'],
        summary: 'List published content, filterable and paginated.',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            locale: localeQuery,
            type: { type: 'string' },
            category: { type: 'string' },
            tag: { type: 'string' },
            game: { type: 'string' },
            cursor: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 }
          }
        },
        response: { 200: { type: 'object', additionalProperties: true }, 400: { $ref: 'ErrorResponse#' } }
      }
    },
    async (request) => {
      const q = request.query as {
        type?: string;
        category?: string;
        tag?: string;
        game?: string;
        cursor?: string;
        limit?: number;
      };
      return deps.content.listPublished({
        locale: localeOf(request),
        ...(q.type === undefined ? {} : { type: q.type }),
        ...(q.category === undefined ? {} : { categorySlug: q.category }),
        ...(q.tag === undefined ? {} : { tagSlug: q.tag }),
        ...(q.game === undefined ? {} : { gameId: q.game }),
        ...(q.cursor === undefined ? {} : { cursor: q.cursor }),
        ...(q.limit === undefined ? {} : { limit: q.limit })
      });
    }
  );

  app.get(
    '/content/:type/:slug',
    {
      schema: {
        tags: ['content'],
        summary: 'Published content detail by localized slug. Drafts return 404.',
        params: {
          type: 'object',
          required: ['type', 'slug'],
          additionalProperties: false,
          properties: { type: { type: 'string' }, slug: { type: 'string' } }
        },
        querystring: { type: 'object', additionalProperties: false, properties: { locale: localeQuery } },
        response: { 200: { type: 'object', additionalProperties: true }, 404: { $ref: 'ErrorResponse#' } }
      }
    },
    async (request) => {
      const { type, slug } = request.params as { type: string; slug: string };
      const locale = localeOf(request);
      const found = await deps.content.getPublishedBySlug(type, locale, slug);
      // A draft, scheduled, or unknown item is indistinguishable: 404.
      if (found === null) throw new NotFoundError();
      const { item, translation, alternateSlugs } = found;
      return {
        id: item._id,
        type: item.type,
        locale,
        slug: alternateSlugs[locale],
        title: translation.title,
        summary: translation.summary,
        body: translation.body,
        seoTitle: translation.seoTitle,
        seoDescription: translation.seoDescription,
        coverImageUrl: item.coverImageUrl,
        categorySlugs: item.categorySlugs,
        tagSlugs: item.tagSlugs,
        gameId: item.gameId,
        publishedAt: item.publishedAt,
        updatedAt: item.updatedAt,
        // Explicit alternate-locale slugs for canonical/hreflang (section 17.3, SEO-003).
        alternateSlugs
      };
    }
  );

  app.get(
    '/content-taxonomy/categories',
    {
      schema: {
        tags: ['content'],
        summary: 'Public category list for filtering.',
        querystring: { type: 'object', additionalProperties: false, properties: { type: { type: 'string' } } },
        response: { 200: { type: 'array', items: { type: 'object', additionalProperties: true } } }
      }
    },
    async (request) => {
      const { type } = request.query as { type?: string };
      const rows = await deps.content.listCategories(type);
      return rows.map(({ _id, ...rest }) => ({ id: _id, ...rest }));
    }
  );

  app.get(
    '/content-taxonomy/tags',
    {
      schema: {
        tags: ['content'],
        summary: 'Public tag list for filtering.',
        response: { 200: { type: 'array', items: { type: 'object', additionalProperties: true } } }
      }
    },
    async () => (await deps.content.listTags()).map(({ _id, ...rest }) => ({ id: _id, ...rest }))
  );

  // --- Admin authoring side ---

  app.get(
    '/admin/content',
    {
      ...gate(PERMISSIONS.contentWrite),
      schema: {
        tags: ['content'],
        summary: 'List content in any state for editing.',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            type: { type: 'string' },
            state: { type: 'string' },
            cursor: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 }
          }
        },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const page = await deps.content.listForAdmin(request.query as Record<string, never>);
      return { items: page.items.map(adminView), nextCursor: page.nextCursor };
    }
  );

  app.post(
    '/admin/content',
    {
      ...gate(PERMISSIONS.contentWrite),
      schema: {
        tags: ['content'],
        summary: 'Create a content draft.',
        body: { type: 'object', additionalProperties: true, required: ['type'], properties: { type: { type: 'string' } } },
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const record = await deps.content.createDraft(
        request.requestContext,
        request.body as Parameters<ContentService['createDraft']>[1]
      );
      reply.status(201);
      return adminView(record);
    }
  );

  app.get(
    '/admin/content/:id',
    {
      ...gate(PERMISSIONS.contentWrite),
      schema: {
        tags: ['content'],
        summary: 'Full content item for editing (any state).',
        params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const item = await deps.content.getById((request.params as { id: string }).id);
      if (item === null) throw new NotFoundError('Unknown content item.');
      return adminView(item);
    }
  );

  app.put(
    '/admin/content/:id',
    {
      ...gate(PERMISSIONS.contentWrite),
      schema: {
        tags: ['content'],
        summary: 'Update a content item.',
        params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } },
        body: {
          type: 'object',
          additionalProperties: true,
          required: ['expectedVersion'],
          properties: { expectedVersion: { type: 'integer', minimum: 1 } }
        },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const record = await deps.content.updateContent(
        request.requestContext,
        (request.params as { id: string }).id,
        request.body as Parameters<ContentService['updateContent']>[2]
      );
      return adminView(record);
    }
  );

  app.post(
    '/admin/content/:id/transition',
    {
      ...gate(PERMISSIONS.contentWrite),
      schema: {
        tags: ['content'],
        summary: 'Move content through its lifecycle. Publish/archive need the publish permission.',
        params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } },
        body: {
          type: 'object',
          required: ['to', 'reason'],
          additionalProperties: false,
          properties: {
            to: { type: 'string', enum: ['draft', 'in_review', 'published', 'archived'] },
            reason: { type: 'string', minLength: 1, maxLength: 500 },
            publishAt: { type: 'string', format: 'date-time' }
          }
        },
        response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as { to: ContentState; reason: string; publishAt?: string };
      // Publisher capability is read from the resolved permissions cached by the gate.
      const canPublish = request.effectivePermissions?.can({ permission: PERMISSIONS.contentPublish }) ?? false;
      requireIdentity(request);
      const record = await deps.content.transition(request.requestContext, id, body.to, {
        reason: body.reason,
        canPublish,
        ...(body.publishAt === undefined ? {} : { publishAt: body.publishAt })
      });
      return adminView(record);
    }
  );

  app.get(
    '/admin/content/:id/revisions',
    {
      ...gate(PERMISSIONS.contentWrite),
      schema: {
        tags: ['content'],
        summary: 'Version history for a content item (CONTENT-007).',
        params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } },
        response: { 200: { type: 'array', items: { type: 'object', additionalProperties: true } }, ...errorResponses }
      }
    },
    async (request) => deps.content.listRevisions((request.params as { id: string }).id)
  );

  app.post(
    '/admin/content-taxonomy/categories',
    {
      ...gate(PERMISSIONS.contentWrite),
      schema: {
        tags: ['content'],
        summary: 'Create a category.',
        body: {
          type: 'object',
          required: ['type', 'labels'],
          additionalProperties: false,
          properties: {
            type: { type: 'string' },
            slug: { type: 'string' },
            labels: {
              type: 'object',
              required: ['fa', 'en'],
              additionalProperties: false,
              properties: { fa: { type: 'string', minLength: 1 }, en: { type: 'string', minLength: 1 } }
            }
          }
        },
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const { _id, ...rest } = await deps.content.createCategory(
        request.requestContext,
        request.body as Parameters<ContentService['createCategory']>[1]
      );
      reply.status(201);
      return { id: _id, ...rest };
    }
  );

  app.post(
    '/admin/content-taxonomy/tags',
    {
      ...gate(PERMISSIONS.contentWrite),
      schema: {
        tags: ['content'],
        summary: 'Create a tag.',
        body: {
          type: 'object',
          required: ['labels'],
          additionalProperties: false,
          properties: {
            slug: { type: 'string' },
            labels: {
              type: 'object',
              required: ['fa', 'en'],
              additionalProperties: false,
              properties: { fa: { type: 'string', minLength: 1 }, en: { type: 'string', minLength: 1 } }
            }
          }
        },
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const { _id, ...rest } = await deps.content.createTag(
        request.requestContext,
        request.body as Parameters<ContentService['createTag']>[1]
      );
      reply.status(201);
      return { id: _id, ...rest };
    }
  );
}
