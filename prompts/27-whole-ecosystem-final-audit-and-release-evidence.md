# DRAGON-27 — Whole-ecosystem final audit and release evidence

Use this prompt after its listed dependencies are complete and integrated. Submit the fenced text directly to Claude Code.

```text
Prompt ID: DRAGON-27

Mission:
Perform the final independent audit across the complete enabled Dragon Ecosystem and close every implemented requirement with reproducible evidence.

Inputs and precedence:
- Follow the repository's current `CLAUDE.md` and `IMPLEMENTATION_DECISIONS.md`.
- Use `Requirements.md` and this prompt as the product scope.
- When sources conflict, follow the explicit implementation decision and record the choice briefly. Do not invent unresolved business policy.

Dependencies:
DRAGON-19, DRAGON-21, DRAGON-23, DRAGON-26
Confirm the dependency work is present and integrated. If it is missing, report the blocker and stop instead of starting unrelated work.

Requirements scope:
All implemented requirements and every enabled phase.
Read the relevant requirement sections before implementation and preserve stable requirement IDs when updating traceability.
Use `prompts/prompt-manifest.json` only as a scope reference. Update traceability files only when requirement mappings actually change.

Open decisions:
- OD-018 [out-of-scope]: Direct/private messaging remains out of scope.
Keep gated behavior disabled, mocked, or out of scope until a decision is available. Record the impact in `DECISIONS.md` when relevant.

Delivery approach:
- Implement the smallest coherent end-to-end slice that satisfies this prompt.
- Preserve the existing architecture unless a requirement clearly demands a change.
- Reuse existing patterns and avoid broad refactors, new orchestration layers, or unnecessary infrastructure.
- Payment and SMS remain deterministic mock adapters unless the requirements explicitly authorize a live provider.
- Add tests that match the changed risk: normal flow, validation, permissions, failure, concurrency, and bilingual UI only where applicable.
- Use the `test-reviewer` once for high-risk changes; do not chain multiple reviewers or add formal evidence workflows.

Bounded slices:
Complete these in order, but keep verification proportional to each slice. Do not create nested review or verification workflows.
- `slices/27a-cross-phase-integration.md` — Cross-phase integration audit
- `slices/27b-security-finance-data.md` — Security, finance, and data audit
- `slices/27c-final-release-evidence.md` — Final release evidence

Acceptance criteria:
- Reconcile `Requirements.md`, `IMPLEMENTATION_DECISIONS.md`, active feature flags, OpenAPI, data models, routes, permissions, tests, and `REQUIREMENTS_TRACEABILITY.md`.
- Run the complete available unit, component, integration, API, E2E, security, accessibility, and performance suite from a clean production-like checkout.
- Run major cross-module journeys in Persian RTL and English LTR and assert no unexpected console error, failed request, raw translation key, broken direct refresh, or unauthorized data exposure.
- Verify mock payment/SMS cannot accidentally call live endpoints, Dragon Coin has no refund/cash-out path, cash prizes use manual audited settlement, MongoDB is the database, and no backup gate was reintroduced.
- Produce final release notes, deployment instructions, operational runbooks, unresolved external decisions, risk register, and a truthful final go/no-go verdict.

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
