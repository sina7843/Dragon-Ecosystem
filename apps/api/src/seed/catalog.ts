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

interface ContentSpec {
  readonly slug: string;
  readonly type: 'news' | 'article' | 'guide' | 'announcement';
  readonly titleFa: string;
  readonly titleEn: string;
  readonly summaryFa: string;
  readonly summaryEn: string;
  readonly long: boolean;
  readonly publish: boolean;
}

const CONTENT: readonly ContentSpec[] = [
  { slug: 'welcome-to-dragon', type: 'announcement', titleFa: 'به دراگون خوش آمدید', titleEn: 'Welcome to Dragon', summaryFa: 'معرفی پلتفرم نمونه.', summaryEn: 'Introducing the demo platform.', long: false, publish: true },
  { slug: 'nova-strike-season', type: 'news', titleFa: 'فصل جدید نبرد نوا', titleEn: 'Nova Strike New Season', summaryFa: 'خبر فصل رقابتی تازه.', summaryEn: 'A new competitive season begins.', long: true, publish: true },
  { slug: 'bracket-basics', type: 'guide', titleFa: 'مبانی جدول مسابقات', titleEn: 'Bracket Basics', summaryFa: 'راهنمای فرمت‌های مسابقه.', summaryEn: 'A guide to tournament formats.', long: true, publish: true },
  { slug: 'team-play-tips', type: 'article', titleFa: 'نکات بازی تیمی', titleEn: 'Team Play Tips', summaryFa: 'مقاله‌ای کوتاه درباره‌ی هماهنگی تیم.', summaryEn: 'A short article on team coordination.', long: false, publish: true },
  { slug: 'dragon-arena-meta', type: 'article', titleFa: 'متای میدان اژدها', titleEn: 'Dragon Arena Meta', summaryFa: 'تحلیل بلند متای بازی.', summaryEn: 'A long-form meta analysis.', long: true, publish: true },
  { slug: 'weekly-recap', type: 'news', titleFa: 'مرور هفتگی', titleEn: 'Weekly Recap', summaryFa: 'خلاصه‌ی رویدادهای هفته.', summaryEn: 'This week in the demo league.', long: false, publish: true },
  { slug: 'draft-preview', type: 'article', titleFa: 'پیش‌نمایش پیش‌نویس', titleEn: 'Draft Preview', summaryFa: 'مقاله‌ی پیش‌نویس منتشرنشده.', summaryEn: 'An unpublished draft article.', long: false, publish: false }
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

  let cCreated = 0;
  let cReused = 0;
  for (const c of CONTENT) {
    const { reused } = await ensureDemo(registry, db, { demoSeedKey: demoRef('content', c.slug), domainType: 'content', collection: 'content_items', resettable: true }, async () => {
      const record = await services.content.createDraft(ctx(), {
        type: c.type,
        slugs: { fa: c.slug, en: c.slug },
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

  return { publishedGames };
}
