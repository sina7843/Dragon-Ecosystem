# DRAGON-00 — Foundation bootstrap and governance

Use this prompt after its listed dependencies are complete and integrated. Submit the fenced text directly to Claude Code.

```text
Prompt ID: DRAGON-00

Mission:
Create the executable repository foundation and governance artifacts required for every later slice.

Inputs and precedence:
- Follow the repository's current `CLAUDE.md` and `IMPLEMENTATION_DECISIONS.md`.
- Use `Requirements.md` and this prompt as the product scope.
- When sources conflict, follow the explicit implementation decision and record the choice briefly. Do not invent unresolved business policy.

Dependencies:
None; this is the first prompt.
Confirm the dependency work is present and integrated. Also run `git rev-list --all --count`; if it returns zero, report the missing baseline commit as a blocker and stop.

Requirements scope:
Sections 1–5, 14–17, 25–37, 39 and all FOUNDATION-tagged requirements.
Read the relevant requirement sections before implementation and preserve stable requirement IDs when updating traceability.
Use `prompts/prompt-manifest.json` only as a scope reference. Update traceability files only when requirement mappings actually change.

Open decisions:
- OD-026 [feature-gate]: Analytics/error-monitoring adapters remain disabled.
Keep gated behavior disabled, mocked, or out of scope until a decision is available. Record the impact in `DECISIONS.md` when relevant.

Delivery approach:
- Implement the smallest coherent end-to-end slice that satisfies this prompt.
- Preserve the existing architecture and seeded root files unless a requirement clearly demands a change. Never let a scaffold generator overwrite the repository root wholesale; generate in a temporary directory or merge deliberately.
- Reuse existing patterns and avoid broad refactors, new orchestration layers, or unnecessary infrastructure.
- Payment and SMS remain deterministic mock adapters unless the requirements explicitly authorize a live provider.
- Add tests that match the changed risk: normal flow, validation, permissions, failure, concurrency, and bilingual UI only where applicable.
- Use the `test-reviewer` once for high-risk changes; do not chain multiple reviewers or add formal evidence workflows.

Acceptance criteria:
- Create a workspace with `apps/web` and `apps/api`, TypeScript, deterministic package-manager lockfiles, and root scripts that delegate typecheck, lint, test, build, and E2E.
- Create safe Dockerfiles and Compose services named `web`, `api`, and `mongo`; MongoDB MUST use a named persistent volume, MUST be addressed internally as `mongo:27017`, and MUST NOT publish host port 27017 in the default Compose file. API health MUST be available at `/health` on container port 3000.
- Create a minimal bilingual Vue route and a minimal Node API so production builds and one real browser E2E pass in both `fa` RTL and `en` LTR.
- Create missing artifacts and carefully populate existing seeded stubs: `ARCHITECTURE.md`, `DECISIONS.md`, `REQUIREMENTS_TRACEABILITY.md`, `IMPLEMENTATION_STATUS.md`, `.env.example`, `.dockerignore`, and required environment documentation. Preserve useful existing content and do not wholesale recreate files that already exist.
- Record the authority order and every resolved decision from `IMPLEMENTATION_DECISIONS.md`; no addressed item may remain an implementation blocker.
- Prove Mongo data survives approved Compose stop/start without deleting volumes; do not add an application backup service or restore gate. Use the internal Compose network and do not require host port 27017.
- Add `.gitattributes` coverage for Dockerfiles, YAML, shell scripts, and entrypoints so Linux container executables retain LF endings.
- Do not create or read `.env`; use safe defaults and `.env.example`. If a local file is required, tell the user to run `06-CREATE-LOCAL-ENV.cmd` manually.

Non-goals:
- Do not implement later prompts unless a minimal compatible boundary is strictly required.
- Do not weaken tests, security controls, or acceptance criteria to obtain a pass.
- Do not claim external provider behavior that was only exercised through a mock/stub.

Verification:
- Run the existing targeted typecheck, lint, unit, integration, build, or browser tests relevant to the changed scope.
- Use normal repository commands and targeted checks; avoid custom state, evidence, or task-gating workflows.
- Fix failures introduced by this work. Report unrelated pre-existing failures separately rather than expanding scope.
- For release or security-sensitive prompts, run one focused security/release review and resolve Critical or High findings before completion.
- Update `IMPLEMENTATION_STATUS.md`, `DECISIONS.md`, API documentation, and requirement traceability only when this prompt changes them.

Completion report:
Summarize implemented behavior, changed files, tests and results, unresolved decisions, remaining risks, and the next eligible prompt ID.
```
