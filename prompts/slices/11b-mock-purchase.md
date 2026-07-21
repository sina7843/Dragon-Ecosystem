# DRAGON-11 slice — Mock purchase and crediting

Parent prompt: `11-mock-payment-and-dragon-coin-ledger.md`

## Mission
Implement deterministic mock Toman payment lifecycle, verified callback, exactly-once Dragon Coin crediting, correction, and failure tests.

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
