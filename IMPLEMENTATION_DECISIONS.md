# Dragon Ecosystem Implementation Decisions

Version: 1.0.0  
Approved: 2026-07-14

## 1. Authority and precedence

When instructions conflict, implementation MUST use this order:

1. `IMPLEMENTATION_DECISIONS.md`.
2. `Requirements.md`.
3. The currently active staged prompt in `prompts/`.
4. Existing repository conventions and tests.
5. A small documented assumption when the sources above do not resolve the issue.

A lower-priority document MUST NOT weaken an approved security, privacy, financial, or product decision. Record material clarifications in `DECISIONS.md` and requirement mappings in `REQUIREMENTS_TRACEABILITY.md`.

## 2. Approved stack and infrastructure

- Frontend: Vue 3, Vite, TypeScript, Vue Router.
- Backend: Node.js LTS and TypeScript; Fastify is the default for a new API.
- Database: MongoDB 8.x for the approved Dragon Ecosystem implementation.
- Runtime: Docker Compose with required `web`, `api`, and `mongo` services. Worker/scheduler MAY be separate services when introduced.
- Production hosting direction: Arvan Cloud. Exact product SKU and topology are deployment configuration, not an implementation blocker.
- Current scope does not require application-managed backups, restore drills, RPO, or RTO. MongoDB named-volume persistence, safe migrations, and restart persistence tests remain mandatory.

## 3. Provider policy

### Payment

- Implement a deterministic mock payment provider inside the repository.
- The mock MUST support success, failure, expiry, duplicate callback, invalid signature, delayed callback, unknown state, and reconciliation scenarios.
- No live payment-provider network call or production credential is allowed.
- Provider boundaries MUST use an adapter so a real provider can be added later without changing domain logic.

### SMS

- Implement a deterministic mock SMS provider for OTP and approved tournament messages.
- The mock MUST expose messages only through a protected development/test inbox or test API.
- It MUST support delivery success, failure, delay, retry, and rate-limit simulation.
- OTP values MUST never be written to ordinary production logs.
- No live SMS-provider network call or credential is required.

### Email

Email remains optional and provider selection remains open. Use an adapter and a local test sink when email behavior is needed.

## 4. Age, privacy, and legal baseline

- Minimum platform age is 13.
- There is no custom guardian-consent workflow for users aged 13–17 in the approved scope.
- Mandatory applicable law in each operating jurisdiction always controls.
- Where not conflicting, engineering MUST follow recognized international privacy and child-rights principles: data minimization, purpose limitation, privacy by default, age-appropriate notices, security safeguards, restricted profiling, authenticated export/deletion, and consent controls for nonessential analytics.
- There is no single “global law” that automatically replaces applicable national law. These are engineering defaults and are not legal advice.

## 5. Dragon Coin and money

- Toman values are stored as integer Iranian rial amounts and displayed in Toman.
- No general internal Toman wallet is active: users cannot deposit, hold, transfer, spend, or withdraw a platform Toman balance. Toman is limited to payment amounts and cash-prize entitlements.
- Dragon Coin uses whole integer units.
- Dragon Coin purchases are final and non-refundable.
- Dragon Coin cannot be redeemed for cash or sold back to Dragon Ecosystem.
- Duplicate, fraudulent, or system-error corrections use immutable administrative ledger adjustments; they are not user refund flows.
- Tournament organizers may define cash prizes in Toman.
- Cash prizes create pending entitlements and are settled manually by authorized finance staff with immutable audit evidence.
- No external payout provider is required in the current scope.

## 6. Scale baseline

- Maximum approved tournament size: 1,000 individual participants or 1,000 teams.
- Lists, registration contention, waitlists, bracket generation, standings, jobs, and load tests MUST cover this limit.
- No implementation may load the complete tournament participant set into a browser page without pagination or virtualization where needed.

## 7. Delivery strategy

- Use the ordered prompts in `prompts/prompt-manifest.json`.
- Run one implementation prompt or one named slice at a time.
- A prompt may start only after its dependencies are integrated and the previous work is committed or otherwise durably preserved.
- Do not run overlapping prompts against the same checkout.
- For large prompts with slices, execute the slices in order and do not also execute the parent prompt as a second implementation task.
- Run targeted checks that match the changed scope. Release, security, finance, identity, and concurrency work require broader focused checks.
- Use one independent review pass only when the change risk justifies it.
- Approved mock providers are permanent boundaries for the current scope, not TODO placeholders.
- Update `PROJECT_STATUS.md`, `IMPLEMENTATION_STATUS.md`, `DECISIONS.md`, and traceability only when their recorded facts change.

## 8. Windows repository safety and local runtime

- The initial branch is `main`. DRAGON-00 may start only after a baseline commit exists.
- Setup creates a local Git bundle at `.dragon-backups/baseline.bundle`; adding a private remote remains strongly recommended.
- Canonical source material (`Requirements.md`, `IMPLEMENTATION_DECISIONS.md`, `CLAUDE.md`, `.claude/`, `tools/`, and `prompts/`) is read-only to Claude during product implementation.
- MongoDB is reachable between Compose services as `mongo:27017` and MUST NOT publish host port `27017` in the default Compose file. A user-approved override may expose a different host port when necessary.
- Claude does not create or read `.env`. Local developers create it manually with `06-CREATE-LOCAL-ENV.cmd` after `.env.example` is ready. Compose and tests should use safe defaults where practical.
- Scaffolding tools must not overwrite seeded root files wholesale. Generate in a temporary directory or merge deliberately.
- Pin dependency versions through the lockfile; avoid unpinned `npx` downloads in verification commands.
- Dockerfiles, YAML, shell scripts, and entrypoints use LF line endings.
