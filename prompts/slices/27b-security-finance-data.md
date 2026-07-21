# DRAGON-27 slice — Security, finance, and data audit

Parent prompt: `27-whole-ecosystem-final-audit-and-release-evidence.md`

## Mission
Audit security boundaries, ledgers/payouts, privacy, data integrity, migration/index health, and failure recovery across the ecosystem.

## Working boundary
- Implement only this slice and its direct integration points.
- Follow the parent prompt's dependencies, requirement scope, and open decisions.
- Do not start the next slice until this one works and its targeted tests pass.
- Avoid nested task workflows, formal evidence collection, and repeated global verification.

## Acceptance
- The slice behavior works end to end for its stated scope, including validation, authorization, failure, conflict/concurrency, and bilingual UI where applicable.
- Changed contracts and requirement IDs are reflected in relevant tests or traceability.

## Verification
- Run the smallest relevant unit, integration, typecheck, build, or browser test set.
- Add focused tests for the behavior changed by this slice.
- Update status and traceability only when the slice changes them.
- Report completed behavior, test results, blockers, and remaining risks to the parent prompt.
