# DRAGON-03 — OTP authentication, sessions, and account profile

Use this prompt after its listed dependencies are complete and integrated. Submit the fenced text directly to Claude Code.

```text
Prompt ID: DRAGON-03

Mission:
Implement mobile OTP authentication with the approved mock SMS adapter, secure sessions, recovery boundaries, and user/player profiles.

Inputs and precedence:
- Follow the repository's current `CLAUDE.md` and `IMPLEMENTATION_DECISIONS.md`.
- Use `Requirements.md` and this prompt as the product scope.
- When sources conflict, follow the explicit implementation decision and record the choice briefly. Do not invent unresolved business policy.

Dependencies:
DRAGON-02
Confirm the dependency work is present and integrated. If it is missing, report the blocker and stop instead of starting unrelated work.

Requirements scope:
All relevant FOUNDATION and PHASE_1 requirements, especially Sections 6–18 and 30–39.
Read the relevant requirement sections before implementation and preserve stable requirement IDs when updating traceability.
Use `prompts/prompt-manifest.json` only as a scope reference. Update traceability files only when requirement mappings actually change.

Open decisions:
- OD-003 [feature-gate]: Keep verified-email delivery disabled; retain adapter boundary only.
- OD-028 [feature-gate]: Profile launch uses no invented reserved-name/change-frequency policy.
- OD-029 [feature-gate]: Recovery without mobile/email remains disabled.
Keep gated behavior disabled, mocked, or out of scope until a decision is available. Record the impact in `DECISIONS.md` when relevant.

Delivery approach:
- Implement the smallest coherent end-to-end slice that satisfies this prompt.
- Preserve the existing architecture unless a requirement clearly demands a change.
- Reuse existing patterns and avoid broad refactors, new orchestration layers, or unnecessary infrastructure.
- Payment and SMS remain deterministic mock adapters unless the requirements explicitly authorize a live provider.
- Add tests that match the changed risk: normal flow, validation, permissions, failure, concurrency, and bilingual UI only where applicable.
- Use the `test-reviewer` once for high-risk changes; do not chain multiple reviewers or add formal evidence workflows.

Acceptance criteria:
- Implement Iranian mobile normalization, OTP request/resend/verify, expiry, attempt limits, anti-enumeration, rate limits, session rotation/revocation, logout, and security events.
- Use only the deterministic mock SMS adapter; expose OTPs through a protected dev/test inbox and never ordinary logs.
- Implement account/profile completion, optional verified email fields behind an adapter, locale/time-zone/theme preferences, public player identity, and privacy controls.
- Enforce minimum age 13 without a custom guardian workflow; present age-appropriate localized notices and privacy-by-default settings.
- Add unit, API, integration, security, and bilingual E2E tests for success and failure paths.

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
