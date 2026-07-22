/** The two supported public locales (matches the web `/:locale(fa|en)` routing). */
export type Locale = 'fa' | 'en';

/**
 * SEO service (DRAGON-15): builds the environment-aware robots.txt (SEO-006) and the
 * XML sitemap of published, indexable resources with locale alternates (SEO-005). The
 * concrete published resources come from an injected source so this module never reads
 * another module's collections directly.
 */

export interface SitemapEntry {
  /** Locale-prefixed site path, e.g. /en/content/guide/getting-started. */
  readonly path: string;
  /** Per-locale alternate paths for hreflang (xhtml:link). */
  readonly alternates: Partial<Record<Locale, string>>;
}

export interface SitemapSource {
  collect(): Promise<SitemapEntry[]>;
}

export interface SeoConfigView {
  /** 'production' emits an indexable robots.txt; anything else disallows all crawling. */
  env: string;
  /** Absolute origin for sitemap/robots URLs; empty yields site-relative locations. */
  publicOrigin: string;
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export class SeoService {
  readonly #config: SeoConfigView;
  readonly #source: SitemapSource;

  constructor(config: SeoConfigView, source: SitemapSource) {
    this.#config = config;
    this.#source = source;
  }

  #origin(): string {
    return this.#config.publicOrigin;
  }

  /**
   * robots.txt. A non-production environment disallows all crawling so staging/preview
   * builds never get indexed (SEO-006). Production allows crawling and points at the
   * sitemap.
   */
  robots(): string {
    if (this.#config.env !== 'production') {
      return 'User-agent: *\nDisallow: /\n';
    }
    const sitemap = `${this.#origin()}/sitemap.xml`;
    return `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /account/\nDisallow: /admin/\nSitemap: ${sitemap}\n`;
  }

  async sitemap(): Promise<string> {
    const origin = this.#origin();
    const entries = await this.#source.collect();
    const urls = entries
      .map((entry) => {
        const loc = `${origin}${entry.path}`;
        const links = Object.entries(entry.alternates)
          .map(([locale, path]) => `    <xhtml:link rel="alternate" hreflang="${locale}" href="${xmlEscape(`${origin}${path}`)}"/>`)
          .join('\n');
        return `  <url>\n    <loc>${xmlEscape(loc)}</loc>${links === '' ? '' : `\n${links}`}\n  </url>`;
      })
      .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`;
  }
}
