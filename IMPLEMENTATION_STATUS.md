# Implementation Status

## Current state
- Repository foundation: complete (DRAGON-00)
- Data and contract foundation: complete (DRAGON-01)
- Design system, shell, and localization: complete (DRAGON-02)
- Identity, sessions, and profiles: complete (DRAGON-03)
- Authorization, administration, audit, configuration: complete (DRAGON-04)
- Content CMS and game catalog: complete (DRAGON-05)
- Persistent teams and gaming identities: complete (DRAGON-06)
- Tournament authoring and discovery: complete (DRAGON-07)
- Registration, eligibility, approval, and waitlist: complete (DRAGON-08) — implemented and verified, not yet committed
- Competition core (single-elimination + round-robin): complete (DRAGON-09a) — implemented and verified, not yet committed
- Advanced competition formats (double elimination, Swiss, manual/custom): complete (DRAGON-09b) — implemented and verified, not yet committed
- Standings, corrections, locking, concurrency, and presentation: complete (DRAGON-09c) — completes DRAGON-09; implemented and verified, not yet committed
- Bracket versioning/regeneration/rollback, operator console, and public bracket presentation: complete (DRAGON-10) — implemented and verified, not yet committed
- Ledger core and invariants: complete (DRAGON-11a) — immutable double-entry ledger foundation; implemented and verified, not yet committed
- Mock Toman purchase and exactly-once Dragon Coin crediting: complete (DRAGON-11b) — implemented and verified, not yet committed
- Holds, releases, expiry, and gated transfer boundaries: complete (DRAGON-11c) — implemented and verified, not yet committed. **Parent DRAGON-11 is complete** (11a + 11b + 11c)
- Paid tournament checkout and prize entitlements: complete (DRAGON-12) — implemented and verified, not yet committed (paid checkout stays OD-007-gated off by default)
- Paid checkout + prize entitlements: complete (DRAGON-12) — implemented and verified, not yet committed
- Notifications (in-app inbox, templates, preferences, gated SMS/email, retry/dead-letter): complete (DRAGON-13) — implemented and verified, not yet committed
- Moderation/support/recovery, consent-aware analytics, bounded jobs runner, alerts/metrics/health: complete (DRAGON-14) — implemented and verified, not yet committed (external analytics stays OD-026-gated off; recovery is triage-only under OD-029)
- Media pipeline, public search/filters, and SEO (robots/sitemap/structured data): complete (DRAGON-15) — implemented and verified, not yet committed
- Accessibility + bilingual UX hardening (shared primitives, keyboard/focus, contrast, RTL/LTR, live states): complete (DRAGON-16a) — implemented and verified, not yet committed
- Security hardening (CSRF origin guard, CSP/HSTS/Permissions-Policy, no-store, pseudonym-salt secret): complete (DRAGON-16b) — implemented and verified, not yet committed
- Performance + delivery hardening (media 304, public-directory + job-status indexes, content-list projection, frontend fetch-once/stale-guard, bundle budget): complete (DRAGON-16c) — implemented and verified, not yet committed. **Parent DRAGON-16 is now complete** (16a + 16b + 16c all done)
- Requirement/decision closure (traceability reconciliation, deterministic integrity + full Phase-1 coverage): complete (DRAGON-17a) — reconciled, verified, and committed (`09b1af5`)
- Phase 1 release-candidate verification and release evidence: complete (DRAGON-17b) — committed (`45272f1`, doc-only on top of `09b1af5`)
- Phase 1 release decision and acceptance closure: DRAGON-17c **implementation complete — decision recorded in `RELEASE_DECISION.md`: GO WITH CONDITIONS for the local/test RC at `09b1af5`; production NOT authorized; final Phase 1 acceptance withheld; awaiting authorized human sign-off** — not committed
- Phase 2 stream catalog and provider adapter boundary: complete (DRAGON-18) — committed (`9a2873a`)
- Phase 2 moderated live chat and release closure: complete (DRAGON-19) — committed (`9a2873a`). **Phase 2 release decision: NO-GO** (`RELEASE_DECISION_PHASE2.md`), blocked by OD-013 + OD-014 + INT-004; no implementation failure outstanding
- Phase 3 courses, enrolment, and progress: complete (DRAGON-20) — committed (`c9cc9ec`)
- Phase 3 education release closure: complete (DRAGON-21) — implemented and verified, not yet committed. **Phase 3 release decision: NO-GO** (`RELEASE_DECISION_PHASE3.md`), blocked by OD-015 + OD-016; no implementation failure outstanding
- Phase 4 community and advanced team roles: complete (DRAGON-22) — committed (`c1cdd9a`)
- Phase 4 community release closure: complete (DRAGON-23) — implemented and verified, not yet committed. **Phase 4 release decision: NO-GO** (`RELEASE_DECISION_PHASE4.md`), blocked by OD-017 + OD-024 + OD-027; no implementation failure outstanding
- Phase 5 store catalog, inventory, and fulfillment: complete (DRAGON-24) — implemented and verified, not yet committed
- Phase 5 economy, rewards, peer transfer, and payouts: complete (DRAGON-25) — implemented and verified, not yet committed
- Phase 5 commerce and economy release closure: complete (DRAGON-26) — implemented and verified, not yet committed. **Phase 5 release decision: NO-GO** (`RELEASE_DECISION_PHASE5.md`), blocked by OD-019 + OD-020 + OD-030; no implementation failure outstanding
- Whole-ecosystem audit and release evidence: complete (DRAGON-27a, 27b, 27c). **Final ecosystem verdict: NO-GO** (`RELEASE_DECISION_ECOSYSTEM.md`). Implementation completeness and release approval are separate: the code is largely built and tested; the release is blocked by ten open external decisions, four standing phase NO-GOs, an unauthorized Phase 1 production deployment, and missing human sign-off
- Release remediation and evidence closure: partial (DRAGON-28) — five engineering gaps closed, four remediation items not attempted and named as such. **Ecosystem verdict unchanged: NO-GO**
- Browser E2E stabilization: complete (DRAGON-29A) — the browser-suite instability DRAGON-28 opened with no established cause is diagnosed and closed; test-only fixes and harness configuration, no product change. Committed (`caf9c34`). **Ecosystem verdict unchanged: NO-GO**
- Production-grade CI pipeline: complete (DRAGON-29B) — `.github/workflows/ci.yml` + `CI.md`; the repository had no CI configuration at all. **Never executed (no Git remote) and branch protection not activated: CI implementation complete, repository administrator activation pending.** **Ecosystem verdict unchanged: NO-GO**
- First remote CI failure remediation: complete (DRAGON-29B.1) — three failed jobs diagnosed and fixed, including two real product defects and one high-severity shipped dependency advisory. **A second remote run is required to confirm; no green run exists yet.** **Ecosystem verdict unchanged: NO-GO**
- Performance-evidence integration: complete (DRAGON-29B.2) — `apps/api/src/perf/perf.itest.ts` audited, hardened, and made commit-ready, so the release documents no longer cite a file absent from Git and CI. **Ecosystem verdict unchanged: NO-GO**
- Active prompt: DRAGON-29B.2 (commit and validate performance evidence); **parent DRAGON-17 remains open pending authorized human sign-off, and the Phase 2, Phase 3, and Phase 4 releases are each blocked by unresolved external decisions**
- Latest verified checkpoint: DRAGON-23 Phase 4 closure, 2026-07-29

## DRAGON-29B.2 — Commit and validate performance evidence

**The problem was a documentation-integrity one, not a testing one.** `RELEASE_DECISION_ECOSYSTEM.md`
carried a full measurement table, and PERF-004 and PERF-014 cited `apps/api/src/perf/perf.itest.ts`
as evidence — for a file that had **never been committed**. Nothing in CI ran it, nobody
cloning the repository had it, and the eight-test gap between the local integration count
(501) and the remote one (493) was exactly this file. Evidence that exists on one machine is
not evidence.

**Audited by content, not by history**, since a never-committed file has no history to appeal
to. One source file, 489 lines. No generated benchmark output, no results file, no logs, no
database dumps, no secrets, no machine-specific paths, no timestamps written anywhere —
`report()` goes to stdout and nothing touches disk. It follows the existing integration
convention (`*.itest.ts`, `node:test`, `createTestDatabase`), which is why
`npm run test:integration` already discovered it locally. `tsconfig.build.json` excludes
`src/**/*.itest.ts`, so committing it puts no test code in the production image — verified:
`apps/api/dist/perf` does not exist after a build. **Verdict: suitable for source control,
retained in full. No test was removed or weakened.**

**Safety and isolation verified.** `createTestDatabase()` gives every run its own
`dragon_test_<uuid>` on the disposable `docker-compose.test.yml` replica set, dropped by
`dispose()`; no production or developer database is reachable. Datasets are bounded (301 rows,
8–24 concurrent operations); every account, username, SKU, business reference and idempotency
key is derived from a monotonic counter, so nothing is reused and nothing collides with the
other integration files, which each hold their own database. Scenario E reads counts that
scenario D seeded, but its assertion does not depend on them, so there is no ordering
requirement. The full suite was not serialised.

**No latency is asserted anywhere.** This was the property to confirm before committing,
because a timing assertion would have made a slower GitHub runner fail the job. Every one of
the eight tests asserts a correctness invariant and only reports timing:

| Scenario | Invariant asserted |
|---|---|
| A1/A2 one key, cold and open window | value moves exactly once; exactly one ledger transaction for the key; losers get 409, not an error |
| A3/A4 distinct keys, cold and open window | all 8 accepted and each moved its own amount — the DRAGON-28 cold-window defect surfaces here |
| B rolling-window claims | 24 claims against a budget of 20 admit ≤20, and the stored counter equals what was admitted, so every refusal was compensated |
| C store last-unit contention | exactly one winner, stock floors at 0, exactly one order line for the contested variant |
| D stale-reservation scan | findings within the configured bound, stale rows actually detected, and the query is `IXSCAN`, not `COLLSCAN` |
| E store reconciliation | an authorized operator gets 200 on all ten sequential reads |

The plan assertion in D was checked for meaningfulness rather than taken on trust: it
reproduces the detector's real query shape exactly — both registered recovery sources use
`pendingStates: ['pending_payment']`, so the single-element `$in`, the `$lt` on `createdAt`,
the ascending sort and the bounded limit all match `findStale`. A simplified reproduction
could have passed while the real query did a collection scan; this one cannot.

**Two hygiene fixes.** The run banner printed `MONGODB_TEST_URI`, which may legitimately carry
credentials and is written to a CI log — it now prints host and port only, userinfo stripped.
And `buildApp` assigns the shared `ledger` handle on both calls; both apps are wired to the
same database so the two services are two handles on one set of balances, which is now stated
instead of left looking like a bug.

**`npm run test:performance` added** as a bounded focused entry point for exactly the
repetition this slice needed. It does **not** remove the tests from `test:integration`; they
run in both, and CI runs the integration job unchanged.

**CI compatibility — no workflow change was needed.** The file needs Node ≥22.18 (satisfied by
the pinned 22.23.1), the `mongo:8.0` replica set the integration job already starts, and
nothing else: `MONGODB_TEST_URI` has a default, there is no Windows-specific path, no
local-only variable, and no dependency on `docker-compose.yml`. The workflow hard-codes no
test count, so the integration job simply reports 501 instead of 493. The green pipeline was
left alone.

**Verification:**

| Command | Result | Exit |
|---|---|---|
| `npm run typecheck` | pass | 0 |
| `npm run lint` | 0 errors, 60 pre-existing warnings | 0 |
| `npm test` | 451 passed, 0 failed (api 405, web 46) | 0 |
| `npm run test:integration` | **501 passed**, 0 failed, 0 skipped, 25.3 s | 0 |
| `npm run test:performance` | **8 passed**, 0 failed, 4.3 s | 0 |
| `npm run test:performance` ×5 (determinism) | 8/8 passed every run; `IXSCAN` every run | 0 |
| `npm run build` / `npm run test:budget` | pass / 1 passed | 0 / 0 |
| `npm run closure:check` / `decision:check` | 14/14 / 12/12 | 0 / 0 |
| `npm run ci:validate` | 11 checks passed | 0 |

The E2E suite and Docker persistence were **not** re-run: no product, browser, or storage
behaviour changed in this slice.

**Documentation corrected, no claim strengthened.** The statements that the directory was
untracked and absent from CI are now false and were fixed; PROJECT_STATUS's "five contention
scenarios" is now "five scenario groups totalling eight tests". The classification is stated
explicitly: timing figures **measured locally** on the named machine, invariants
**structurally verified in CI**, production-scale load **not measured**, PERF-014/OPS-014
**blocked by external decisions**. Every required limitation is preserved verbatim —
`app.inject` excludes network, TLS and proxy so the latencies are a floor; 8–24 operations is
contention, not load; hundreds of rows do not meet the DEC-046 scale baseline; none of it is
production SLO evidence. PERF-004 stays *Implemented* and PERF-001/002/003/014 and OPS-014
stay *Blocked*. **Ecosystem verdict unchanged: NO-GO.**

## DRAGON-29B.1 — First remote CI failure remediation

The pipeline ran. Six jobs passed — `validate`, `static`, `unit`, `build-budget`,
`integration`, `migrations` — and `security`, `persistence`, and `e2e` failed. Every one of
the three was a real problem. No job was redesigned, no retry enabled, no timeout raised, no
assertion weakened, and no `continue-on-error` added.

**`security` — a high-severity advisory in the shipped dependency tree.**
`find-my-way <=9.6.0` (GHSA-c96f-x56v-gq3h, CVSS 3.1 7.5, HTTP/2 denial of service), reached
as `@dragon/api → fastify@5.10.0 → find-my-way@9.6.0`. The patched release is `9.7.0`, and
`fastify@5.10.0` — already the newest 5.x — declares `find-my-way: ^9.6.0`, which `9.7.0`
satisfies. `npm update find-my-way` therefore fixed it as a **three-line lockfile change**:
no manifest edit, no Fastify bump, no API change, no migration. `npm audit --omit=dev
--audit-level=high` now reports **0 vulnerabilities**, with the threshold unchanged and no
exception added. Because this replaces the router in every request path, it was verified
rather than assumed: `server.test.ts` (route registry, versioned-prefix-only, unknown-route
envelope) and all 501 integration tests pass on `9.7.0`.

**`persistence` — my assertion was wrong, not the repository.** It failed in ~14 seconds,
before `verify:persistence` ran, on a step requiring `WEB_PORT=18080` to move the published
host port. That is the behaviour of an **uncommitted** working-tree change to
`docker-compose.yml`; the committed file hardcodes `8080:8080`. CI checked out committed state
and could not satisfy an assertion written against a local modification — the exact failure
mode of letting a job depend on anything but committed state. The step now asserts the
contract the committed file actually makes: web publishes exactly `8080:8080`, and `api` and
`mongo` publish no host port at all. That is stricter about the thing that matters (nginx as
the sole published surface) and it keeps holding if the `WEB_PORT` change is ever committed,
since `${WEB_PORT:-8080}` resolves to 8080 unset. Verified against both the committed file
(extracted with `git show HEAD:docker-compose.yml`) and the modified worktree copy.

**`e2e` — two product defects behind three vacuous assertions.** Eight failures, six of them
the same test. One mechanism explains all of them: `toHaveCount` and `toHaveAttribute` pass on
their **first successful poll**, so an assertion evaluated during a loading window observes
the empty or default state and passes without ever seeing the real result. Locally, fast, they
passed. On a slower runner the first poll landed after the state settled.

*Product defect 1 — the player page could not unfollow after a reload.* `following` was a
local ref defaulting to `false`, never reconciled with the server, and `SocialProfileView`
carried no viewer-follow field at all. So on every load the toggle read "Follow" to someone
already following, and pressing it **followed again**. A forced local trace settled it: the
second click sent `POST /api/v1/follows/user/...` → 201 and there was no `DELETE` anywhere in
the run. The two assertions that should have caught this had been passing for the wrong
reason — `aria-pressed` was still `false` in the window before the POST resolved, and the
"post is gone" check ran against a feed list that had not loaded. Fixed in the product:
`getPublicProfile` now returns `viewerFollows`, which costs one indexed `findOne` on an
endpoint that already received the viewer's id and already queried the follows collection
(served by the existing `follow_follower_state` index), and the view initialises the toggle
from it.

*Product defect 2 — the store operator console rendered for anyone.* `AdminStoreView` decided
`forbidden` from `getStoreConfig()` and `listProducts()` — `/store/config` and `/products`,
the **public storefront's own endpoints**, which answer 200 for everybody. So the gate could
never trip, and the create form, SKU and price fields, and inventory controls rendered in full
for any signed-in user, who could then only watch the server reject each action. The server
was never the hole; the page simply never asked whether it should render. Fixed by probing
`store.manage` through the existing `useAdmin()` capability probe — the mechanism the other
consoles already use.

*Test defect — an auth assertion counted a leftover toast.* Signing in pushes "You are signed
in" and reaches the profile page by client-side navigation, so the toast queue was already
non-empty and `toHaveCount(1)` was satisfied by that message before the save produced
anything. It now asserts the **success** toast, which is what the test always meant. This is a
site DRAGON-29A examined and cleared as safe "because a `goto` precedes it" — there is no
`goto` there, and the reasoning was wrong.

**Both strengthened assertions were proven to have teeth**, by temporarily reinstating each
defect and confirming the test fails: the follow assertion failed with `aria-pressed="false"`
on a "Follow"/"دنبال کردن" button, and the store assertion failed on a missing
`state-forbidden` block. A strengthened assertion that has not been seen to fail is not
evidence.

**`E2E_WORKERS` left at 2.** The remote log shows no contention symptom — no page-setup
timeout, no browser-launch failure — so the eight failures were defects, not saturation, and
lowering it would have been treating the wrong thing. The suite took 12.2 minutes remotely
against ~6 locally, which is runner speed.

**Local verification — every command, exit code recorded:**

| Command | Result | Exit |
|---|---|---|
| `npm audit --omit=dev --audit-level=high` | **0 vulnerabilities** (was 1 high) | 0 |
| `npm run ci:validate` | 11 checks passed | 0 |
| `npm run typecheck` | pass | 0 |
| `npm run lint` | 0 errors, 60 pre-existing warnings | 0 |
| `npm test` | 451 passed, 0 failed (api 405, web 46) | 0 |
| `npm run test:integration` | 501 passed, 0 failed, 0 skipped | 0 |
| `npm run build` / `test:budget` | pass / 1 passed | 0 / 0 |
| `npm run verify:migrations` | 23 checks passed | 0 |
| `npm run verify:persistence` | PASS | 0 |
| `npm run e2e` (`E2E_WORKERS=2`) | 464 passed, 1 skipped, 0 failed | 0 |
| focused: community + store + auth, all 3 projects | 117 passed | 0 |
| `closure:check` / `decision:check` | 14/14 / 12/12 | 0 / 0 |
| workflow structure validation | 10 jobs, `required` covers 9, no problems | 0 |

`npm run e2e` again needed `E2E_WEB_PORT=4400` on this host (WinNAT has reserved 4144-4243,
containing the default 4173) — the documented escape hatch, irrelevant on a Linux runner.

**The `required` job was not touched** and remains correct: `if: always()`, depends on all
nine jobs, passes only on `success`, and allows exactly one skip (`persistence`, on a pull
request only) checked against the event.

**Remote confirmation is still pending.** These fixes are verified locally; the pipeline has
no green run and is not described as fixed.

## DRAGON-29B — Production-grade CI pipeline

**Provider: GitHub Actions, chosen on evidence rather than assumption.** The repository had
no CI configuration of any kind — no `.github/`, no `.gitlab-ci.yml`, no Azure Pipelines, no
`Jenkinsfile` — and `git remote -v` is empty, so the host could not be read from a remote.
The deciding evidence is the repository's own: `REQUIREMENTS_TRACEABILITY.md` names
`.github/workflows` as the specific missing artefact in three rows (SEC-016, SEC-017,
TEST-026), and `Requirements.md` requires linting, type checks, tests, and security scans to
run in CI (§1991, SEC-016, §2106). No second CI platform was added.

**Ten jobs, one required summary.** `validate` → then `static`, `unit`, `integration`,
`build-budget`, `migrations`, `security`, and `persistence` in parallel; `e2e` after
`static`, `unit`, and `build-budget`; `required` over all of them. Stable check names are
`ci / validate`, `ci / static`, `ci / unit`, `ci / integration`, `ci / build-budget`,
`ci / migrations`, `ci / e2e`, `ci / security`, `ci / persistence`, `ci / required`.

Every step invokes a script the repository already owns. There is no CI-only variant of any
check, no relaxed configuration, no raised bundle budget, no enabled retry, and no step that
can pass while the command inside it fails — `ci-validate.mjs` fails the build if any
CI-required npm script grows a `|| true` or `; exit 0`, and the one `continue-on-error` step
in the workflow is the report-only dev-dependency audit, which cannot decide its job.

**`required` cannot go green falsely.** It runs `if: always()` and inspects
`needs.*.result`; anything other than `success` fails it. Exactly one job may be skipped —
`persistence`, and only on a `pull_request`, which is the reason it declares — and the
allowance is checked against the event rather than treating "skipped" as acceptable in
general.

**Least privilege and no secrets.** Workflow-level `permissions: contents: read`, never
raised. The string `secrets.` does not appear in the workflow: the API runs `NODE_ENV=test`
with the deterministic test-only values already committed in `playwright.config.ts`, the
mock payment provider stays fail-closed in production (asserted by `config.test.ts` in
`validate`), no provider credential is needed, and no `.env` is created, read, or uploaded.
An untrusted forked pull request therefore has nothing to reach.

