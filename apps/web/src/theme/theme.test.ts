import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_THEME_MODE, isThemeMode, readStoredThemeMode, resolveTheme } from './theme.ts';

describe('theme resolution', () => {
  test('explicit modes ignore the system preference', () => {
    assert.equal(resolveTheme('light', true), 'light');
    assert.equal(resolveTheme('light', false), 'light');
    assert.equal(resolveTheme('dark', false), 'dark');
    assert.equal(resolveTheme('dark', true), 'dark');
  });

  test('system mode follows the operating system preference', () => {
    assert.equal(resolveTheme('system', true), 'dark');
    assert.equal(resolveTheme('system', false), 'light');
  });

  test('the default mode follows the system', () => {
    assert.equal(DEFAULT_THEME_MODE, 'system');
  });
});

describe('stored preference', () => {
  test('a valid stored mode is used', () => {
    assert.equal(readStoredThemeMode('dark'), 'dark');
    assert.equal(readStoredThemeMode('light'), 'light');
    assert.equal(readStoredThemeMode('system'), 'system');
  });

  test('missing or unknown values fall back to the default', () => {
    assert.equal(readStoredThemeMode(null), 'system');
    assert.equal(readStoredThemeMode('solarized'), 'system');
    assert.equal(readStoredThemeMode(''), 'system');
  });

  test('isThemeMode rejects anything unsupported', () => {
    assert.equal(isThemeMode('dark'), true);
    assert.equal(isThemeMode('sepia'), false);
    assert.equal(isThemeMode(undefined), false);
  });
});
