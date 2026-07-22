import { ValidationError } from '../../shared/errors.ts';

/**
 * Slug handling (section 5.9: slugs may change but are not the sole relationship
 * key; section 17.3: localized slugs may differ). Slugs are per-locale, so both a
 * Persian and a Latin slug are valid as long as they are URL-safe.
 */

const SLUG_MAX_LENGTH = 120;
// Unicode letters/numbers, collapsed to single hyphens. Persian text is allowed.
const INVALID_SLUG_CHARS = /[^\p{Letter}\p{Number}-]+/gu;

export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(INVALID_SLUG_CHARS, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, SLUG_MAX_LENGTH);
}

export function isValidSlug(slug: string): boolean {
  if (slug.length === 0 || slug.length > SLUG_MAX_LENGTH) return false;
  // A normalized slug is the fixed point of slugify.
  return slugify(slug) === slug;
}

/** Normalises and validates a caller-supplied slug, deriving one from `fallback` when blank. */
export function resolveSlug(candidate: string | undefined, fallback: string, field = 'slug'): string {
  const slug = candidate === undefined || candidate.trim() === '' ? slugify(fallback) : slugify(candidate);
  if (!isValidSlug(slug)) {
    throw new ValidationError('The slug is not valid.', [
      { field, code: 'INVALID_SLUG', message: 'Use letters, numbers, and hyphens.' }
    ]);
  }
  return slug;
}
