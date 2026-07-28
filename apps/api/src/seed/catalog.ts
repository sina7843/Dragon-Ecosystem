/**
 * Games catalog and editorial content, created through the real games/content services.
 * Bilingual fa/en, published + one draft each, so public directories, search, pagination,
 * and the admin draft view all have data. Drafts stay unpublished (never leak publicly).
 */
import type { SeedSummary } from './harness.ts';
import { demoRef } from './harness.ts';
import type { DemoRegistry } from './registry.ts';
import { accountContext, ensureDemo, type Services } from './wiring.ts';

export interface CatalogRegistry {
  /** Published game ids keyed by demo slug — teams and tournaments reference these. */
  readonly publishedGames: Map<string, string>;
}

interface GameSpec {
  readonly slug: string;
  readonly nameFa: string;
  readonly nameEn: string;
  readonly descFa: string;
  readonly descEn: string;
  readonly publish: boolean;
}

const GAMES: readonly GameSpec[] = [
  { slug: 'nova-strike', nameFa: 'نبرد نوا', nameEn: 'Nova Strike', descFa: 'تیراندازی تیمی رقابتی نمونه.', descEn: 'A fictional competitive team shooter.', publish: true },
  { slug: 'dragon-arena', nameFa: 'میدان اژدها', nameEn: 'Dragon Arena', descFa: 'مبارزه‌ی میدانی پنج‌نفره.', descEn: 'A 5v5 arena battler for the demo.', publish: true },
  { slug: 'astro-racers', nameFa: 'راننده‌های فضایی', nameEn: 'Astro Racers', descFa: 'مسابقه‌ی سرعت آینده‌نگرانه.', descEn: 'Futuristic racing, fictional.', publish: true },
  { slug: 'rune-tactics', nameFa: 'تاکتیک رون', nameEn: 'Rune Tactics', descFa: 'استراتژی نوبتی نمونه.', descEn: 'Turn-based strategy demo title.', publish: true },
  { slug: 'pixel-league', nameFa: 'لیگ پیکسل', nameEn: 'Pixel League', descFa: 'ورزش آرکید رترو.', descEn: 'Retro arcade sports, fictional.', publish: true },
  { slug: 'shadow-duel', nameFa: 'دوئل سایه', nameEn: 'Shadow Duel', descFa: 'مبارزه‌ی تک‌به‌تک.', descEn: '1v1 fighting demo title.', publish: true },
  { slug: 'orbit-blitz', nameFa: 'بلیتز مداری', nameEn: 'Orbit Blitz', descFa: 'معمای سریع چندنفره.', descEn: 'Fast multiplayer puzzle, fictional.', publish: true },
  { slug: 'unreleased-quest', nameFa: 'کوئست منتشرنشده', nameEn: 'Unreleased Quest', descFa: 'عنوان پیش‌نویس برای نمای مدیر.', descEn: 'Draft-only title, visible to admins.', publish: false }
];

type ContentType = 'news' | 'article' | 'guide' | 'announcement';

/**
 * Editorial taxonomy. Categories are scoped to a content type (a "guide" category is not
 * offered on a news item), tags are global and cross-cutting — that is the shape the
 * content service and the admin taxonomy screens expect.
 */
const CATEGORIES: readonly { type: ContentType; slug: string; fa: string; en: string }[] = [
  { type: 'news', slug: 'esports-news', fa: 'اخبار ورزش‌های الکترونیک', en: 'Esports news' },
  { type: 'news', slug: 'platform-updates', fa: 'به‌روزرسانی‌های پلتفرم', en: 'Platform updates' },
  { type: 'article', slug: 'analysis', fa: 'تحلیل', en: 'Analysis' },
  { type: 'article', slug: 'community', fa: 'انجمن', en: 'Community' },
  { type: 'guide', slug: 'getting-started', fa: 'شروع به کار', en: 'Getting started' },
  { type: 'guide', slug: 'tournament-formats', fa: 'فرمت‌های مسابقه', en: 'Tournament formats' },
  { type: 'announcement', slug: 'releases', fa: 'انتشارها', en: 'Releases' }
];

