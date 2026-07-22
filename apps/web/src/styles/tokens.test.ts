import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

/**
 * Contrast verification for the design tokens (A11Y-008, section 23.2).
 *
 * The test reads tokens.css itself, so the declared colours and the checked
 * colours cannot drift apart. WCAG AA: 4.5:1 for body text, 3:1 for non-text
 * UI such as focus rings and borders.
 */

const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');

function themeTokens(selector: string): Record<string, string> {
  const selectorIndex = css.indexOf(selector);
  assert.notEqual(selectorIndex, -1, `selector ${selector} not found in tokens.css`);
  const open = css.indexOf('{', selectorIndex);
  const close = css.indexOf('}', open);
  const tokens: Record<string, string> = {};
  for (const match of css.slice(open + 1, close).matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    tokens[match[1] as string] = (match[2] as string).trim();
  }
  return tokens;
}

function channelLuminance(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const normalized = hex.replace('#', '');
  assert.equal(normalized.length, 6, `expected a 6-digit hex colour, received ${hex}`);
  const [r, g, b] = [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
  return (
    0.2126 * channelLuminance(r as number) +
    0.7152 * channelLuminance(g as number) +
    0.0722 * channelLuminance(b as number)
  );
}

function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return ((lighter as number) + 0.05) / ((darker as number) + 0.05);
}

/** Foreground, background, and the ratio the pair must meet. */
const TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['--color-text', '--color-surface'],
  ['--color-text', '--color-surface-raised'],
  ['--color-text', '--color-surface-sunken'],
  ['--color-text-muted', '--color-surface'],
  ['--color-text-muted', '--color-surface-raised'],
  ['--color-accent', '--color-surface'],
  ['--color-accent-text', '--color-accent'],
  ['--color-success-text', '--color-success-surface'],
  ['--color-warning-text', '--color-warning-surface'],
  ['--color-danger-text', '--color-danger-surface'],
  ['--color-info-text', '--color-info-surface']
];

// Non-text UI that must meet WCAG 1.4.11 3:1 (A11Y-008). Interactive control boundaries
// (inputs, selects, buttons, the table scroll region, dialog) are drawn with
// --color-border-strong; the accent fill is the boundary of primary buttons and the
// current-page control. --color-border stays a subtle decorative separator (row lines,
// card edges) that does not itself identify a control, so it is exempt from 3:1.
const NON_TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['--color-focus', '--color-surface'],
  ['--color-border-strong', '--color-surface'],
  ['--color-border-strong', '--color-surface-raised'],
  ['--color-accent', '--color-surface']
];

const THEMES = [
  { name: 'light', selector: ":root[data-theme='light']" },
  { name: 'dark', selector: ":root[data-theme='dark']" }
];

for (const theme of THEMES) {
  describe(`${theme.name} theme contrast`, () => {
    const tokens = themeTokens(theme.selector);

    test('body text pairs meet WCAG AA 4.5:1', () => {
      for (const [foreground, background] of TEXT_PAIRS) {
        const fg = tokens[foreground];
        const bg = tokens[background];
        assert.ok(fg, `${theme.name}: ${foreground} is not defined`);
        assert.ok(bg, `${theme.name}: ${background} is not defined`);
        const ratio = contrastRatio(fg, bg);
        assert.ok(
          ratio >= 4.5,
          `${theme.name}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1, needs 4.5:1`
        );
      }
    });

    test('focus ring and strong borders meet 3:1', () => {
      for (const [foreground, background] of NON_TEXT_PAIRS) {
        const ratio = contrastRatio(tokens[foreground] as string, tokens[background] as string);
        assert.ok(
          ratio >= 3,
          `${theme.name}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1, needs 3:1`
        );
      }
    });

    test('every semantic colour token is defined', () => {
      const required = new Set([...TEXT_PAIRS, ...NON_TEXT_PAIRS].flat());
      for (const token of required) {
        assert.match(tokens[token] ?? '', /^#[0-9a-f]{6}$/i, `${theme.name}: ${token} must be a hex colour`);
      }
    });
  });
}

describe('token coverage', () => {
  test('tokens exist for every category required by section 23.2', () => {
    for (const prefix of [
      '--font-',
      '--text-',
      '--space-',
      '--radius-',
      '--shadow-',
      '--motion-',
      '--z-',
      '--breakpoint-'
    ]) {
      assert.ok(css.includes(prefix), `no tokens defined for ${prefix}`);
    }
  });

  test('reduced motion is handled', () => {
    assert.match(css, /prefers-reduced-motion:\s*reduce/);
  });

  test('glass surfaces declare a solid fallback before the blur', () => {
    const fallback = css.indexOf('.glass {');
    const enhancement = css.indexOf('backdrop-filter');
    assert.ok(fallback !== -1 && fallback < enhancement, 'solid fallback must precede the blur enhancement');
  });
});
