# Continuous integration

The pipeline lives in [`.github/workflows/ci.yml`](.github/workflows/ci.yml). Every step runs
a script the repository already owns, so a green pipeline means the same commands a
developer runs locally passed. There is no CI-only variant of any check, no relaxed
configuration, and no step that can pass while the command inside it fails.

## Platform

GitHub Actions. The repository had no CI configuration of any kind before DRAGON-29B — no
`.github/`, no `.gitlab-ci.yml`, no Azure Pipelines, no `Jenkinsfile`. The choice is not an
assumption drawn from the repository using Git: `REQUIREMENTS_TRACEABILITY.md` names
`.github/workflows` as the specific missing artefact in three separate rows (SEC-016,
SEC-017, TEST-026), so GitHub Actions is the repository's own stated expectation.

**No Git remote is configured** (`git remote -v` is empty). The workflow is therefore
correct-by-construction but has never executed: see [Limitations](#limitations).

## Runtime versions

| Component | Version | Where it is pinned |
|---|---|---|
| Node (toolchain: CI and development) | `22.23.1` | [`.nvmrc`](.nvmrc), read by `setup-node` via `node-version-file` |
| Node (production container runtime) | `22.12.0` | `apps/api/Dockerfile`, `apps/web/Dockerfile` |
| npm | bundled with the pinned Node | — |
| MongoDB | `mongo:8.0` | `docker-compose.yml`, `docker-compose.test.yml` |
| Runner image | `ubuntu-24.04` | pinned in the workflow; never `ubuntu-latest` |
| Playwright browsers | Chromium only | all three viewport projects in `playwright.config.ts` are Chromium |

### Why the two Node versions differ

`package.json` declares `engines.node: ">=22.12.0"`, and that is right for the **container**:
it runs compiled JavaScript. It is *not* enough for the **toolchain**. `npm test`,
`npm run migrate`, and the CI scripts execute TypeScript sources directly, and unflagged
type stripping only arrived in Node **22.18.0**. A host on 22.12.0 installs cleanly and then
cannot run a single test.

`.nvmrc` therefore carries the real toolchain version, `npm run ci:validate` asserts both
that `.nvmrc` clears the 22.18.0 floor and that the Node actually running clears it, and
`engines.node` is left alone because it is the packaging contract for an image that does not
need type stripping. One authoritative version per role, both enforced.

CI runs the Node 22 line because that is the major the production images ship. Local
DRAGON-29A/29B evidence was produced on Node 24.13.1; both satisfy the floor.

## Triggers

| Trigger | Scope |
|---|---|
| `pull_request` | targeting `main` |
| `push` | to `main` |
| `workflow_dispatch` | manual, any branch |

There is **no release-tag trigger**: the repository does not use tags for releases (`git tag`
is empty and every release decision is a committed document, not a tag).

**No path filters.** Documentation is not excluded, and `*.md` in particular must not be:
`npm run closure:check` and `npm run decision:check` assert the content of
`PROJECT_STATUS.md`, `IMPLEMENTATION_STATUS.md`, `REQUIREMENTS_TRACEABILITY.md`, and the
`RELEASE_DECISION*.md` files. A documentation-only commit can break those checks, so it has
to run them.

## Concurrency

```yaml
group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

A superseded pull-request run is cancelled. A `main` run is **not**: main is the record of
what was verified on the protected branch, and an arriving commit must not erase the
verification of the one before it.

## Permissions and secrets

Workflow-level `permissions: contents: read`, and no job raises it. Nothing writes to the
repository, publishes a package, pushes an image, or comments on a pull request.

**The pipeline uses no secrets at all.** Not "no production secrets" — none:

- `secrets` appears nowhere in the workflow, so a forked pull request cannot reach one and
  no `pull_request_target` escalation exists.
- The API runs in `NODE_ENV=test` under Playwright's `webServer` block, with deterministic
  test-only values already committed in `playwright.config.ts`
  (`AUTH_SECRET: 'e2e-only-auth-secret-value-not-a-real-secret'`,
  `PAYMENTS_CALLBACK_SECRET: 'e2e-only-payments-callback-secret-not-real'`).
- The mock payment provider stays test-only: `config.ts` keeps `PAYMENTS_MOCK_ENABLED`
  fail-closed in production, asserted by `config.test.ts` in the `validate` job.
- No provider credential is needed. `SMS_PROVIDER` is unset, so the mock SMS adapter is
  selected; `STREAMING_PROVIDER=arvan` fails startup by design (OD-013).
- No `.env` file is created, read, or uploaded. `ci-validate.mjs` fails if any `.env` other
  than `.env.example`, or any `*.pem`/`*.key`/`*.p12`/`*.pfx`, is tracked by Git.

## Job graph

```
validate ──┬── static ──────────┐
           ├── unit ────────────┼── e2e ──┐
           ├── build-budget ────┘         │
           ├── integration ───────────────┤
           ├── migrations ────────────────┼── required
           ├── security ──────────────────┤
           └── persistence (main only) ───┘
```

`validate` gates everything: it finishes in seconds and catches a missing script, a
duplicate migration id, a committed key, or a broken doc check before anything expensive
starts. `e2e` waits for `static`, `unit`, and `build-budget` because a type error or a
failing unit test makes a browser run a waste of six minutes.

### Required check names

Configure branch protection against these, exactly:

```
ci / validate
ci / static
ci / unit
ci / integration
ci / build-budget
ci / migrations
ci / e2e
ci / security
ci / persistence
ci / required
```

`ci / required` alone is sufficient — it fails when any of the others fails, is cancelled,
or times out. Listing the individual jobs as well gives a clearer failure signal in the
pull-request UI.

### What each job runs

| Check | Commands |
|---|---|
| `validate` | `npm run ci:validate`, `npm run closure:check`, `npm run decision:check`, and targeted `node --test` on `config.test.ts` (environment + fail-closed providers), `server.test.ts` (route registry), `locales.test.ts` (locale keys) |
| `static` | `npm run typecheck`, `npm run lint` |
| `unit` | `npm test` |
| `integration` | `npm run test:integration` |
| `build-budget` | `npm run build`, output-existence assertions, `npm run test:budget`, entry-bundle size report |
| `migrations` | `npm run verify:migrations` |
| `e2e` | reset-guard proof, then `npm run e2e` |
| `security` | `npm audit --omit=dev --audit-level=high` (gating), `npm audit --audit-level=low` (report only), `npm run ci:validate` |
| `persistence` | `docker compose config -q`, `WEB_PORT` override contract, `npm run verify:persistence` |
| `required` | asserts every job above succeeded |

## MongoDB in CI

CI uses the repository's **own disposable database**, `docker-compose.test.yml`, not a
GitHub service container. That is deliberate:

- It is a single-node **replica set**. MongoDB only supports transactions on one, and the
  ledger, store, and economy suites depend on them. A service container cannot run
  `rs.initiate`, so it could not provide transactions at all.
- Data lives on `tmpfs`, so it is disposable by construction.
- It binds `127.0.0.1:27018` only — never reachable from the network — and the default
  stack never publishes a MongoDB port at all.
- `wait-for-test-db.mjs` polls the container's own healthcheck, which is the thing that
  initiates the replica set. Nothing runs until a transaction-capable primary answers, so
  readiness is real rather than a sleep.
- The image is pinned to `mongo:8.0`.
- Each job that starts it runs `npm run db:test:down` in an `if: always()` step.

### Test-database safeguards

Three independent guards, all of which fail closed:

1. `scripts/reset-test-db.mjs` refuses any database whose name does not match `/e2e|test/i`.
2. `scripts/verify-migrations.mjs` refuses any database whose name does not match
   `/e2e|test|check/i`, and works in `dragon_migration_check`, separate from the E2E database.
3. The `e2e` job **proves guard 1 still works** before running the suite: it points
   `E2E_MONGODB_URI` at a production-shaped name (`…/dragon`), requires the script to exit
   non-zero, and requires the refusal message in stderr. A future edit that weakened the
   guard would fail CI rather than silently drop a real database.

The E2E database is `dragon_e2e` on port 27018 — a different port and a different database
name from both the developer stack (`dragon`, internal-only) and anything production.

## Migration verification

`npm run verify:migrations` covers both scenarios in one bounded run and drops its own
database at the end.

**Fresh database** — start empty, apply all 30 migrations, assert every registered version
is recorded as applied, assert `030-recovery-indexes` specifically, assert the indexes it
exists for (`enrollment_state_created` on `course_enrollments`, `order_state_created` on
`store_orders`), then run a second pass and require it to apply nothing.

**Existing database** — write test-only records into the four collections the system treats
as immutable (a ledger entry, a store order, an audit event, a course enrolment), run a
further full pass, then require each record to still exist, to be byte-for-byte unchanged,
and to remain queryable by field.

It never touches a developer or production database, and it removes no volume.

## Browser E2E

The job runs `npm run e2e`, never bare `npx playwright test`. Only the npm script runs the
guarded database reset; the bare command would leave the previous run's data in place.

### Worker count

`E2E_WORKERS: 2`, set explicitly in the workflow and echoed into the log alongside `nproc`.

A GitHub-hosted `ubuntu-24.04` runner has 4 vCPU. The local default is `cpus/4`, which would
give 1 there — needlessly slow — while Playwright's own default of `cpus/2` gives 2 anyway.
The number is set explicitly rather than inherited because DRAGON-29A established what goes
wrong when renderers are oversubscribed: the multi-actor journeys open two or three browser
pages each, and at one worker per two cores on a 16-thread machine, Chromium could not open a
page inside thirty seconds. Two workers keeps the page count near the core count with
headroom for the API process and mongod.

Raise it only against a measured run on a larger runner. Never raise a timeout to compensate
for a worker count.

### Readiness

Playwright's `webServer` gate is `http://127.0.0.1:3000/health/ready`, not `/health`.
`/health` is liveness only — it answers as soon as the process can serve a request, which is
before the Mongo connection, the startup migrations, and the system-configuration seed have
finished. `/health/ready` pings the database and only then returns 200. The web server's own
gate is `http://127.0.0.1:4173/en`. No browser test starts before both answer.

### Retries

`retries: 0`, unchanged from DRAGON-29A. The repository's release evidence is stated in terms
of clean runs at zero retries, and enabling retries would silently redefine what "clean"
means. If CI ever needs retries, the justification belongs in this file next to the change.

### Failure artifacts

On failure **or cancellation**, `apps/web/test-results/` and `apps/web/playwright-report/`
upload as `playwright-artifacts-<run_id>-<run_attempt>`, retained **7 days**. Those paths
hold the traces, screenshots, and error context that DRAGON-29A's `retain-on-failure`
settings write.

The step cannot change the job result, and nothing else is uploaded — no database files, no
`.env`, no tokens, no `node_modules`, no `dist/`.

`if-no-files-found: warn` means the upload warns rather than fails when there is nothing to
collect, which happens when the job fails *before* Playwright starts — the guard-proof step,
the browser install, the image pull. So a red `e2e` job does not guarantee an artifact: check
the step that actually failed first. The warning is deliberate; failing the upload would
replace a clear earlier error with a confusing later one.

The HTML report exists because `playwright.config.ts` declares
`[['list'], ['html', { open: 'never' }]]`. The list reporter is what a developer reads while
the suite runs; the HTML report is what survives it. `open: 'never'` keeps it from launching
a browser locally, and `playwright-report/` is gitignored.

## Security and dependency checks

The repository has no security scanning tooling today, and this pipeline does not invent a
toolchain it cannot support. What runs:

- **`npm audit --omit=dev --audit-level=high` — gating.** Runtime dependencies only, failing
  on high or critical.
- **`npm audit --audit-level=low` — report only.** Development-only advisories are visible in
  the log without gating; a build-time advisory is not a shipped vulnerability. This is the
  only `continue-on-error` step in the workflow and it is diagnostic by design.
- **Committed-key guard** — `ci:validate` fails on a tracked `.env`, tracked key material, or
  unambiguous key/token markers in tracked text files.

No dependency updates are applied automatically.

### Live finding: the gating audit currently fails

`npm audit --omit=dev --audit-level=high` **exits 1 on the current lockfile**, so
`ci / security` will be red on the first run. This is not a pipeline defect — it is the
pipeline doing its job on a pre-existing problem that nothing in the repository was checking
for before.

| Field | Value |
|---|---|
| Package | `find-my-way` (transitive, via `fastify`) |
| Advisory | [GHSA-c96f-x56v-gq3h](https://github.com/advisories/GHSA-c96f-x56v-gq3h) — denial of service over HTTP/2 |
| Severity | high, CVSS 3.1 score 7.5 (`AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H`) |
| Vulnerable range | `<=9.6.0` |
| Shipped? | Yes — it is in the runtime dependency tree, not a build-time dependency |
| Fix available | Yes, `npm audit` reports `fixAvailable: true` with no dependent effects |

It was **not fixed in DRAGON-29B**: this slice builds the pipeline and is explicitly barred
from applying dependency updates, and a lockfile change is a change to what ships. Two
things are needed and neither is a CI decision:

1. **Update the dependency** — a scoped change with its own verification, since it moves
   Fastify's router in every request path.
2. **Or record a formal risk acceptance** — the advisory is HTTP/2-specific, and the API is
   served over HTTP/1.1 behind nginx, so real exposure may be nil. That judgement is
   precisely what SEC-017 reserves for a named approver, and no such approver or waiver
   record exists in the repository. This file does not make that call.

Until one of those happens, treat a red `ci / security` as the expected and correct state.

### Recorded gaps

- **SEC-016 container-image scanning is not implemented.** Adding Trivy or Grype means
  adopting a tool the repository has never used, and image scanning is only meaningful
  against images this workflow deliberately does not build or push.
- **SEC-017 has no risk-acceptance mechanism.** The requirement is that critical and high
  findings block release *unless formally risk-accepted*; the repository names no
  acceptance owner and defines no waiver record. `--audit-level=high` implements the
  blocking half. The waiver half needs an authorized owner, which is not an engineering
  decision.
- **`npm audit` is not a secret scanner, a SAST tool, or a licence checker.** No such tool
  is configured.
- **None of this is a penetration test or an authorized security review.** It is dependency
  and hygiene checking only.

## Caching

`actions/setup-node@v4` with `cache: npm` caches the npm **download cache**, keyed on
`package-lock.json`. Installs are always `npm ci`, so the lockfile is authoritative and a
lockfile that disagrees with the manifests fails.

Playwright browsers are cached at `~/.cache/ms-playwright`, keyed on the runner OS and
`package-lock.json` — the lockfile pins the Playwright version, which decides the browser
build, and the runner image decides the shared libraries it links against.

Not cached: `node_modules`, MongoDB data, any test database, build output, and test results.
A cold-cache run works exactly the same; the cache only makes it faster.

## Local equivalents

| Command | Covers | Needs Docker |
|---|---|---|
| `npm run ci` | `ci:validate`, `typecheck`, `lint`, `test`, `build`, `test:budget`, `closure:check`, `decision:check` | no |
| `npm run ci:full` | everything in `npm run ci`, then `test:integration`, `verify:migrations`, `e2e` | yes |
| `npm run ci:validate` | the fast repository validation on its own | no |
| `npm run verify:migrations` | fresh + existing-database migration verification | yes |

`npm run ci` deliberately requires no Docker, so static checks stay available without a
container runtime. Both scripts chain existing scripts with `&&` and duplicate none of their
logic; the first failure stops the chain and propagates its exit code.

Workflow syntax is validated by GitHub on push. For a local check before pushing, use
[`actionlint`](https://github.com/rhysd/actionlint); it is not vendored into the repository.

## Branch protection

**Status: CI implementation complete — repository administrator activation pending.**

Nothing below has been applied. There is no configured Git remote, so no repository
administration interface was reachable and none was contacted. These are the settings an
administrator must switch on, on `main`:

1. **Require a pull request before merging** — at least 1 approving review from someone
   other than the author.
2. **Require status checks to pass**, with *Require branches to be up to date before
   merging* on. Select the ten `ci / …` checks listed above. GitHub only offers a check name
   after it has been seen once, so run the workflow via **Actions → ci → Run workflow**
   before configuring this.
3. **Require conversation resolution before merging.**
4. **Dismiss stale pull request approvals when new commits are pushed** — an approval of a
   diff that no longer exists is not an approval.
5. **Do not allow force pushes.**
6. **Do not allow deletions.**
7. **Restrict who can push to matching branches** — no direct pushes to `main`; everything
   arrives through a reviewed pull request.
8. **Administrator bypass:** leave *Do not allow bypassing the above settings* **on**.
   Release-evidence integrity is the point of the pipeline, and an unverified administrator
   merge would break exactly the claim the release documents make. If a break-glass path is
   ever needed, it should be a temporary, logged, deliberate change — not a standing
   exemption.

Do not read anything in this file as evidence that protection is active. It is not.

## Limitations

- **The workflow has never run.** No Git remote is configured, so it could not be executed
  remotely from the environment that authored it. Every command it invokes was run locally
  and passed (see `IMPLEMENTATION_STATUS.md`), the YAML parses, and the job graph, action
  pinning, timeouts, and required-summary logic were checked structurally — but there is no
  remote CI run to point at, and this file does not claim one.
- **CI runs Node 22.23.1; local evidence was produced on Node 24.13.1.** Both clear the
  22.18.0 floor. The first remote run is the first execution on the 22 line.
- **`E2E_WORKERS: 2` is a reasoned starting value, not a measured one** for a GitHub runner.
- **`apps/api/src/perf/` is untracked**, so the five performance-contention integration
  tests it holds do not exist for CI and its `perf.itest.ts` will not run there. It belongs
  to DRAGON-28 and is not absorbed here; committing it is that slice's decision.
- **`persistence` does not run on pull requests.** The static topology contract does
  (`compose-topology.test.ts` in `unit`); the runtime stop/start cycle runs on `main` and on
  manual dispatch.
- **No deployment, publication, image push, or release step exists** in this workflow, by
  design.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `validate` fails on "the running Node can execute the repository scripts" | The runner picked up a Node older than 22.18.0. Check `.nvmrc` and that `setup-node` uses `node-version-file`. |
| `validate` fails on "every npm script CI invokes exists" | A root script was renamed. Update `REQUIRED_SCRIPTS` in `scripts/ci-validate.mjs` and the workflow together. |
| `validate` fails on "no CI-required script suppresses its exit status" | A script gained `\|\| true` or `; exit 0`. Remove it — the check exists so a verification step cannot become unfailable. |
| `integration` or `migrations` times out waiting for the database | `wait-for-test-db.mjs` polls the container healthcheck for 120 s. Read the `docker compose logs mongo-test` output: usually the image pull failed or the replica set did not initiate. |
| `e2e` fails with "Test timeout … while setting up page" | Renderer starvation, the DRAGON-29A failure mode. Lower `E2E_WORKERS`; do not raise timeouts. |
| `e2e` fails on the reset-guard step | `scripts/reset-test-db.mjs` stopped refusing a non-test database name. Restore the guard; do not delete the step. |
| `e2e` fails only on the first run after a Playwright bump | The browser cache key changed and `npx playwright install` had to re-download. Re-run; if it persists, the new Playwright needs newer system libraries than the pinned runner image has. |
| `build-budget` fails | The entry bundle exceeded 380 kB. Split a route into a lazy chunk. Do not raise the budget. |
| `security` fails on `npm audit` | A runtime dependency has a high or critical advisory. Update the dependency. There is no waiver mechanism (see Recorded gaps). |
| `required` fails while every other check looks green | A required job was cancelled or skipped. Only `persistence` may be skipped, and only on a pull request. |
