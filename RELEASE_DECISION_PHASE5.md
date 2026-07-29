# Phase 5 Release Decision — commerce, economy, rewards, prizes, and payouts

Recorded by DRAGON-26 on 2026-07-29. Scope: Phase 5 (GOAL-009) only. The Phase 1, 2, 3,
and 4 decisions are in `RELEASE_DECISION.md`, `RELEASE_DECISION_PHASE2.md`,
`RELEASE_DECISION_PHASE3.md`, and `RELEASE_DECISION_PHASE4.md`; none of them is changed by
this document.

Tested commit: `6105330` (DRAGON-25, "feat: add rewards transfers and hardened payouts"),
on top of `07c7fb0` (DRAGON-24, "feat: add store catalog checkout and fulfillment"). The
DRAGON-26 traceability reconciliation and this document sit on top of `6105330` and are
**not yet committed**.

## Decision: NO-GO

Phase 5 must not be released.

As with Phases 2, 3, and 4, the verdict is **not** driven by a defect. Every implementation
acceptance criterion in DRAGON-24 and DRAGON-25 is met and verified, the deterministic
suites are green, and no Critical or High implementation finding is outstanding. Phase 5 is
blocked by three unresolved external decisions, all three classified release-blockers by
this prompt's own gate table.

What that leaves is a commerce phase that cannot sell anything physical, cannot revoke
anything digital, and cannot let one person buy from another. Releasing it would ship a
store whose entire physical catalogue is unbuyable and whose digital goods carry no agreed
revocation rule — a shop with the shutters half down.

## External blockers (not implementation failures)

| Blocker | Owner | What is missing | Effect if released anyway |
|---|---|---|---|
| OD-019 | Commerce operations | Shipping carriers, service regions within Iran, shipping-price rules, and fulfilment service levels | **Physical commerce cannot be released.** A physical item can be authored, stocked, and browsed but not bought: selling one commits the platform to a delivery nobody has agreed how to make. Physical fulfilment states exist but cannot be advanced. No carrier concept exists in the code at all. |
| OD-020 | Commerce | Digital-product entitlement and revocation rules | **Affected digital products are blocked.** Entitlements are granted after payment and never revoked — there is no revocation route and no `revoked` state, because the rule that would govern one has not been written. |
| OD-030 | Product, legal, and finance | Whether a user-to-user Dragon Coin purchase means future platform-listed digital goods or something else | **Peer commerce cannot be released.** Buying from another user does not exist. Direct coin transfer between people is separately approved by DEC-022 and DEC-023 and is enabled; the purchase meaning OD-030 governs is not. |

None can be closed by engineering. All three require a product, legal, or commercial
decision.

## Implementation failures blocking release

**None.**

The DRAGON-25 security review returned REQUEST-CHANGES with two Critical findings and one
High. All three were real, all three are fixed, and each has a regression test:

| Finding | What it allowed | Fix |
|---|---|---|
| Dual-control bypass (Critical) | Failing a never-approved payout and retrying it reached `approved` with no recorded approver, so the approver comparison had nobody to compare against and one actor could settle alone | Settlement refuses an entitlement with no approver; a retry records the retrying actor as approver; reconciliation names a settled payout with no approver |
| Double ledger posting (Critical) | Two concurrent requests under one idempotency key each generated a record id and each posted, debiting the sender twice while the API reported one transfer | The ledger reference derives from `(sender, idempotencyKey)`, so the ledger's own dedup collapses the race; reconciliation now also detects a posting with no transfer record |
| Raceable transfer window (High) | Concurrent transfers each read the same pre-race window totals and were all admitted, collectively passing the configured limit | An atomic claim in one conditional update, with the budget released when the transfer is subsequently refused |

## Verification run for this decision

- `npm run typecheck` — pass (both workspaces)
- `npm run lint` — **0 errors**, 63 warnings (all pre-existing formatting warnings)
- `npm test` — **450 passed, 0 failed** (api 405, web 45)
- `npm run test:integration` — **476 passed, 0 failed**
- `npm run build` — pass · `npm run test:budget` — pass (entry bundle 376.21 kB against a 380 kB budget)
- `npm run e2e` — **464 passed, 1 skipped, 0 failed**, across small-mobile 320px, mobile 375px, and desktop 1440px in fa RTL and en LTR
- `npm run docker:up` — web, api, and mongo all **healthy**; nginx remains the single published entry point
- `npm run verify:persistence` — **PASS**: committed MongoDB data survived a Compose stop/start on the named volume
- `npm run closure:check` — 14/14 · `npm run decision:check` — 12/12

### Phase 5 acceptance criteria, evidenced

