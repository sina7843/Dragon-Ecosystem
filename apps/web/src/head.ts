import { SUPPORTED_LOCALES, type Locale } from './i18n/locale.ts';

/**
 * Document head management for the shell.
 *
 * Covers what the application shell owns: localized title, canonical URL,
 * hreflang alternates, and indexability. The full SEO surface — descriptions per
 * page, Open Graph, structured data, sitemaps — belongs to DRAGON-15.
 */

export interface HeadOptions {
  readonly title: string;
  readonly locale: Locale;
  readonly path: string;
  /** SEO-008: account, admin, and personalized pages must not be indexable. */
  readonly indexable: boolean;
  /** SEO-001: localized meta description for indexable pages. */
  readonly description?: string;
  /** SEO-004: Open Graph object type, e.g. 'article' or 'website'. */
  readonly ogType?: string;
  /** Absolute or site-relative image for social cards. */
  readonly image?: string | null;
  /**
   * Explicit per-locale alternate paths. Required where localized slugs differ
   * (section 17.3), so hreflang points at the correct slug rather than a naive
   * locale swap of the current path.
   */
  readonly alternates?: Partial<Record<Locale, string>>;
}

function upsertAttrMeta(attr: 'name' | 'property', key: string, content: string): void {
  const head = globalThis.document?.head;
  if (head === undefined) return;
  let element = head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (element === null) {
    element = globalThis.document.createElement('meta');
    element.setAttribute(attr, key);
    head.append(element);
  }
  element.content = content;
}

function upsertMeta(name: string, content: string): void {
  upsertAttrMeta('name', name, content);
}

function upsertLink(rel: string, href: string, hreflang?: string): void {
  const head = globalThis.document?.head;
  if (head === undefined) return;
  const selector = hreflang === undefined ? `link[rel="${rel}"]:not([hreflang])` : `link[rel="${rel}"][hreflang="${hreflang}"]`;
  let element = head.querySelector<HTMLLinkElement>(selector);
  if (element === null) {
    element = globalThis.document.createElement('link');
    element.rel = rel;
    if (hreflang !== undefined) element.hreflang = hreflang;
    head.append(element);
  }
  element.href = href;
}

/** Replaces the locale segment of a path, used to build hreflang alternates. */
export function pathForLocale(path: string, locale: Locale): string {
  const segments = path.split('/').filter((segment) => segment !== '');
  if (segments.length > 0 && SUPPORTED_LOCALES.includes(segments[0] as Locale)) {
    segments[0] = locale;
    return `/${segments.join('/')}`;
  }
  return `/${locale}${path === '/' ? '' : path}`;
}

export function applyHead(options: HeadOptions): void {
  const document = globalThis.document;
  if (document === undefined) return;

  document.title = options.title;
  upsertMeta('robots', options.indexable ? 'index,follow' : 'noindex,nofollow');
  if (options.description !== undefined) upsertMeta('description', options.description);

  const origin = globalThis.location?.origin ?? '';
  const canonical = `${origin}${options.path}`;
  upsertLink('canonical', canonical);
  for (const locale of SUPPORTED_LOCALES) {
    // Explicit alternate when localized slugs differ; otherwise swap the locale segment.
    const alternatePath = options.alternates?.[locale] ?? pathForLocale(options.path, locale);
    upsertLink('alternate', `${origin}${alternatePath}`, locale);
  }

  // Open Graph (SEO-004): localized, with the current locale and canonical URL.
  upsertAttrMeta('property', 'og:title', options.title);
  upsertAttrMeta('property', 'og:type', options.ogType ?? 'website');
  upsertAttrMeta('property', 'og:url', canonical);
  upsertAttrMeta('property', 'og:locale', options.locale);
  if (options.description !== undefined) upsertAttrMeta('property', 'og:description', options.description);
  if (options.image !== undefined && options.image !== null && options.image !== '') {
    upsertAttrMeta('property', 'og:image', options.image.startsWith('http') ? options.image : `${origin}${options.image}`);
  }
}
