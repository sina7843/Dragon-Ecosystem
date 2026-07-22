import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isValidSlug, resolveSlug, slugify } from './slug.ts';
import { sanitizeRichText, toPlainText } from './sanitize.ts';
import { CONTENT_STATES, canContentTransition } from './state.ts';

describe('slugs (section 17.3)', () => {
  test('slugify produces URL-safe slugs and keeps Persian letters', () => {
    assert.equal(slugify('Hello World!'), 'hello-world');
    assert.equal(slugify('  Multiple   Spaces  '), 'multiple-spaces');
    assert.equal(slugify('Trailing---hyphens---'), 'trailing-hyphens');
    // Persian slugs are allowed (localized slugs may differ).
    assert.equal(slugify('راهنمای بازی'), 'راهنمای-بازی');
  });

  test('isValidSlug accepts only normalized slugs', () => {
    assert.equal(isValidSlug('valid-slug-1'), true);
    assert.equal(isValidSlug('Invalid Slug'), false);
    assert.equal(isValidSlug('-leading'), false);
    assert.equal(isValidSlug(''), false);
  });

  test('resolveSlug derives from a fallback when blank and rejects an unusable value', () => {
    assert.equal(resolveSlug(undefined, 'My Article Title'), 'my-article-title');
    assert.equal(resolveSlug('custom-slug', 'ignored'), 'custom-slug');
    // Punctuation-only slugifies to empty, which is not a valid slug.
    assert.throws(() => resolveSlug('!!!', '!!!'), /not valid/);
  });
});

describe('rich-text sanitisation (CONTENT-005, SEC-003)', () => {
  test('scripts and event handlers are removed', () => {
    const dirty = '<p>Safe</p><script>alert(1)</script><img src=x onerror=alert(1)>';
    const clean = sanitizeRichText(dirty);
    assert.ok(!clean.includes('<script'));
    assert.ok(!clean.includes('onerror'));
    assert.ok(clean.includes('<p>Safe</p>'));
  });

  test('javascript: and data: URLs are stripped', () => {
    assert.ok(!sanitizeRichText('<a href="javascript:alert(1)">x</a>').includes('javascript:'));
    assert.ok(!sanitizeRichText('<img src="data:text/html,<script>1</script>">').includes('data:'));
  });

  test('allowed formatting is preserved and external links get rel', () => {
    const clean = sanitizeRichText('<h2>Title</h2><p><strong>Bold</strong> <a href="https://example.com">link</a></p>');
    assert.ok(clean.includes('<h2>Title</h2>'));
    assert.ok(clean.includes('<strong>Bold</strong>'));
    assert.match(clean, /rel="noopener noreferrer nofollow"/);
  });

  test('bidi and language markers survive for mixed-direction content', () => {
    const clean = sanitizeRichText('<p dir="ltr" lang="en">code</p>');
    assert.ok(clean.includes('dir="ltr"'));
    assert.ok(clean.includes('lang="en"'));
  });

  test('toPlainText strips all markup for indexing', () => {
    assert.equal(toPlainText('<p>Hello <strong>world</strong></p>'), 'Hello world');
  });
});

describe('content state machine', () => {
  test('the lifecycle allows the documented transitions', () => {
    assert.ok(CONTENT_STATES.includes('draft'));
    assert.equal(canContentTransition('draft', 'in_review'), true);
    assert.equal(canContentTransition('in_review', 'published'), true);
    assert.equal(canContentTransition('in_review', 'draft'), true);
    assert.equal(canContentTransition('published', 'archived'), true);
    assert.equal(canContentTransition('published', 'draft'), true); // unpublish
    assert.equal(canContentTransition('archived', 'draft'), true); // restore
  });

  test('invalid transitions are rejected', () => {
    assert.equal(canContentTransition('draft', 'published'), false); // must pass review
    assert.equal(canContentTransition('draft', 'archived'), false);
    assert.equal(canContentTransition('archived', 'published'), false);
  });
});