| Criterion | Evidence |
|---|---|
| Digital checkout, fa + en | `store.spec.ts` — discover, add to cart, check out, receive the entitlement, and read a receipt that reconciles |
| Physical checkout | **Not runnable.** `store.itest.ts` asserts a physical basket is refused with the gate off and that the product page says so before the customer commits (OD-019) |
| Stock contention | `store.itest.ts` — two real racing requests for the last unit produce exactly one order and a final stock of zero |
| Mixed payment | **Does not exist by decision.** An order settles in one asset; Toman buys Dragon Coin as an earlier, separate step, because DEC-050 permits no Toman balance to spend. Recorded in `DECISIONS.md` |
| Dragon Coin transfer | `economy.spec.ts` — a player sends coin in fa and en and both balances change; `economy.itest.ts` — atomic, idempotent, limit-bounded, and race-safe |
| Reward grant | `economy.itest.ts` — issued once per rule per account however often requested, with actor, reason, and ledger transaction recorded |
| Cash-prize manual settlement | `prizes.itest.ts` — verify recipient → approve → settle with evidence, plus dual control, retry, reversal, and cancellation. `economy.spec.ts` covers the console and its permission gate. **The full settlement journey is asserted at the service level, not through the browser** |
| Failure and reconciliation | `store.itest.ts` — an unfundable payment returns the stock and grants nothing; three reconciliation reports (store, economy, finance) each **recompute** from source records and name every difference |
| Exact arithmetic | `money.test.ts`, `store.test.ts` — integer-only, per-asset, with the classic float error asserted impossible; discounts round the reduction down so a total is never below what the merchant expects |
| Balanced postings | `ledger.itest.ts`, `economy.itest.ts` — every journal balances to zero; a transfer's two legs commit together |
| Idempotency | `store.itest.ts` (retried checkout returns the original order), `economy.itest.ts` (same key, including under a real race, moves value once) |
| Authorization | `store.itest.ts`, `economy.itest.ts`, `prizes.itest.ts` — every admin route refuses an ordinary user; `shop_operator` holds no finance permission |
| Privacy | `store.itest.ts` — another customer's order is a 404, not a 403; `economy.itest.ts` — a private recipient is indistinguishable from a missing one |
| Security | One focused review per money-handling slice; the DRAGON-25 Criticals are fixed and regression-tested |
| Accessibility | `store.spec.ts`, `economy.spec.ts` — one `h1`, `label[for]` on every control, correct `dir` per locale, table captions, no raw i18n keys |
| Performance | Keyset pagination and compound indexes on every commerce read path; the entry bundle holds its budget. **Structural, not measured** — see the honest characterisation below |
| Docker | `npm run docker:up` — all three services healthy |
| Mongo persistence | `npm run verify:persistence` — PASS |

### Gated features are disabled, not simulated

- **Physical fulfilment** — `PHYSICAL_FULFILLMENT_ENABLED` ships `false`. A physical basket is refused at checkout before any money moves, and no carrier, rate table, or booking record exists anywhere in the code. A guardrail test asserts no store source file so much as names a carrier or shipping rate in code.
- **Entitlement revocation** — `ENTITLEMENT_REVOCATION_ENABLED` ships `false`, and there is no revocation route and no `revoked` state to reach.
- **Peer commerce** — absent. The economy config surface reports it as gated.
- **Cash redemption, sell-back, exchange rate, order-book trading** — absent, not gated, and proven three ways: no registered route, no price or counter-asset on the transfer contract, and **no ledger transaction type that could balance a cash-out** even for a future caller.
- **Platform-managed returns and refunds** — no route, no collection; the store config reports `returnsWorkflow: not_offered` (DEC-034).
- **Internal Toman wallet** — reported `disabled`; Toman exists only as a payment amount and a displayed list price (DEC-050).
- **Payment provider** — the deterministic in-repository mock. No external provider was contacted, and no claim is made about how one would behave.

## Independent review of this decision

One focused `test-reviewer` release-readiness pass over the Phase 5 traceability, this
verdict, the four recorded deviations, and the Phase 5 code surface: **APPROVE WITH NOTES,
no Critical and no High findings.**

It verified by direct code reading — not by trusting this document — that DRAGON-25's two
Critical fixes and one High fix are genuinely in place and complete, that every gate
default is fail-closed in both `config.ts` and `.env.example`, that each blocked capability
is absent rather than gated-but-simulated, and that all four deviations match the code they
describe. It also confirmed the participant-facing entitlement view really does exclude
settlement evidence and approver ids, which is a claim this document makes.

Two Medium bookkeeping defects were found and are fixed:

| Defect | Correction |
|---|---|
| `REWARD-001` and `REWARD-008` were re-tagged `PHASE_1, PHASE_5`, but `Requirements.md` tags them `FOUNDATION, PHASE_1` and `PHASE_1` — the phase-tag pass had pattern-matched instead of reading each requirement's own tag | Both restored to their source tags, and the "accepted cross-phase mapping (Phase 5)" phrasing removed, since asserting a re-scope the requirement document never made is exactly the drift this file exists to prevent |
| `ROLE-022` lost its `FOUNDATION` tag | Restored to `FOUNDATION, PHASE_1, PHASE_5` |

Its third note — that the working tree also carries an unrelated `docker-compose.yml`
change — is accurate but not from this slice: that edit predates DRAGON-18 (it is the
intentional `${WEB_PORT:-8080}` host-port escape hatch, uncommitted since `3ecd32d`) and is
left alone rather than swept into a closure commit.

The reviewer did not re-execute the suites; the figures above are from the runs recorded in
this document.

