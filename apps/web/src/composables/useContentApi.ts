import { apiFetch } from '../api.ts';
import type { Locale } from '../i18n/locale.ts';

/**
 * Typed reads for the public content and games surface. Only published resources
 * are ever returned by these endpoints; the server enforces it.
 */

export interface ContentCard {
  id: string;
  type: string;
  slug: string;
  title: string;
  summary: string;
  publishedAt: string;
  coverImageUrl: string | null;
}

export interface ContentDetail {
  id: string;
  type: string;
  locale: Locale;
  slug: string;
  title: string;
  summary: string;
  body: string;
  seoTitle: string;
  seoDescription: string;
  coverImageUrl: string | null;
  publishedAt: string | null;
  updatedAt: string;
  alternateSlugs: Record<Locale, string>;
}

export interface GameCard {
  id: string;
  slug: string;
  name: string;
  description: string;
  coverImageUrl: string | null;
}

export interface GameDetail extends GameCard {
  locale: Locale;
  seoTitle: string;
  seoDescription: string;
  publishedAt: string | null;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, value);
  }
  const s = search.toString();
  return s === '' ? '' : `?${s}`;
}

export function listContent(params: {
  locale: Locale;
  type?: string;
  category?: string;
  tag?: string;
  cursor?: string;
}): Promise<Page<ContentCard>> {
  return apiFetch<Page<ContentCard>>(`/content${query(params)}`);
}

export function getContent(type: string, slug: string, locale: Locale): Promise<ContentDetail> {
  return apiFetch<ContentDetail>(`/content/${encodeURIComponent(type)}/${encodeURIComponent(slug)}${query({ locale })}`);
}

export function listGames(params: { locale: Locale; cursor?: string }): Promise<Page<GameCard>> {
  return apiFetch<Page<GameCard>>(`/games${query(params)}`);
}

export function getGame(slug: string, locale: Locale): Promise<GameDetail> {
  return apiFetch<GameDetail>(`/games/${encodeURIComponent(slug)}${query({ locale })}`);
}
