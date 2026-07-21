# DRAGON-17 — Phase 1 release candidate and acceptance closure

Use this prompt after its listed dependencies are complete and integrated. Submit the fenced text directly to Claude Code.

```text
Prompt ID: DRAGON-17

Mission:
Close every Foundation and Phase 1 requirement with traceable evidence and produce a deployable release candidate.

Inputs and precedence:
- Follow the repository's current `CLAUDE.md` and `IMPLEMENTATION_DECISIONS.md`.
- Use `Requirements.md` and this prompt as the product scope.
- When sources conflict, follow the explicit implementation decision and record the choice briefly. Do not invent unresolved business policy.

Dependencies:
DRAGON-16, DRAGON-14
Confirm the dependency work is present and integrated. If it is missing, report the blocker and stop instead of starting unrelated work.

Requirements scope:
All relevant FOUNDATION and PHASE_1 requirements, especially Sections 6–18 and 30–39.
Read the relevant requirement sections before implementation and preserve stable requirement IDs when updating traceability.
Use `prompts/prompt-manifest.json` only as a scope reference. Update traceability files only when requirement mappings actually change.

Open decisions:
- OD-003 [release-blocker]: Block Phase 1 release if email is advertised or required.
- OD-006 [release-blocker]: Block publishing affected tournaments.
- OD-007 [release-blocker]: Block paid tournament launch.
- OD-008 [release-blocker]: Block SMS launch claims beyond approved classes.
- OD-023 [release-blocker]: Block public SLA claims at launch.
- OD-026 [release-blocker]: Block external analytics activation.
- OD-028 [release-blocker]: Block public username launch.
- OD-029 [release-blocker]: Block unsupported recovery activation.
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
- `slices/17a-traceability-closure.md` — Requirement and decision closure
- `slices/17b-release-evidence.md` — Release evidence and reviews
- `slices/17c-release-decision.md` — Release decision

Acceptance criteria:
- Complete `REQUIREMENTS_TRACEABILITY.md` for every Foundation/Phase 1 requirement with implementation, tests, evidence, override, and status.
- Run all critical browser journeys in Persian RTL and English LTR, including teams, free/paid registration, all five formats, bracket correction/rollback, mock payment, Dragon Coin, cash-prize entitlement, and administration.
- Prove Docker build/start/health, Mongo persistence restart, migrations, seed idempotency, production builds, API contracts, E2E, security, accessibility, and load baseline.
- Remove unauthorized placeholders, fake buttons, dead routes, unresolved TODO/FIXME, accidental live-provider configuration, and untraceable requirements.
- Produce release notes, deployment/runbook documentation, known risks, and a Phase 1 go/no-go verdict.

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
