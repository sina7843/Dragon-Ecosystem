# Prompt Pack Quick Start

1. Read `IMPLEMENTATION_DECISIONS.md`.
2. Confirm at least one Git baseline commit exists, then start with `00-foundation-bootstrap-and-governance.md`.
3. Copy the fenced prompt into Claude Code.
4. Let the agent implement one coherent slice and run targeted tests.
5. Review and preserve the changes, then continue according to the dependencies in `prompt-manifest.json`.

Prompts 00–17 cover the foundation and Phase 1. Prompts 18–26 cover later phases. Prompt 27 performs the final whole-system audit. Files under `prompts/slices/` divide the largest domains into smaller tasks. Execute `09a/09b/09c`, `11a/11b/11c`, `16a/16b/16c`, `17a/17b/17c`, and `27a/27b/27c`; do not execute those parent prompts as separate tasks.

## Fixed product decisions

- MongoDB 8.x is the current database.
- Payment and SMS use realistic deterministic mock adapters in the current scope.
- Dragon Coin cannot be refunded, cashed out, or converted to money.
- Cash prizes use a manual audited settlement workflow.
- A tournament supports up to 1,000 players or teams.
- Application-managed backup/restore is not a current delivery requirement.

Advance when the prompt's feature behavior and relevant tests are complete. Avoid formal evidence workflows, repeated global verification, and multiple reviewer chains.