const TAGS: readonly { slug: string; fa: string; en: string }[] = [
  { slug: 'beginner', fa: 'مبتدی', en: 'Beginner' },
  { slug: 'competitive', fa: 'رقابتی', en: 'Competitive' },
  { slug: 'season', fa: 'فصل', en: 'Season' },
  { slug: 'strategy', fa: 'استراتژی', en: 'Strategy' },
  { slug: 'teamplay', fa: 'بازی تیمی', en: 'Team play' },
  { slug: 'meta', fa: 'متا', en: 'Meta' },
  { slug: 'recap', fa: 'مرور', en: 'Recap' },
  { slug: 'platform', fa: 'پلتفرم', en: 'Platform' }
];

interface ContentSpec {
  readonly slug: string;
  readonly type: ContentType;
  readonly titleFa: string;
  readonly titleEn: string;
  readonly summaryFa: string;
  readonly summaryEn: string;
  readonly long: boolean;
  readonly publish: boolean;
  readonly categorySlugs: readonly string[];
  readonly tagSlugs: readonly string[];
}

const CONTENT: readonly ContentSpec[] = [
  { slug: 'welcome-to-dragon', type: 'announcement', titleFa: 'به دراگون خوش آمدید', titleEn: 'Welcome to Dragon', summaryFa: 'معرفی پلتفرم نمونه.', summaryEn: 'Introducing the demo platform.', long: false, publish: true, categorySlugs: ['releases'], tagSlugs: ['platform', 'beginner'] },
  { slug: 'nova-strike-season', type: 'news', titleFa: 'فصل جدید نبرد نوا', titleEn: 'Nova Strike New Season', summaryFa: 'خبر فصل رقابتی تازه.', summaryEn: 'A new competitive season begins.', long: true, publish: true, categorySlugs: ['esports-news'], tagSlugs: ['season', 'competitive'] },
  { slug: 'bracket-basics', type: 'guide', titleFa: 'مبانی جدول مسابقات', titleEn: 'Bracket Basics', summaryFa: 'راهنمای فرمت‌های مسابقه.', summaryEn: 'A guide to tournament formats.', long: true, publish: true, categorySlugs: ['getting-started', 'tournament-formats'], tagSlugs: ['beginner', 'strategy'] },
  { slug: 'team-play-tips', type: 'article', titleFa: 'نکات بازی تیمی', titleEn: 'Team Play Tips', summaryFa: 'مقاله‌ای کوتاه درباره‌ی هماهنگی تیم.', summaryEn: 'A short article on team coordination.', long: false, publish: true, categorySlugs: ['community'], tagSlugs: ['teamplay'] },
  { slug: 'dragon-arena-meta', type: 'article', titleFa: 'متای میدان اژدها', titleEn: 'Dragon Arena Meta', summaryFa: 'تحلیل بلند متای بازی.', summaryEn: 'A long-form meta analysis.', long: true, publish: true, categorySlugs: ['analysis'], tagSlugs: ['meta', 'strategy', 'competitive'] },
  { slug: 'weekly-recap', type: 'news', titleFa: 'مرور هفتگی', titleEn: 'Weekly Recap', summaryFa: 'خلاصه‌ی رویدادهای هفته.', summaryEn: 'This week in the demo league.', long: false, publish: true, categorySlugs: ['platform-updates'], tagSlugs: ['recap'] },
  { slug: 'draft-preview', type: 'article', titleFa: 'پیش‌نمایش پیش‌نویس', titleEn: 'Draft Preview', summaryFa: 'مقاله‌ی پیش‌نویس منتشرنشده.', summaryEn: 'An unpublished draft article.', long: false, publish: false, categorySlugs: ['analysis'], tagSlugs: ['meta'] }
];

function body(summaryEn: string, long: boolean): string {
  const p = `<p>${summaryEn} This is fictional demonstration content for the local Dragon Ecosystem environment.</p>`;
  return long ? p + '<p>It intentionally runs longer so article detail pages, reading layouts, and truncated cards all have realistic material to render in both Persian and English.</p>' : p;
}

