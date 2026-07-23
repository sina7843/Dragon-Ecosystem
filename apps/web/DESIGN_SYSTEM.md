# Dragon Ecosystem — frontend design system

Premium, gaming-inspired **purple** identity for an esports platform. Formal enough
for wallets, moderation, and administration; expressive enough for tournaments and
brackets. Dark and light are both first-class.

## Token architecture

All colour, type, spacing, radius, elevation, motion, and z-index live in
`src/styles/tokens.css` as semantic CSS custom properties. **Components reference
tokens only — never raw colours** (enforced: zero hardcoded hex in any `.vue`).
Redesigns happen at the token layer and propagate to every view.

- `src/styles/tokens.css` — the tokens + light/dark themes (`:root[data-theme]`).
- `src/styles/base.css` — element base, typography, focus, `.btn` system.
- `src/styles/components.css` — shared class primitives (below).

### Themes
`data-theme` on `<html>` selects light/dark; resolution and persistence are in
`src/theme/theme.ts` (`light` / `dark` / `system`, stored under `dragon.theme`).
Theme is applied before mount, so there is no wrong-theme flash.

- **Dark:** layered near-black surfaces (`#08070B` → `#191624`), deep-purple panels,
  bright purple primary (`#7C3AED`), restrained violet glow on key elements.
- **Light:** white + soft lavender surfaces, purple primary, clean tinted shadows
  (no glow). Light mode is a complete design, not a downgrade.

### Contrast
`src/styles/tokens.test.ts` reads `tokens.css` directly and asserts WCAG AA on every
text pair (4.5:1) and non-text pair (3:1) in both themes, including the primary and
danger action-fill pairs. Adjust token values, not the test, if a pair fails.

## Typography
System/local font stack (no bundled or CDN fonts). Scale: `--text-xs … --text-4xl`.
Persian gets a taller line-height (`--leading-persian`) and no `letter-spacing` /
`text-transform` (both break Arabic-script ligatures — always reset under `[lang='fa']`).
Statistics, scores, balances, dates, and standings use `font-variant-numeric: tabular-nums`.

## RTL rules
Logical properties throughout (`margin-inline`, `inset-block-start`, `border-inline-start`)
so one stylesheet serves both directions. Code-like values (usernames, SKUs, IDs, money)
use `.latin-value` (LTR + `unicode-bidi: isolate`) or `<bdi>`.

## Component primitives (`components.css`)
`.btn` (+ `-primary` / `-secondary` / `-neutral` / `-ghost` / `-danger`, with hover /
active / disabled / loading), `.card` / `.card-interactive` / `.data-panel` / `.stat-card`,
`.badge-*`, `.status-pill-*`, `.page-header`, `.section-header`, `.toolbar`, `.card-grid`,
`.stat-grid`. Primary actions are purple; destructive actions use danger tokens and are
never purple. Status is always carried by a **text label**; colour and the pill dot are
reinforcement, never the only signal.

## Motion
Subtle and purposeful only (button press, dialog entrance, card hover, nav disclosure).
All motion is neutralised under `prefers-reduced-motion: reduce` via zeroed motion tokens
plus a global animation/transition override in `tokens.css`.

## Accessibility
Native semantics first: real `<button>`, `<dialog>` (platform focus trap + restore),
`<table>` with caption/scope, labelled inputs with associated errors. Visible focus ring
(`--color-focus`, 3px, AA non-text). Skip link and route-change focus preserved in the
shell. Minimum 2.75rem touch targets. Verified in both themes and both locales.
