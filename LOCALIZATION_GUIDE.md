# Localization and RTL guide

How Persian/English and RTL/LTR actually work in this repository, and the exact sequence for
adding a locale — satisfying DOC-013 (localization and RTL guide) and DOC-014 (instructions
for adding a new locale, the [final section](#adding-a-locale)).

This describes current behavior. Where something is not implemented it says so.

## Policy

| Rule | Value | Source |
|---|---|---|
| Supported locales | `fa`, `en` | `SUPPORTED_LOCALES` in [apps/web/src/i18n/locale.ts](apps/web/src/i18n/locale.ts); mirrored by `SUPPORTED_LOCALES` in [apps/api/src/server.ts](apps/api/src/server.ts) and published at `GET /api/v1/meta` |
| Fallback locale | `fa` (I18N-003) | `DEFAULT_LOCALE` |
| Direction | `fa` → `rtl`, `en` → `ltr` (section 17.5) | `LOCALE_DIRECTION` |
| Intl tags | `fa` → `fa-IR`, `en` → `en-US` | `INTL_LOCALE` in [i18n/format.ts](apps/web/src/i18n/format.ts) |
| Anonymous preference key | `dragon.locale` in `localStorage` (I18N-006) | `LOCALE_STORAGE_KEY` |

Both bundles currently hold **1,497 keys each**, and `locales.test.ts` asserts the two key
sets are identical, that no value is empty or a raw key, that Persian values are not copied
English placeholders, and that every literal `t()` key used in the app exists in both files.

## Locale resolution

`detectLocale(stored, preferred)` ([locale.ts](apps/web/src/i18n/locale.ts)) resolves in this
order:

1. a stored preference, if it is a supported locale;
2. the first browser preference whose **base** language is supported (`en-GB` → `en`);
3. `fa`.

The URL is authoritative for the rendered locale. Every route is prefixed
`/:locale(fa|en)` ([router.ts](apps/web/src/router.ts)) and `/` redirects to
`/${activeLocale()}`, so a direct refresh or a shared link always renders the locale in the
link rather than the last stored preference (TEST-017).

`applyDocumentLocale(locale)` sets `document.documentElement.lang` and `.dir`. This is the
single place direction reaches the document; nothing else writes `dir`.

## Missing keys must never reach the UI

`createI18n` is configured with a `missing` handler ([i18n/index.ts](apps/web/src/i18n/index.ts))
that logs `console.error` and returns an **empty string**. A raw key never renders (I18N-009).
Two independent guards back this:

- `locales.test.ts` — every literal `t()` key resolves in every locale;
- the browser suite — most specs assert page text against
  `RAW_KEY_PATTERN = /\b[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*\.[a-zA-Z]+\b/`, so a dotted token
  appearing on screen fails the run.

Both bundles ship in the entry chunk. Per-locale lazy loading was tried in DRAGON-18 and
reverted: it deferred the mount until the bundle arrived, leaving the skip link and every
keyboard entry point absent while the page was unmounted. The entry budget is held down by
route-level splitting instead. Doing it properly needs the messages inlined into the document
or served per locale at the edge — not a client-side fetch in front of the mount.

## RTL and bidirectional text

### CSS uses logical properties, not mirroring

There is no RTL stylesheet, no `dir`-specific override file, and no flip step in the build.
Layout is written in logical properties — `inline-start`/`inline-end`,
`margin-inline`/`padding-inline`, `inset-inline-*`, `block-start`/`block-end` — used in
roughly 280 places across `styles/`, `components/` and `views/`. Direction on the root
element is all that changes; the browser resolves the rest.

**Rule for new CSS: never use `left`, `right`, `margin-left`, `padding-right`, or
`text-align: left|right`.** Use `start`/`end` equivalents. A physical property is a bug in
this codebase, not a style preference.

### Direction of content, not just chrome

Three mechanisms handle text whose direction differs from the page:

| Mechanism | Where | Purpose |
|---|---|---|
| `dir="auto"` | rendered post bodies, chat messages, composer inputs | A Persian post inside the English feed keeps its own base direction, and the reverse (SOCIAL-004, CHAT-007) — asserted in `community.spec.ts` by reading `getComputedStyle(...).direction` |
| `isolate(value)` | [i18n/format.ts](apps/web/src/i18n/format.ts) | Wraps a value in a Unicode first-strong isolate (U+2068 … U+2069) so a code-like or Latin value cannot reorder the Persian sentence around it |
| `.latin-value` | [styles/base.css](apps/web/src/styles/base.css) | Forces `direction: ltr` for values that are always Latin — usernames, SKUs, slugs, identifiers — so they read correctly inside RTL text |

Use `<bdi>` or `.latin-value` for any user-supplied Latin token rendered inside Persian
prose. Interpolating a bare username into a Persian sentence reorders the punctuation.

### Numbers, dates and money

Everything goes through [i18n/format.ts](apps/web/src/i18n/format.ts); nothing calls `Intl`
directly in a view:

- `formatNumber` / `formatDate` / `formatDateTime` / `formatRelativeTime` take an explicit
  locale, so Persian renders Persian digits and Persian month names without changing the
  stored value.
- Times are stored **UTC** and displayed in the viewer's zone (`viewerTimeZone()`, DEC-005).
- `normalizeDigits` converts Persian and Arabic-Indic digits to ASCII on the way **in**, so a
  user typing a mobile number with Persian digits is accepted. The API does the same
  server-side (`normalizeIranianMobile`), which is the authority.
- Money: rial is the stored unit, Toman is the user-facing convention
  (`RIAL_PER_TOMAN = 10`, `rialToTomanParts`, `formatTomanValue`). No helper labels a value,
  so a rial amount cannot be displayed as if it were Toman. The authoritative Money contract
  is [apps/api/src/shared/money.ts](apps/api/src/shared/money.ts); the web copy is a
  display-side mirror and is marked as such.

### Server messages are not localized

The API returns stable machine-readable codes, and the web app maps them to localized text
(`useApiErrors`, Requirements section 13.1). **Never render a server `message` field to a
user** — map its `code`. This is why adding a locale requires no API change.

## Testing localization

| Check | Command |
|---|---|
| Key parity, no empty values, no raw keys, every `t()` key resolves | `npm test` (`locales.test.ts`) |
| Formatting, digits, isolates, Toman conversion | `npm test` (`format.test.ts`) |
| Locale policy and fallback | `npm test` (`locale.test.ts`) |
| Direction, per-content direction, no raw keys on screen, 320px floor | `npm run e2e` — every viewport project runs both locales |

## Adding a locale

The steps below are the complete sequence. `xx` is the new BCP 47 base tag.

1. **Decide direction and Intl tag.** You need the base tag (`xx`), its direction, and the
   regional Intl tag (`xx-YY`).

2. **[apps/web/src/i18n/locale.ts](apps/web/src/i18n/locale.ts)** — add `'xx'` to
   `SUPPORTED_LOCALES` and an entry to `LOCALE_DIRECTION`. Leave `DEFAULT_LOCALE` as `fa`
   unless a decision changes the fallback; I18N-003 fixes it at Persian today.

3. **[apps/web/src/i18n/format.ts](apps/web/src/i18n/format.ts)** — add the `INTL_LOCALE`
   entry (`xx: 'xx-YY'`). `Record<Locale, string>` makes this a type error until you do, so
   `npm run typecheck` will catch an omission.

4. **`apps/web/src/i18n/locales/xx.json`** — copy `en.json` and translate. All 1,497 keys are
   required: `locales.test.ts` fails on a missing or empty key, and on a value left identical
   to the English placeholder. Do not add keys to one file only.

5. **[apps/web/src/i18n/index.ts](apps/web/src/i18n/index.ts)** — import the bundle and add it
   to `messages`. Note this grows the entry chunk; check the budget (step 9).

6. **[apps/web/src/router.ts](apps/web/src/router.ts)** — extend **every** path matcher from
   `/:locale(fa|en)` to `/:locale(fa|en|xx)`. The matcher is repeated per route, so this is a
   mechanical find-and-replace across the file; a missed route 404s only in the new locale.

7. **[apps/api/src/server.ts](apps/api/src/server.ts)** — add `'xx'` to the API's
   `SUPPORTED_LOCALES`. This is what `GET /api/v1/meta` publishes and what request-level
   locale validation accepts. Content, games, tournaments, courses and store products carry
   per-locale translation objects keyed by this union, so **existing records will have no `xx`
   translation**: decide whether authoring requires it (a validation change) or falls back,
   and record that decision.

8. **Notification templates** — `notification_templates` records hold `locales` keyed by
   locale ([modules/notifications/service.ts](apps/api/src/modules/notifications/service.ts)).
   Existing approved templates have no `xx` entry, and a delivery with no localized template
   is recorded `suppressed`. New template versions must be authored and approved for `xx`.

9. **Verify.**
   ```
   npm run typecheck        # catches missing Record<Locale, …> entries
   npm test                 # locales.test.ts key parity and value checks
   npm run test:budget      # the entry chunk grew by one bundle
   npm run e2e              # add the locale to the specs that loop over ['fa','en']
   ```

10. **If the locale is RTL**, no CSS change should be needed — that is the point of the
    logical-property rule. Verify at the 320px floor in the browser suite rather than
    assuming it.

### Not covered by these steps

- **Seeded and demo content** ([DEMO_DATA.md](DEMO_DATA.md)) is authored in `fa`/`en` only.
- **Legal documents** have no versioned store at all (PAGE-024, blocked on DEC-043), so there
  is nothing to translate yet.
- **Locale persistence for signed-in accounts** is a profile field; a locale removed from
  `SUPPORTED_LOCALES` would leave stored values orphaned. Removing a locale is not covered
  here and has no migration.
