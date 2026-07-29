import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { SUPPORTED_LOCALES } from './locale.ts';

/**
 * Translation completeness check (I18N-010, TEST-011). A missing or extra key in
 * any supported locale fails the build rather than surfacing a raw key at runtime.
 */

type Bundle = Record<string, unknown>;

function loadBundle(locale: string): Bundle {
  const path = fileURLToPath(new URL(`./locales/${locale}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as Bundle;
}

function flattenKeys(bundle: Bundle, prefix = ''): string[] {
  return Object.entries(bundle).flatMap(([key, value]) => {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    return typeof value === 'object' && value !== null
      ? flattenKeys(value as Bundle, path)
      : [path];
  });
}

const bundles = new Map(SUPPORTED_LOCALES.map((locale) => [locale, loadBundle(locale)]));
const reference = [...flattenKeys(bundles.get('en') as Bundle)].sort();

test('every supported locale defines exactly the same keys', () => {
  for (const locale of SUPPORTED_LOCALES) {
    const keys = flattenKeys(bundles.get(locale) as Bundle).sort();
    assert.deepEqual(keys, reference, `locale "${locale}" key set differs from the reference set`);
  }
});

test('no translated value is empty or left as a raw key', () => {
  for (const locale of SUPPORTED_LOCALES) {
    const bundle = bundles.get(locale) as Bundle;
    for (const key of flattenKeys(bundle)) {
      const value = key.split('.').reduce<unknown>((node, part) => (node as Bundle)[part], bundle);
      assert.equal(typeof value, 'string', `${locale}:${key} must be a string`);
      const text = (value as string).trim();
      assert.ok(text.length > 0, `${locale}:${key} must not be empty`);
      assert.notEqual(text, key, `${locale}:${key} must not repeat the raw key`);
    }
  }
});

test('Persian values are actually Persian, not copied English placeholders', () => {
  const fa = bundles.get('fa') as Bundle;
  // Locale display names are intentionally shown in their own script, so they are excluded.
  const exempt = new Set(['locale.name.fa', 'locale.name.en']);
  const persianRange = /[؀-ۿ]/;

  for (const key of flattenKeys(fa)) {
    if (exempt.has(key)) continue;
    const value = key.split('.').reduce<unknown>((node, part) => (node as Bundle)[part], fa) as string;
    assert.match(value, persianRange, `fa:${key} does not contain Persian text`);
  }
});

/**
 * Every statically written `t('some.key')` must resolve in every locale.
 *
 * Key *parity* between en and fa is checked above, but parity says nothing about whether a
 * key a component actually calls exists at all — a key missing from both files is
 * perfectly symmetrical and renders as its own raw name on the page. That is exactly how
 * `tournaments.tbd` reached the game detail page, where a tournament with no announced
 * date displayed the literal string `tournaments.tbd` in both locales.
 *
 * Only literal keys are checked. A dynamic key such as `` t(`store.type.${type}`) `` cannot
 * be resolved statically, so its coverage stays with the browser tests that assert no raw
 * key pattern appears on a rendered page.
 */
test('every literal t() key used in the app exists in every locale', () => {
  const webSrc = join(dirname(fileURLToPath(import.meta.url)), '..');
  const files = readdirSync(webSrc, { recursive: true }).filter(
    (f): f is string => typeof f === 'string' && (f.endsWith('.vue') || f.endsWith('.ts')) && !f.endsWith('.test.ts')
  );
  const LITERAL_KEY = /\bt\(\s*'([a-zA-Z0-9_.]+)'/g;

  const used = new Set<string>();
  for (const relative of files) {
    const source = readFileSync(join(webSrc, relative), 'utf8');
    for (const match of source.matchAll(LITERAL_KEY)) used.add(match[1] as string);
  }
  assert.ok(used.size > 50, 'the scan found translation keys at all');

  const missing: string[] = [];
  for (const locale of SUPPORTED_LOCALES) {
    const known = new Set(flattenKeys(loadBundle(locale)));
    for (const key of used) {
      if (!known.has(key)) missing.push(`${locale}:${key}`);
    }
  }
  assert.deepEqual(missing.sort(), [], `translation keys used in the app but not defined: ${missing.join(', ')}`);
});