export async function seedCatalog(
  services: Services,
  registry: DemoRegistry,
  summary: SeedSummary,
  authorId: string
): Promise<CatalogRegistry> {
  const db = services.db;
  const ctx = () => accountContext(authorId, ['content_publisher', 'platform_administrator']);
  const publishedGames = new Map<string, string>();
  let gCreated = 0;
  let gReused = 0;

  for (const g of GAMES) {
    // Games are anchors tournaments/teams reference by id — preserved, never reset.
    const { id, reused } = await ensureDemo(registry, db, { demoSeedKey: demoRef('game', g.slug), domainType: 'game', collection: 'games', resettable: false }, async () => {
      const record = await services.games.create(ctx(), {
        slug: g.slug,
        translations: {
          fa: { name: g.nameFa, description: g.descFa, seoTitle: g.nameFa, seoDescription: g.descFa },
          en: { name: g.nameEn, description: g.descEn, seoTitle: g.nameEn, seoDescription: g.descEn }
        }
      });
      if (g.publish) await services.games.setStatus(ctx(), record._id, 'published', 'demo seed publish');
      return record._id;
    }, { slug: g.slug });
    if (reused) gReused += 1;
    else gCreated += 1;
    if (g.publish) publishedGames.set(g.slug, id);
  }
  summary.record('games', gCreated, gReused);

  // Taxonomy first, so a content item can be created already filed under its category.
  let taxCreated = 0;
  let taxReused = 0;
  for (const cat of CATEGORIES) {
    const { reused } = await ensureDemo(
      registry,
      db,
      { demoSeedKey: demoRef('category', `${cat.type}:${cat.slug}`), domainType: 'category', collection: 'categories', resettable: true },
      async () => (await services.content.createCategory(ctx(), { type: cat.type, slug: cat.slug, labels: { fa: cat.fa, en: cat.en } }))._id,
      { type: cat.type, slug: cat.slug }
    );
    if (reused) taxReused += 1;
    else taxCreated += 1;
  }
  for (const tag of TAGS) {
    const { reused } = await ensureDemo(
      registry,
      db,
      { demoSeedKey: demoRef('tag', tag.slug), domainType: 'tag', collection: 'tags', resettable: true },
      async () => (await services.content.createTag(ctx(), { slug: tag.slug, labels: { fa: tag.fa, en: tag.en } }))._id,
      { slug: tag.slug }
    );
    if (reused) taxReused += 1;
    else taxCreated += 1;
  }
  summary.record('content taxonomy', taxCreated, taxReused);

  let cCreated = 0;
  let cReused = 0;
  for (const c of CONTENT) {
    const { reused } = await ensureDemo(registry, db, { demoSeedKey: demoRef('content', c.slug), domainType: 'content', collection: 'content_items', resettable: true }, async () => {
      const record = await services.content.createDraft(ctx(), {
        type: c.type,
        slugs: { fa: c.slug, en: c.slug },
        categorySlugs: [...c.categorySlugs],
        tagSlugs: [...c.tagSlugs],
        translations: {
          fa: { title: c.titleFa, summary: c.summaryFa, body: body(c.summaryEn, c.long), seoTitle: c.titleFa, seoDescription: c.summaryFa },
          en: { title: c.titleEn, summary: c.summaryEn, body: body(c.summaryEn, c.long), seoTitle: c.titleEn, seoDescription: c.summaryEn }
        }
      });
      if (c.publish) {
        // State graph is draft -> in_review -> published (no direct jump).
        await services.content.transition(ctx(), record._id, 'in_review', { reason: 'demo seed review', canPublish: true });
        await services.content.transition(ctx(), record._id, 'published', { reason: 'demo seed publish', canPublish: true });
      }
      return record._id;
    }, { type: c.type, 'slugs.en': c.slug });
    if (reused) cReused += 1;
    else cCreated += 1;
  }
  summary.record('content', cCreated, cReused);

  // Backfill taxonomy onto items seeded before categories/tags existed. Only fills an
  // item that carries none, so an editorial change made by hand is never overwritten and
  // a rerun writes nothing.
  let filed = 0;
  for (const c of CONTENT) {
    if (c.categorySlugs.length === 0 && c.tagSlugs.length === 0) continue;
    const item = (await db.collection('content_items').findOne({ type: c.type, 'slugs.en': c.slug } as never)) as unknown as
      | { _id: string; version: number; categorySlugs?: string[]; tagSlugs?: string[] }
      | null;
    if (item === null) continue;
    if ((item.categorySlugs?.length ?? 0) > 0 || (item.tagSlugs?.length ?? 0) > 0) continue;
    await services.content.updateContent(ctx(), item._id, {
      categorySlugs: [...c.categorySlugs],
      tagSlugs: [...c.tagSlugs],
      expectedVersion: item.version
    });
    filed += 1;
  }
  if (filed > 0) summary.record('content filed under taxonomy', filed, 0);

  return { publishedGames };
}
