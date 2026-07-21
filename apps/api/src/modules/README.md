# Domain modules

One directory per domain boundary from Requirements section 32.1:

identity · profile · content · games · teams · tournaments · competition · notifications · moderation · media · payments · ledger · education · social · commerce · operations

No module exists yet. DRAGON-03 onwards adds them.

## Dependency rules

These are enforced by ESLint (`eslint.config.mjs`), not just documented:

1. A module never imports another module's internals. Cross-module access goes through the other module's public `index.ts`.
2. A module never reads or writes another module's collections. Ask that module, or consume its domain events.
3. The shared kernel (`src/shared`, `src/http`) never imports a domain module. Dependencies point inward only.

## What every module write must go through

`runUnitOfWork` in `src/shared/db/unit-of-work.ts`. It supplies the transaction session, the request context, and the audit and outbox queues, so a domain write cannot silently skip audit correlation or lose its domain event. Direct collection writes outside a unit of work are a review failure.
