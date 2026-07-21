# DRAGON-16 slice — Accessibility and bilingual UX

Parent prompt: `16-accessibility-performance-and-security-hardening.md`

## Mission
Close WCAG, keyboard, focus, contrast, Persian RTL, English LTR, and localized error-state gaps with automated and manual evidence.

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