**MongoDB is the repository's own disposable database, not a service container.** It is a
pinned `mongo:8.0` single-node **replica set** — MongoDB only supports transactions on one,
and the ledger, store, and economy suites depend on them, which a service container cannot
provide because it cannot run `rs.initiate`. Data is on `tmpfs`, bound to `127.0.0.1:27018`
only, and readiness comes from polling the container's own healthcheck rather than a sleep.
Three independent guards keep it test-only, and the `e2e` job **proves the reset guard still
works** before running the suite: it points `E2E_MONGODB_URI` at a production-shaped name,
requires a non-zero exit, and requires the refusal message in stderr.

**Two findings the pipeline surfaced rather than hid.**

*First, the toolchain Node floor was wrong.* `engines.node` says `>=22.12.0`, which is
correct for the container — it runs compiled JavaScript. It is not enough for the toolchain:
`npm test` and `npm run migrate` execute TypeScript sources directly, and unflagged type
stripping only arrived in **Node 22.18.0**. A host on 22.12.0 installs cleanly and then
cannot run a single test. `.nvmrc` now carries the toolchain version (`22.23.1`), CI reads it
via `node-version-file`, and `ci:validate` asserts both that `.nvmrc` clears the floor and
that the Node actually running clears it. `engines.node` was deliberately left alone: it is
the packaging contract for an image that does not need type stripping.

*Second, `ci / security` fails on the current lockfile.* `find-my-way <=9.6.0` — GHSA-c96f-x56v-gq3h,
CVSS 7.5, HTTP/2 denial of service — is in the **shipped** dependency tree via Fastify, and
`npm audit --omit=dev --audit-level=high` exits 1 on it. That is the gate working on a
pre-existing problem nothing was checking for before. It was not fixed here: this slice is
barred from applying dependency updates, and a lockfile change is a change to what ships.
The alternative is a formal risk acceptance — the advisory is HTTP/2-specific and the API is
served over HTTP/1.1 behind nginx — which is exactly the judgement SEC-017 reserves for a
named approver the repository does not have. Neither call was invented here.

**Verification — every command run locally, exit codes recorded:**

| Command | Result |
|---|---|
| `npm run ci:validate` | 11 checks passed, exit 0 |
| `npm run typecheck` | pass, exit 0 |
| `npm run lint` | 0 errors, 63 pre-existing warnings, exit 0 |
| `npm test` | 451 passed, 0 failed (api 405, web 46), exit 0 |
| `npm run test:integration` | 501 passed, 0 failed, 0 skipped, exit 0 |
| `npm run build` | pass, exit 0 |
| `npm run test:budget` | 1 passed, exit 0 |
| `npm run closure:check` | 14/14, exit 0 |
| `npm run decision:check` | 12/12, exit 0 |
| `npm run verify:migrations` | 23 checks passed, exit 0 |
| `npm run verify:persistence` | PASS, exit 0 |
| `npm run e2e` | 464 passed, 1 skipped, 0 failed, exit 0 |
| `npm run ci` | exit 0 (the whole non-Docker chain) |
| `npm audit --omit=dev --audit-level=high` | **exit 1** — the live advisory above |

The integration count is 501 locally but would be **493 in CI**: `apps/api/src/perf/` is
untracked, so its eight performance-contention tests do not exist for a fresh clone. That
directory belongs to DRAGON-28 and was deliberately not absorbed here. *(Resolved by
DRAGON-29B.2, which committed the file; both counts are now 501.)*

`npm run e2e` needed `E2E_WEB_PORT=4400` on this host: Windows WinNAT had reserved
4144-4243, which contains the default 4173, and a reserved port fails to bind even with
nothing listening. That is the host escape hatch working as designed and does not apply to a
Linux runner.

**Not verified: the workflow itself.** No Git remote is configured, so it could not be run
remotely. What was checked: the YAML parses, every job has a display name, a pinned
`ubuntu-24.04` runner and a `timeout-minutes`, every `needs` reference resolves, every action
is pinned to a major, no step suppresses failure, and `required` depends on all nine other
jobs. There is no remote CI run to cite and none is claimed.

**The independent review returned REQUEST-CHANGES with one Critical, and it was right.** The
step that proves the E2E database reset still refuses a non-test database ran *before* any
MongoDB was started, and `reset-test-db.mjs` connected before checking the name — so the
script would have died on a 15-second server-selection timeout, the `grep` for the refusal
message would have missed, and the `e2e` job would have failed on every run without ever
reaching the browser suite. A false red, and on a pipeline that has never executed, one that
would have been blamed on the suite rather than the step. Fixed at the root rather than by
reordering the workflow: the guard now reads the database name off the connection string and
refuses **before** it connects, so a refusal can never be confused with a connection failure
and the check works with nothing listening (verified with the test database stopped). Parsing
is by pattern, not `new URL`, which rejects MongoDB's comma-separated multi-host form, and it
fails closed on a string it cannot read a name out of.

Two more gaps closed while acting on the review: the suite had `reporter: 'list'` only, so the
`playwright-report/` the workflow uploads would never have existed — the config now declares
`[['list'], ['html', { open: 'never' }]]` and `playwright-report/` is gitignored; and `CI.md`
now states that `if-no-files-found: warn` means a red `e2e` job does not guarantee an
artifact, because the failure may predate Playwright. The review's other conclusions were
that nothing can produce a false green, nothing can reach a non-test database, the
`find-my-way` advisory and the traceability counts are accurate as stated, and neither the
migration check's existing-database scenario nor any of `ci-validate.mjs`'s eleven checks is
vacuous.

**Traceability.** SEC-016 and SEC-017 moved from `Evidence pending` to `Partial`, each
naming what is still unsatisfied (container-image scanning; a risk-acceptance mechanism and
the live advisory). TEST-026 stays `Partial` with rewritten clauses (never executed, branch
protection inactive, persistence not on pull requests). `Evidence pending` rows: 29 → 27.
`Partial`: 125 → 127. No requirement was marked complete on the strength of a pipeline that
has not run.

## DRAGON-29A — Browser E2E stabilization

**The suite was not flaky in the way it was recorded.** DRAGON-28 left three failures across
17 full-suite runs, in three different specs, "all on small-mobile", cause unestablished.
The viewport was a red herring: small-mobile is simply the first project in `projects[]`, so
it absorbs the start-up contention of a run. One deliberate full parallel reproduction
produced **7 failures spread across all three viewport projects**, and with artifacts
retained they separated into three causes. Diagnosis rested on the retained traces, which
had never existed before: `trace: 'on-first-retry'` was paired with `retries: 0`, so the
suite had been configured to never write one.

**Root cause 1 — a stale toast satisfied the wait (assertion defect).** `teams.spec.ts:58`
failed in all three projects in the same run, which is not what intermittent looks like.
After clicking *send invite* it waited on `expect(getByTestId('toast')).toHaveCount(1)`. The
toast queue is Vue module state; it survives client-side navigation and nothing expires it,
so the *"team created"* toast pushed a few lines earlier already satisfied the count. The
assertion returned immediately and the invitee loaded their page while the invitation was
still being written — the invitations panel was genuinely absent. The same weak wait guarded
the profile save that produces the username being invited, where a rejected save would have
been indistinguishable from an accepted one. Both now wait on the API response itself.

**Root cause 2 — the disposable database was never disposed of (test-data isolation).**
Every spec carried its own copy of `0912` + seven random digits, a 10^7 space, against a
database holding **22,597 accounts and 90 collections** accumulated across runs. At about
800 sign-ins per run that reused an already-existing account roughly twice per run, silently
— a reused number still signs in, and only surfaces later as a username clash, a non-zero
opening balance, or a role the test never granted. Fixed at both ends: one shared generator
pair that is unique by construction (a per-process nonce plus a monotonic counter, neither
truncated into a wrapping range), and a database drop before each `npm run e2e`. The drop
runs in the root script rather than a Playwright global setup, because global setup runs
*after* the web servers are already up and the API rebuilds its schema on boot.

**Root cause 3 — host CPU saturation, not the application.** The remaining failures were the
machine. Two were `Test timeout of 30000ms exceeded while setting up "page"` — Chromium
could not open a page inside thirty seconds. The rest show the application demonstrably
mid-request when the assertion's five-second budget expired; in one trace the API had
answered `202` in 288 ms and the renderer had still not run the continuation five seconds
later, then completed normally a moment after the failure. Playwright's default of one
worker per two cores assumes a worker costs one page, and the multi-actor journeys here (an
owner and an invitee, an author and a moderator, a sender and a recipient) run two or three.
**The worker cap is load-bearing and was proven so rather than assumed:** a control run at
the old worker count, with every other fix already applied, still failed 4 tests — all four
of them the 30-second page-setup timeout. It is also faster, because the machine stops
thrashing: 3.4 minutes clean against 4.3 minutes with failures.

**No global timeout was raised, no sleep added, no assertion weakened, no test disabled, and
no failure marked expected.** No product defect was found behind any of the seven failures
and no product code changed; the one candidate examined and rejected was the wallet's
five sequential refresh requests, which is a latency characteristic, not a defect.

**Evidence — all at exit 0, `retries: 0`:**

| Run | Command | Result |
|---|---|---|
| Full suite, normal settings | `npm run e2e` | 464 passed, 1 skipped, 0 failed |
| Full suite, no database reset | `npx playwright test` | 464 passed, 1 skipped, 0 failed |
| Small-mobile only | `npx playwright test --project=small-mobile` | 155 passed, 0 failed |
| Focused ×3 over the five affected specs | `--repeat-each=3` | 297 passed, 0 failed |

`npm run typecheck` pass · `npm run lint` 0 errors (63 pre-existing warnings) · `npm test`
451 passed (api 405, web 46), 0 failed · `npm run build` pass · `npm run test:budget` pass.

One independent read-only review was run; both findings it raised were real and are fixed —
the mobile generator's counter was truncated at `% 1000` and shared with the suffix
generator, so it wrapped within a worker's lifetime, and `reset-test-db.mjs` had no runtime
check that its target is a test database.

## DRAGON-28 — Release remediation and evidence closure

**The economy concurrency failure was a product defect, not a flaky test.**
`claimTransferWindow`'s fallback assumed the only reason its conditional claim could fail
was an exhausted budget. It can also fail because the window did not exist at that instant
and a racer created it microseconds later — in which case the code returned
`amount_exceeded` without ever checking the budget. Two transfers arriving together on a
sender's first transfer of a period meant one was refused with a misleading "too many
transfers" error. Under load, users would have seen spurious limit refusals. The claim now
retries once against the window a racer just opened, and reports a limit only after
re-reading it. Reproduced at ~1-in-3; **0 failures in 10 bounded runs** afterwards.

Regression coverage was added (two concurrent transfers on a cold window, both far inside
every limit), but honestly: **it does not deterministically fail under the original
defect** — the bug is race-only, and reproducing it reliably would need fault injection.
The dependable signal is bounded repetition, which is what the evidence above rests on.

**A previously reported finding was wrong, and it was my error.** Earlier documents said the
browser suite "intermittently exited non-zero while reporting every test passed". It never
did. Those runs had a real failing test — `moderation.spec.ts` → *"report a tournament …
and a moderator sees it (fa)"* on desktop — and the console filters I used to summarise the
output truncated the failure line. There is no phantom exit code, no `webServer` shutdown
bug, and no npm exit-code propagation problem; the scripts report failure correctly. The
flake itself remains undiagnosed and is carried as an engineering risk.

**Entry bundle: 376.27 kB → 341.13 kB** against an unchanged 380 kB budget, by moving the
three public *detail* views (tournament, content, game) to lazy route chunks. They are
reached by a click or a direct link, never as a first paint; `TournamentDetailView` alone is
25.52 kB. Headroom went from 3.73 kB to 38.87 kB.

**Docker and persistence evidence restored** at the current commit: engine 28.1.1, all three
services healthy, only 8080 published, persistence PASS.

**Moderation E2E flake diagnosed.** `moderation.spec.ts` → *"report a tournament … and a
moderator sees it (fa)"* is a **test-isolation defect**, not a product defect and not
external. The moderation queue returns a default first page of 20 cases newest-first and
the view loads only that page; during a full run, other specs' cases push this test's row
off it. 6/6 clean in isolation, ~1-in-3 inside the suite. UUIDv4 ids ruled out prefix
collision. The remedy — scoping the queue read by `subjectId`, which the API already
supports but the web client does not expose — is product scope, so it was **not applied**;
it is carried as a remaining engineering risk with the fix named.

**Accessibility preparation complete.** `ACCESSIBILITY_CERTIFICATION.md`: 20 criteria,
four audiences, both locales, 320px and desktop, each marked with its automated coverage.
Six criteria have no automation at all and are the substance of certification. Labelled
*Engineering preparation complete / Authorized human certification pending*; no tester,
date, result, or signature recorded.

**Moderation flake fixed, test-only.** The spec pages forward through the queue's own
`load-more` control, bounded at ten pages, until the row is reachable. `toHaveCount(1)`,
the state and severity checks and the identifier-leak checks are unchanged, and no product
behaviour was touched. Across **17 full-suite runs** the moderation test did not fail once
— but the suite as a whole was clean in only **14 of 17**. Three other specs failed once
each (`community.spec.ts:92`, `registration.spec.ts:90`, and one run whose failure was not
captured), all on small-mobile, all element-wait timeouts. That instability is a separate,
newly-recorded engineering risk with **no established cause**; the suite must not be
described as green. *(Superseded: DRAGON-29A established the causes and closed this — see
the DRAGON-29A section above. The "all on small-mobile" pattern recorded here was an
artefact of project order, not of the viewport.)* The subject-scoped queue read is still the
better product remedy and is still not implemented, because that is new product scope.

**Traceability reconciled.** All 344 `Evidence pending` rows were read against their source
requirement, the registered route or collection, the module's tests and the applicable
gate. 200 became **Implemented**, 96 **Partial** with the unsatisfied clause named, 12
**Blocked** with the blocker named, 4 **Gated** with the flag and default state, 2
**Deferred**, 1 **Not applicable**, and **29 stay pending** — 344 exactly — those are the rows where
nothing is built and no external party is blocking, each recording its exact missing
evidence and owner. The applier refused to write until every cited path, test filename and
index name resolved to something that exists, so no row claims evidence the repository does
not contain.

**Bounded performance measurements added.** `apps/api/src/perf/perf.itest.ts`: transfer
idempotency under concurrency (one key and distinct keys, cold and open windows), the
rolling-window claim at its configured budget, store last-unit contention, the indexed
stale-reservation scan, and one additional bounded admin query. Every scenario asserts its
correctness invariant as well as timing it — 24 concurrent claims against a budget of 20
admitted exactly 20 with zero overshoot; eight buyers for one unit produced exactly one
winner; the stale scan examined 50 keys for a configured limit of 50 via `IXSCAN`. Zero
errors. These are contention measurements on one machine through `app.inject`, not
production capacity, and the release document states that limitation explicitly.

**Correction to an earlier claim.** The statement that "every remaining blocker is
external" was wrong. Engineering still owns the 29 pending rows, the 125 partial rows, and
the absence of any CI pipeline (SEC-016, SEC-017, TEST-026).

### DRAGON-28 verification, 2026-07-29

- `npm run typecheck` pass · `npm run lint` **0 errors** · `npm test` **451/451**
- `npm run test:integration` — **500/500, exit 0** (includes the five new performance scenarios)
- `npm run build` pass · `npm run test:budget` pass at **341.13 kB / 380 kB**
- `npm run e2e` — **14 of 17 runs clean at 464 passed, exit 0**; 3 runs failed once each on unrelated small-mobile specs (cause not established). The moderation test passed in all 17.
- `npm run docker:up` — api, mongo, web all healthy; only 8080 published
- `npm run verify:persistence` — **PASS** · `closure:check` 14/14 · `decision:check` 12/12

## DRAGON-27 — Whole-ecosystem audit and release evidence

Three bounded slices. No new product capability was added in any of them.

**27a — cross-phase integration audit.** Mechanical audits of the backend and frontend
route registries, navigation links, API-client targets, i18n key usage, event payloads,
admin authorization guards, and gate defaults. Results: no duplicate `(method, path)` pair,
no navigation link without a route, **zero admin routes without a permission guard**, all
gates fail-closed, and no secret in any event payload — `account.registered` publishes a
masked mobile. One confirmed defect: `t('tournaments.tbd')` resolved in neither locale, so
a game page with an undated tournament rendered the raw key. Fixed, plus a guardrail that
every literal `t()` key must resolve in every locale — the pre-existing parity test could
not have caught a key missing from *both* files, which is how it shipped.

**27b — security, finance, data-integrity, and failure-recovery audit.** Six confirmed
defects fixed:

| Defect | Effect |
|---|---|
| Transfer-window opening used `$set: { count: 1 }` | Two concurrent openers each wrote 1, losing a claim and admitting an extra transfer past the limit. Surfaced by the parallel suite as *"admitted 21 transfers past a limit of 20"* |
| Compensating decrement not scoped to its window generation | A delayed compensation could corrupt a newer window's budget |
| Orphan-item reconciliation scan used `$nin` | Unindexed full scan, and its budget was consumed by ordinary unpaid-order items before reaching a real orphan |
| Course enrolments had no `(state, createdAt)` index | The recovery scan would have been a collection scan; added with migration `030-recovery-indexes` |
| Recovery adapter read `accountId` on enrolments | They name it `learnerId`; would have reported blank owners |
| Store reconciliation was one-directional | Added `paid_without_reservation` and `item_without_order` |

Added a shared **read-only** stuck-reservation detector for the crash window between domain
commit and hold capture, exposed at a permission-protected
`GET /admin/ops/stuck-reservations`. It is a **detector, not a recovery mechanism**: it
repairs nothing, because a captured-but-unfinished order has no approved remedy under
DEC-034.

**27c — final release evidence and decision.** Reconciled the five phase decisions against
the current code, confirmed every gate still fail-closed and every absent capability still
absent, and produced `RELEASE_DECISION_ECOSYSTEM.md`. **Verdict: NO-GO**, driven by ten
open external decisions and outstanding human sign-off rather than by any implementation
failure.

Two evidence gaps are recorded in that document rather than smoothed over: no full browser
suite run exists against the 27a/27b commits, because the Docker engine began returning
`500 Internal Server Error` partway through the slice and took the disposable test database
with it; and a money-path concurrency test in `economy.itest.ts` failed once in four
full-suite runs, passing in isolation and on re-runs, with its assertion message not
captured before the environment went down. It is listed as a release blocker for the
economy scope, not dismissed as a flake.

### DRAGON-27c verification, 2026-07-29

- `npm run typecheck` — pass · `npm run lint` — **0 errors** · `npm test` — **451/451**
- `npm run test:integration` — 491 tests; **490/491 on one of four runs**, 491/491 on the other three (see above)
- `npm run build` — pass · `npm run test:budget` — pass, 376.27 kB against 380 kB
- `npm run closure:check` — 14/14 · `npm run decision:check` — 12/12
- `npm run e2e`, `npm run verify:persistence`, Docker health — **not runnable this session** (engine unavailable); persistence and Docker health last passed at this same commit during 27b

## DRAGON-26 — Phase 5 commerce and economy release closure

Traceability reconciliation and a release verdict, not new product surface.

**Twenty Phase 5 rows changed.** Twelve had sat `Evidence pending` since DRAGON-17a while
the capability they describe was actually delivered by DRAGON-12, 24, or 25 — PAYOUT-001,
002, 003, REWARD-001, REWARD-008, DATA-070, DATA-071, PAGE-058, PAGE-059, ROLE-022, BR-022,
and JOURNEY-008. Eight requirements had **no row at all**: GOAL-009, UC-020, UC-021,
JOURNEY-007, DATA-072, API-095, API-096, and PAGE-042. Several are recorded `Partial`
rather than `Implemented`, each with the specific clause that is not satisfied — PAYOUT-002
has no product prize components, PAGE-058 has no refund control because DEC-044 makes
purchases final, and JOURNEY-007's delivery-validation and fulfilment steps are unreachable
while OD-019 holds.

**Four deviations recorded rather than hidden.**

| Deviation | Why |
|---|---|
| A payout is the prize entitlement record (DATA-072), with `/admin/entitlements/…` paths instead of API-095/096's `/admin/prize-allocations/…` and `/admin/payouts/…` | Settlement is manual and off-platform under DEC-045, so a payout has no life independent of the entitlement it settles — a second record would be a copy that can disagree. Approval is per entitlement because BR-022 requires components to settle independently |
| No mixed-payment order | DEC-050 permits no Toman balance to spend, so there is nothing to mix from. A split payment would also leave an order half-settled on failure, with no return workflow to unwind it (DEC-034) |
| Prize entitlements on the wallet page, not `/account/prizes` (PAGE-042) | A cash prize is balance-adjacent; a second page splits one financial picture in two |
| `/account/payouts` (PAGE-043) not built | Its own acceptance note is "no withdrawal capability is shown unless legally activated", and no withdrawal exists |

**Phase 5 release decision: NO-GO**, recorded in `RELEASE_DECISION_PHASE5.md`. Blocked
entirely by OD-019, OD-020, and OD-030, with **no implementation failure outstanding**. What
the blockers leave is a commerce phase that cannot sell anything physical, cannot revoke
anything digital, and cannot let one person buy from another — a shop with the shutters
half down.

