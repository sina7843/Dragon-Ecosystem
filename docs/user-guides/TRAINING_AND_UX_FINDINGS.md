# Training and UX findings — DRAGON-30

Everything below was reproduced against the running product in the shipped fail-closed
configuration (`apps/web/playwright.guide.config.ts`), not inferred from reading the source.
Where a finding is a product defect it is recorded as one and left unfixed: this task
documents the platform, it does not change it.

Classification vocabulary, as required by the slice: *training issue, missing permission,
missing prerequisite, feature gate, external provider, open decision, missing approved
content, UX discoverability issue, product defect, documentation defect.*

---

## F-01 — No role-assignment interface anywhere in the product

| Field | Value |
|---|---|
| **Finding** | An authorized administrator cannot assign or revoke an operator role from the product UI. The protected API exists; no screen calls it. |
| **Role** | `platform_administrator`, `super_administrator` (holders of `roles.assign`) |
| **Route** | `/{locale}/admin/users` — and every other administration route |
| **Reproduction** | Sign in as an account holding `roles.assign`; open `/fa/admin/users`; search any account. The screen offers search, masked details, suspend and reactivate. There is no role column, no role list, no assign control. Confirmed statically: `apps/web/src` contains **zero** references to `/admin/users/:id/roles` or `/admin/roles/:assignmentId/revoke`. |
| **Expected behavior** | A holder of `roles.assign` can view an account's roles and grant or revoke one with a reason, as the API already requires. |
| **Actual behavior** | No such control exists. Roles can only be created by the one-time `bootstrap:superadmin` command, by a direct authenticated call to the roles API, or by the development-only `/dev/grant-role` route (fail-closed, never registered in production). |
| **Classification** | **Confirmed product and UX defect** |
| **Impact** | Authorized administrators cannot provision operator roles from the product UI. |
| **Existing backend** | Protected role-assignment API exists: `GET /api/v1/admin/users/:id/roles`, `POST /api/v1/admin/users/:id/roles` (body requires `role` and `reason`), `POST /api/v1/admin/roles/:assignmentId/revoke` — all gated on `roles.assign`, all audited. |
| **Current workaround** | The restricted technical-operator procedure in `THIRD_PARTY_SETUP_FA.md` (§ راهکار موقت). |
| **Recommended remediation** | A minimal, permission-gated role-assignment UI on the existing users screen. |
| **Required permission** | `roles.assign` |
| **Release effect** | Blocks self-service operational onboarding. Does **not** weaken backend authorization — every route remains enforced server-side. |

**This is the root cause of both faults the reader reported.** Neither course creation nor
stream operation is broken; the roles that unlock them cannot be granted through the product.

---

## F-02 — A draft course cannot be published directly

| Field | Value |
|---|---|
| **Finding** | The course lifecycle is `draft → review → published`. Attempting `draft → published` is refused. |
| **Role** | `education_manager` |
| **Route** | `POST /api/v1/admin/courses/:id/state` |
| **Reproduction** | Create a draft course, then request `state: 'published'`. |
| **Expected behavior** | Documented, discoverable lifecycle. |
| **Actual behavior** | **409** `COURSE_TRANSITION_NOT_ALLOWED` — *"A draft course cannot move to published."* Moving to `review` first returns 200, after which publication is evaluated. |
| **Classification** | **Training issue** (the behaviour is correct and deliberate — Requirements § 12.10) |
| **Recommended action** | Documented in chapter 10 and in the troubleshooting flow. No code change. |

---

## F-03 — Course publication prerequisites are only discoverable by failing

| Field | Value |
|---|---|
| **Finding** | The full prerequisite list is returned only when publication is attempted and refused. |
| **Role** | `education_manager` |
| **Route** | `POST /api/v1/admin/courses/:id/state` with `state: 'published'` from `review` |
| **Reproduction** | Publish a course that has titles but nothing else. |
| **Actual behavior** | **422** `VALIDATION_FAILED` listing, per field: `translations.fa.summary`, `translations.en.summary`, `coachId` (*"Assign a coach who owns this course"*), `lessons` (*"Add at least one lesson"*), `lessons.required` (at least one lesson counting toward completion). A coach must additionally be **approved** (`POST /admin/coaches/:id/approval`) or publication fails with `COACH_NOT_APPROVED`. |
| **Classification** | **Missing prerequisite** + **UX discoverability issue** |
| **Recommended action** | Documented as a checklist in chapter 10. A pre-publication readiness panel would remove the guesswork, but that is a product change and is out of scope here. |