## Pre-existing repository failures, separated from this work

**None outstanding.** Lint reports zero errors and every suite is green.

One intermittent is recorded rather than explained: the browser suite occasionally exits
non-zero while reporting every test passed, with no test failure ever named. It was seen in
DRAGON-24 and DRAGON-25; re-runs are clean, and the run recorded above exited zero. It has
not been diagnosed.

## Approved scope (local and test environments only)

- Localized physical and digital product catalogue with variants, SKUs, and internal stock.
- Digital purchase end to end: cart, server-recalculated totals, versioned discounts, idempotent checkout, entitlement, and a reconciling receipt.
- Auditable inventory movements and internal fulfilment states.
- Dragon Coin purchase through the mock provider, reward rules and grants, and direct user-to-user transfer with limits and a manual-review hold.
- Prize allocation from final standings, and manual cash settlement with recipient verification, dual control, retry, reversal, and evidence.
- Three reconciliation reports that recompute from source records.
- Storefront, product, cart, checkout, orders, wallet, store administration, order operations, and prize settlement consoles, in fa and en.

## Excluded scope

- Purchase of any physical product, in any environment where `PHYSICAL_FULFILLMENT_ENABLED` is not deliberately set. It ships `false`.
- Carrier selection, shipping rates, service regions, and any external shipping call.
- Digital entitlement revocation.
- User-to-user purchases (peer commerce).
- Cash redemption, sell-back, withdrawal, and order-book trading — permanently, not pending.
- Platform-managed returns and refunds (DEC-034).
- A general internal Toman wallet (DEC-050), and any mixed-asset order.
- Third-party marketplace vendors and international shipping.
- Product categories, cart expiry, and `/account/payouts`.
- Catalog, conversion, inventory, and coin analytics reporting beyond the three reconciliation reports.

## Blocked / disabled capability inventory

| Capability | Gate or decision | Shipped state |
|---|---|---|
| Buying a physical product | OD-019 | Refused at checkout; `PHYSICAL_FULFILLMENT_ENABLED` ships `false` |
| Advancing a physical fulfilment | OD-019 | Refused; the states exist but cannot be used |
| Carrier booking or shipping rates | OD-019, INT-008 | Absent: no adapter, credential, or rate table |
| Digital entitlement revocation | OD-020 | Absent: no route, no state |
| Peer commerce | OD-030 | Absent; reported as gated |
| Cash redemption / sell-back / order book | DEC-023, DEC-024 | Absent permanently, not gated |
| Returns and refunds | DEC-034 | Absent; reported as `not_offered` |
| Internal Toman wallet | DEC-050 | Absent; reported as `disabled` |
| External payout provider | DEC-045 | Not required and not built; settlement is manual |
| Live payment provider | PAY-012 | Deterministic mock only |

## Gates that must flip before a Phase 5 GO is reconsidered

- `PHYSICAL_FULFILLMENT_ENABLED` — requires approved carriers, service regions, shipping-price rules, and service levels.
- `ENTITLEMENT_REVOCATION_ENABLED` — requires approved entitlement and revocation rules.
- `PAYMENTS_MOCK_ENABLED` — a real Phase 5 release needs a real payment provider, not the deterministic mock.

## Conditions for reconsidering the verdict

1. OD-019 resolved: carriers, service regions, shipping-price rules, and service levels approved, then implemented behind a real carrier adapter.
2. OD-020 resolved: digital entitlement and revocation rules approved and implemented.
3. OD-030 resolved: the meaning of a user-to-user purchase settled, or peer commerce explicitly dropped from scope.
4. A live payment provider integrated and validated, replacing the deterministic mock.
5. Manual accessibility certification of the storefront, cart, checkout, and finance consoles, which local automation does not replace.
6. Production capacity evidence for checkout and ledger posting under real load — the current evidence is structural, not measured.
7. A sweeper for orders stuck in `pending_payment` after a process crash, covering every hold-based purchase flow (recorded as a known limitation in `DECISIONS.md`).
8. Authorized human sign-off, on the same basis Phases 1 through 4 require.

Production deployment authorized: **NO**. Awaiting authorized human sign-off.

## Honest characterisation

Everything verified here ran on a local stack with deterministic mock adapters. "Payment"
throughout Phase 5 means the in-repository mock provider and the Dragon Coin ledger; no
external payment or shipping provider was ever contacted, and no claim is made about how
one would behave. The performance evidence is **structural, not measured**: every commerce
read is keyset-paginated against a compound index and every money path is exact integer
arithmetic, but no load test was run and no figure is offered for checkout latency or
ledger throughput under contention. The stock-contention and transfer-race guarantees are
proven by real concurrent requests in the integration suite, which is a stronger claim than
the performance one — but still at test scale, not production scale.

One known limitation is carried forward from DRAGON-24 rather than hidden: if the process
dies between an order transaction committing and the Dragon Coin capture returning, the
order stays `pending_payment` and its claimed stock is never released. In-process failures
are handled and tested. The fix belongs in one sweeper across every hold-based purchase
flow, and is listed as a condition above.
