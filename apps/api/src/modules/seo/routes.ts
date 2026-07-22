import type { FastifyInstance } from 'fastify';
import type { SeoService } from './service.ts';

/**
 * SEO root routes (DRAGON-15): robots.txt and sitemap.xml are served at the site root
 * (not under the /api/v1 prefix) so crawlers reach them at the canonical locations. The
 * production reverse proxy forwards these two paths to the API.
 */
export function registerSeoRoutes(app: FastifyInstance, deps: { seo: SeoService }): void {
  app.get('/robots.txt', { schema: { tags: ['seo'], summary: 'Environment-aware robots.txt.' } }, async (_request, reply) => {
    reply.header('content-type', 'text/plain; charset=utf-8').header('cache-control', 'public, max-age=3600');
    return deps.seo.robots();
  });

  app.get('/sitemap.xml', { schema: { tags: ['seo'], summary: 'XML sitemap of published indexable resources with locale alternates.' } }, async (_request, reply) => {
    const xml = await deps.seo.sitemap();
    reply.header('content-type', 'application/xml; charset=utf-8').header('cache-control', 'public, max-age=3600');
    return xml;
  });
}
