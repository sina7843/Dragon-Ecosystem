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
}

function upsertMeta(name: string, content: string): void {
  const head = globalThis.document?.head;
  if (head === undefined) return;
  let element = head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (element === null) {
    element = globalThis.document.createElement('meta');
    element.name = name;
    head.append(element);
  }
  element.content = content;
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

  const origin = globalThis.location?.origin ?? '';
  upsertLink('canonical', `${origin}${options.path}`);
  for (const locale of SUPPORTED_LOCALES) {
    upsertLink('alternate', `${origin}${pathForLocale(options.path, locale)}`, locale);
  }
}
