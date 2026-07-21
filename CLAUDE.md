# Dragon Ecosystem — Claude Code instructions

## Source precedence
1. `IMPLEMENTATION_DECISIONS.md`
2. `Requirements.md`
3. The currently active file under `prompts/`
4. Existing repository conventions
5. A small documented assumption when none of the above resolves the issue

## Working rules
- Work on one DRAGON prompt or one named slice at a time.
- Before any implementation, confirm the repository has at least one Git commit. Stop if `git rev-list --all --count` is zero.
- Inspect the repository before changing architecture or dependencies.
- Implement the smallest coherent end-to-end change.
- Do not create signed state, task gates, automatic retry loops, Stop hooks, or custom verifier engines.
- Delegate only when a clearly separate frontend, backend, review, or deployment task benefits from it.
- Use at most one independent `test-reviewer` pass for high-risk work.
- Run checks relevant to the changed scope. Do not claim a check passed unless it actually ran.
- Do not read or create real secret files. Use `.env.example`, safe defaults, and documented variable names; ask the user to run `06-CREATE-LOCAL-ENV.cmd` when a local `.env` is needed.
- Treat `Requirements.md`, `IMPLEMENTATION_DECISIONS.md`, `CLAUDE.md`, `.claude/`, `tools/`, and `prompts/` as protected source material. Read them, but do not rewrite them during product implementation.
- Keep Persian RTL and English LTR behavior correct where the active requirement applies.
- Update `PROJECT_STATUS.md`, `IMPLEMENTATION_STATUS.md`, decisions, and traceability only when the change materially affects them.

## Completion format
At the end of each prompt report:
- implemented behavior;
- important changed files;
- commands and tests actually run;
- unresolved decisions or blockers;
- remaining risks;
- the next eligible prompt or slice.
