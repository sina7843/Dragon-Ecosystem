# DRAGON-16 — Accessibility, performance, and security hardening

Use this prompt after its listed dependencies are complete and integrated. Submit the fenced text directly to Claude Code.

```text
Prompt ID: DRAGON-16

Mission:
Harden the complete Phase 1 implementation against accessibility, security, privacy, performance, and scale requirements.

Inputs and precedence:
- Follow the repository's current `CLAUDE.md` and `IMPLEMENTATION_DECISIONS.md`.
- Use `Requirements.md` and this prompt as the product scope.
- When sources conflict, follow the explicit implementation decision and record the choice briefly. Do not invent unresolved business policy.

Dependencies:
DRAGON-10, DRAGON-12, DRAGON-15
Confirm the dependency work is present and integrated. If it is missing, report the blocker and stop instead of starting unrelated work.

Requirements scope:
All relevant FOUNDATION and PHASE_1 requirements, especially Sections 6–18 and 30–39.
Read the relevant requirement sections before implementation and preserve stable requirement IDs when updating traceability.
Use `prompts/prompt-manifest.json` only as a scope reference. Update traceability files only when requirement mappings actually change.

Open decisions:
- No registered open decision directly gates this prompt. Do not activate any unlisted unresolved policy discovered during implementation; add it to the manifest first.
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
- `slices/16a-accessibility-i18n.md` — Accessibility and bilingual UX
- `slices/16b-security-hardening.md` — Security hardening
- `slices/16c-performance-load.md` — Performance and load

Acceptance criteria:
- Resolve automated and manual accessibility findings for keyboard, focus, semantics, labels, errors, dialogs, tables, contrast, zoom, RTL/LTR, and reduced motion.
- Implement secure headers, explicit CORS, CSRF/session controls, tailored rate limits, injection/XSS/IDOR protections, upload controls, dependency/container scanning, and secret checks.
- Run load and contention tests covering tournament registration and competition operations at up to 1,000 participants/teams plus OTP, mock payment callbacks, ledger transfers, and notifications.
- Meet documented performance targets or record measured justified exceptions without weakening correctness.
- Add privacy-by-default checks for minors, data minimization, authenticated export/deletion, consent-aware analytics, and log redaction.

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
