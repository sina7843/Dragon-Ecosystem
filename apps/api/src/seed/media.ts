/**
 * Demo media through the real media service. Small, valid, repository-owned image bytes
 * (no remote downloads, no copyrighted assets): one PNG, one JPEG, one WebP. Covers staged
 * vs published media, localized and empty (decorative) alt text, content-addressed
 * duplicate upload (dedup), and one published-and-referenced asset a game cover points at
 * (so it cannot be deleted). Media is content-addressed, so a rerun reuses by hash.
 */
import { demoRef } from './harness.ts';
import type { SeedSummary } from './harness.ts';
import type { CatalogRegistry } from './catalog.ts';
import type { DemoRegistry } from './registry.ts';
import { accountContext, ensureDemo, type Services } from './wiring.ts';

// Minimal valid 1x1 images (base64). Only the magic bytes + size are validated by the
// media service; these are genuine, tiny, fictional fixtures.
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const JPEG_1X1 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAB//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==';
const WEBP_1X1 =
  'UklGRkoAAABXRUJQVlA4WAoAAAAQAAAAAAAAAAAAQUxQSAwAAAARBxAR/Q9ERP8DAABWUDggGAAAABQBAJ0BKgEAAQAAAP4AAA3AAP7mtQAAAA==';

function mediaUrl(id: string): string {
  return `/media/${id}`;
}

export async function seedMedia(
  services: Services,
  registry: DemoRegistry,
  summary: SeedSummary,
  catalog: CatalogRegistry,
  uploaderId: string
): Promise<void> {
  const db = services.db;
  const ctx = () => accountContext(uploaderId, ['content_publisher', 'platform_administrator']);
  let created = 0;
  let reused = 0;

  // A: PNG, left staged (not published).
  const a = await ensureDemo(registry, db, { demoSeedKey: demoRef('media', 'staged-png'), domainType: 'media', collection: 'media_assets', resettable: false }, async () => {
    const rec = await services.media.upload(ctx(), uploaderId, { data: PNG_1X1 });
    return rec._id;
  });
  if (a.reused) reused += 1;
  else created += 1;

  // B: JPEG, published with localized fa/en alt text.
  const b = await ensureDemo(registry, db, { demoSeedKey: demoRef('media', 'published-jpeg'), domainType: 'media', collection: 'media_assets', resettable: false }, async () => {
    const rec = await services.media.upload(ctx(), uploaderId, { data: JPEG_1X1, alt: { fa: 'تصویر نمونه‌ی منتشرشده', en: 'Published demo image' } });
    if (rec.state === 'staged') await services.media.publish(ctx(), rec._id, rec.version);
    return rec._id;
  });
  if (b.reused) reused += 1;
  else created += 1;

  // C: WebP, published, decorative (empty alt).
  const c = await ensureDemo(registry, db, { demoSeedKey: demoRef('media', 'decorative-webp'), domainType: 'media', collection: 'media_assets', resettable: false }, async () => {
    const rec = await services.media.upload(ctx(), uploaderId, { data: WEBP_1X1, alt: { fa: '', en: '' } });
    if (rec.state === 'staged') await services.media.publish(ctx(), rec._id, rec.version);
    return rec._id;
  });
  if (c.reused) reused += 1;
  else created += 1;

  // Content-addressed duplicate upload: same PNG bytes dedup to the same record.
  const dup = await services.media.upload(ctx(), uploaderId, { data: PNG_1X1 });
  const deduped = dup._id === a.id;
  summary.record('media', created, reused);
  if (deduped) summary.skip('duplicate PNG upload deduped to the existing asset (content-addressed)');

  // Referenced media that cannot be deleted: point a published game cover at asset B.
  const gameId = catalog.publishedGames.get('nova-strike');
  if (gameId !== undefined) {
    const game = (await db.collection('games').findOne({ _id: gameId } as never)) as unknown as
      | { slug: string; version: number; coverImageUrl?: string }
      | null;
    const url = mediaUrl(b.id);
    if (game !== null && game.coverImageUrl !== url) {
      await services.games.update(ctx(), gameId, {
        slug: game.slug,
        coverImageUrl: url,
        translations: {},
        expectedVersion: game.version
      });
    }
  }
}
