import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { SeoService, type SitemapEntry, type SitemapSource } from './service.ts';

/**
 * SEO unit coverage (DRAGON-15): robots.txt distinguishes production from nonproduction
 * (SEO-006) and the sitemap emits absolute URLs with hreflang alternates (SEO-005),
 * escaping XML metacharacters.
 */

function source(entries: SitemapEntry[]): SitemapSource {
  return { collect: () => Promise.resolve(entries) };
}

describe('robots.txt (SEO-006)', () => {
  test('a nonproduction environment disallows all crawling', () => {
    const seo = new SeoService({ env: 'test', publicOrigin: 'https://example.test' }, source([]));
    const robots = seo.robots();
    assert.match(robots, /Disallow: \/\s*$/);
    assert.doesNotMatch(robots, /Allow: \//);
  });

  test('production allows crawling, blocks private areas, and links the sitemap', () => {
    const seo = new SeoService({ env: 'production', publicOrigin: 'https://dragon.example' }, source([]));
    const robots = seo.robots();
    assert.match(robots, /Allow: \//);
    assert.match(robots, /Disallow: \/admin\//);
    assert.match(robots, /Sitemap: https:\/\/dragon\.example\/sitemap\.xml/);
  });
});

describe('sitemap.xml (SEO-005)', () => {
  test('emits absolute locations with hreflang alternates and escapes metacharacters', async () => {
    const seo = new SeoService({ env: 'production', publicOrigin: 'https://dragon.example' }, source([
      { path: '/fa/content/guide/a&b', alternates: { fa: '/fa/content/guide/a&b', en: '/en/content/guide/a-b' } }
    ]));
    const xml = await seo.sitemap();
    assert.match(xml, /<loc>https:\/\/dragon\.example\/fa\/content\/guide\/a&amp;b<\/loc>/);
    assert.match(xml, /hreflang="en" href="https:\/\/dragon\.example\/en\/content\/guide\/a-b"/);
    assert.match(xml, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/);
    assert.doesNotMatch(xml, /a&b/); // the raw ampersand must be escaped
  });
});