**Review.** One focused `test-reviewer` release-readiness pass: **APPROVE WITH NOTES, no
Critical and no High findings.** It verified by direct code reading that DRAGON-25's two
Critical fixes and one High fix are in place and complete, that every gate default is
fail-closed in both `config.ts` and `.env.example`, that each blocked capability is absent
rather than simulated, and that all four deviations match the code. It found two Medium
bookkeeping defects, both fixed: `REWARD-001` and `REWARD-008` had been re-tagged
`PHASE_1, PHASE_5` when `Requirements.md` tags them `FOUNDATION, PHASE_1` and `PHASE_1`,
and `ROLE-022` had lost its `FOUNDATION` tag. The phase-tag pass had pattern-matched
instead of reading each requirement's own tag — a closure slice asserting a re-scope the
requirement document never made is precisely the drift this file exists to prevent.

### DRAGON-26 verification, 2026-07-29, all commands run from the repository root

- `npm run typecheck` — pass (both workspaces)
- `npm run lint` — **0 errors**, 63 warnings (all pre-existing formatting warnings)
- `npm test` — **450 passed, 0 failed** · `npm run test:integration` — **476 passed, 0 failed**
- `npm run build` — pass · `npm run test:budget` — pass (entry bundle 376.21 kB against a 380 kB budget)
- `npm run e2e` — **464 passed, 1 skipped, 0 failed** across three viewports in fa RTL + en LTR, exit 0
- `npm run docker:up` — web, api, and mongo all **healthy**
- `npm run verify:persistence` — **PASS**
- `npm run closure:check` — 14/14 · `npm run decision:check` — 12/12

## DRAGON-25 — Phase 5 economy, rewards, peer transfer, and payouts

A new `economy` module (migration `029-economy`) plus payout hardening inside `prizes`.

- **A transfer is one balanced journal.** Both legs commit together, so there is no window
  in which coin exists nowhere. The ledger reference is derived from the caller's
  `(sender, idempotencyKey)` — not from a generated record id — which is what makes two
  concurrent requests under one key collapse into a single posting.
- **The rolling window is claimed, not read.** A read-then-decide check is not a limit:
  concurrent requests all see the same pre-race totals and are all admitted. A single
  conditional update claims both the count and the amount budget, so a losing racer matches
  nothing. Budgets are handed back when the transfer is then refused.
- **A held transfer moves nothing.** Recording a review while the coin has already arrived
  is the worst of both — the recipient could spend it before anyone looked. A held
  transfer therefore carries no ledger transaction at all, and the reconciliation report
  treats "an unreleased transfer with a ledger transaction" as a difference it must name.
- **Payout settlement takes two people and a verified recipient.** Dual control is checked
  on the *actor*, because one person can hold both finance permissions. A retry reuses the
  same entitlement id, so a second payment is structurally impossible; a reversal is
  recorded alongside the original evidence, so the record shows both that it was paid and
  that it was undone.
- **Cash redemption is absent, not gated.** DEC-024 forbids it and DEC-023 defines trading
  as direct transfer, so a feature flag would imply a decision that is not pending. Proven
  three ways: no registered route, no price or counter-asset on the transfer contract, and
  **no ledger transaction type that could balance a cash-out** even for a future caller.

**The security review returned REQUEST-CHANGES, and it was right.** Two Critical and one
High, all real, all fixed, each with a regression test:

| Finding | What it allowed | Fix |
|---|---|---|
| Dual-control bypass (Critical) | Failing a never-approved payout and retrying it reached `approved` with `approvedBy` still null, so the approver comparison had nobody to compare against and one actor could settle alone | Settlement now refuses an entitlement with no recorded approver, a retry records the retrying actor as approver, and reconciliation names a settled payout with no approver |
| Double ledger posting (Critical) | Two concurrent requests under one idempotency key each generated a record id, so each posted its own ledger transaction — the sender was debited twice while the API reported one transfer | The ledger reference derives from `(sender, idempotencyKey)`, so the ledger's own dedup collapses the race; reconciliation now also detects a ledger posting with no transfer record |
| Window limits raceable (High) | Concurrent transfers each read the same pre-race window totals and were all admitted, collectively passing the configured limit | An atomic claim in a single conditional update, with the budget released when the transfer is subsequently refused |

The reviewer also noted the reconciliation reports only checked one direction
(record-without-transaction). Both now check the other direction too, which is the check
that would have caught the second Critical.

### DRAGON-25 verification, 2026-07-29, all commands run from the repository root

- `npm run typecheck` — pass (both workspaces)
- `npm run lint` — **0 errors**, 63 warnings (all pre-existing formatting warnings)
- `npm test` — **450 passed, 0 failed** (api 405, web 45)
- `npm run test:integration` — **476 passed, 0 failed** (economy 20, prizes 16)
- `npm run build` — pass · `npm run test:budget` — pass (entry bundle 376.21 kB against a 380 kB budget; **within 4 kB of the ceiling**, so the next slice adding to the entry chunk will need to split something)
- `npm run e2e` — **464 passed, 1 skipped, 0 failed** across small-mobile 320px, mobile 375px, and desktop 1440px in fa RTL + en LTR. Adds 10 economy tests × 3 viewports
- `npm run closure:check` — 14/14 · `npm run decision:check` — 12/12

**Known intermittent.** The browser suite occasionally exits non-zero while reporting every
test passed; re-running is clean and no test failure is ever named. Seen in DRAGON-24 and
again here, on runs whose reported results were identical to passing runs. Recorded rather
than explained — it has not been diagnosed.

**Deliberately out of scope.** `/account/payouts` (PAGE-043) is not built: its own
acceptance note is "no withdrawal capability is shown unless legally activated", and no
withdrawal exists. Peer commerce (user-to-user *purchase*) stays absent under OD-030.
Automatic threshold-driven payout review is defined and surfaced but not auto-applied.

## DRAGON-24 — Phase 5 store catalog, inventory, and fulfillment

A new `store` module (migration `028-store`) plus a `store.manage` permission and the
`shop_operator` role.

- **Money is exact and server-owned.** Every total is recomputed from the catalog variant
  rows at checkout; the cart's stored price is named `unitPricePreview` and is never read
  there. The web client computes no total at all. Settlement is Dragon Coin through the
  shared holds boundary — the store never posts to the ledger, which is the ROLE-021
  boundary, and a test asserts the module does not so much as reference it. A Toman list
  price may ride alongside for the rial representation COMMERCE-009 requires; it is a
  separate asset that never enters settlement arithmetic.
- **Stock cannot be oversold.** The claim is a single conditional `$inc` inside the write
  transaction, so a losing concurrent buyer matches nothing. An integration test races two
  real requests for the last unit and asserts exactly one order and a final stock of zero.
  A payment that cannot be funded returns the stock, cancels the fulfillments, and grants
  nothing.
- **An order is a snapshot, not a set of references.** Title, SKU, unit price, discount,
  and address are all captured at checkout, so archiving the product afterwards leaves the
  historical order untouched — asserted directly.
- **The receipt is checked, not asserted.** Its reconciliation figure is recomputed from
  the stored line items rather than copied from the order, so a drifted total shows as a
  visible mismatch instead of agreeing with itself. Shipping is shown as zero rather than
  omitted, because a missing row reads as "forgotten" and a zero row says "not charged".

**Both gates are fail-closed, and one of them is a sale gate rather than a catalog gate.**
OD-019 blocks carrier selection, service regions, shipping-price rules, and service
levels. Taking money for a physical item commits us to delivering it, so the fail-closed
point is the **sale**: physical products can be authored, stocked, and browsed, and the
product page says plainly that they cannot be bought yet. Gating the catalog instead would
have made the acceptance criterion unimplementable; gating nothing would have sold a
delivery nobody has agreed how to make. No carrier or shipping-rate concept exists in
store code at all, asserted by a guardrail that strips comments and strings first so it
checks identifiers rather than prose. OD-020 keeps entitlement revocation absent — no
route, no `revoked` state. There is no returns, refund, or RMA surface anywhere
(COMMERCE-010, DEC-034), and the store config endpoint reports `returnsWorkflow:
not_offered` so a client cannot infer one.

**Deliberately out of scope.** Prize and payout requirements (PAYOUT-001..012, API-095,
API-096, PAGE-042/043/060) are not in this slice despite the prompt's requirements-scope
line mentioning prizes and payouts — every acceptance criterion it lists is commerce, and
payout settlement is its own separation-of-duties problem. Also absent: third-party
marketplace vendors, international shipping, product categories, and a cart-expiry job.

**Known limitation, recorded rather than hidden.** If the process dies between the order
transaction committing and the Dragon Coin capture returning, the order stays
`pending_payment` and its claimed stock is never released. In-process failures *are*
handled and tested. This is the existing holds-integration shape — paid course enrolment
has the same window — so the fix is one sweeper across every hold-based purchase flow
rather than a store-specific patch. It matters more here because a stuck row makes a
physical unit unsellable.

### DRAGON-24 verification, 2026-07-29, all commands run from the repository root

- `npm run typecheck` — pass (both workspaces)
- `npm run lint` — **0 errors**, 63 warnings (all pre-existing formatting warnings)
- `npm test` — **433 passed, 0 failed** (api 388 incl. 22 new store tests, web 45)
- `npm run test:integration` — **449 passed, 0 failed** (store 25)
- `npm run build` — pass · `npm run test:budget` — **pass**, entry bundle 357.96 → 371.78 kB against a 380 kB budget. All seven store views are lazy route chunks; the growth is the shared client and formatting helpers they pull in
- `npm run e2e` — **434 passed, 1 skipped, 0 failed** across small-mobile 320px, mobile 375px, and desktop 1440px in fa RTL + en LTR. Adds 12 store tests × 3 viewports. The first invocation exited non-zero while still reporting every test passed; two immediate re-runs were clean at exit 0, so this is recorded as an unexplained single occurrence rather than a diagnosed failure
- `npm run closure:check` — 14/14 · `npm run decision:check` — 12/12

**Review.** One focused `test-reviewer` security pass over the money and stock paths:
**verdict APPROVE, no Critical and no High findings, and no blockers.** Money correctness,
stock integrity under concurrency, idempotency, IDOR, gate integrity, and test quality
each checked out. Its one substantive note is the crash-window limitation recorded above,
which it classified as a pre-existing characteristic of the holds integration rather than
a defect introduced here.

## DRAGON-23 — Phase 4 community release closure

Traceability correction and evidence, not new product surface.

**The largest finding was in the paperwork, not the code.** Re-reading the Phase 4
requirement text line by line showed that four rows DRAGON-22 recorded had been mapped to
requirements whose text says something else:

| Row | What DRAGON-22 claimed it was | What the requirement actually says |
|---|---|---|
| SOCIAL-011 | Community surfaces are privacy-by-default | Social notifications must respect per-channel preferences |
| MOD-008 | Community moderation uses the shared case workflow | Appeals must remain disabled until OD-024 is approved |
| NOTIF-011 | Community mentions notify the mentioned account | Push notifications must remain provider-adapted and preference-controlled |
| TEST-023 | Tests cover authorization, privacy, moderation, abuse, scale | Tests cover visibility, following, moderation, block/mute when enabled, and feed filtering |
| INT-006 | Community capabilities must not introduce an external integration | The push-integration catalog entry: token privacy, opt-in, invalid-token cleanup, retries, sandbox |

Each was re-rowed against its real text. Three of the five turn out to be **gates**, not
features: MOD-008 is now `Blocked by open decision` under OD-024, and NOTIF-011 and INT-006
under OD-027 — the honest status for a requirement whose content is "this must stay off"
or "here is what the integration must satisfy once it exists". The report-workflow evidence
moved onto SOCIAL-007, where it belongs. Several other rows moved from `Implemented` to
`Partial` where a requirement has a clause the slice does not satisfy — SOCIAL-003's
block/mute half, PAGE-034's filters, PAGE-035's teams and match history, TEAM-011's
membership applications.

Two of these were caught by the independent review rather than by my own pass, along with
a missing row: **ROLE-019 (community moderator) had no traceability entry at all** even
though DRAGON-22 shipped the capability, and **TEAM-011 still read `Deferred by phase`**
after its delegated-role half had shipped. Both are now rowed. A closure slice that leaves
a mismapped or missing row behind has not closed anything, so these were fixed here rather
than deferred.

**Three evidence gaps closed.**

- **Direction-aware posts (SOCIAL-004).** Rendered bodies and both composers now carry `dir="auto"`, matching the chat surface. A Persian post inside the English feed keeps its own base direction; the browser test asserts the *computed* direction rather than the attribute, so it would fail if the CSS ever overrode it.
- **Search leakage (SOCIAL-003, ANALYTICS-005).** Global search is a client-side fan-out over five public list endpoints, and community posts are not one of them. Two guardrails assert that — the search view imports no community client, and no API route offers a community search surface — so an aggregate index cannot be added later without a deliberate decision. That matters because an index answers from what it last ingested, while community visibility is decided per viewer at read time.
- **JOURNEY-006 end to end.** Discover a player, follow, receive their followers-only post, react, comment, then unfollow and watch it leave on the next read — one browser journey, run in fa and en. Advanced team permissions are exercised through the browser's own session, since delegated roles are an API capability with no dedicated UI in this slice; the test says so rather than implying a screen exists.

**Two path deviations, recorded rather than hidden.** API-088 names `POST /reports`, which
the moderation module already registers; the community intake is `POST /social/reports`.
PAGE-035 names `/users/{username}`; the social profile renders on the existing
`/players/{username}` page, because SOCIAL-001 requires existing profile URLs to stay valid
and a second canonical profile URL would break the requirement PAGE-035 exists to serve.

### DRAGON-23 verification, 2026-07-29, all commands run from the repository root

- `npm run typecheck` — pass (both workspaces)
- `npm run lint` — **0 errors**, 63 warnings (all pre-existing formatting warnings)
- `npm test` — **411 passed, 0 failed** (api 366, web 45)
- `npm run test:integration` — **424 passed, 0 failed**
- `npm run build` — pass · `npm run test:budget` — pass (entry bundle 357.96 kB, unchanged)
- `npm run e2e` — **398 passed, 1 skipped, 0 failed** across small-mobile 320px, mobile 375px, and desktop 1440px in fa RTL + en LTR
- `npm run docker:up` — web, api, and mongo all **healthy**. This is also independent confirmation that the DRAGON-22 duplicate-route crash is fixed in a production image
- `npm run verify:persistence` — **PASS**
- `npm run closure:check` — 14/14 · `npm run decision:check` — 12/12

**Review.** One focused `test-reviewer` release-and-security pass: **no Critical and no High
security findings**, and the verdict itself confirmed honest — every capability the decision
calls absent was verified absent in the code, the three gate defaults verified fail-closed
in both `config.ts` and `.env.example`, and every evidence row checked against a test that
exists and asserts what the row claims. The `dir="auto"` change renders through Vue
interpolation, never `v-html`, so it adds no injection vector. The three traceability
defects it found (INT-006 text, missing ROLE-019, stale TEAM-011) are fixed above.

**Phase 4 release decision: NO-GO**, recorded in `RELEASE_DECISION_PHASE4.md`. Blocked
entirely by OD-017, OD-024, and OD-027, with **no implementation failure outstanding**. The
decisive blocker is OD-017: SOCIAL-003 requires the feed to enforce block and mute rules,
and no such rules exist to enforce, so a released Phase 4 would put a public posting
surface in front of users whose only remedy against a specific person is a report.

## DRAGON-22 — Phase 4 community capabilities and advanced team roles

A new `social` module (migration `027-social`) plus an additive widening of the existing team role.

- **Visibility is decided on every read, never fanned out** (BR-025). Three current facts settle it — the item's moderation state, the author's profile visibility, and the follow relation — and none is cached on the post. That is why unfollowing an author, or an author narrowing their profile, removes their posts on the *next* request with no rebuild and no invalidation step. The cost is a per-item check on read; the alternative is a stored activity row that records a decision made at write time and is wrong the moment either fact changes. There is deliberately **no activity collection at all** (DATA-060).
- **Blocking and muting are absent, not disabled.** SOCIAL-008 requires that blocking must not be *partially* activated, and a disabled endpoint over a real block table would already be partial activation. A guardrail test asserts against the registered route surface and the module's own collections and indexes that nothing named block or mute exists anywhere. `SOCIAL_BLOCKING_ENABLED` remains as the fail-closed switch for when OD-017 is answered.
- **A post the viewer may not read answers 404, never 403.** A 403 confirms the id exists, which lets a caller enumerate private posts one id at a time. Since the visibility check already runs, answering identically for "absent" and "not yours" costs nothing.
- **Advanced team roles required no migration.** TEAM-012 had already made the role a resource-scoped grant on each membership row rather than a fixed column, so `manager` and `captain` are simply two more values of that union and every existing row is already valid. An integration test asserts the membership id and `joinedAt` are unchanged across a promotion, and that no second row appears. `owner` is not assignable through the delegation route — promoting to owner without the atomic demote would breach the one-active-owner partial index — and a delegate cannot delegate, so revoking delegated authority stays with the single accountable holder.
- **Community reports go into the shared moderation case workflow** with two new subject types, carrying the body as it read at report time. A removed post keeps its row and body for the case file while every reader surface drops it in the same read.

**Two real defects were found by the new tests and fixed in the product, not in the test.** An over-long post body was silently truncated to the stored maximum, which publishes words the author did not write and never tells them — it is now rejected. And `POST /reports` collided with the moderation module's existing route, which is a Fastify duplicate-route crash at startup; it escaped the module suite because moderation's routes are registered inside `if (deps.tournaments !== undefined)` and the social suite has no tournaments. The path moved to `/social/reports`, and a route-registry guardrail now scans every `routes.ts` for duplicate `(method, path)` pairs regardless of composition.

### DRAGON-22 verification, 2026-07-29, all commands run from the repository root

- `npm run typecheck` — pass (both workspaces)
- `npm run lint` — **0 errors**, 63 warnings (all pre-existing formatting warnings in files this slice did not add)
- `npm test` (workspaces) — **407 passed, 0 failed** (api 362 incl. 15 new social/role tests, web 45)
- `npm run test:integration` (api) — **424 passed, 0 failed** (social 28, teams 28 incl. 7 new delegated-role tests)
- `npm run build` — pass · `npm run test:budget` — pass (entry bundle unchanged at 357.96 kB; all four community views are lazy route chunks)
- `npm run e2e` — **386 passed, 1 skipped, 0 failed** across small-mobile 320px, mobile 375px, and desktop 1440px in fa RTL + en LTR. Adds 11 community tests × 3 viewports.
- `npm run closure:check` — 14/14 · `npm run decision:check` — 12/12
- `npm run verify:persistence` — **not run in this slice** (unchanged since the DRAGON-21 pass; no persistence-affecting change)

**Review.** One independent `test-reviewer` pass over the new authorization and privacy boundary: **verdict APPROVE, no Critical and no High findings.** Read-time visibility re-checking, consistent 404-vs-403, mention resolution through the identity directory, the team-role escalation paths, gate integrity for all three open decisions, and the module boundaries were each confirmed. Two Mediums were raised: an inline 404 envelope in two social routes that duplicated the shared error shape (fixed — both now throw `NotFoundError`), and the `limit * 2` over-read heuristic in `listAuthorPosts` possibly under-filling a page, which is the same accepted pattern already used by `feed` and is a short-page nit rather than a leak. The reviewer did not inspect the three new Vue views or the Persian strings; that gap is covered separately by `community.spec.ts`, which asserts one `h1`, `label[for]` association for every composer control, the correct `dir` attribute per locale, and the absence of raw i18n keys — 33 passing across three viewports in both locales.

