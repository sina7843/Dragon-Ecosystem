# Dragon Ecosystem — frontend design system

**Lapis & Ember.** A deep indigo-lapis ground carrying saffron gold — the palette of
Persian manuscript night skies — set in the vernacular of a tournament HUD. Formal
enough for wallets, moderation, and administration; expressive enough for brackets
and prize settlement. Dark and light are both first-class.

## Token architecture

All colour, type, spacing, radius, elevation, motion, and z-index live in
`src/styles/tokens.css` as semantic CSS custom properties. **Components reference
tokens only — never raw colours.** Redesigns happen at the token layer and propagate
to every view.

- `src/styles/tokens.css` — the tokens + light/dark themes (`:root[data-theme]`).
- `src/styles/base.css` — element base, typography, focus, the `.btn` system, `.hud`.
- `src/styles/components.css` — shared class primitives (below).

### Themes
`data-theme` on `<html>` selects light/dark; resolution and persistence are in
`src/theme/theme.ts` (`light` / `dark` / `system`, stored under `dragon.theme`).
Theme is applied before mount, so there is no wrong-theme flash.

- **Dark:** layered lapis surfaces (`#070A18` → `#171E46`) — there is blue in every
  step, never neutral grey. Saffron gold (`#FFC24B`) is both the accent and the
  primary fill. Steel-periwinkle hairlines. A gold horizon above the fold and a
  lapis pool below it.
- **Light:** cool paper (`#ECEFF9`) with lapis ink. The bright gold survives as the
  button fill; links drop to bronze (`#7A5200`) so text clears AA. Light mode keeps
  the lapis identity rather than bleaching it out.

Semantic roles never overlap: gold is prize/primary, jade is live, copper is warning
(a distinct hue from gold on purpose), lacquer red is destructive only.

### Contrast
`src/styles/tokens.test.ts` reads `tokens.css` directly and asserts WCAG AA on every
text pair (4.5:1) and non-text pair (3:1) in both themes, including the primary and
danger action-fill pairs. Adjust token values, not the test, if a pair fails.

## Typography
Three roles, all from locally installed faces — the CSP allows `font-src 'self'` and
the bundle ships no font files.

- **Display** (`--font-display`): a condensed technical grotesque — Bahnschrift on
  Windows, Avenir Next Condensed on macOS, Roboto Condensed on Linux. Headings,
  button labels, statistics, card titles. `font-variation-settings: 'wdth'` narrows
  it where the face carries a width axis.
- **Body** (`--font-sans`): the system UI face.
- **Utility** (`--font-mono`): eyebrows, field labels, table column heads, counts,
  dates, IDs, language codes. Uppercase and wide-tracked in Latin.

Persian has no condensed Latin equivalent and cannot take tracking or casing, so
every display/utility treatment carries a `[lang='fa']` reset back to `--font-sans`
at natural spacing and a taller line (`--leading-persian`). Arabic-script glyphs fall
through the stack per glyph, so no per-locale font switch is needed. Statistics,
scores, balances, dates, and standings use `font-variant-numeric: tabular-nums`.

## Shape: the HUD plate
Radii are near-zero. The corner treatment that carries the personality is a
**chamfer on both bottom corners** — mirror-symmetric, so one definition serves RTL
and LTR without a variant. Depth comes from `--hud-cut-sm|md|lg|xl`.

A `clip-path` cuts the border away along the diagonals, so a chamfered plate redraws
those two hairlines with background gradients in `--plate-edge`. A plate that changes
its border colour (an error state, a selected row) overrides that one variable and
both the border and the diagonals follow.

A `clip-path` also clips `outline`, so chamfered controls draw their focus ring with
inset shadows instead (`.btn:focus-visible` in `base.css`). Everything unchamfered
keeps the standard 3px outline.

## The bracket seam
The site's one structural device: a gold elbow that runs into a heading from the
leading edge — the line an elimination bracket draws between two matches. It appears
on `.section-header h2`, along the top of the shell header and footer, on the stat
card, and at full scale as the eight-entrant ladder behind the home hero. It marks
section boundaries and nothing else.

## RTL rules
Logical properties throughout (`margin-inline`, `inset-block-start`,
`border-inline-start`) so one stylesheet serves both directions. Code-like values
(usernames, SKUs, IDs, money) use `.latin-value` (LTR + `unicode-bidi: isolate`) or
`<bdi>`. The two direction-aware exceptions are the hero bracket (mirrored with
`scaleX(-1)`) and the "view all" chevron, which is rotated per direction and so uses
physical borders on purpose.

## Component primitives (`components.css`)
`.btn` (+ `-primary` / `-secondary` / `-neutral` / `-ghost` / `-danger`, with hover /
active / disabled / loading), `.card` / `.card-interactive` / `.data-panel` /
`.stat-card`, `.badge-*`, `.status-pill-*`, `.page-header`, `.section-header`,
`.toolbar`, `.card-grid`, `.stat-grid`, `.eyebrow`, `.hud` / `.hud-lg` / `.hud-xl`.

Primary actions are gold; destructive actions use danger tokens and are never gold.
Secondary is outlined rather than tinted — a gold tint over lapis turns olive.
Disabled is its own appearance (sunken surface, muted label), not a faded fill, since
a dimmed gold reads as a muddy colour rather than an unavailable control. Status is
always carried by a **text label**; colour and the pill's leading bar are
reinforcement, never the only signal.

## Motion
Subtle and purposeful only (button press, dialog entrance, card hover, nav
disclosure, the featured marquee). One element pulses on the whole site: the champion
node at the end of the hero bracket. All motion is neutralised under
`prefers-reduced-motion: reduce` via zeroed motion tokens plus a global
animation/transition override in `tokens.css`.

## Accessibility
Native semantics first: real `<button>`, `<dialog>` (platform focus trap + restore),
`<table>` with caption/scope, labelled inputs with associated errors. Visible focus
ring (`--color-focus`, 3px, AA non-text). Skip link and route-change focus preserved
in the shell. Minimum 2.75rem touch targets. The home banner is deliberately not one
giant link — the title and the action are the two targets — so a screen reader is not
made to read the whole summary as link text. Verified in both themes and both locales.
