# Dragon Ecosystem Staged Prompt Runbook

The numbered prompts split the product into manageable delivery stages. Run one prompt at a time in dependency order as normal Claude Code work.

## Workflow

1. Read `IMPLEMENTATION_DECISIONS.md` and the relevant sections of `Requirements.md`.
2. Select the first prompt whose dependencies are complete and integrated.
3. Submit only that prompt's fenced text to Claude Code.
4. Review the implementation and run the targeted tests appropriate to its risk.
5. Record material decisions, status, and requirement mappings when they change.
6. Commit or otherwise preserve the completed work before starting the next prompt.

Do not run overlapping prompts against the same checkout. Large domains may use the smaller ordered files in `prompts/slices/`, but each slice should remain a normal bounded implementation task rather than a nested verification process.

## Review policy

Use the five-role simplified team only as needed: orchestrator, frontend, backend, test reviewer, and DevOps/release. The orchestrator may delegate a focused task, but it should not create review chains. A single test/security/release review is sufficient for high-risk work.

## Verification policy

Use existing project scripts and run only checks relevant to the changed scope. Release prompts should run the broader suite; ordinary feature prompts should not repeatedly rebuild or verify the entire repository.
