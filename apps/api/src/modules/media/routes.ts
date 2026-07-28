import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PERMISSIONS } from '../../shared/authz/permissions.ts';
import { createSessionGuards, requireIdentity, type IdentityService } from '../identity/index.ts';
import { requirePermission, type AuthorizationService } from '../admin/index.ts';
import { NotFoundError } from '../../shared/errors.ts';
import { mediaPublicUrl, type MediaService } from './service.ts';
import type { MediaRecord } from './state.ts';

/**
 * Media administration surface (DRAGON-15). Upload/staging/publish/alt/delete are gated
 * on `content.publish` (owning-resource authorization, MEDIA-006). Public byte serving is
 * a separate root route registered in server.ts; only a published asset is served.
 */

export interface MediaAdminDeps {
  identity: IdentityService;
  authorization: AuthorizationService;
  media: MediaService;
  /** Maximum raw upload size in bytes; the upload route's body limit is derived from it. */
  maxUploadBytes: number;
}

const errorResponses = {
  400: { $ref: 'ErrorResponse#' }, 401: { $ref: 'ErrorResponse#' }, 403: { $ref: 'ErrorResponse#' }, 404: { $ref: 'ErrorResponse#' }, 409: { $ref: 'ErrorResponse#' }, 413: { $ref: 'ErrorResponse#' }, 422: { $ref: 'ErrorResponse#' }
} as const;
const idParam = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } };
const altSchema = { type: 'object', additionalProperties: false, properties: { fa: { type: 'string', maxLength: 300 }, en: { type: 'string', maxLength: 300 } } };

function view(m: MediaRecord) {
  return { id: m._id, state: m.state, url: mediaPublicUrl(m._id), contentType: m.contentType, byteSize: m.byteSize, sha256: m.sha256, alt: m.alt, version: m.version, createdAt: m.createdAt, publishedAt: m.publishedAt };
}

export function registerMediaRoutes(app: FastifyInstance, deps: MediaAdminDeps): void {
  const guards = createSessionGuards(deps.identity);
  const gate = () => ({ preHandler: [guards.requireSession, requirePermission(deps.authorization, PERMISSIONS.contentPublish)] });
  const actor = (request: FastifyRequest): string => requireIdentity(request).account._id;
  // The default Fastify body limit (1 MB) is smaller than a base64-encoded max-size image,
  // which would reject a valid upload with an opaque 413 before the service can validate it.
  // Size the upload route's limit to the base64 expansion of the cap (+ JSON envelope) so the
  // configured MEDIA_MAX_BYTES is actually reachable; the service still enforces the real cap.
  const uploadBodyLimit = Math.ceil(deps.maxUploadBytes * 1.4) + 4096;

  // Self-service upload for any signed-in user (avatars, and any picker in the app). It
  // uploads and publishes in one step so the caller gets an immediately usable /media URL,
  // without needing the content.publish capability the admin media surface requires. Bytes
  // are still validated by signature and capped, and content-addressing dedups uploads.
  app.post(
    '/media',
    {
      preHandler: [guards.requireSession],
      bodyLimit: uploadBodyLimit,
      schema: {
        tags: ['media'],
        summary: 'Upload and publish an image for the signed-in user (base64).',
        body: { type: 'object', required: ['data'], additionalProperties: false, properties: { data: { type: 'string', minLength: 1 }, alt: altSchema } },
        response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses }
      }
    },
    async (request, reply) => {
      const body = request.body as { data: string; alt?: { fa?: string; en?: string } };
      const staged = await deps.media.upload(request.requestContext, actor(request), { data: body.data, ...(body.alt === undefined ? {} : { alt: body.alt }) });
      // A fresh upload is `staged`; dedup can return an already-published asset.
      const record = staged.state === 'published' ? staged : await deps.media.publish(request.requestContext, staged._id, staged.version);
      reply.status(201);
      return view(record);
    }
  );

  app.post('/admin/media', { ...gate(), bodyLimit: uploadBodyLimit, schema: { tags: ['media'], summary: 'Upload media (base64); validated by content, stored nonpublic (staged).', body: { type: 'object', required: ['data'], additionalProperties: false, properties: { data: { type: 'string', minLength: 1 }, alt: altSchema } }, response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request, reply) => {
    const body = request.body as { data: string; alt?: { fa?: string; en?: string } };
    const record = await deps.media.upload(request.requestContext, actor(request), { data: body.data, ...(body.alt === undefined ? {} : { alt: body.alt }) });
    reply.status(201);
    return view(record);
  });

  app.get('/admin/media', { ...gate(), schema: { tags: ['media'], summary: 'List media assets.', querystring: { type: 'object', additionalProperties: false, properties: { state: { type: 'string' }, cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const page = await deps.media.list(request.query as { state?: string; cursor?: string; limit?: number });
    return { items: page.items.map(view), nextCursor: page.nextCursor };
  });

  app.get('/admin/media/:id', { ...gate(), schema: { tags: ['media'], summary: 'Get one media asset.', params: idParam, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const record = await deps.media.getForAdmin((request.params as { id: string }).id);
    if (record === null) throw new NotFoundError('Unknown media asset.');
    return view(record);
  });

  app.post('/admin/media/:id/publish', { ...gate(), schema: { tags: ['media'], summary: 'Publish a staged asset.', params: idParam, body: { type: 'object', required: ['expectedVersion'], additionalProperties: false, properties: { expectedVersion: { type: 'integer', minimum: 1 } } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const body = request.body as { expectedVersion: number };
    return view(await deps.media.publish(request.requestContext, (request.params as { id: string }).id, body.expectedVersion));
  });

  app.post('/admin/media/:id/alt', { ...gate(), schema: { tags: ['media'], summary: 'Set localized alternative text.', params: idParam, body: { type: 'object', required: ['expectedVersion', 'alt'], additionalProperties: false, properties: { expectedVersion: { type: 'integer', minimum: 1 }, alt: altSchema } }, response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses } } }, async (request) => {
    const body = request.body as { expectedVersion: number; alt: { fa?: string; en?: string } };
    return view(await deps.media.setAlt(request.requestContext, (request.params as { id: string }).id, body.alt, body.expectedVersion));
  });

  app.delete('/admin/media/:id', { ...gate(), schema: { tags: ['media'], summary: 'Delete an unreferenced asset.', params: idParam, response: { 204: { type: 'null' }, ...errorResponses } } }, async (request, reply) => {
    await deps.media.delete(request.requestContext, (request.params as { id: string }).id);
    reply.status(204);
    return null;
  });
}
