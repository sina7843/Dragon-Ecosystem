/**
 * Cursor pagination (Requirements section 20.3).
 *
 * Default page size 20, capped at 100, with a stable secondary sort by id so no
 * record is duplicated or skipped between pages. The cursor is an opaque token
 * carrying the sort key of the last row seen.
 */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface PageCursor {
  /** The primary sort value (an ISO timestamp for the collections paginated here). */
  readonly sortValue: string;
  readonly id: string;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export function clampLimit(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(requested)));
}

export function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** Returns null for a missing or malformed cursor rather than throwing. */
export function decodeCursor(raw: string | undefined): PageCursor | null {
  if (raw === undefined || raw === '') return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<PageCursor>;
    if (typeof parsed.sortValue !== 'string' || typeof parsed.id !== 'string') return null;
    return { sortValue: parsed.sortValue, id: parsed.id };
  } catch {
    return null;
  }
}

/**
 * Builds a `{items, nextCursor}` page from one extra-row lookahead. Callers query
 * `limit + 1` rows; if the extra row exists there is another page.
 */
export function toPage<T extends { sortValue: string; id: string }>(
  rows: readonly T[],
  limit: number
): Page<T> {
  if (rows.length <= limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, limit);
  const last = items[items.length - 1] as T;
  return { items, nextCursor: encodeCursor({ sortValue: last.sortValue, id: last.id }) };
}
