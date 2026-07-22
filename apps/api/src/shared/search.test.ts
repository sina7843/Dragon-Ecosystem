import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { applyTextSearch, normalizeQuery } from './search.ts';

/**
 * Free-text search helper (DRAGON-15). The query is regex-escaped (no injection/ReDoS),
 * length-capped, and composes with an existing keyset-cursor `$or` under `$and` so the
 * pagination boundary is never lost.
 */

describe('normalizeQuery', () => {
  test('trims, caps length, and treats blank as no search', () => {
    assert.equal(normalizeQuery(undefined), null);
    assert.equal(normalizeQuery('   '), null);
    assert.equal(normalizeQuery('  dragon  '), 'dragon');
    assert.equal(normalizeQuery('x'.repeat(200))?.length, 100);
  });
});

describe('applyTextSearch', () => {
  test('adds a case-insensitive $or over the given fields with an escaped pattern', () => {
    const filter: Record<string, unknown> = { state: 'published' };
    applyTextSearch(filter, 'a.b*c', ['title', 'summary']);
    const or = filter['$or'] as Array<Record<string, { $regex: string; $options: string }>>;
    assert.equal(or.length, 2);
    // Regex metacharacters are escaped so the pattern is a literal substring match.
    assert.equal(or[0]?.['title']?.$regex, 'a\\.b\\*c');
    assert.equal(or[0]?.['title']?.$options, 'i');
    assert.equal(or[1]?.['summary']?.$regex, 'a\\.b\\*c');
    assert.equal(filter['state'], 'published');
  });

  test('composes with an existing cursor $or under $and so neither is lost', () => {
    const cursorOr = [{ publishedAt: { $lt: 'x' } }, { publishedAt: 'x', _id: { $gt: 'y' } }];
    const filter: Record<string, unknown> = { state: 'published', $or: cursorOr };
    applyTextSearch(filter, 'dragon', ['title']);
    assert.equal(filter['$or'], undefined);
    const and = filter['$and'] as Array<Record<string, unknown>>;
    assert.equal(and.length, 2);
    assert.deepEqual(and[0], { $or: cursorOr });
    assert.equal(Array.isArray((and[1] as { $or: unknown[] }).$or), true);
  });
});
