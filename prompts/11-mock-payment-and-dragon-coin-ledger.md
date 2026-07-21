# DRAGON-11 — Mock payment and Dragon Coin ledger

Use this prompt after its listed dependencies are complete and integrated. Submit the fenced text directly to Claude Code.

```text
Prompt ID: DRAGON-11

Mission:
Implement the approved mock Toman payment adapter and an auditable Dragon Coin ledger for purchases, grants, spend, holds, and transfers.

Inputs and precedence:
- Follow the repository's current `CLAUDE.md` and `IMPLEMENTATION_DECISIONS.md`.
- Use `Requirements.md` and this prompt as the product scope.
- When sources conflict, follow the explicit implementation decision and record the choice briefly. Do not invent unresolved business policy.

Dependencies:
DRAGON-08, DRAGON-04
Confirm the dependency work is present and integrated. If it is missing, report the blocker and stop instead of starting unrelated work.

Requirements scope:
All relevant FOUNDATION and PHASE_1 requirements, especially Sections 6–18 and 30–39.
Read the relevant requirement sections before implementation and preserve stable requirement IDs when updating traceability.
Use `prompts/prompt-manifest.json` only as a scope reference. Update traceability files only when requirement mappings actually change.

Open decisions:
- OD-007 [feature-gate]: Record reversible ledger boundaries without inventing policy.
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
- `slices/11a-ledger-core.md` — Ledger core and invariants
- `slices/11b-mock-purchase.md` — Mock purchase and crediting
- `slices/11c-holds-transfers.md` — Holds and transfer boundaries

Acceptance criteria:
- Implement mock payment intents, signed callbacks, success/failure/expiry/delay/duplicate/invalid-signature/unknown scenarios, idempotency, and reconciliation without any external network call.
- Implement immutable balanced ledger postings, accounts, available/held balance, packages, purchase credit, admin grant with reason, spend, gift/direct transfer, limits, holds, and manual review.
- Dragon Coin purchases are final and non-refundable; no cash redemption, cash-out, user refund endpoint, or negative silent correction may exist.
- Duplicate, fraud, or system-error corrections must use authorized compensating ledger adjustments with complete audit evidence.
- Add exact-arithmetic, concurrency, idempotency, authorization, abuse, reconciliation, and bilingual E2E tests.

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