---

## F-04 — Live streaming runs against a deterministic stub, not a provider

| Field | Value |
|---|---|
| **Finding** | An authorized operator *can* create, schedule and provision a stream record. What they cannot do is broadcast. |
| **Role** | `streaming_operator` |
| **Route** | `/{locale}/admin/streams`, `GET /api/v1/admin/streams/config` |
| **Reproduction** | With `stream.manage`, create a stream (**201**) and provision it (**200**). Then read the config endpoint. |
| **Actual behavior** | The server reports `{"provider":"stub","rightsPolicyApproved":false,"playbackTtlSeconds":300}`. The provider is hard-coded to `stub` in `apps/api/src/config.ts`; `STREAMING_PROVIDER=arvan` is **explicitly rejected** at startup. |
| **Classification** | **External provider** + **open decision** (OD-013 provider integration, OD-014 rights, archive, retention and takedown) |
| **Recommended action** | Chapter 12 states plainly that this is a simulation. No reader is told they can start a real broadcast. |

---

## F-05 — Administration areas are discoverable only from two places

| Field | Value |
|---|---|
| **Finding** | Operator consoles appear as cards on `/{locale}/account` and `/{locale}/admin` only. The global navigation for the `admin` shell contains just *dashboard* and *home*. |
| **Route** | `apps/web/src/components/AppShell.vue`, `apps/web/src/composables/useAdminAreas.ts` |
| **Actual behavior** | An operator who navigates away from the dashboard has no persistent path back to a sibling console. |
| **Classification** | **UX discoverability issue** |
| **Recommended action** | Documented in chapter 4 and chapter 19. Not a defect: the cards are generated from the server's effective permissions and the boundary is enforced server-side regardless. |

---

## F-06 — `TRUSTED_PROXIES` is read by configuration but absent from `.env.example`

| Field | Value |
|---|---|
| **Finding** | The configuration loader reads `TRUSTED_PROXIES`; `.env.example` does not mention it. |
| **Route** | `apps/api/src/config.ts` |
| **Classification** | **Documentation defect** |
| **Release effect** | This variable scopes proxy trust, which is what makes per-IP rate limiting correct behind nginx. Its absence from the example file makes a production misconfiguration easy and silent. |
| **Recommended action** | Add it to `.env.example` with a safe default and a comment. Recorded here; not changed by this task, which is barred from editing product configuration. |

---

## F-07 — The automated-test environment does not match the shipped defaults

| Field | Value |
|---|---|
| **Finding** | `apps/web/playwright.config.ts` forces `PAID_TOURNAMENTS_ENABLED=true` and `PAID_COURSES_ENABLED=true`. |
| **Classification** | **Documentation defect** (risk to this manual, not to the product) |
| **Impact on this package** | Screenshots captured in that environment would show paid controls that a reader following `.env.example` does not have. |
| **Action taken** | The manual's capture harness runs its own configuration with the shipped fail-closed defaults, and asserts `paidCoursesEnabled === false`, `provider === 'stub'` and `rightsPolicyApproved === false` before capturing the corresponding figures. |

---

## Not findings

Recorded so a later reader does not re-investigate them:

- **Typing an administration URL directly is not a bypass.** The page loads and renders a
  forbidden state; the API refuses independently with **403**. Confirmed for
  `/admin/users`, `/admin/finance`, `/admin/store`, `/admin/operations`, `/admin/courses`,
  `/admin/streams`.
- **A missing navigation card is not a bug.** Cards are generated from the server's
  effective-permission probe. Absence normally means the permission is absent.
- **Course creation itself has no required fields.** `POST /admin/courses` returns **201**
  with a `draft`. The friction is role acquisition, the review step, and the coach.

---

## Proposed follow-up slice (not implemented here)

See the completion report for the exact scope of the separate role-management UI slice.
Nothing in this package implements it.
