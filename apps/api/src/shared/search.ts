/**
 * Safe free-text search helper (DRAGON-15, search/filter acceptance).
 *
 * Builds a case-insensitive substring match over a fixed set of fields. The query is
 * length-capped and fully regex-escaped so a caller can never inject a pattern (ReDoS
 * or operator injection). It composes with keyset pagination: when the filter already
 * carries a cursor `$or`, both are combined under `$and` so neither is lost.
 */

const MAX_QUERY_LENGTH = 100;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Normalizes a raw query; returns null when there is nothing to search for. */
export function normalizeQuery(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim().slice(0, MAX_QUERY_LENGTH);
  return trimmed === '' ? null : trimmed;
}

/**
 * Mutates `filter` to also require that one of `fields` contains `query` (case
 * insensitive). Safe to call only when `query` is a normalized non-empty string.
 */
export function applyTextSearch(filter: Record<string, unknown>, query: string, fields: readonly string[]): void {
  const pattern = escapeRegExp(query);
  const searchOr = fields.map((field) => ({ [field]: { $regex: pattern, $options: 'i' } }));
  if ('$or' in filter) {
    filter['$and'] = [{ $or: filter['$or'] }, { $or: searchOr }];
    delete filter['$or'];
  } else {
    filter['$or'] = searchOr;
  }
}