**Deliberately out of scope, and rowed as such.** ANALYTICS-005 (community analytics) is deferred: no report is built, so there is nothing whose output could be checked. Membership applications (the second half of TEAM-011's sentence) are not in this slice.

## DRAGON-21 — Phase 3 education release closure

Hardening and evidence, not new product surface. Four gaps left by DRAGON-20 were closed.

- **Paid course journey now runs end to end** (`academy-paid.spec.ts`, fa + en). The browser environment sets `PAID_COURSES_ENABLED=true` — mirroring `PAID_TOURNAMENTS_ENABLED`, already enabled in the same file — so the criterion "run the paid journey" is actually run rather than asserted around. The gate stays fail-closed in `.env.example` and is asserted off by integration tests, so both states are covered. The money half goes through the shared mock provider and the Dragon Coin ledger, which is what makes **payment failure** and a **duplicate provider callback** real cases here instead of education-specific inventions.
- **Notifications closed.** Completing a course publishes `course.completed` through the shared outbox with an `in_app` template in both locales. Education keeps no notification table (NOTIF-010), asserted directly.
- **Shared-ledger reconciliation.** An integration test proves every transaction a course capture produces balances to zero and that the learner's stored balance equals the sum of their entries — the ledger's own invariant, asserted over education's postings.
- **Responsive and accessible lesson consumption.** The player is verified at the 320px floor with zero horizontal overflow, and its lesson list is asserted to be a real `navigation` landmark with reachable controls.

**Gate honesty, asserted rather than claimed.** Integration tests assert that with OD-015 off no course anywhere carries a paid access model or a price and no `course_enrollment` hold exists, and that no stored lesson has a `quiz` or `exercise` type. The console's paid-gate badge is asserted against the server's reported config rather than against the test's own assumption — an earlier version of that test only proved it knew its fixture.

### DRAGON-21 verification, 2026-07-29, all commands run from the repository root

- `npm run typecheck` — pass (both workspaces)
- `npm run lint` — 2 errors, **both pre-existing in `apps/web/src/views/TournamentDetailView.vue`**
- `npm test` (workspaces) — 391 tests: 390 passed, 1 failed. The failure is the pre-existing `compose-topology.test.ts` case caused by the uncommitted `docker-compose.yml` change.
- `npm run test:integration` (api) — **389 passed, 0 failed** (education 32, adding ledger reconciliation, the notification event, and both gate-honesty assertions)
- `npm run build` — pass · `npm run test:budget` — pass
- `npm run e2e` — **353 passed, 1 skipped, 0 failed** across small-mobile 320px, mobile 375px, and desktop 1440px in fa RTL + en LTR. Adds 7 paid-journey browser tests.
- `npm run verify:persistence` — **PASS**: committed MongoDB data survived a Compose stop/start on the named volume
- `npm run closure:check` — 14/14 · `npm run decision:check` — 12/12

**Test-environment note.** `OTP_REQUESTS_PER_IP` was raised from 500 to 5000 for the browser suite only. The suite now runs 350+ tests across three viewports and every one signs in, so one run spends several hundred OTP requests from a single loopback address inside one fixed window; at 500, a second run within 15 minutes failed unrelated specs with sign-in errors that read as a regression and were not one. The limiter is unchanged and still enforced.

### Phase 3 verdict

**NO-GO**, recorded in `RELEASE_DECISION_PHASE3.md` with external blockers separated from implementation failures. OD-015 (ownership, refund, access revocation, coach commercial terms) and OD-016 (quiz/exercise scope) are both release-blockers and neither is resolvable by engineering. **No implementation failure blocks the release.**

## DRAGON-20 — Phase 3 courses, enrolment, and progress

- **Education module (`apps/api/src/modules/education/`).** Course lifecycle exactly per section 12.10 (draft → review → published → unpublished → archived), enrolment per its two documented paths (free `pending → active → completed`, paid `pending_payment → active → completed`, with revoked/refunded/cancelled). Migration `026-education` creates six collections and their constraints.
- **Access (BR-024).** Lesson content needs *both* an access-granting enrolment and, for a paid course, a live entitlement. A locked lesson is returned without its body or `mediaUrl`, so the lock is a property of the payload rather than of the client (MEDIA-012).
- **Progress and completion (EDU-006, EDU-007).** Progress is idempotent and monotonic per learner/lesson — a replay changes nothing and a stale device never lowers what was recorded. Completion is a pure function of stored required-lesson progress, asserted stable under repeated evaluation.
- **Paid enrolment (EDU-002, EDU-010).** The price is reserved as a Dragon Coin hold at enrolment and captured on activation, both through the shared holds service, which posts through the ledger. No education-specific balance exists. Activation is exactly-once, proven against ledger balances rather than against a mock.
- **Publication (EDU-009).** Refused until both locales have a title and summary, the curriculum has at least one required lesson with localized titles, and an **approved** coach owns the course. Every missing item is reported together.
- **Gates held closed.** OD-015: `PAID_COURSES_ENABLED` ships `false`, so a course cannot be priced or paid for; a Toman price is refused outright (Dragon Coin is non-redeemable, so it raises none of the ownership/refund/payout questions the decision governs). OD-016: quiz and exercise lesson types are refused by name.
- **Not implemented, deliberately.** PAGE-033 (coach page — its content depends on the commercial relationship OD-015 governs; the coach's approved fields are shown unlinked on the course detail rather than as a dead link), ANALYTICS-004 (course revenue cannot reconcile while paid enrolment is gated), and EDU-012 certification/accreditation/payout, which has no endpoint, field, or promise anywhere.

### DRAGON-20 focused security review

One independent `test-reviewer` pass over the education surface (money correctness, entitlement/access, IDOR, prerequisite bypass, gate integrity, publication/ownership, data leakage, concurrency, test honesty). **Verdict: APPROVE — no Critical or High finding.**

- **Medium (fixed):** a concurrent duplicate enrolment could strand a Dragon Coin reservation. Two requests could both pass the existence check and both reserve; only one enrolment won the unique index, and the loser silently discarded its hold, leaving the learner's balance reserved until the hold's TTL. The losing attempt now releases its own reservation, and any other post-reservation failure does the same. A test asserts exactly one active hold survives a race.
- **Medium (fixed):** a `pending_payment` enrolment had no exit. `POST /me/enrollments/{id}/cancel` now releases the reservation and cancels the enrolment, so a learner who changes their mind gets their balance back immediately instead of waiting out the TTL.

### DRAGON-20 verification, 2026-07-29, all commands run from the repository root

- `npm run typecheck` — pass (both workspaces)
- `npm run lint` — 2 errors, **both pre-existing in `apps/web/src/views/TournamentDetailView.vue`**. The new views add two `vue/no-v-html` warnings, matching the established pattern in `GameDetailView.vue` and `ContentDetailView.vue`: the bodies are sanitised at the server write boundary.
- `npm test` (workspaces) — 391 tests: 390 passed, 1 failed (api 346: 345 pass; web 45: 45 pass). The single failure is the pre-existing `compose-topology.test.ts` "nginx remains the public entry point on 8080", caused by the uncommitted `docker-compose.yml` change. Adds 33 education unit tests.
- `npm run test:integration` (api) — 385 passed, 0 failed. Adds 28 education integration tests covering every TEST-022 area: free and paid entitlement, progress, completion, and revocation — plus authorization, publication completeness, prerequisite locks, coach privacy, review eligibility, the OD-015/OD-016 gates, cancellation, and the concurrency race.
- `npm run build` — pass · `npm run test:budget` — pass
- `npm run e2e` — **332 passed, 1 skipped, 0 failed** across small-mobile 320px, mobile 375px, and desktop 1440px in fa RTL + en LTR. Adds 8 academy browser tests. (An earlier run hit the tracked intermittent `teams.spec.ts:58` (C6/R-FLAKE) under full-parallel contention; it passed on an isolated re-run and on the final full run.)
- `npm run closure:check` — 14/14 · `npm run decision:check` — 12/12
- Migrations against the disposable test DB — `026-education` applies cleanly.

**Environment note.** The browser suite could not start at all until the API host port was moved: Windows/WinNAT had reserved 2969-3068, which contains the default 3000, and a reserved port fails to bind with a permissions error even though nothing is listening. Because the test environment logs at `silent`, the API exited 1 with no output. `E2E_API_PORT` / `E2E_WEB_PORT` now provide the same escape hatch `WEB_PORT` already gives Compose; the defaults are unchanged.

### Phase 3 traceability

38 Phase-3 requirement rows added (EDU-001..012, API-077..082, PAGE-030..033, PAGE-054, DATA-050..055, ROLE-014/015/023, FORM-017, BR-024, MEDIA-012, TEST-022, ANALYTICS-004). Nine are honestly Gated, Partial, Deferred, or Not applicable rather than claimed complete.

## DRAGON-19 — Phase 2 moderated live chat and release closure

- **Chat module (`apps/api/src/modules/chat/`).** A room belongs to exactly one stream (unique index) and inherits that stream's access decision, so an unlinked room cannot exist and a sign-in-only stream has a sign-in-only room (CHAT-001). Migration `025-chat`.
- **Ordering and delivery (CHAT-006).** A per-room sequence is allocated inside the write transaction, giving a total order independent of clock skew, and an aborted insert cannot leave a gap. Delivery is at-least-once: the feed re-reads a trailing window and the client folds pages by message id. That window is a correctness requirement, not an optimisation — polling strictly after the cursor would never deliver a *removal* of an already-rendered message.
- **Duplicate protection.** A unique `(roomId, senderId, clientMessageId)` index plus a pre-check means a retried or concurrently-doubled send converges on the original message and consumes no rate-limit budget.
- **Backpressure (CHAT-003, PERF-012).** Sending is rate limited per sender per room and refused with 429 rather than queued; the feed page size is capped and an oversize request is rejected.
- **Timeouts and bans (CHAT-004).** Stored as room-scoped restriction records with a reason and (for a timeout) a bounded expiry. They never touch account state: a chat ban leaves the account active, which is the boundary this prompt required not to weaken.
- **Evidence (CHAT-005).** Removing a message delivers a tombstone with no body to viewers while the body is retained for moderators, and a report snapshots the body into the shared moderation case independently — so evidence survives both public removal and any later purge.
- **CHAT-008.** No direct-messaging route or client exists, and a route-registry guardrail asserts that against the registered Fastify surface rather than against documentation.
- **Frontend.** Chat panel on the watch page (`role="log"`, polite live region, `dir="auto"` per message) and a `/admin/chat` moderation console, both fully bilingual.

### DRAGON-19 verification, 2026-07-28, all commands run from the repository root

- `npm run typecheck` — pass (both workspaces)
- `npm run lint` — 2 errors, **both pre-existing in `apps/web/src/views/TournamentDetailView.vue`** and untouched by this work. No chat file produces an error or a warning.
- `npm test` (workspaces) — 358 tests: 357 passed, 1 failed (api 313: 312 pass; web 45: 45 pass). The single failure is `compose-topology.test.ts` "nginx remains the public entry point on 8080", caused by the **pre-existing uncommitted `docker-compose.yml` change**, not by this work. Adds 6 chat unit tests (restriction effectiveness, room lifecycle, the CHAT-008 route guardrail) and 6 web unit tests for client deduplication.
- `npm run test:integration` (api) — 357 passed, 0 failed. Adds 29 chat integration tests covering every TEST-021 case: ordering, duplicate delivery (including a concurrent race), rate limit, timeout, ban, and report evidence — plus access, scope, closed rooms, sanitisation, the identity-boundary check, and three cross-room IDOR regressions added after the review pass.
- `npm run build` — pass · `npm run test:budget` — pass
- `npm run e2e` — **308 passed, 1 skipped, 0 failed** across small-mobile 320px, mobile 375px, and desktop 1440px in fa RTL + en LTR. Adds 24 chat browser tests.
- `npm run closure:check` — 14/14 · `npm run decision:check` — 12/12
- Migrations against the disposable test DB — `025-chat` applies cleanly.

### DRAGON-19 focused security review

One independent `test-reviewer` pass over the chat and streams surfaces (authorization/IDOR, access control, secret leakage, evidence integrity, privilege escalation, concurrency, rate-limit bypass, injection, and test honesty). **Verdict: APPROVE — no Critical or High finding.** All nine risk areas were reported as holding.

- **Medium (resolved):** the cross-room IDOR logic on the *mutating* restriction routes was correct by inspection but had no regression test — the scope tests only covered a read route, and `timeouts`/`bans` take the room from the caller-controlled request body. Three integration tests were added: a room-A-scoped moderator is refused (403) on timeout/ban/remove/lift aimed at room B, is refused (404) when naming their own room while targeting room B's message or restriction, and still succeeds inside their own room.
- **Low (recorded, not built):** the send budget is per room per sender, so a sender could spend a full budget in several rooms at once. Rooms are independent broadcasts, so that is the intended scope; a `ponytail:` comment in `chat/service.ts` names the ceiling and the upgrade path.
- **Low (clarified):** the playback-access response necessarily carries the provider resource id, since that is what a player fetches. STREAM-001 constrains the *public* discovery and detail payloads, which carry no provider field at all; a comment in `streams/service.ts` now states that distinction.

### Phase 2 traceability

44 Phase-2 requirement rows added (CHAT-001..008, API-066..076, PAGE-027/028/029/052/053, DATA-042..047, ROLE-011/012/013/024, PERF-011/012, TEST-020/021, plus BR-023, CON-007, FORM-016, INT-004, MEDIA-011, NOTIF-010, ANALYTICS-003), each carrying an accepted cross-phase mapping or an explicit gate owner. Nine are honestly Deferred, Blocked, Gated, or Partial rather than claimed complete.

## DRAGON-18 — Phase 2 stream catalog and provider adapter boundary

Dragon owns stream identity, schedule, relationships, access policy, and lifecycle; the provider owns delivery only.

- **Stream module (`apps/api/src/modules/streams/`).** Seven-state lifecycle enforced exactly per section 12.9 (draft → scheduled → live → ended → archived, with draft/scheduled → cancelled, scheduled/live → failed, and controlled recovery out of failed; cancelled and archived terminal). Relationships to games, tournaments, matches, channels, and streamers, each optional and each indexed for reverse resolution. Public/authenticated watch modes. Migration `024-streams`.
- **Provider boundary (STREAM-002).** `StreamingProvider` interface plus a deterministic in-repository stub. Provider resource ids derive from the Dragon stream id, so provisioning converges on retry, and a unique partial index refuses a second resource. No public payload carries a provider identifier, which is what makes "provider replacement does not change public stream IDs" structurally true rather than a convention.
- **Access (STREAM-005/006, BR-023).** Dragon decides access before any provider data exists: an anonymous caller on an authenticated-mode stream, a stream that is not playing, a taken-down stream, and a stream whose provider is unhealthy are all refused with no playable data in the response.
- **Degraded state (STREAM-008).** A provider failure marks the stream unavailable, records a bounded message plus the correlation id (never the raw provider error), raises an operator alert through a narrow port, and surfaces an unavailable/retry state on the public page and the console.
- **Frontend.** `/streams` discovery (URL-synced shelf, search, and relationship filters), `/streams/{slug}` watch page, `/admin/streams` operations console. Full fa/en copy; `stream.manage` is its own permission held only by `streaming_operator` (ROLE-024).
- **Gates held closed.** OD-013: no Arvan-specific behaviour; `STREAMING_PROVIDER=arvan` fails startup naming the decision. OD-014: `STREAM_RIGHTS_POLICY_APPROVED` defaults false, so archiving and takedown are refused and a disabled archive creates no public VOD. Rights confirmation before scheduling is always required (section 27) and is not behind that gate.
- **Not implemented, deliberately.** STREAM-010 highlights (source VOD is gated off, so the surface would have no reachable source) and STREAM-012 provider playback analytics (no contracted metric feed to separate first-party views from). API-071 provider webhook replaced by operator-triggered reconciliation, because a callback needs a contracted authentication scheme. Live chat (CHAT-*) belongs to DRAGON-19 and was not started.

### DRAGON-18 verification, 2026-07-28, all commands run from the repository root

- `npm run typecheck` — pass (both workspaces)
- `npm run lint` — 2 errors, **both pre-existing in `apps/web/src/views/TournamentDetailView.vue`** and untouched by this work (an unused `toggleChoice`, and a parse error from mojibake introduced in commit `878bf24`). No stream file produces an error or a warning.
- `npm test` (workspaces) — 345 passed / 1 failed. The single failure is `compose-topology.test.ts` "nginx remains the public entry point on 8080", caused by the **pre-existing uncommitted `docker-compose.yml` change** (`"${WEB_PORT:-8080}:8080"`), not by this work. Adds 28 stream unit tests (state machine, scheduling readiness, links, archive gate, adapter idempotency, secure-link scope binding) and 5 config-gate tests.
- `npm run test:integration` (api) — 328 passed, 0 failed. Adds 29 stream integration tests: operator authorization, public visibility, lifecycle enforcement, watch access (including the STREAM-006 P2 acceptance case), provisioning idempotency, reconciliation, provider failure, the OD-014 archive/takedown gates, reverse relationship resolution, schedule notifications, and the audit trail.
- `npm run build` — pass
- `npm run test:budget` — pass
- `npm run e2e` — **284 passed, 1 skipped, 0 failed** across small-mobile 320px, mobile 375px, and desktop 1440px in fa RTL + en LTR. Adds 21 stream browser tests.
- `npm run closure:check` — 14/14 pass · `npm run decision:check` — 12/12 pass
- Migrations against the disposable test DB — `024-streams` applies cleanly.

## DRAGON-17b — Phase 1 release evidence

Local/test-environment verification only. Not production capacity, deployment, provider-integration, backup/restore, or manual assistive-technology certification.

- **Commit tested:** `09b1af5` (branch `main`), working tree clean at start.
- **Environment:** Windows 11; Node `>=22.12.0`; test MongoDB `mongo:8.0` (compose test service, `127.0.0.1:27018`, single-node replica set `rs-test`); Playwright Chromium engine, 3 viewport projects; mock SMS/email/payments adapters only; `NODE_ENV=test` for the e2e API; unit/integration run per-workspace, e2e `fullyParallel`.
- **Commands run (in order):** `npm run closure:check`; `npm run lint`; api + web `typecheck`; api + web `test`; `npm run test:integration`; clean `migrate` ×2 on a throwaway DB + index enumeration; api + web `build`; `npm run test:budget`; focused security/config + perf/determinism node:test subsets; `npm run e2e`; `npm audit`.
- **Closure/guardrails:** `closure:check` 14/14 (596/596 Phase-1 rowed once; 0 missing/dup/unknown; TOURN-024 route assertion holds).
- **Static:** lint clean; api `tsc --noEmit` clean; web `vue-tsc --noEmit` clean.
- **Unit/property:** api **266/266**, web **39/39** (0 fail, 0 skip).
- **Integration/concurrency:** **295/295** (0 fail, 0 skip) — OTP/session, deny-by-default authz, superadmin singleton, atomic seat/final-seat concurrency, waitlist order, immutable rosters, deterministic brackets, versioning/rollback, standings locking, double-entry ledger, exactly-once purchase credit, hold reserve/capture/release/expiry + underflow guard, paid-checkout gate/fees, prize double-credit guard, outbox idempotency + claim/retry/dead-letter, moderation optimistic locking, triage-only recovery, consent-aware analytics, bounded jobs, media publication/deletion protection, perf indexes.
- **Migration:** 22 migrations (`001-foundation`…`022-perf-indexes`) apply clean from empty schema; second run = "No new migrations" (idempotent). Enumerated **60 collections / 184 indexes** (47 unique, 12 partial, 5 TTL) incl. notifications/moderation/operations/media/checkout/prizes + perf indexes. Throwaway `dragon_e2e`/`dragon_migcheck` test DBs remain as harmless local artifacts (destructive-drop guardrail not bypassed). No backup/restore claim.
- **Build/bundle:** api `tsc` build ok; web `vite build` ok; bundle-budget test **pass** — entry `index` ≈272 kB raw / **gzip 89.80 kB**, admin/account views all lazy code-split.
- **Security (focused, maintained tests):** 55/55 across config, proxy-trust, server headers/no-store, payments callback (forged-signature/field-substitution/replay/fee-integrity). Production fail-closed secrets, dev-only routes absent in prod, secure cookie attrs — all asserted green.
- **Performance/load (focused, DRAGON-16c):** perf-index itest + capacity/round-robin/standings-determinism unit + standings-concurrency itest all green (37/37 unit, 35/35 itest incl. perf-indexes). Local regression evidence only, not production capacity.
- **Browser matrix:** 3 viewports (small-mobile 320, mobile 375, desktop 1440) × fa/en journeys (public shell, auth/OTP, account/profile/security, content/games, teams/identities, tournament discovery/detail, registration/waitlist, brackets/standings, wallet/purchase, paid-checkout mock, notifications, moderation, media/SEO, accessibility, forbidden/not-found, logout). One broad run: **258 passed, 1 skipped (intentional — mobile-disclosure case skipped on desktop), 2 failed → both intermittent, root cause unconfirmed** (`teams.spec.ts:58` invitee "invitations" panel) — pass on desktop and pass 4/4 on an isolated `--workers=1` rerun; see "Known flake" below. Not re-run broad again (result assessed).
- **Dependency audit:** `npm audit` **0 vulnerabilities** (full and `--omit=dev`).
- **Evidence mappings changed:** none — broad pass corroborates existing `Verified` dispositions; no new precise per-requirement mapping established; 362 `Evidence pending` rows unchanged (owned by DRAGON-17c). No bulk upgrade.

### Known flake (unconfirmed root cause)
- `teams.spec.ts:58` "owner invites a player, player joins" times out on `getByTestId('invitations')` under the 3-project `fullyParallel` browser run (2/261 executions, narrow viewports only; 0 on desktop; 0 on an isolated `--workers=1` rerun). **Classification: unconfirmed intermittent timing failure — not a settled root cause.** The invitee reaches the page via `inviteePage.goto('/en/account/teams')` (`teams.spec.ts:89`), a full navigation that remounts the SPA and re-fires `TeamsView` `onMounted` → a *same-session stale-cache / fetch-once mechanism is ruled out*. Remaining candidates, not yet distinguished: (a) Playwright's default 5 s expect timeout under `fullyParallel` CPU/DB contention; (b) a write-then-read gap between `POST /teams/:id/invitations` and the invitee's `GET /invitations/mine` (no explicit read-your-writes guarantee observed in `apps/api/src/modules/teams/routes.ts`). The feature itself works (desktop + isolated both green). **Not masked with retries; no test weakened; broad suite not re-run again.** Re-diagnose (raise the assertion timeout or serialize e2e workers to isolate infra-timing vs. API consistency) before final acceptance — not a Phase-1 release-candidate blocker.

### Release-candidate assessment
Technically credible Phase 1 release candidate: all deterministic suites green; the single browser failure is a non-blocking intermittent timing failure (isolated + desktop green), with its root cause left honestly unconfirmed rather than overclaimed. **No unexplained Critical/High defect.** Parent DRAGON-17 stays open; final acceptance disposition and the 362 `Evidence pending` rows remain DRAGON-17c work.

### Risk notes (release-candidate)
| Risk | Evidence | Impact | Mitigation | Owner | Blocks RC? | Blocks final acceptance? |
|---|---|---|---|---|---|---|
| Browser-suite intermittent failure (teams invitations under parallel load; root cause unconfirmed) | 2/261 exec, isolated + desktop green | Intermittent CI red | Re-diagnose: raise assert timeout or serialize e2e workers; check `GET /invitations/mine` read-your-writes | 17c/maintenance | No | No |
| Screen-reader manual certification not performed | Only automated a11y tokens/journeys run | Unverified AT parity | Manual audit in acceptance | 17c | No | Yes |
| SSR/prerender + real wire-status SPA 404 not delivered | SPA-only routes | SEO/soft-404 nuance | Accepted Phase-1 scope | 17c | No | Deferred (accepted) |
| Real SMS/email/payment/analytics providers not integrated | Mock adapters only | No live delivery | Fail-closed gates (OD-007/026/029) | Post-Phase-1 | No | Accepted fail-closed |
| Refund/cash-out/external payout disabled | Feature gates off | No outbound money | Zero prohibited effects proven in itests | Post-Phase-1 | No | Accepted fail-closed |
| Background jobs not always-on scheduled | Bounded runner only | Manual/triggered ops jobs | Bounded batch caps enforced | Post-Phase-1 | No | Accepted |
| Local load ≠ production capacity | Deterministic 16c limits only | No prod latency/capacity guarantee | Documented as local regression evidence | 17c | No | Yes (needs prod rehearsal) |
| Deploy/TLS/backup-restore/observability unverified locally | Out of local scope | Production readiness gap | Deployment rehearsal outside slice | Post-Phase-1 | No | Yes |
| 362 neutral `Evidence pending` mappings | Traceability | Coverage complete, evidence pending | Per-requirement disposition | 17c | No | Yes |

## Delivered by DRAGON-00
- npm workspace with `apps/web` (Vue 3 + Vite + TypeScript) and `apps/api` (Node.js + Fastify + TypeScript), one root lockfile, and root scripts for typecheck, lint, test, build, and E2E.
- Bilingual `fa` RTL and `en` LTR route with locale detection, Persian fallback, runtime switching, and a translation-completeness check.
- API with validated startup configuration, `/health` liveness on port 3000, correlation IDs, and the section 15.2 error envelope.
- Compose stack `web`, `api`, `mongo`; nonroot runtime images; MongoDB on the named volume `dragon-mongo-data`, internal-only as `mongo:27017`.
- Governance artifacts: `ARCHITECTURE.md`, `ENVIRONMENT_VARIABLES.md`, `README.md`, `.dockerignore`, and populated `DECISIONS.md` and `REQUIREMENTS_TRACEABILITY.md`.

## Delivered by DRAGON-01
- Shared kernel: opaque UUID IDs, Money value contract on integer rial and whole Dragon Coin, domain-event envelope, audit envelope, request context, and the shared error hierarchy.
- Mongo access layer: connection management, transaction helper, ordered and race-safe migration runner with version tracking, declared indexes, idempotent system seed (28 roles), and per-run test database isolation.
- Transactional outbox, idempotency store with concurrency-safe replay, and job interfaces.
- Versioned `/api/v1` routing, JSON Schema validation, OpenAPI 3.1 at `/api/v1/openapi.json`, and `/health/ready` backed by a real Mongo ping.
- Module dependency rules enforced by ESLint; `runUnitOfWork` makes audit and outbox writes structural rather than optional.
- MongoDB runs as a single-node replica set so transactions are available.

## Delivered by DRAGON-02
- Design tokens for colour, typography, spacing, radius, elevation, motion, z-index, and breakpoints, with light and dark themes whose contrast is verified against WCAG AA by parsing the stylesheet.
- One application shell serving the public, account, and administration areas: responsive navigation that collapses below 768px, skip link, landmarks, locale switcher, theme control, and a polite notification region.
- Shared states — loading, empty, error, forbidden, not found — plus accessible dialog, form field, table, and pagination components built on native platform behaviour.
- Localization architecture: semantic keys, browser detection with Persian fallback, stored preference, runtime switching that preserves the route, `lang`/`dir` handling, locale-aware dates, numbers, and Toman display, digit normalization, and a completeness check that fails the build.
- Document head handling for localized titles, canonical, hreflang, and `noindex` on account and administration routes.

## Delivered by DRAGON-03
- Iranian mobile normalization to E.164 from nine accepted input forms, including Persian and Arabic-Indic digits, with masked presentation for logs and delivery records.
- OTP request, resend interval, expiry, attempt cap, single use, and per-mobile and per-IP rate limits. Codes are stored only as keyed hashes and never appear in a delivery record or a log.
- Anti-enumeration across the OTP endpoints: identical responses for known and unknown numbers, one generic failure for every unsuccessful verification.
- Sessions in an httpOnly cookie with a hashed token, per-session and global revocation, logout, a recent-authentication window, and recorded security events the user can review.
- Deterministic mock SMS provider with a development-and-test-only inbox route that does not exist in production; email adapter boundary present but delivery disabled.
- Account state machine with audited transitions, suspended accounts blocked from protected routes.
- Profile completion with username normalization and uniqueness, minimum age 13, locale and time zone preferences, privacy-by-default visibility, and a public player identity that returns 404 while private.
- Bilingual sign-in, profile, and security pages with server error codes mapped to localized messages.

## Delivered by DRAGON-04
- Deny-by-default RBAC: a pure permission catalogue and policy evaluator (`shared/authz`), role→permission mapping owned by code and enforced by the seed, and resource-scoped role assignments that prevent IDOR and privilege escalation.
- Administration API under `/api/v1/admin`: masked paginated user list, suspend/reactivate, role assign/revoke with an escalation guard, versioned configuration with dual control for high-risk finance/security keys, and immutable audit search, export, and an emergency oversight queue.
- Every high-risk mutation writes an audit event in the same transaction; super-administrator actions are flagged emergency; audit export records its own event.
- Capability-driven administration frontend: overview, users (suspend/reactivate), and audit (search/export) pages that render from effective permissions and show the forbidden state otherwise, bilingual.
- Authorization-matrix integration tests (401/403/404, IDOR, escalation, dual control, audit, emergency) and browser tests for the forbidden UI in both locales.
- One-time super-administrator bootstrap: a CLI entry point (`bootstrap:superadmin`, no HTTP surface) that grants the first super admin to an existing account, refuses once one exists, and writes an emergency audit event. Procedure documented in `RUNBOOKS.md`.

## Delivered by DRAGON-05
- Content module: six content types (news, article, announcement, guide, rules, page) as bilingual translation-group records; draft → in_review → published → archived lifecycle with scheduling; publication blocked unless both locales are complete; append-only version history; optimistic concurrency; categories and tags.
- Rich content sanitised on write (strict allowlist); the public read path serves already-safe HTML; drafts and scheduled items never leak.
- Games module: bilingual catalog with slug, SEO, lifecycle, and archive (never destructive delete).
- Public read side: content hub with type filter and pagination, content detail with per-locale slug and SEO (title, description, canonical, hreflang using the correct localized slug, Open Graph), games catalog and detail, real 404s.
- Admin: content management with a bilingual editor and lifecycle controls (publisher-only publish/archive), games management, capability-driven navigation.
- Backend tests (slug/sanitize/state unit; content and games integration for authz, publication rules, drafts-not-public, concurrency) and bilingual browser journeys (publish → public in both locales, SEO assertions, draft-404).

## Delivered by DRAGON-06
- Persistent teams module (`modules/teams`): create/edit/view teams with a unique normalized slug, a private-by-default visibility, and a reference to a published game-catalog record; owner and member roles held per membership (a resource-scoped grant, not a fixed team-role column, so Phase 4 delegation is additive — TEAM-002/012).
- Membership and invitation lifecycles: invite by username, accept (idempotent), decline, lazy expiry, remove, and voluntary leave, with membership history retained via effective `joinedAt`/`leftAt` dates.
- Race safety is enforced by partial unique indexes inside the write transaction, never read-before-write alone: one active membership per (team, account), exactly one active owner per team, and one pending invitation per (team, account). Ownership transfer is an atomic demote/promote guarded by the one-active-owner index and conditional filters, so concurrent transfers still leave exactly one owner.
- Every high-risk mutation writes its audit event in the same transaction through `runUnitOfWork`; the owner cannot leave or be removed (transfer or disband first); disbanding archives the team without destroying membership history.
- Immutable, append-only roster snapshots for later tournament registration and match history (BR-007, ASM-004), plus a historical roster reconstruction from membership effective dates.
- Game-specific player identities (in-game name per game) with privacy-aware public views: a public team lists only public-profile members, and a private profile hides its gaming identities entirely.
- Identity module extended with cross-module lookups (username → account id, batch identity summaries, public-only identities, public-profile check) so teams never read identity collections directly (section 32.1).
- Bilingual (fa RTL / en LTR) team hub, team detail with owner/member controls, gaming-identity management, and a public team page; router, navigation, and locale bundles updated with full key parity.
- A single focused `test-reviewer` pass on the ownership/invitation/membership authorization and concurrency paths returned APPROVE with no Critical or High findings. Two low-risk notes were applied (slug is now stable across renames unless explicitly changed; `listTeamInvitations` returns 404 for an unknown team before 403 for a non-owner); the remaining notes were benign read-only consistency windows with no invariant impact.

## Delivered by DRAGON-07
- Tournament-definition module (`modules/tournaments`): bilingual translation-group records with a game reference, individual/team participant type, capacity capped at 1,000 (DEC-046), registration and schedule dates, format family (single/double elimination, round robin, Swiss, custom), custom rules, eligibility, approval mode, waitlist mode, entry fee, refund policy, prizes, and versioned custom questions.
- Fee definitions (TOURN-012) for free, Toman, Dragon Coin, or fixed mixed pricing, held as exact integer `Money` (Toman stored as rial ×10, Dragon Coin as whole units) with no floating-point math; a domain ceiling keeps every amount a safe integer. No payment is executed — these are priced definitions only.
- Versioned prize definitions (Toman and/or Dragon Coin per placement) and a versioned custom-question set: each carries its own version counter that bumps only when the set actually changes, so later submitted answers can be stamped with the question version (TOURN-007).
- Lifecycle (draft → published, with cancel, archive, and a reserved `completed` state owned by DRAGON-09): draft validation that lists every missing mandatory value at once (TOURN-002), cross-field date ordering (registration opens < closes ≤ start < end), preview, clone, optimistic-concurrency edits restricted to drafts, and append-only revision history plus an audit event written atomically with each change.
- Public discovery: list (upcoming first), detail by slug, and a calendar within a date range — all restricted to published tournaments; a draft/cancelled/archived tournament is a real 404 and the internal question set is never exposed publicly (TOURN-029).
- Capability-driven tournament administration UI (authoring form, lifecycle controls, clone, preview) gated on `tournament.manage`, and bilingual public list, detail, and calendar views; router, navigation, admin capabilities, and locale bundles updated with full key parity.
- OD-006 handled by feature-gate: no approved game/publisher/federation rule profiles are shipped, so tournaments use custom free-text rules (always publishable) and named external profiles stay out of scope until OD-006 resolves.
- Authoring authority uses the existing global `tournament.manage` permission (any holder manages any tournament), matching the content and games modules; resource-scoped organizer/referee ownership is deferred to DRAGON-08 operations.
- One focused `test-reviewer` pass over money handling, publication gating, authorization, and lifecycle: verdict APPROVE, no Critical/High. Two Medium notes were addressed — money amounts now have a domain ceiling so an oversized fee is a clean 422 rather than an overflow 500, and publication now aggregates missing-value and date-order problems together.

## Delivered by DRAGON-08
- Registration module (`modules/registrations`): individual and team registration for published, free tournaments, with eligibility evaluation (participant-type match, registration window, complete-profile, minimum age, in-game identity), versioned custom-question answers stamped with the question-set version (TOURN-007), and immutable answers.
- Database-enforced invariants (never read-before-write): capacity is claimed by an atomic conditional `$inc` on a per-tournament seat counter (`mainCount < capacity`, capacity frozen at publish) so concurrent final-slot requests cannot overbook (TOURN-005); a partial unique index on `(tournamentId, subjectId) where active:true` guarantees one active registration per participant, so concurrent duplicates collapse to one active entry and one conflict (TOURN-009); `withIdempotency` makes a replayed submit return the same registration (TOURN-013); waitlist positions come from a monotonic `$inc`, giving deterministic, unique ordering (TOURN-006).
- Team registration is owner-only and captures an immutable roster snapshot via the teams module (reusing `captureRosterSnapshot`, which enforces ownership and an active team) — TOURN-009/TOURN-010.
- Approval workflow: automatic approval seats immediately (or waitlists when full and enabled, else rejects as full); manual approval creates a pending entry and an administrator approves (claims a seat), rejects with a required reason, waitlists, promotes a waitlisted entry, or cancels; cancelling or rejecting an approved entry releases its seat (which an administrator then fills by promotion — no auto-promote). Every decision writes an audit event and a domain event to the outbox in the same transaction.
- Administration queue is resource-scoped: routes are nested under `/admin/tournaments/:id/registrations` and gated on `tournament.manage` scoped to that tournament, so a resource-scoped organizer/referee operates only their own tournament and cannot reach another's (IDOR closed, TOURN-018); the queue is filterable and cursor-paginated with a seat summary — bounded queries at the 1,000 scale.
- Participant status endpoint plus a bilingual public registration panel (register, live status, withdraw) on the tournament detail, and a bilingual admin registration queue (approve/reject/waitlist/promote/cancel) with a seat summary.
- OD-007: paid registration and refund execution stay disabled — a non-free tournament rejects registration with `PAYMENT_NOT_AVAILABLE` until DRAGON-11/12.
- One focused `test-reviewer` pass over concurrency, authorization, IDOR, waitlist promotion, duplicate prevention, and capacity enforcement: verdict APPROVE, no Critical/High. One Low DRY note was applied (the active-flag now derives from `isActiveState`). One Medium note is a property of the shared `withIdempotency` helper (completion is not written inside the registration transaction): a process crash in a narrow window can leave an idempotency key `in_progress` until its 24h TTL, but this can never overbook or create a duplicate (the seat counter and active-unique index still hold), so it is recorded as a known limitation rather than changed here (rewriting shared infrastructure is out of scope).

## Delivered by DRAGON-09a
- Pure, deterministic competition engine (`modules/competitions/engine.ts`): reproducible seeding (a caller-supplied manual order, else a stable sort by a keyed SHA-256 of the seed and participant id — order-independent, no RNG/clock), standard balanced bracket seeding, single-elimination generation with correct byes for non-power-of-two counts (byes assigned to top seeds and pre-advanced), and round-robin scheduling by the circle method (every pairing once per leg, one rest per round for odd counts, home/away alternating by leg). Match `key`s are logical/positional so the structure is stable and property-testable; opaque ids are assigned on persistence.
- Configuration validation (`validation.ts`): rejects unsupported formats (double elimination, Swiss, manual/custom are validated as unsupported here — delivered by DRAGON-09b), duplicate participants, and participant counts outside each format's limits (single elimination 2–1000, round robin 2–64 synchronous; larger round robin via a background job is DRAGON-09c), before any generation.
- Competition service (`service.ts`): generates a competition from a tournament's **approved** registrations only (the authoritative participant source), carrying each team entry's immutable registration-time roster snapshot into its match slots (TOURN-010); records match results with deterministic single-elimination advancement.
- Database and concurrency guarantees: one competition per tournament via a unique index on `tournamentId` (concurrent generation collapses to one, no duplicate state); results recorded under an optimistic `(version, state:ready)` guard so concurrent progression on a match yields one success and one conflict, a result is applied at most once (idempotent replay of the same result, conflict on a different one), and a match never advances without an accepted result (byes are the only structural pre-advance). Every write goes through `runUnitOfWork` (transactional audit + outbox event); persisted competitions and matches use stable opaque ids; no floating-point or money behavior.
- Scope boundary: this slice adds no user-facing UI and no HTTP surface — bracket administration and operational control UI are later slices/prompts (09b/09c/10), so the browser suite is unchanged. Authorization is preserved unchanged (the service carries the request context for audit; the gated HTTP surface arrives with the control UI).

## Delivered by DRAGON-09b
- Double-elimination engine (`modules/competitions/double-elimination.ts`): deterministic winners and losers brackets built from a slot-source graph. A winners-bracket loser drops to a fixed losers-bracket fixture, a losers-bracket loser is eliminated (a second loss), byes are modelled as permanently-empty slots that advance structurally without counting as a loss (non-power-of-two counts produce a valid bracket), and the two bracket champions meet in a **single** grand final. Validated by an independent play-out simulator for n=2..32 (single champion, no participant exceeds two losses, no self-play, no duplicate per round).
- Swiss engine (`swiss.ts`): round-incremental deterministic pairing — score groups by accepted-result wins, ordered by score then seed, paired by a backtracking matching that avoids prior pairings when a rematch-free perfect matching exists and falls back deterministically otherwise; odd counts give one bye (no fabricated opponent) to the player with the fewest prior byes, then the lowest score, then the lowest seed. The next round is generated only after the current round completes; a unique key index makes concurrent generation of a round collapse to one.
- Manual / custom format (`manual.ts`): a validated declarative competition graph (data, never executable code — OD-006). Validation rejects duplicate fixture keys, out-of-range or reused participant seeds, missing/invalid downstream targets, self-dependency, self-pairing, conflicting downstream writers, orphan slots, cycles (Kahn), and size/depth beyond bounds; a result can only ever propagate inside the validated graph.
- Service (`service.ts`): format-dispatched generation, deterministic single-elimination/double-elimination/manual advancement (winner → next, loser → losers bracket / manual loser slot) with a bye cascade (`#fillCascade`) for empty-sibling walkovers, and `generateSwissRound` from accepted results. Matches now carry a logical `key`, `bracket` side, empty-slot markers, and loser-routing; the competition stores its seeded participants (with roster snapshots) and Swiss progression.
- Database safeguards: a unique `(competitionId, key)` index makes logical fixture keys unique within a competition and is the authority that collapses concurrent Swiss-round (and duplicate manual/bracket) generation to one; the existing unique `tournamentId` still enforces one competition per tournament; results stay under the optimistic `(version, state:ready)` guard.
- Gated policies (recorded, not invented): the double-elimination grand-final **reset** variant and the exact Swiss **bye scoring / tiebreak** are defined by rule profiles, which OD-006 keeps gated (BRACKET-007); this slice ships a single grand final and a bye-counts-as-a-win default and gates the alternatives. Synchronous size limits: single elimination ≤1000, double elimination ≤256, round robin ≤64, Swiss ≤16, manual ≤256 fixtures / depth ≤32.
- One focused `test-reviewer` pass over double-elimination routing, Swiss rematch/bye invariants, custom-graph validation, result idempotency, concurrency, and resource-scoped authorization: verdict APPROVE, no Critical/High. One correctness Medium was fixed — the manual graph now rejects reusing a participant seed across fixtures (which could double-book a participant or route the same participant into both sides of a later fixture). No routes/UI were added, so authorization is unchanged from 09a.

## Delivered by DRAGON-09c
- Deterministic standings projection (`modules/competitions/standings.ts`): a pure calculator per format — points-based for round robin / Swiss / manual, placement-based (champion, runner-up, eliminated-by-round, active) for single and double elimination. Ranking is competition ranking (1, 2, 2, 4): tied participants share a rank and the seeded order is the sole stable final fallback; no wall clock, insertion order, or database natural order affects ordering. Only accepted (completed/bye) results count; every participant appears exactly once; manual returns a partial (wins-derived) ordering rather than an invented total order.
- Versioned standings snapshots (`competition_standings`): each carries competition id, format + policy version, calculation version, source watermark, status (final/provisional/partial), the ranked rows, and a metadata-only timestamp. Exactly one snapshot per competition is current (unique partial index) and one per calculation version; a recalculation runs inside the mutating transaction under an optimistic `standingsVersion` guard, so concurrent recalculation yields exactly one current projection and a stale projection cannot overwrite a newer one. Recalculation is deterministic and reconciles: recomputing from the same accepted results reproduces the stored rows.
- Result correction and versioning (`competition_result_corrections`, TOURN-022): a completed result can be corrected with an expected-version guard; the original is preserved in an immutable, append-only revision (prior/corrected result, reason, actor, correlation id, revision number, timestamp) written atomically with the recalculated standings and an audit + outbox event. A same-key same-payload retry is idempotent (`withIdempotency`, scope `result_correction:matchId`) and creates no new revision; a stale version conflicts; concurrent different corrections yield exactly one winner and the loser writes nothing.
- Downstream-history boundary (session-consistent): a correction whose match feeds an already-completed downstream fixture is refused with `DOWNSTREAM_HISTORY_CONFLICT` — the check is re-verified inside the correction transaction so a concurrent result completing the downstream cannot slip past; an allowed correction only re-points a not-yet-completed downstream slot. History is never silently rewritten.
- Lock / finalize lifecycle (BRACKET-012): `open → correction_limited → locked`, an optimistic `lockVersion`-guarded, audited transition. A finalized competition rejects ordinary result entry and corrections (both re-checked inside their transactions); concurrent lock transitions yield exactly one accepted change. No rollback or regeneration deletes immutable result or audit history.
- Load-safe reads: the bracket and admin competition endpoints are keyset-paginated over (round, index) on a declared index; standings is a single bounded snapshot document; participant identity is the seed number. Standings recalculation is synchronous within the approved size limits; a background dispatcher (DRAGON-14) is unnecessary within those limits.
- HTTP surface: public `GET /tournaments/:id/standings` and `/tournaments/:id/bracket` (published tournaments only), and admin generate / result / correct / lock / recalculate / swiss-round routes gated on `tournament.manage` scoped to the path tournament, with each match/competition validated against the route tournament (cross-tournament IDOR → 404). This is the first HTTP surface for the competition engine (09a/09b had none).
- Accessible bilingual presentation: a standings table (caption, column headers, tied and placement labels, no color-only signalling) and a textual bracket on the tournament detail page, with a status indicator (provisional / final / partial / finalized), in fa RTL and en LTR.
- One focused `test-reviewer` pass over deterministic ranking, correction authorization, optimistic concurrency, idempotency, downstream-history protection, projection races, load-safe reads, and cross-tournament IDOR: verdict APPROVE, no Critical/High. One Medium correctness note was fixed — the downstream-history and lock checks are now re-verified inside the mutating transaction so a concurrent completion/lock cannot slip past.
- **DRAGON-09 is complete** (09a single-elim/round-robin + 09b double-elim/Swiss/manual + 09c standings/corrections/concurrency).

## Delivered by DRAGON-10
- Immutable bracket versioning (`competition_bracket_versions`, BRACKET-010/013/014): generation records version 1; every regeneration and rollback appends a version and increments the competition's `activeVersion`. A version carries its origin (generation/regeneration/rollback), the seed and participant seed-order it was built with, a reason, and — once superseded — a full snapshot of its matches including any recorded results. Two database safeguards make concurrent operations safe: a unique `(competitionId, versionNumber)` index and a partial-unique `(competitionId) where state:'active'` index, so exactly one active version can ever exist. The active version's live matches are snapshotted into its record before they are deleted, so **no approved result is ever lost silently**.
- Regeneration (`regenerate`, destructive): rebuilds the bracket from the current participants (optionally a new seed) for any format. It requires an explicit confirmation and a non-empty reason (validated server-side, not just in the UI), refuses a finalized competition (re-checked inside the transaction), and guards on the competition `version` so concurrent regeneration yields exactly one success. A non-mutating `regeneratePreview` reports how many recorded results the current bracket holds and the next version number before anything changes.
- Rollback (`rollback`, destructive/result-changing): restores a superseded version's matches — with the results recorded at supersede time — plus its seed order and seed, as a new active version referencing the one it restored. It is itself reversible (the current active version is snapshotted first), confirmation- and reason-gated, refuses a locked competition, and is version-guarded. Standings are recomputed inside the same transaction so the projection always matches the restored matches.
- All five formats are operable from creation through completion over the HTTP surface with no database or code intervention: generate → (Swiss: generate-next-round) → record result / correct result → lock/finalize, plus regenerate and rollback. Verified end to end by integration tests for every format.
- Operator console (`AdminTournamentCompetitionView.vue`, gated on `tournament.manage` scoped to the tournament): a playable-first match queue with result entry (optional scores) and reason-gated correction, Swiss round progression, lock/finalize control, destructive regeneration with an impact preview + confirmation + reason, and the immutable version history with per-version rollback. Bilingual fa RTL / en LTR; every error code maps to a localized message.
- Public bracket presentation (`TournamentDetailView.vue`): the whole bracket is paged in and grouped by round into horizontally-scrolling columns with round quick-navigation (responsive large-bracket navigation), plus print (print-optimized styles) and shareable-link actions. The tournament URL is the shareable/participant view.
- One focused `test-reviewer` pass over result-loss, optimistic concurrency and one-active-version races, authorization/IDOR on the new routes, destructive-action gating, lifecycle correctness, and standings consistency: verdict APPROVE, no Critical/High. One correctness note was fixed — rollback now restores the version's seed order and seed (not only its matches), so public seed labels match the restored bracket; a 4-participant reseed→rollback regression test was added.
- **DRAGON-10 is complete.**

## Delivered by DRAGON-11a
- Immutable double-entry ledger (`modules/ledger/`, WALLET-001..008): three collections — `ledger_accounts`, `ledger_transactions`, `ledger_entries`. Sign convention is a single signed `amount` added directly to the account balance; a transaction is balanced when its entries sum to exactly zero for the one asset and scale it carries (no debit/credit column).
- Pure journal invariants (`journal.ts`, database-free, property-tested): at least two entries and at most 64; no zero entries; safe-integer amounts with running-sum overflow rejection; one asset and one scale per transaction; account-type-vs-transaction-type relationship validation. Nothing partially balanced is ever stored — a failing command throws before the posting transaction opens.
- Account model (`accounts.ts`, code-owned policy): `user_dragon_coin` (no negative) plus system singletons `platform_dragon_coin_treasury`, `cash_clearing`, `tournament_fee_holding`, `refund_clearing`, `prize_payable`. Clients never choose debit/credit accounts; a posting names a transaction type and accounts resolve by role. One canonical account per role/owner/asset/scale via a unique `identityKey` index; concurrent first-touch collapses to one record. Only DRC transaction types post in this slice; the IRR clearing accounts are declared placeholders (no user Toman wallet/endpoint/UI — WALLET-009/DEC-050 respected).
- Posting service (`service.ts`, internal only — no HTTP): `post` (balanced, idempotent), `compensate` (correction by a new reversing transaction), `getBalance`/`getBalanceByRef`, and cursor-paginated `listEntries`. The idempotency scope is `ledger:{type}:{businessRef}` with a canonical semantic hash (no timestamps/UUIDs/order); account resolution runs inside the idempotency gate so a genuine replay short-circuits even if an account was later disabled. Every posting carries a durable, globally-unique `businessRef` (unique index) as a second duplicate-posting safeguard, and a compensation is unique per reversed transaction (partial-unique `reversalOf`). The reserved `compensation` type is not reachable from `post()`.
- Transactional posting boundary: header, all entry lines, the balance projection, audit row, and outbox event commit inside one MongoDB transaction; a mid-transaction failure (e.g. insufficient funds after the header and entries were written) rolls back everything — no header, entries, balance change, audit, or outbox — proven by an integration test.
- Balance model: immutable entries are authoritative; each account keeps a transactionally-maintained `balance` projection and monotonic `balanceVersion`, rebuildable and reconciled. Negative-balance policy is enforced by an atomic conditional `$inc` (`balance: { $gte: -amount }`), not a pre-transaction read, so exactly one of two concurrent final-balance spends succeeds (the loser retries on write-conflict and fails `INSUFFICIENT_FUNDS`) and no user account goes negative.
- Reconciliation primitives (`reconciliation.ts`, read-only, never repairs): verify a transaction balances to zero with matching asset/scale and contiguous unique line numbers; recompute an account balance from entries and compare with the projection; detect orphan entries; a bounded report over an explicit ≤100-account list (unbounded requests rejected). Findings are structured (checkId, opaque entityRef, expected, actual, severity, explanation) with no user data.
- Stable domain errors: `UNBALANCED_TRANSACTION`, `MIXED_ASSET`/`MIXED_SCALE`, `ZERO_ENTRY`, `UNSAFE_INTEGER`/`AMOUNT_OVERFLOW`, `INVALID_ACCOUNT_RELATIONSHIP`, `UNSUPPORTED_TRANSACTION_TYPE`, `DUPLICATE_BUSINESS_REFERENCE`, `DUPLICATE_COMPENSATION`, `INSUFFICIENT_FUNDS`, `ACCOUNT_DISABLED`, `RECONCILIATION_UNBOUNDED`, plus the shared idempotency conflicts — never a raw Mongo duplicate-key or collection name.
- Indexes (migration `013-ledger`): unique account identity; unique transaction business reference; partial-unique reversal; unique `(transactionId, lineNumber)`; account-entry pagination `(accountId, recordedAt, _id)`; transaction-by-correlation. Uniqueness and partial-filter options are asserted by an integration test.
- One focused `test-reviewer` pass over balance invariants, immutable history, idempotency, overspending concurrency, rollback, account authorization, integer/asset correctness, and reconciliation: verdict APPROVE, no Critical/High. Two correctness notes were fixed: `post()` now rejects the reserved `compensation` type (which would otherwise bypass the account-relationship policy), and account resolution moved inside the idempotency gate so a replay returns the original even if a referenced account was later disabled. The shared idempotency crash-window is unchanged; the unique `businessRef` index guarantees no double financial effect (a post-crash retry surfaces `DUPLICATE_BUSINESS_REFERENCE`, never a second posting).
- Deferred to DRAGON-11b/11c (OD-007/DEC-050 gated): mock payment provider and callbacks, checkout, paid-registration activation, refund execution, prize payout, holds (WALLET-006), wallet purchase UI, and admin financial adjustment UI.
- **DRAGON-11a is complete; parent DRAGON-11 remains open.**

## Delivered by DRAGON-11b
- Dragon Coin purchase lifecycle (`modules/payments/`, PAY-003/006): an immutable-identity purchase with a versioned state machine (`created`/`payment_pending` → `succeeded`/`failed`/`cancelled`/`expired`, and `succeeded` → `corrected`). Terminal states never return to pending; transitions are optimistic-concurrency guarded.
- Code-owned versioned packages (`packages.ts`, PAY-012): starter/plus/pro bind an exact rial price and whole Dragon Coin quantity at `PRICING_VERSION=1`. The client selects a package code; the server owns the rate and coin amount (no client-supplied exchange rate, no dynamic pricing). Toman is derived (÷10) for display; rial is charged.
- Deterministic mock provider (`provider.ts`, PAY-012): a narrow `PaymentProvider` interface a real provider could implement without changing ledger rules. No network call; deterministic outcomes; callbacks authenticated with an HMAC-SHA256 over a fixed-order canonical string (provider, providerRequestId, purchaseId, rialAmount, asset, eventType, eventId), compared in constant time. Every callback is untrusted input.
- Exactly-once Dragon Coin crediting: a verified success callback and the ledger credit commit in one transaction (`LedgerService.writeWithin`) under the durable business reference `dragon_coin_purchase:<id>`. Three DB authorities make it exactly-once independent of provider idempotency — the unique ledger `businessRef` index, the partial-unique `purchase_ledger_tx_unique` index (one ledger tx per purchase), and the unique `(provider, eventId)` provider-event index. Duplicate/concurrent callbacks converge to the stored result; a purchase is never `succeeded` without a linked ledger transaction, and no credit posts without the linked purchase. Two concurrent callbacks (same or different event ids) yield exactly one credit — proven by integration tests.
- Callback binding + failure handling: the verified callback is bound to the server-created purchase (provider, providerRequestId, asset, exact rial amount) before any effect; the credited quantity always comes from the server quote. Failure/cancellation transition without crediting; a signature/amount/reference mismatch is rejected and recorded as a rejected provider event; a late success after expiry settles the purchase as `expired` with no credit (documented rule); conflicting outcomes are rejected (`CONFLICTING_PROVIDER_EVENT`) and never overwrite history.
- Correction by compensation (`correctPurchase`, finance-gated, WALLET-004/007, PAY-009): a `finance.approve` operator reverses a successful purchase with exactly one compensating ledger transaction committed together with the `succeeded`→`corrected` transition, guarded by expected version and a unique correction reference (duplicate correction prevented). A reversal that would drive the user balance below zero is rejected (`INSUFFICIENT_BALANCE_FOR_CORRECTION`) — no silent debt. Never edits a posted credit.
- HTTP surface (`routes.ts`): session-gated user routes (list packages, create purchase, get owned purchase, list own history, get Dragon Coin balance) with identity from the session only; a provider callback route that uses no browser session as authority and returns a generic acknowledgement; a **fail-closed** mock-pay control registered only outside production; and a finance-gated correction route. Every mutation has JSON-Schema validation, stable domain errors, rate limiting, correlation id, and audit. No arbitrary ledger-posting endpoint. Owner views expose no ledger id, business reference, provider reference, or correlation id.
- Bilingual wallet UI (`AccountWalletView.vue`, `/account/wallet`): packages with exact Toman and Dragon Coin, purchase initiation, all lifecycle states, current balance, purchase history, loading/empty/error states, fa RTL / en LTR, no raw provider errors or internal ids, no color-only status, locale-aware integer/Toman formatting. Success is never shown before the verified callback and credit commit.
- Config + fail-closed startup (`config.ts`): `PAYMENTS_CALLBACK_SECRET` (required and length-checked in production), `PAYMENTS_MOCK_ENABLED` (off in production unless explicit), `PAYMENTS_PURCHASE_TTL_SECONDS`. Documented in `.env.example` and `ENVIRONMENT_VARIABLES.md`.
- Ledger reuse (no parallel wallet): DRAGON-11a's `LedgerService` gained `ensureAccounts`, `writeWithin` (post a balanced journal inside a caller's transaction), `buildCompensation`, and `mapDuplicateKey` so payments commit the credit atomically with the purchase transition; `post`/`compensate` and all 11a invariants are unchanged and still pass.
- One focused `test-reviewer` pass over callback authenticity, amount/purchase binding, exactly-once crediting, duplicate/concurrent callbacks, state-machine correctness, rollback atomicity, cross-user IDOR, correction authorization, and secret/provider-data exposure: verdict APPROVE, no Critical/High. One Low note was hardened — the self-serve `/payments/mock/pay` control is now fail-closed and never registered in production regardless of `PAYMENTS_MOCK_ENABLED`, so an opted-in production mock provider still cannot let a caller self-credit.
- Deferred to DRAGON-11c (OD-007/DEC-050 gated): real payment-provider integration, tournament checkout, paid-registration activation, refund execution, prize payout, withdrawable cash, user-to-user transfers, holds (WALLET-006), and admin financial-adjustment UI.
- **DRAGON-11b is complete; parent DRAGON-11 remains open.**

## Delivered by DRAGON-11c
- Balance model (`modules/ledger/service.ts`, WALLET-002/006/007): `availableBalance = ledgerBalance − heldAmount`. `heldAmount` is a projection field on the ledger user account summing active uncaptured hold reservations. A hold reduces available balance without changing the ledger balance; capture converts a hold into an immutable ledger transfer and releases the equal reservation in the same transaction (available unchanged by capture); release/expiry only free the reservation (no journal). Amounts always conserve: `originalAmount = capturedAmount + releasedAmount + remainingAmount`.
- Hold lifecycle (`modules/holds/`): a durable, versioned hold (`active`/`partially_captured` → terminal `captured`/`released`/`expired`/`cancelled`). Creation reserves available balance with an atomic conditional update (`{$expr: balance − heldAmount ≥ amount}` `$inc heldAmount`), so concurrent holds competing for the final available balance yield exactly one winner and available balance never goes negative — proven by an integration test. Every hold carries a durable unique `businessRef` (duplicate creation cannot reserve twice); creation is idempotent per (owner, key).
- Capture: converts part or all of a hold into a ledger transfer (user → code-owned DRC destination) committed with the hold update; the per-capture ledger `businessRef` `dragon_coin_hold_capture:<holdId>:<seq>` and the optimistic hold `version`/`captureCount` guards make concurrent captures yield exactly one credit and replay idempotent. Capture cannot exceed the remaining amount; partial capture is per-purpose. A captured hold always links a ledger transaction; a failed ledger post rolls the whole thing back.
- Release/cancel: returns reserved availability with no journal (idempotent); cancellation is a full release. Expiry: deterministic on the server clock (never a client time), applies only to open holds, releases the remaining amount, and is a bounded, paginated callable primitive (`expireDueHolds`, ≤100/batch) with per-hold version guards making duplicate/concurrent expiry safe — the full scheduler stays with DRAGON-14. `releaseHeld` is a strict atomic invariant — it applies only when the account's current `heldAmount` ≥ the release amount (never clamps or repairs), so the reservation can never underflow; an inconsistent projection throws `HELD_INVARIANT_VIOLATION` and rolls the whole transaction back.
- Typed transfer boundaries + feature gates (`purposes.ts`): source/destination account classes are code-owned; a client never chooses accounts. Every transfer type required by later workflows (`user_to_user`, `refund_execution`, `prize_payout`, `withdrawal`) is fail-closed disabled and returns `TRANSFER_FEATURE_DISABLED` with no hold/journal/audit/outbox effect. The only enabled hold purpose is `admin_correction` (finance-authorized, captured to the platform treasury); `tournament_entry_fee` (OD-007) and `prize_reservation` are gated and cannot create a hold. Proven to produce zero effects by integration tests.
- Reconciliation (`holds/reconciliation.ts`, read-only, bounded ≤100 accounts, never repairs): amount conservation per hold, `heldAmount` vs open-hold remaining, non-negative available balance, capture-to-ledger linkage / orphan capture references, and expired-still-open holds. Structured findings, opaque references only.
- HTTP surface: session-gated user reads (`/wallet/summary` ledger/held/available, `/wallet/holds`, `/wallet/holds/:id` — owner-scoped, IDOR-closed, no internal ledger account id or business reference exposed); finance operations gated on `finance.manage` (create/capture/expire/reconcile) and `finance.approve` (force-release), each with JSON-Schema validation, stable errors, rate limiting, correlation id, and audit. No generic create/capture/transfer endpoint for arbitrary clients.
- Wallet UI (`AccountWalletView.vue`): shows total, held, and available Dragon Coin plus an owned-holds list with purpose and status, bilingual fa RTL / en LTR, exact integer formatting, empty/loading/error states, no internal financial identifiers.
- One focused `test-reviewer` pass over insufficient-funds enforcement, hold/capture/release/expiry concurrency, amount conservation, ledger atomicity, duplicate effects, feature-gate bypass, cross-user IDOR, admin-override authorization, and reconciliation: verdict APPROVE, no Critical/High. A Low defense-in-depth note prompted a stricter guard than suggested: rather than floor `heldAmount`, `releaseHeld` now enforces a strict atomic invariant (release only when current `heldAmount` ≥ amount, otherwise `HELD_INVARIANT_VIOLATION` with a full rollback and no silent repair), backed by focused regression tests (exact-remaining release succeeds; over-release fails leaving hold/held/audit/outbox/ledger unchanged; concurrent releases cannot underflow; reconciliation reports projection drift without repairing).
- Deferred to DRAGON-12+ (still gated): real payment-provider integration, paid tournament checkout activation, participant refund execution, prize distribution, withdrawable cash, user-to-user transfers, arbitrary admin ledger posting, and the background expiry/reconciliation scheduler (DRAGON-14).
- **DRAGON-11c is complete. Parent DRAGON-11 (11a ledger + 11b mock purchase + 11c holds/transfers) is complete.**

## Delivered by DRAGON-12
- OD-007 fail-closed gate (`config.ts`, `PAID_TOURNAMENTS_ENABLED`): paid registration checkout is off everywhere unless the flag is exactly `true`; a disabled gate produces no registration, hold, checkout, or ledger effect. Free tournaments keep the direct `register()` path.
- Paid registration checkout (`modules/checkout/`, migration `016-checkout`): server-recalculates the fee from `tournament.fee` (Toman/rial + Dragon Coin components; never client-supplied). A checkout reserves a main seat via a new `pending_payment` registration state and, for a Dragon Coin fee, a `tournament_checkout` hold — both in one transaction at start. Completion (verified Toman provider callback and/or Dragon Coin hold capture) activates the registration (`pending_payment`→`approved`), posts the Toman fee to the ledger (`cash_fee_collection`: cash_clearing → tournament_fee_holding), and captures the hold — **all atomically in one transaction**. Idempotent start; a duplicate or concurrent success callback converges to the activated result (unique checkout/ledger business references + version guards); a failed/cancelled/expired checkout releases the seat and the hold with no fee collected. Only the mock provider and approved ledger are used — no live provider, Dragon Coin refund, or cash-out.
- Registration integration (`registrations/`): the new `pending_payment` state holds a main seat and blocks duplicate active entries; paid activation/cancellation run inside the checkout's transaction via within-uow methods. The generic admin/self decision path (`approve`/`reject`/`waitlist`/`cancel`) refuses a `pending_payment` registration (`REGISTRATION_PAYMENT_PENDING`) so it can never be granted a free seat, double-claim capacity, or orphan its checkout — those registrations are owned entirely by the checkout flow.
- Prize allocation + entitlements (`modules/prizes/`, migration `017-prizes`): versioned allocation from final standings, idempotent per standings calculation version. Organizer-defined Dragon Coin prizes credit immediately and idempotently through the ledger (keyed `prize_drc:<tid>:<rank>:<account>` so re-allocation after a standings correction never double-credits and never claws back an already-credited coin prize); organizer-defined Toman cash prizes become pending entitlements, and a re-allocation supersedes prior unpaid (pending/approved) cash entitlements without touching paid ones.
- Cash entitlement lifecycle (finance): `pending`→`approved`→`paid` (or `→failed`), each reasoned; marking `paid` requires off-platform settlement evidence and `finance.approve` (allocation, approve, fail require `finance.manage`). No external payout provider and no cash-out ledger movement — an entitlement records the obligation and its manual settlement only.
- HTTP surface: session-gated participant checkout (start/status/list/confirm/cancel — owner-scoped, IDOR-closed, no internal ledger/registration/business-reference detail) and prize-entitlement reads; an untrusted provider callback with no session authority; a fail-closed non-production mock-pay control; finance-gated prize allocation and entitlement settlement. Fees are always server-recomputed.
- Bilingual UI: a paid checkout flow on the tournament detail page (pay-and-register → awaiting payment → mock settle → registered; never shows registered before activation) and a prize-entitlements list in the wallet, fa RTL / en LTR, exact integer formatting, no internal identifiers.
- One focused `test-reviewer` pass over fee integrity, atomic activation, exactly-once/no-double-charge, failed/cancelled paths, the OD-007 gate, IDOR/authorization, prize double-credit prevention, the registration state machine, and data exposure: **one Critical was found and fixed** — the generic admin `approve()`/`cancel()` path could act on a `pending_payment` registration (a free seat grant + capacity double-claim without the fee); it is now refused with a stable error and covered by regression tests. No other Critical/High; the reviewer confirmed fee integrity, atomicity, exactly-once, the fail-closed gate, IDOR, and prize correctness as sound.
- Deferred to DRAGON-13+ (still gated/out of scope): real payment-provider integration, participant Toman refunds, prize cash-out via a provider, Dragon Coin refunds, and the background checkout/entitlement scheduler (DRAGON-14).
- **DRAGON-12 is complete.**

## Delivered by DRAGON-13
- Idempotent domain-event outbox consumer (`modules/notifications/service.ts`): a code-owned event→template map turns pending `domain_event_outbox` events into in-app notifications (unique per account + source event + template) and gated channel deliveries, marking each event dispatched — all in one transaction. Redelivery and concurrent consume produce exactly one notification (unique index + pre-check; the batch loop tolerates a concurrent duplicate and leaves the event pending for the next pass). This is the platform's first outbox consumer; the general background dispatcher is DRAGON-14.
- In-app inbox + read state (`notifications` collection): participant-owned, cursor-paginated, localized client-side from `templateKey` + bounded params (no server-rendered string, no recipient detail). Mark-one / mark-all read + unread count. Owner-scoped (cross-user id → not found).
- Preferences (`notification_preferences`, OD-008 gated): per-account by category (transactional/marketing) × channel. Transactional in-app is always on; enabling any SMS/email/marketing class is refused (`NOTIFICATION_CLASS_DISABLED`), and marketing consent is a separate class a transactional message can never reuse.
- Channel deliveries with retry/dead-letter (`notification_deliveries`): a due `pending` delivery is claimed atomically so concurrent processors cannot double-send, sent through a deterministic mock adapter, retried after a backoff, and dead-lettered after 3 attempts. A delivery is sent only when the channel gate is on, the recipient consented for the category, and an approved template exists — otherwise stored `suppressed` with a reason. **Only a verified contact is ever messaged**; recipients are masked in every stored record and route.
- Channels (`channels.ts`): a deterministic `MockSmsChannel` (approved adapter; delivery/failure by number, no network) and a `MockEmailChannel` writing to a non-production local sink only. Both fail-closed: SMS under OD-008 (`NOTIFICATIONS_SMS_ENABLED`, default off; OTP SMS is unaffected — the identity module's own path), email under OD-003 (`NOTIFICATIONS_EMAIL_ENABLED`, default off, no live provider).
- Versioned localized templates + operator approval (`notification_templates`): create (draft) → approve (`support.manage`), one version per (key, channel, version); a draft never renders/sends. Per-tournament template enablement (`notification_template_enablements`). Unknown template keys rejected. Marketing and transactional templates are distinct categories.
- Operator visibility (`support.manage`): list templates, list deliveries (recipients already masked), and a bounded consume+deliver trigger (`POST /admin/notifications/process`) — the operational primitive DRAGON-14 will schedule.
- HTTP surface: session-gated participant inbox + preferences; operator-gated template/enablement/delivery/process routes. No unauthenticated mutation and no external callback (in-app is the entry channel).
- Bilingual UI: an in-app notification inbox (`NotificationsInboxView.vue`, `/account/notifications`) rendering each item from its template key + params, with per-item and mark-all read, empty/loading/error states, fa RTL / en LTR, no internal or recipient detail.
- One focused `test-reviewer` pass over consumer idempotency, retry/dead-letter, channel gating, marketing-vs-transactional consent, privacy/masking, IDOR/authorization, and template approval: verdict APPROVE after fixes, no remaining Critical/High. **One Blocker was found and fixed** — the contact lookup now returns only a **verified** mobile/email, so an unverified or stale address can never be messaged; and the consume loop was hardened so a concurrent duplicate never fails the batch (a concurrency regression test was added).
- Deferred to DRAGON-14+ (still gated/out of scope): the background dispatcher/scheduler that drains the outbox and retries deliveries automatically, live SMS/email providers, and the enabled tournament-SMS / marketing preference classes.
- **DRAGON-13 is complete.**

## Delivered by DRAGON-14
- Moderation report intake + case management (`modules/moderation/service.ts`): a participant report collapses into (or opens) exactly **one** open case per subject via a partial-unique index on `{subjectType, subjectId}` where `state ∈ {open, assigned}`; a concurrent report that loses the insert race retries once and links to the winning case. Reports are rate-limited (10/hr per reporter). Case lifecycle — assign, set severity, flag emergency, and act (suspend / remove / dismiss) — is version-guarded (optimistic `expectedVersion` + `matchedCount`) with every change audited in the same transaction; a searchable list filters by state/severity/subject.
- Suspension boundary: `act(suspend)` is allowed **only** for a `user` subject and routes solely through a narrow identity adapter (`transitionAccountState → 'suspended'`, emergency-aware) — moderation never touches authentication internals; a non-user suspend is refused and leaves the case untouched.
- Support cases (`support.manage`): open (participant), owner-scoped read (cross-user id → not found; operator may read any), operator list + assign/resolve/close transitions, all audited. No SLA claim is published (OD-023).
- Account-recovery review is **triage-only** (OD-029): `reviewRecovery` can mark a request `reviewed` or `rejected` but **refuses** `approved`/`approve` with `RECOVERY_APPROVAL_DISABLED`; there is no approval or session-restoring path, review never bypasses authentication, and the operator list **masks** the account id (`accountMasked`, raw id never returned).
- Consent-aware pseudonymous analytics + error monitoring behind adapters (`modules/operations/service.ts`): an essential event is always recorded to the internal sink; a nonessential event is dropped unless `consented === true`. The **raw account id is never stored** — only a stable salted SHA-256 pseudonym. No external tracker is integrated and none is ever called; external forwarding requires both the OD-026 gate (`ANALYTICS_EXTERNAL_ENABLED`, fail-closed) **and** an integrated tracker, so it stays disabled. Captured errors are redacted to a single line with control bytes stripped (no stacks/secrets).
- Bounded jobs runner with observability: `runJobs` executes each registered job once (drains the notifications outbox → deliveries → hold expiry → checkout expiry — all bounded and idempotent), recording a `job_executions` row (running → succeeded/failed) and raising a critical `queue` alert on failure. Health/readiness (`checkHealth`) pings Mongo (→ `mongo` alert) and inspects the dead-letter queue (→ `queue` alert); cross-collection `metrics` report pending outbox, dead-letter deliveries, failed jobs, and open alerts. Alerts (`ops_alerts`) carry a typed category (`otp_mock | payment_mock | ledger | bracket | queue | mongo`) and are acknowledgeable; raising and acknowledging are audited.
- HTTP surface: session-gated participant routes (file report, open/list/get own support case, emit a consent-aware analytics event about the caller); `moderation.manage` case routes; `support.manage` support/recovery/operator-ops routes. No route exposes a raw account id or secret.
- Structured redacted logs + correlation IDs: every operation carries the request `correlationId` into its audit + outbox + analytics/alert records; error/alert text is redacted at the boundary.
- Migrations `019-moderation` + `020-operations` (collections + indexes, including the report-collapse partial-unique index); both apply cleanly and are idempotent on re-run.
- Bilingual UI: a participant "report this tournament" action on the tournament detail view (signed-in only, reason + optional details, success + rate-limit states) and a permission-gated (`moderation.manage`) read-only admin **moderation queue** (`AdminModerationView.vue`, `/admin/moderation`) with a state filter; fa RTL / en LTR, keys in both locale bundles.
- One focused `test-reviewer` pass over the moderation + operations backend (suspension, recovery-no-approve, analytics consent/pseudonymity, authorization scoping, transactional integrity, redaction).
- Runbooks (not backup/restore, per the prompt): **migration rollback / forward-fix** (forward-only idempotent runner, stalled-`applying` recovery, reverse via a new corrective migration) and **persistence incident** (Mongo / queue / ledger / bracket / mock-adapter triage via health/metrics/alerts, bounded idempotent re-run, no snapshot restore) added to `RUNBOOKS.md`.
- Deferred / still gated: external analytics + error-monitoring provider activation (OD-026), any published support SLA (OD-023), an account-recovery approval/restore path (OD-029 — permanently triage-only until a supported recovery method exists), and an always-on scheduled trigger for `runJobs` (the runner is a bounded operator/callable primitive; a cron/worker wrapper is a later operational concern).
- **DRAGON-14 is complete.**

## Delivered by DRAGON-15
- Media pipeline (`modules/media/service.ts`, `storage.ts`): a base64 upload is validated by its **actual bytes** — a magic-byte signature check (`detectImageType`) accepts only PNG/JPEG/WEBP, independent of the client filename/MIME (MEDIA-001/002); size (`MEDIA_MAX_BYTES`, default 5 MB) and emptiness are rejected before storage. Bytes are **content-addressed** by SHA-256 (dedup + cacheable/immutable URLs, MEDIA-007) behind a `MediaStorage` adapter boundary (default `MongoBlobStorage`; a deployment can swap S3/GCS with no service change). An asset stays **`staged` (nonpublic)** until an explicit publish (MEDIA-003); only `published` bytes are served. Public serving is a root route `GET /media/:id` (published-only, `image/*` content-type, `immutable` cache, ETag = content hash). Localized alt text is stored, empty allowed for decorative (MEDIA-009/010). Deleting a **referenced** asset is blocked (MEDIA-008) via an injected reference check (content/games cover URLs); shared bytes are only dropped when no asset still points at them. Publish/alt are version-guarded (optimistic `matchedCount`).
- Media admin surface gated on `content.publish` (owning-resource authorization, MEDIA-006): upload/list/get/publish/alt/delete under `/admin/media`. Anonymous upload is rejected (401). Migration `021-media` (asset + blob collections; unique `sha256` index for dedup).
- Public search + filters (`shared/search.ts`): a draft-safe free-text `q` was added to `GET /content`, `GET /games`, and `GET /tournaments`; the query is length-capped and fully **regex-escaped** (no ReDoS/operator injection) and composes with the keyset cursor under `$and` so no page is lost. `q` only **narrows** the existing published/public filter, so drafts/unpublished/restricted data can never surface. New public directory search — `GET /players` (public profiles only, `visibility:'public'`) and `GET /public/teams` (public + active teams only) — never lists a private profile or private/disbanded team, and returns only public fields.
- SEO (`modules/seo/service.ts`): environment-aware **robots.txt** (SEO-006 — nonproduction disallows all crawling; production allows and links the sitemap while disallowing `/api /account /admin`) and an **XML sitemap** (SEO-005) of published, indexable content/games/tournaments with `xhtml:link` hreflang alternates (per-locale content slugs honoured), XML-escaped, bounded scan. Both served at the site root (`/robots.txt`, `/sitemap.xml`) and proxied by nginx (and the local Vite dev/preview proxy) to the API. Client-side JSON-LD **structured data** (SEO-007): schema.org `Article` on content detail and `Event` on tournament detail, via a new `jsonLd` option in `head.ts` (canonical/hreflang/OG were already emitted).
- Bundle (`router.ts`): all admin/* and account/* route components are now **lazily imported** (code-split) so an anonymous public visitor no longer downloads privileged/personalized code; public routes stay eager (crawlable first paint). The main bundle dropped ~66 kB (admin/account views are separate chunks).
- Bilingual UI: search inputs on the content, games, and tournament list views (URL-synced for direct refresh), a participant-type filter on the tournament list, and localized `search.*` keys in both locales.
- Tests: 9 media itests (signature/size/empty rejection, staged-vs-published serving, dedup, delete-block, alt); `shared/search.test.ts` (escaping + `$and`/`$or` composition + length cap); `modules/seo/seo.test.ts` (robots prod/nonprod + sitemap alternates/escaping); e2e `seo-media.spec.ts` (env-aware robots, sitemap contains a published tournament with alternates, localized 404 with navigation, media validated/nonpublic-until-published/served, anonymous-upload rejected) across desktop + mobile. One focused `test-reviewer` pass over the upload/search/SEO security surface.
- Deferred with an owner (documented in DECISIONS): a true **wire-status 404** for arbitrary unknown content slugs and **crawlable-without-JS** output (SEO-010 partial / SEO-011) require server-side rendering or prerendering — a deliberate architecture change out of this slice; the SPA shows a localized 404 view with navigation and real robots/sitemap/media status codes are served by the API. Responsive image **derivatives/thumbnails** (MEDIA-004) require an image-processing library; the record model + adapter boundary support them (`derivatives[]`) but generation is a swap-in. Slug-change **redirects** (SEO-009) are not yet needed (no slug-rename flow ships) — the boundary is noted.
- **DRAGON-15 is complete.**

## Delivered by DRAGON-16a (accessibility + bilingual UX slice of DRAGON-16)
Audited every implemented shared primitive and representative journeys (DRAGON-00..15). The audit found the primitives already strong (native `<dialog>`, one labelled `<main>`, skip link, logical CSS everywhere, machine-verified contrast, no positive tabindex, no clickable non-buttons); the fixes below close the confirmed gaps in the shared components so they propagate app-wide.
- **Route-change focus (High):** `router.ts` `afterEach` now moves focus to `#main-content` on a client-side navigation (skipping first load, deferred via `requestAnimationFrame`, guarded for no-DOM), so keyboard/screen-reader users land on the new page instead of a stale link or `<body>`. Fires only on real route changes, never on background/polling updates.
- **StateBlock announcement + heading (High):** error/forbidden/not-found now carry `role="alert"` (loading stays polite `status`, empty is silent); the heading is a real heading element (`headingLevel`, default `h2`) rather than a styled `<p>`; the spinner honours `prefers-reduced-motion` (the polite "Loading…" text conveys progress without motion).
- **Toast politeness (Medium):** the live role is per-toast — danger/warning announce assertively (`role="alert"`/`aria-live="assertive"`), info/success politely (`status`) — and the container is a labelled `region` (no longer a live region), so its label is not re-read on each announcement and each toast announces once.
- **AppDialog (Medium):** unique `useId` title/description ids (no duplicate-id collision with two dialogs), optional `description` → `aria-describedby`, and `overflow` on the dialog + full-height mobile sheet so long content scrolls at 320px.
- **AppField (Medium):** `autocomplete` + `inputmode` passthrough (wired into the OTP form: mobile `tel`/`tel`, code `one-time-code`/`numeric`), the error is a `role="alert"` live region, and the input boundary uses the 3:1 `--color-border-strong`.
- **AppNav (Medium):** Escape now closes the mobile disclosure **and restores focus to the toggle**, so a keyboard user is never stranded on a link that collapsed to `display:none`.
- **Contrast (WCAG 1.4.11):** interactive control boundaries (field input, theme select, pagination + nav toggle buttons, dialog, sign-out) moved from the 2:1 decorative `--color-border` to the 3:1 `--color-border-strong`; `tokens.test.ts` now asserts the accent + strong-border non-text pairs at 3:1 in both themes (the subtle `--color-border` stays a decorative separator, exempt from 3:1).
- **Skip link (Low):** reveals on `:focus` as well as `:focus-visible`.
- **Bidi isolation (Low):** added `isolate()` (`format.ts`, U+2068…U+2069 first-strong isolate) for interpolating codes/mobile/slug/money into Persian sentences where no `<bdi>`/`dir` element wraps the value.
- Tests: `e2e/accessibility.spec.ts` — a bounded matrix (skip-link→main focus, route-change focus, dialog trap/Escape/restore, mobile nav disclosure focus return, form-error summary + field association, danger-toast assertive, not-found alert + real heading, RTL/LTR dir/lang + no raw keys) on desktop + the 320px project; `tokens.test.ts` extended (non-text 3:1); `format.test.ts` extended (`isolate`). One focused `test-reviewer` a11y pass.
- **Not changed:** no authorization, privacy, audit, payment, ledger, tournament, moderation, or media behavior — presentation-only. Existing 320/375/desktop layouts, reduced-motion, and theme behavior preserved.
- **Known limitations with owners:** (1) Shared primitives and design tokens now meet the WCAG 1.4.11 3:1 non-text minimum for interactive boundaries, but ~50 view-level control borders (buttons/selects in individual views) still reference the 2:1 decorative `--color-border`. Per this slice's guidance ("prefer fixing shared primitives rather than patching individual pages repeatedly") they were not swept one-by-one; those controls remain identifiable by their background fill, text label, and the 3:1 focus ring (the 1.4.11 exception), so this is a hardening follow-up — best resolved by a shared button treatment/token pass — not a control-identification failure. (2) Full manual screen-reader certification was not performed (no compatible reader run in this environment); the automated + keyboard matrix stands in. Both are recorded honestly and owned by a later accessibility pass.
- **Deferred to sibling slices:** security threat-model hardening (DRAGON-16b) and performance/bundle/cache work (DRAGON-16c) are out of this accessibility slice.
- **Manual checks actually performed:** keyboard-only operation of the design-system journey, visible focus, 320px reflow, Persian RTL / English LTR, reduced-motion, and light/dark themes were exercised via the automated Playwright matrix and token tests. A hands-on screen-reader pass was **not** performed and is not claimed.
- **DRAGON-16a is complete. Parent DRAGON-16 is NOT complete.**

## Delivered by DRAGON-16b (security-hardening slice of DRAGON-16)
Bounded threat-model audit of DRAGON-00..15 across every trust boundary (proxy/IP, auth/OTP/session/cookie, role/scope authorization, admin/finance, payments/ledger/holds/checkout/prizes callbacks, notifications, moderation/support/recovery/analytics/operations, media upload+serve, public search/cursor/slug, secrets/logs/audit/outbox, transport/headers/deployment). **No Critical or High exploitable defect** — the shared boundaries (proxy trust, HMAC callbacks with constant-time compare, media magic-byte validation + code-owned content-type + nosniff + published-only serve, config fail-fast, error redaction, NoSQL/prototype-pollution resistance via `secure-json-parse` + `additionalProperties:false` bodies, cursor-token validation, server-derived audit actor) are well built and test-covered. Closed the confirmed Medium/Low gaps:
- **Analytics pseudonym salt is now a secret** (`ANALYTICS_PSEUDONYM_SALT`), required + length-checked in production via `parseRequiredSecret`, distinct from `AUTH_SECRET`/`PAYMENTS_CALLBACK_SECRET`, injected into `OperationsService`. Previously a source-committed constant — anyone with repo + `analytics_events` read could de-pseudonymize every event. Never logged/returned/audited.
- **CSRF origin guard**: a shared `onRequest` hook rejects (403, before routing, no side effects) a state-changing request whose browser `Origin` ≠ the configured `PUBLIC_ORIGIN`; safe methods and no-Origin (native/server) requests pass. `PUBLIC_ORIGIN` is now **required in production** (startup fails without a valid absolute origin), so the guard is always active in a real deployment; it is inert only outside production (where the browser origin and proxied API host legitimately differ). Complements `SameSite=Lax`. No token scheme added (same-origin deployment).
- **Response headers**: locked CSP on API JSON (`default-src 'none'; frame-ancestors 'none'; base-uri 'none'`) + `Permissions-Policy`; a self-hosted SPA CSP in nginx (`script-src 'self'`, `style-src 'self' 'unsafe-inline'` for Vue, `img-src 'self' data:`, `connect-src 'self'`, `frame-ancestors 'none'`, `base-uri`/`form-action 'self'`), `Strict-Transport-Security`, `Permissions-Policy`, and `server_tokens off`. `unsafe-inline` limited to `style-src`; scripts never allow inline/eval.
- **Cache**: `Cache-Control: no-store` on dynamic `/api/*` responses; content-addressed `/media/:id` (immutable) and `/robots.txt`/`/sitemap.xml` keep their own cache headers (they are root routes, not under `/api/`).
- Tests: `server.test.ts` (origin guard bad/good/missing-Origin + safe-method, `no-store`, CSP + Permissions-Policy headers), `config.test.ts` (salt production-required + length-checked). Salt threaded through the prod-env test fixtures.
- **Dependency audit: `npm audit` (prod + dev) → 0 vulnerabilities.** No `install`/`prepare`/`postinstall` lifecycle hooks in any workspace (no supply-chain script surface).
- **Verified:** api typecheck, lint, 265 unit, 291 integration, 46 e2e mutation flows (auth/wallet/shell/seo-media) confirming browser mutations still work under the new headers.
- One focused read-only `test-reviewer` security pass.
- **Not implemented (out of scope):** DRAGON-16c performance; no live provider/refund/payout; no new auth architecture; no token-CSRF; no TLS config beyond repo-controlled files (HSTS header set; the TLS terminator itself is deployment-owned).
- Known limitation with owner: L2 (tournament create/update bodies use `additionalProperties:true`) is not exploitable — every field is rebuilt through the service allowlist, no mass-assignment — recorded as hygiene; tighten to explicit nested body schemas in a later pass. The reviewer's High (CSRF guard could silently disable if `PUBLIC_ORIGIN` were unset in production) was resolved by making `PUBLIC_ORIGIN` production-required (startup fails), so the guard cannot be silently off in a real deployment.
- **DRAGON-16b is complete. Parent DRAGON-16 is NOT complete** (DRAGON-16c performance remains).

## Delivered by DRAGON-16c (performance + delivery slice of DRAGON-16)
Measured a bounded baseline (web build chunk sizes, list index coverage, media conditional-request behavior, frontend fetch patterns) and applied bounded, evidence-backed fixes. Local-only measurement — no production latency/Core-Web-Vitals claims.
- **Media conditional delivery (High):** `/media/:id` now reads metadata first (`getPublishedRecordMeta`, projection {contentType,sha256,storageKey}, `state:'published'`) and returns **304** on an `If-None-Match` match **before loading the blob** — a revalidation no longer re-reads the multi-MB bytes from Mongo or re-transfers them. Staged/unpublished media stays 404; immutable cache + ETag preserved.
- **Public-directory + operator indexes:** added compound indexes matching the measured query shapes — games `{status,slug}`, teams `{visibility,status,slug}`, user_profiles `{visibility,username}` (the public directory list sorts), and job_executions `{status,startedAt}` (the metrics/health failed-jobs count, previously an unindexed scan since the record field is `status` not the foundation `state`). Migration `022-perf-indexes` (idempotent `createIndex`). `content` and `tournaments` public lists were already correctly compounded — no change.
- **Content list response size:** `content.listPublished` now projects only card fields, so the list query no longer ships the full sanitized HTML body + derived plain text for every locale. The `q` search still matches on `plainText` (a projection limits returned fields, not the filter), and the published + keyset-cursor contract is unchanged.
- **Frontend fetch efficiency:** `TournamentsListView` fetches the localized game-name map **once** (onMounted + on locale change) instead of re-downloading 100 games on every search/filter; a **stale-response request-token guard** was added to the content, games, and tournament list views so a slower earlier fetch can never overwrite a newer one; the tournament view now also refreshes localized names on a locale change (a correctness gap).
- **Bundle:** `DesignSystemView` (a non-indexable dev showcase) is now lazy-loaded, trimming the anonymous public entry chunk from ~278 KB to ~272 KB raw (~91.6→89.8 KB gzip). Admin/account/finance/moderation/operations screens remain in their own lazy chunks (verified against `dist`); no privileged code in the public shell.
- **Guardrails/tests:** `perf-indexes.itest.ts` (the 4 indexes exist post-migration), `build-budget.test.ts` (entry ≤ 320 KB with tooling headroom + admin/account chunks stay split; skips when no `dist/`), and a media-**304** conditional-request assertion in `seo-media.spec.ts`.
- **Preserved:** every optimized query keeps its base authorization/published/visibility predicate (no client-side private-data filtering); keyset cursors, batch/page limits, and the 16b cache policy (dynamic `/api/*` = `no-store`, content-addressed media = immutable) are intact; 16a accessibility and 16b security behavior unchanged.
- **Bounded jobs / sitemap confirmed already efficient** (runJobs clamps ≤500, notifications ≤200, hold/checkout expiry `.limit()`-bounded; sitemap 3 projected queries capped at 5000) — no change needed.
- **Before/after evidence:** entry chunk 277,886→271,998 bytes raw (91,624→89,790 gzip); media revalidation 200(full body)→304(empty body); job-status count now index-backed. Measurement limited to localhost/seeded data.
- One focused read-only `test-reviewer` performance pass.
- **Remaining risks / limitations:** the `q` case-insensitive substring regex cannot use a plain index (bounded by the published/public subset + page limit today; revisit with a text index only at tens-of-thousands scale). Local measurement cannot predict production latency/CWV. No always-on scheduler added (bounded callable jobs unchanged).
- **DRAGON-16c is complete. With 16a + 16b + 16c all complete, PARENT DRAGON-16 is complete.**

## Delivered by DRAGON-17a (requirement/decision closure slice of DRAGON-17)
Reconciliation + integrity slice — no product behavior changed. Established one internally consistent, evidence-backed view of Phase 1 completion. Authoritative order: code/tests/config > decisions > requirements > traceability docs.
- **Deterministic closure check** (`scripts/closure-check.test.mjs`, `npm run closure:check`): **14 passing guardrails** over the reconciliation docs — canonical `XXX-NNN` ids only; every row resolves to a defined requirement or known metadata id; each id has exactly one row (no duplicates); approved status vocabulary; every `OD-*/DEC-*` resolves to `DECISIONS.md`; valid DRAGON slice ids; no 16b/16c slice reversal; **Phase 1 membership determinable for every requirement**; **the Phase 1 inventory is exactly 596**; **every Phase 1 requirement has exactly one canonical row and the coverage-gap fixture is empty**; **`Evidence pending` rows make no implementation/verification/review/acceptance claim**; **gated/deferred/blocked rows carry an owner or decision reference**; **no later-phase/OOS requirement is shown Phase-1-complete without an accepted cross-phase mapping**; and **no registered API route exposes player check-in (TOURN-024, from the route registry, not comments)**. It fails with the offending ids named; it never rewrites docs.
- **Traceability reconciled** (`REQUIREMENTS_TRACEABILITY.md`): 264→250 canonical data rows. Fixed **15 duplicate ids** to one canonical row each (folding per-slice evidence), including **4 true status contradictions** — AUDIT-001, SEO-003, TOURN-004 (kept the current/Verified row) and **SEO-010** (removed the false "returns an actual 404" claim; kept the honest **In progress**: a localized 404 *view* renders for every SPA route at HTTP 200, and a real 404 *status* is served only for API routes — robots/sitemap/media/content — a wire-status SPA 404 needs SSR, deferred). Retargeted invented ids to real requirements: `SEC-CSRF`→**SEC-006**, `MONITOR-001`→**OPS-002**, `SEARCH-001`→**PAGE-022** (In progress: per-domain search delivered, unified /search page deferred); removed `SUPPORT-001` (no canonical requirement — recovery is tracked by AUTH-008). Corrected a long-standing **mislabel** (found during review): the prize-allocation + cash-settlement content had been carried under `TOURN-024`, whose real requirement is "Phase 1 MUST NOT expose player check-in" — retargeted that content to **PAYOUT-004** (idempotent allocation) + **PAYOUT-005** (cash prizes pending until approved settlement), folded the mislabeled `PAY-009 (12)` cash-prize row into PAYOUT-005, and restored a genuine `TOURN-024` row (Verified — proven deterministically by a closure-check assertion that scans the registered route literals and finds no check-in route, not by comment search).
- **Proven Phase 1 inventory (deterministic, from Requirements.md metadata — not from traceability presence):** `Requirements.md` yields **794 canonical requirement IDs** (922 raw `XXX-NNN` matches minus 128 non-requirement metadata IDs — `OD-`/`DEC-`/`GOAL-`/`UC-`/`ASM-`). Of the 794: **Phase 1 = 596** (510 with an inline `FOUNDATION`/`PHASE_1` tag + 86 in the untagged foundational sections — i18n/accessibility/security/documentation, prefixes I18N/A11Y/SEC/DOC/SMS/INT), **later-phase-only = 196** (`PHASE_2..5`), **OUT_OF_SCOPE = 2**; 596 + 196 + 2 = 794 ✓. Phase membership uses the requirement's FIRST definition line, so the test-matrix appendix (which re-lists ids with `P1..P5` short-codes) never corrupts the classification.
- **Full Phase 1 coverage — every one of the 596 Phase 1 requirements now has exactly one canonical traceability row.** The 362 that were previously unrowed each received a canonical row with the neutral **`Evidence pending`** disposition (defined below). **Duplicate IDs: 0. Unknown IDs: 0. Missing Phase 1 rows: 0.** The 14 metadata cross-references (`DEC-`/`OD-`/`UC-`/`ASM-`) remain as decision/assumption links. Two rows are for later-phase requirements delivered as a Phase-1 foundation, each explicitly marked: `ROLE-027` (canonical PHASE_5 — accepted cross-phase mapping: approver role + dual control delivered/Verified, high-risk payout-adjustment approval deferred to Phase 5) and `TEAM-011` (canonical PHASE_4 — `Deferred by phase`).
- **`Evidence pending`** (added to the approved status vocabulary): a canonical row exists but makes **no implementation, no verification, no review, and no acceptance claim** — evidence reconciliation is still required and the owner remains within DRAGON-17 closure. The closure check enforces that such rows carry empty implementation/schema/test/browser/verification cells and no reviewer/review claim. It is never used where evidence is clear; it replaces the previous "unrowed gap".
- **Phase 1 disposition totals (all 596 rowed):** Verified 166, Implemented 37, In progress 25, Deferred by phase 4, Blocked by open decision 2, **Evidence pending 362** (166 + 37 + 25 + 4 + 2 + 362 = 596 ✓). The 362 Evidence-pending rows are the reconciliation surface for **DRAGON-17c acceptance**, which must upgrade each to an evidence-supported disposition without inventing evidence — this is a documented acceptance task, not an open traceability gap.
- **Coverage-gap fixture retired:** `scripts/phase1-coverage-gap.txt` is now a **must-be-empty** fixture (0 unresolved IDs); the closure check fails if it ever contains a Phase 1 ID. The closure check also cannot deterministically validate that a row's prose semantically matches its id's definition (the `TOURN-024` mislabel was caught by focused review) — a residual class a maintainer guards by inspection.
- **Decisions/gates:** every open decision (OD-003 email, OD-006 rule profiles, OD-007 paid tournaments, OD-008 tournament SMS, OD-023 support SLA, OD-026 external analytics, OD-028 username policy, OD-029 recovery approval) is recorded **open/gated, fail-closed** with a default-off gate; no document describes a gated feature as enabled (audited). `DEC-050` resolves (a resolved decision informationally present in an open-decision cell).
- **Ownership:** 16a=accessibility, 16b=security, 16c=performance is consistent across docs and code; DRAGON-17 shown open with only this 17a closure slice complete.
- **Manual evidence preserved, not overstated:** the DRAGON-16a statement that **no hands-on screen-reader certification was performed** is kept verbatim; no automated a11y/Playwright assertion is relabeled as manual review; no localhost measurement is presented as production capacity; mocks (payments/SMS/email) remain described as mocks, not live providers; the operator-callable jobs runner is not described as an always-on scheduler; prize entitlements are not described as external payout.
- **Release-candidate blockers (for later DRAGON-17b/17c):** (1) **362 Phase 1 requirements carry a canonical `Evidence pending` disposition** — every Phase 1 id now has one canonical row (coverage complete), but these 362 still need an evidence-supported disposition, which DRAGON-17c acceptance must assign without inventing evidence. Outstanding gated/deferred items remain open by design (enumerated in "Deferred with an owner" below); a real wire-status SPA 404 (SEO-010/011) and crawlable-without-JS remain deferred (SSR-owned); manual screen-reader certification and production load/availability/deployment evidence remain pending and are owned by DRAGON-17b/17c.
- **DRAGON-17a meets every acceptance criterion (every Phase 1 requirement has one canonical disposition; deterministic checks pass) but is left UNMARKED pending confirmation this turn. Parent DRAGON-17 remains open** (17b release-candidate verification, 17c acceptance sign-off not started).

## Known blockers
- None.

## Deferred with an owner
- Media upload/scan/derivative pipeline (MEDIA-001..015) — DRAGON-15; content/games reference a validated cover-image URL until then.
- Scheduled-publish notification/index job and locale-aware full-text search — DRAGON-13/15.
- Bulk admin actions with preview (ADMIN-004) and configuration diff UI — later admin prompts.
- Account recovery — blocked by OD-029; nothing partial is exposed.
- Verified email — blocked by OD-003; adapter boundary only.
- Reserved usernames and change-frequency policy — blocked by OD-028.
- Account-level locale and theme persistence beyond the stored preferences — DRAGON-04 onwards.
- Full log redaction review and CSRF tokens — DRAGON-16b.
- Authorization evaluator consuming `RequestContext`, and audit read APIs — DRAGON-04.
- Ledger, balanced postings, reversals, and reconciliation — DRAGON-11.
- Outbox dispatcher, job worker and scheduler, dead-letter handling — DRAGON-14.
- Full security header set, CSP, and CORS allowlist — DRAGON-16b.
- Full browser and viewport matrix from Requirements section 31 — DRAGON-16a.
- OD-026 analytics and error monitoring — unresolved; no adapter exists.
- Bracket versioning, regeneration, and rollback with a destructive-change preview and immutable history (BRACKET-010/013/014) — delivered by DRAGON-10. Still deferred: the BRACKET-017 drag-and-drop visual bracket *editor* (the current operator console edits by regeneration/rollback and result correction, not free-form node dragging) and a background dispatcher for above-limit generation (DRAGON-14).
- Opponent-based Swiss tiebreaks (Buchholz/Sonneborn-Berger), richer round-robin tiebreaks (head-to-head, score difference), draw support, and named points policies — gated by OD-006/BRACKET-007; the shipped policy is win = 1 point with the seeded order as the stable fallback.
- Double-elimination grand-final reset and exact Swiss bye-scoring/tiebreak (rule-profile-defined) — gated by OD-006/BRACKET-007; single grand final and bye-as-win defaults ship today.
- Manual group/round-robin-style graphs with a participant appearing in multiple fixtures — deferred; the manual graph currently seeds each participant once (elimination/bracket-style), which prevents downstream self-play.
- Tournament match scheduling, results, corrections, and outcomes (TOURN-019..025), and cancellation/completion cleanup workflows (TOURN-027/028) — DRAGON-09/10.
- Outbox dispatcher and notification delivery — registration emits domain events to the outbox; the dispatcher and mock-SMS/notification delivery are DRAGON-13/14.
- Paid tournament registration and refund execution (OD-007) — gated off; a non-free tournament rejects registration until DRAGON-11/12.
- Eligibility revaluation on roster change and staff/referee resource assignment beyond `tournament.manage` scope (TOURN-011, TOURN-018) — team registration captures an immutable snapshot now; roster-change revalidation and per-tournament staff assignment UIs are DRAGON-09/10.
- Bulk admin registration actions and permission-controlled exports (TOURN-030) — later admin prompts; the queue is filterable and paginated today.
- Approved game/publisher/federation rule profiles (OD-006) — gated off; custom free-text rules are used until a profile is approved.
- Idempotency completion is written outside the registration transaction (shared `withIdempotency`); a crash in a narrow window can strand a key `in_progress` until its 24h TTL without overbooking or duplicating — a stronger in-session/reconciliation guarantee is a shared-infrastructure change for a later hardening prompt.

## Last verification
2026-07-22 (DRAGON-13), all commands run from the repository root:
- `npm run typecheck` — pass
- `npm run lint` — pass, 0 problems
- `npm test` (workspaces) — 290 passed (254 api, 36 web); api unit adds 5 notification unit tests (event mapping, template rendering, recipient masking) and the config fail-closed test for the SMS/email gates; web unit includes the fa/en i18n parity + Persian-content checks covering the new `notifications` template and error-code keys
- `npm run test:integration` (api) — 268 passed (adds 12 notifications: mapped/unmapped consume, redelivery idempotency, two-concurrent-consume one-notification, SMS suppressed-without-consent + masked recipient, mark one/all + IDOR, template create/approve idempotent + unknown-key rejection, gated-preference refusal, delivery send + retry-to-dead-letter, and index uniqueness)
- `npm run build` — pass
- migrations against the disposable test DB — `018-notifications` applies cleanly (all 18 migrations applied and recorded)
- `npm run e2e` — the notification journey (purchase → operator consume → in-app inbox item → mark read; empty state; Persian RTL) passes on desktop/mobile/small-mobile in fa + en. The full browser suite passes at ~214 tests; the OTP-heavy suite occasionally flakes under full-parallel contention with `retries: 0` (a different handful of unrelated specs each run), and an isolated re-run passes (matrix owned by DRAGON-16a)
- Prior DRAGON-12 checkpoint unchanged this slice.

Earlier DRAGON-12 verification, 2026-07-22, all commands run from the repository root:
- `npm run typecheck` — pass
- `npm run lint` — pass, 0 problems
- `npm test` (workspaces) — 284 passed (248 api, 36 web); api unit adds the paid-checkout config fail-closed test; web unit includes the fa/en i18n parity + Persian-content checks covering the new `checkout`, `wallet` prize, and error-code keys
- `npm run test:integration` (api) — 256 passed (adds 14 checkout: OD-007 gate, server fee recalculation, Toman/Dragon Coin/mixed fees, atomic activation, duplicate + failed callback, insufficient coins, idempotent start, cancellation, expiry, IDOR, free-tournament rejection, and the admin-decision guard on `pending_payment`; and 9 prizes: versioned allocation, idempotent Dragon Coin credit, re-allocation supersede-without-double-credit, not-final rejection, cash entitlement approve/pay(evidence)/invalid-transition, owner-scoped list, index uniqueness)
- `npm run build` — pass
- migrations against the disposable test DB — `016-checkout` and `017-prizes` apply cleanly (all 17 migrations applied and recorded)
- `npm run e2e` — the paid checkout journey (start → awaiting payment → mock verified callback → registered; a failed payment does not register; Persian RTL) passes on desktop/mobile/small-mobile in fa + en. The full browser suite passes at ~198 tests; the OTP-heavy suite intermittently flakes under full-parallel contention with `retries: 0` (a different handful of unrelated specs each run), and an isolated re-run of the affected specs passes (matrix owned by DRAGON-16a)
- Prior DRAGON-11 checkpoints unchanged this slice.

Earlier DRAGON-11c verification, 2026-07-22, all commands run from the repository root:
- `npm run typecheck` — pass
- `npm run lint` — pass, 0 problems
- `npm test` (workspaces) — 283 passed (247 api, 36 web); api unit adds 5 hold unit/property tests (state machine, purpose/transfer gate registries fail-closed, and a 500-iteration amount-conservation property: original = captured + released + remaining after every valid capture/release)
- `npm run test:integration` (api) — 229 passed (adds 16 hold integration: reserve available balance, insufficient-funds rejected with no effect, gated purpose rejected, idempotent create + conflicting payload + duplicate businessRef, two concurrent holds → one winner + non-negative available, full/partial capture with one ledger transfer, capture idempotent + concurrent → one credit, concurrent capture-vs-release one winner, full release + idempotent, bounded idempotent expiry, IDOR-closed reads, gated transfers produce no effect, reconciliation conservation + drift detection + unbounded rejection, index uniqueness)
- `npm run build` — pass
- migrations against the disposable test DB — `015-holds` applies cleanly (all 15 migrations applied and recorded)
- `npm run e2e` — 189 passed across small-mobile 320px, mobile 375px, and desktop 1440px, fa RTL + en LTR (the wallet journey now shows total/held/available balances and an owned-holds list; buy → verified callback → credited available balance, held stays zero). The OTP-heavy browser suite occasionally flakes under full-parallel contention with `retries: 0`; an isolated re-run of the affected spec passes (matrix owned by DRAGON-16a)
- Prior DRAGON-11a/11b checkpoints (unchanged this slice): ledger 20 unit + 18 integration; payments 12 unit + 21 integration

Earlier DRAGON-10 verification, 2026-07-22:
- `npm test` — 244 passed (208 api, 36 web)
- `npm run test:integration` — 174 passed
- `npm run build` — pass
- `npm run e2e` — 180 passed across small-mobile 320px, mobile 375px, and desktop 1440px, in fa RTL and en LTR
- `node --test .claude/tests/guardrails.test.mjs` — 7 passed
- `npm run verify:persistence` — pass (DRAGON-01 run)
- `npm run docker:up` — web, api, mongo all healthy; migrations applied and 28 roles seeded (DRAGON-03 run)
- Package guardrails: run `03-CHECK-PACKAGE.cmd`.

DRAGON-03's proxy-trust security finding was reviewed, fixed, and re-checked (PASS); those rows are marked Reviewed. DRAGON-04 (security-sensitive RBAC) had one focused `test-reviewer` security pass: verdict PASS, no Critical/High. One Medium/plausible finding — a config-key case variant could dodge high-risk dual-control classification — was fixed by canonicalising keys, with unit and integration regression tests. DRAGON-05 (content sanitisation and draft isolation) had one focused `test-reviewer` security pass: verdict PASS, no Critical/High; sanitisation on every write path, no draft/scheduled leakage, no NoSQL injection, and safe SEO/v-html rendering all confirmed. One Medium (defense-in-depth) — the dev-only `/dev/grant-role` is safe in production but fail-open if `NODE_ENV` is unset — was hardened with a loud non-production startup warning and an ENV note. DRAGON-05 traceability rows are recorded but left Pending for review by the same reviewer independence rule used earlier. DRAGON-06 (persistent teams) had one focused `test-reviewer` pass over its ownership, invitation, and membership authorization and concurrency paths: verdict APPROVE, no Critical/High; resource-scoped owner-only enforcement, correct 404-vs-403 boundaries, the partial-unique-index race guarantees, atomic ownership transfer, in-transaction audit writes, insert-only snapshots, and privacy-aware public views were all confirmed. Two low-risk notes were applied (stable slug on rename; 404-before-403 in `listTeamInvitations`); the TEAM traceability rows are marked Reviewed. DRAGON-07 (tournament authoring) had one focused `test-reviewer` pass over money handling, publication gating, authorization, and lifecycle: verdict APPROVE, no Critical/High; exact-integer fees/prizes, published-only public reads, no public exposure of the internal question set, atomic revision+audit writes, draft-only editing, and correct state-machine and optimistic-concurrency guards were all confirmed. Two Medium notes were fixed (money domain ceiling → clean 422 instead of overflow 500; publication aggregates missing-value and date-order problems together). The TOURN authoring-scope traceability rows are marked Reviewed. DRAGON-08 (registration) had one focused `test-reviewer` pass over concurrency, authorization, IDOR, waitlist promotion, duplicate prevention, and capacity enforcement: verdict APPROVE, no Critical/High; atomic seat-counter capacity claim with no overbooking, resource-scoped admin authorization, correct self-cancel IDOR guard, deterministic waitlist ordering/promotion, the active-flag partial-unique duplicate guard, and idempotent replay were all confirmed. One Low DRY note was applied; one Medium note (idempotency completion outside the registration transaction) is a shared-infrastructure property recorded as a known limitation. The registration traceability rows are marked Reviewed. Rows from DRAGON-00 through DRAGON-02 remain Pending for review.
