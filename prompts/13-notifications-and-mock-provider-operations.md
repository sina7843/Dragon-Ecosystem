# DRAGON-13 — Notifications and mock provider operations

Use this prompt after its listed dependencies are complete and integrated. Submit the fenced text directly to Claude Code.

```text
Prompt ID: DRAGON-13

Mission:
Implement in-app notifications, approved mock SMS delivery, optional local email sink, templates, preferences, retries, and operator visibility.

Inputs and precedence:
- Follow the repository's current `CLAUDE.md` and `IMPLEMENTATION_DECISIONS.md`.
- Use `Requirements.md` and this prompt as the product scope.
- When sources conflict, follow the explicit implementation decision and record the choice briefly. Do not invent unresolved business policy.

Dependencies:
DRAGON-03, DRAGON-08, DRAGON-12
Confirm the dependency work is present and integrated. If it is missing, report the blocker and stop instead of starting unrelated work.

Requirements scope:
All relevant FOUNDATION and PHASE_1 requirements, especially Sections 6–18 and 30–39.
Read the relevant requirement sections before implementation and preserve stable requirement IDs when updating traceability.
Use `prompts/prompt-manifest.json` only as a scope reference. Update traceability files only when requirement mappings actually change.

Open decisions:
- OD-003 [feature-gate]: Do not activate transactional email.
- OD-008 [feature-gate]: Only security-essential mock SMS may be enabled; preference classes remain disabled.
Keep gated behavior disabled, mocked, or out of scope until a decision is available. Record the impact in `DECISIONS.md` when relevant.

Delivery approach:
- Implement the smallest coherent end-to-end slice that satisfies this prompt.
- Preserve the existing architecture unless a requirement clearly demands a change.
- Reuse existing patterns and avoid broad refactors, new orchestration layers, or unnecessary infrastructure.
- Payment and SMS remain deterministic mock adapters unless the requirements explicitly authorize a live provider.
- Add tests that match the changed risk: normal flow, validation, permissions, failure, concurrency, and bilingual UI only where applicable.
- Use the `test-reviewer` once for high-risk changes; do not chain multiple reviewers or add formal evidence workflows.

Acceptance criteria:
- Implement versioned localized templates, event-to-template mapping, in-app inbox, read state, preferences, delivery attempts, retry/dead-letter behavior, and idempotent outbox consumers.
- Use the mock SMS adapter for OTP and enabled tournament messages with protected test inbox, delivery/failure/delay/rate-limit simulation, and masked recipient logs.
- Use an adapter and local test sink for optional verified-email notifications; no live provider is required.
- Implement admin template approval and tournament template enablement without allowing marketing messages to reuse transactional consent.
- Add localization, privacy, retry, duplicate-event, preference, authorization, and browser tests.

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
