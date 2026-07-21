# DRAGON-22 — Phase 4 social graph, community, and advanced teams

Use this prompt after its listed dependencies are complete and integrated. Submit the fenced text directly to Claude Code.

```text
Prompt ID: DRAGON-22

Mission:
Implement approved gaming-community capabilities and advanced team roles using shared moderation/privacy foundations.

Inputs and precedence:
- Follow the repository's current `CLAUDE.md` and `IMPLEMENTATION_DECISIONS.md`.
- Use `Requirements.md` and this prompt as the product scope.
- When sources conflict, follow the explicit implementation decision and record the choice briefly. Do not invent unresolved business policy.

Dependencies:
DRAGON-17
Confirm the dependency work is present and integrated. If it is missing, report the blocker and stop instead of starting unrelated work.

Requirements scope:
All relevant FOUNDATION and PHASE_4 requirements, especially social, moderation, privacy, and advanced-team sections.
Read the relevant requirement sections before implementation and preserve stable requirement IDs when updating traceability.
Use `prompts/prompt-manifest.json` only as a scope reference. Update traceability files only when requirement mappings actually change.

Open decisions:
- OD-017 [prompt-blocker]: Do not activate social graph privacy/blocking behavior.
- OD-024 [feature-gate]: Appeals remain disabled.
- OD-027 [feature-gate]: Web/mobile push remains disabled.
Keep gated behavior disabled, mocked, or out of scope until a decision is available. Record the impact in `DECISIONS.md` when relevant.

Delivery approach:
- Implement the smallest coherent end-to-end slice that satisfies this prompt.
- Preserve the existing architecture unless a requirement clearly demands a change.
- Reuse existing patterns and avoid broad refactors, new orchestration layers, or unnecessary infrastructure.
- Payment and SMS remain deterministic mock adapters unless the requirements explicitly authorize a live provider.
- Add tests that match the changed risk: normal flow, validation, permissions, failure, concurrency, and bilingual UI only where applicable.
- Use the `test-reviewer` once for high-risk changes; do not chain multiple reviewers or add formal evidence workflows.

Acceptance criteria:
- Implement follow relationships for approved entities, community posts/comments/reactions, feed filtering, visibility, reporting, and moderation.
- Implement advanced team roles/capabilities only where Phase 4 requirements define them, with migration from owner/member that preserves history and permissions.
- Implement privacy-by-default, block/mute/appeal feature gates tied to OD-017/OD-024, and no direct messaging or private group chat.
- Prevent restricted activity leakage through feed, search, analytics, notifications, and APIs.
- Add authorization, privacy, moderation, abuse, scale, bilingual browser, and accessibility tests.

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
