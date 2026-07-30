# Content and media authoring guide

How an editor takes an article, guide or game from nothing to public, and how images are
uploaded, described and published — satisfying DOC-015.

This is the authoring workflow as implemented. [DEMO_DATA.md](DEMO_DATA.md) describes seeded
demo records, which is a different thing: it tells you what exists in a demo database, not how
to author.

## Who may do what

Two distinct permissions, deliberately separated so writing and publishing are not the same
authority ([apps/api/src/shared/authz/permissions.ts](apps/api/src/shared/authz/permissions.ts)):

| Permission | Allows |
|---|---|
| `content.write` | Create and edit drafts, submit for review |
| `content.publish` | Reach or leave the **public** state — publish and archive |

The `content_publisher` role holds both. A writer with only `content.write` can move a draft to
review but **cannot** publish it — enforced server-side by `requiresPublishPermission(to)`,
which returns true for `published` and `archived`.

Hiding a control in the UI is never the boundary; every route re-checks the permission
(section 9.4).

## Content lifecycle

`CONTENT_STATES` = `draft` → `in_review` → `published` → `archived`
([modules/content/state.ts](apps/api/src/modules/content/state.ts)).

Permitted transitions are explicit, and nothing else is allowed:

| From | May move to |
|---|---|
| `draft` | `in_review` |
| `in_review` | `draft`, `published` |
| `published` | `draft`, `archived` |
| `archived` | `draft` |

Consequences worth knowing before authoring:

- **You cannot publish straight from `draft`.** Review is a required step.
- **Unpublishing is `published` → `draft`**, which removes it from public reads immediately.
- **`archived` is not deletion.** An archived item is recoverable to `draft`; the record and its
  revisions remain.
- A draft is **never publicly reachable** — asserted in the browser suite
  (`content.spec.ts`, "a draft is never publicly reachable").

### Authoring routes

| Step | Route |
|---|---|
| List / search drafts | `GET /api/v1/admin/content` |
| Create | `POST /api/v1/admin/content` |
| Read one | `GET /api/v1/admin/content/:id` |
| Edit | `PUT /api/v1/admin/content/:id` |
| Change state | `POST /api/v1/admin/content/:id/transition` |
| Revision history | `GET /api/v1/admin/content/:id/revisions` |
| Taxonomy | `GET`/`POST /api/v1/admin/content-taxonomy/categories`, `.../tags` |

Public reads: `GET /api/v1/content` (paged list, filterable by type) and
`GET /api/v1/content/:type/:slug`. Public taxonomy: `GET /api/v1/content-taxonomy/categories`,
`.../tags`.

The admin surface is `/{locale}/admin/content` and `/{locale}/admin/games`.

### Both locales are part of the record

Content carries a translation object per supported locale. Publication completeness is
validated, so an item cannot go public with a locale missing the fields its type requires —
this is why adding a locale is a content decision as well as a code change (see
[LOCALIZATION_GUIDE.md](LOCALIZATION_GUIDE.md), "Adding a locale", step 7).

Write plain text and structured fields; the rich-text path sanitizes markup server-side
(`sanitize-html`). Never author raw HTML expecting it to survive verbatim.

### Scheduled publication

The publish transition accepts an optional **`publishAt`** (`date-time`) on
`POST /api/v1/admin/content/:id/transition`
([content/routes.ts](apps/api/src/modules/content/routes.ts),
[content/service.ts](apps/api/src/modules/content/service.ts)):

- omit it and the item publishes now (`publishedAt` = now);
- give a **future** timestamp and the item enters `published` with that `publishedAt`, and
  `scheduledFor` records the schedule.

**The visibility rule is what makes this safe.** Every public read filters
`{ state: 'published', publishedAt: { $lte: now } }`, so a future-dated item is genuinely
invisible until its time arrives — there is no background job that flips a flag, and therefore
no window in which a scheduled item leaks because a scheduler did not run. Covered by
`content.itest.ts` ("a scheduled (future) publish is not visible yet").

Two consequences worth knowing:

- The item **is** in `published` state immediately, so the admin list shows it as published with
  a `scheduledFor` value. It is scheduled, not pending review.
- A past `publishAt` back-dates the item, which changes its position in the public list —
  ordering is `publishedAt` descending.

### Revisions

Every edit records a revision, readable at `.../revisions`. Revisions are additive history —
they are not a rollback mechanism, and there is no "restore this revision" operation.

## Games

Games are authored on the same pattern with their own lifecycle and a publish transition:
`POST /api/v1/admin/games`, then `POST /api/v1/admin/games/:id/status` with
`{ status: 'published', reason }`. A **reason is required** on the status change and is audited.

Public reads: `GET /api/v1/games` (paged) and `GET /api/v1/games/:slug`. A game must be
published before a team or tournament may reference it.

## Media

[modules/media](apps/api/src/modules/media) (MEDIA-001..010/015). The rules that matter to an
author:

### Uploads are validated by their bytes

`POST /api/v1/admin/media` takes **base64** bytes plus localized `alt`. The service:

1. bounds the work **before** decoding — a base64 string longer than the size cap is rejected
   without allocating, since base64 expands bytes by ~4/3;
2. rejects non-base64, empty, and over-cap uploads (`mediaMaxBytes`, default 5 MB,
   configurable);
3. detects the image type from the **magic-byte signature** (`detectImageType`) — never from a
   filename or a client-supplied MIME type (MEDIA-002);
4. computes the SHA-256 of the bytes, which is the **content address** (MEDIA-007) and also
   **deduplicates identical uploads**;
5. stores the bytes through the storage adapter and records the asset as `staged`.

Accepted types are the image signatures `detectImageType` recognizes (PNG, JPEG, WEBP — the
same set the picker advertises). An unrecognized signature is refused whatever the file is
named.

### Staged until explicitly published

`MediaState` = `staged` | `published` | `failed`.

**A `staged` asset is nonpublic and is not served** (MEDIA-003). Only `published` bytes are
served, at `GET /media/:id` on the site root — content-addressed, so responses are safely
cacheable and immutable.

| Step | Route |
|---|---|
| Upload (staged) | `POST /api/v1/admin/media` |
| List / inspect | `GET /api/v1/admin/media`, `GET /api/v1/admin/media/:id` |
| Publish | `POST /api/v1/admin/media/:id/publish` with `expectedVersion` |
| Set localized alt | `POST /api/v1/admin/media/:id/alt` with `expectedVersion` |
| Delete | `DELETE /api/v1/admin/media/:id` — **only an unreferenced asset** |

`expectedVersion` makes publish and alt-text edits optimistically concurrent: a stale version is
refused rather than silently overwriting someone else's change.

### Alternative text is required, and empty means decorative

`alt` is localized (`{ fa, en }`), MEDIA-009. **An empty string is meaningful**: it marks the
image as decorative (MEDIA-010), which is the correct value for a purely ornamental image and
the wrong value for anything conveying information. Do not fill it with the filename.

### Derivatives

The record retains original ↔ derivative relationships (`derivatives[]`, MEDIA-005), each with
its kind, storage key, content type and byte size. Derivative generation is limited to what the
media service produces today; the field exists so a rendition is always traceable to its
original.

## Referencing an image from content

Content and games reference a cover image **by validated URL** — a site path or `https` — not
by an embedded upload (DECISIONS.md, 2026-07-22). Publish the asset first, then reference its
served path. A reference to a `staged` asset resolves to nothing public.

## Authoring checklist

1. Confirm you hold the permission the step needs (`content.write` to draft, `content.publish`
   to publish).
2. Upload and **publish** any image first; set localized alt text, using `""` only for
   genuinely decorative images.
3. Create the draft with **both locales** filled for the fields the type requires.
4. Attach categories and tags from the taxonomy rather than inventing free text.
5. Submit for review (`draft` → `in_review`).
6. A publisher reviews and publishes (`in_review` → `published`), with a reason where the route
   requires one.
7. Verify the public page in **both locales**, including RTL for `fa`.
8. To withdraw: `published` → `draft` (immediate) or `published` → `archived` (recoverable).

## Limitations

- **No malware or virus scanning** of uploads (SEC-013 is a Partial row). Validation is
  signature-and-size only.
- **No revision restore.** History is readable, not restorable.
- **No content authoring UI beyond the admin console** — no preview environment, no draft
  sharing link.
- **No CDN and no static cache invalidation path** for served media (PERF-009 is Partial; the
  CDN itself is infrastructure, CON-001/INT-005).
- **No legal-document authoring.** `/legal/{document}` and versioned legal documents do not
  exist (PAGE-024, blocked on DEC-043).
- **Deleting a referenced asset is refused**, and there is no "find what references this"
  report to help you before trying.
