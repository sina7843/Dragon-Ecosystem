# Financial guide: ledger, Dragon Coin, payments, refunds, reconciliation

The money model as implemented — the value contract, the double-entry ledger, Dragon Coin,
holds, the mock payment path, what refunds do and do not exist, and every reconciliation
report — satisfying DOC-012.

This describes current behavior. Every gated or absent capability is named with its gate.

## The value contract

[apps/api/src/shared/money.ts](apps/api/src/shared/money.ts) (DATA-061, section 15.1):

```ts
interface Money { assetCode: AssetCode; amountInteger: number; scale: number }
```

**CON-002: no monetary calculation may use binary floating-point arithmetic.** Every amount is
a safe integer in the asset's minor unit; `scale` records how many decimals that minor unit
represents. `money.test.ts` asserts the classic float error is impossible.

| Asset | Code | Scale | Notes |
|---|---|---|---|
| Iranian rial | `IRR` | 0 | Stored unit for fiat. **1 Toman = 10 rial** (`RIAL_PER_TOMAN`); Toman is display-only (DEC-020) |
| Dragon Coin | `DRC` | 0 | Whole integer units, no fractional coin (ASM-006, DEC-049) |

Both assets are whole-unit, so `scale` is 0 for both today. Nothing in the money module labels
a value, which is why a rial amount can never be rendered as if it were Toman.

## Double-entry ledger

[modules/ledger](apps/api/src/modules/ledger) — the immutable core. A posted transaction is
never mutated; a mistake is corrected by a **compensating** transaction.

### Account types

`ACCOUNT_TYPES` ([accounts.ts](apps/api/src/modules/ledger/accounts.ts)):

| Account type | Owner | Asset | May go negative |
|---|---|---|---|
| `user_dragon_coin` | user | DRC | **No** |
| `platform_dragon_coin_treasury` | system | DRC | Yes |
| `cash_clearing` | system | IRR | Yes |
| `tournament_fee_holding` | system | IRR | Yes |
| `refund_clearing` | system | IRR | Yes |
| `prize_payable` | system | DRC | Yes |

A user Dragon Coin balance is a **liability the platform owes the user and must never go
negative** — there is no overdraft. System accounts may go negative because they are the
platform's own side of the entry.

**There is no user IRR ledger account** (WALLET-009). Cash enters through `cash_clearing`; a
user never holds a fiat balance, which is why no cash-out can exist (see below).

### Transaction types

`TRANSACTION_TYPES` — each pins the asset every leg must use and the account roles it may
reference:

| Type | Asset | Allowed accounts |
|---|---|---|
| `dragon_coin_issue` | DRC | treasury, user, prize_payable |
| `dragon_coin_transfer` | DRC | user, treasury |
| `dragon_coin_adjustment` | DRC | user, treasury, prize_payable |
| `cash_fee_collection` | IRR | cash_clearing, tournament_fee_holding, refund_clearing |
| `compensation` | inherits from the reversed transaction | `any` |

`compensation` is the only type allowed `any` account role, because it must be able to reverse
whatever the original touched.

### Integrity: constraints, not read-before-write

The authority behind the invariants is **unique indexes**, not application checks
([ledger/collections.ts](apps/api/src/modules/ledger/collections.ts)):

| Index | Guarantees |
|---|---|
| `account_identity_unique` | one account per identity |
| `transaction_business_ref_unique` | **one posting per business reference** |
| `transaction_reversal_unique` (partial) | one compensation per transaction |
| `entry_transaction_line_unique` | unique line numbers within a transaction |

So concurrent creation or posting collapses to a single durable record rather than racing.
`ledger.post` writes header, entries, balance projection, audit row and outbox event **inside
one unit of work**.

## Dragon Coin

- Bought with Toman through the **mock** provider, then spent. Crediting is exactly-once.
- **Cannot be redeemed, sold back, or exchanged for money** (DEC-024). This is proven three
  ways, including that the ledger has **no transaction type that could balance a cash-out**
  — the absence is structural, not a disabled flag.
- Peer-to-peer transfer between users is implemented (`economy` module, DEC-022/023) with
  rolling-window limits and a manual-review threshold. Peer *commerce* stays out under OD-030.

`DEFAULT_ECONOMY_LIMITS` ([economy/state.ts](apps/api/src/modules/economy/state.ts)):
`maxTransferAmount` 10,000 · `transferAmountPerWindow` 20,000 · `transfersPerWindow` 20 ·
`windowSeconds` 86,400 · `manualReviewThreshold` 5,000 · `payoutReviewThreshold` 50,000,000.

The rolling window is claimed **atomically** — read-then-decide was a real DRAGON-25 defect
and is regression-tested. A cold-window race that once refused a legitimate transfer with a
misleading limit error was fixed in DRAGON-28 and is covered by the bounded performance tests
(scenario A, [apps/api/src/perf/perf.itest.ts](apps/api/src/perf/perf.itest.ts)).

## Holds

[modules/holds](apps/api/src/modules/holds) — a reservation against a Dragon Coin balance.
States: `active`, `partially_captured` (open) → `captured`, `released`, `expired`, `cancelled`
(terminal). A terminal hold cannot change.

**Purposes and transfer relationships are code-owned. A client never chooses a source,
destination, treasury, escrow or prize account.** `HOLD_PURPOSES`
([purposes.ts](apps/api/src/modules/holds/purposes.ts)):

| Purpose | Enabled | Capture destination | Partial capture | Gate |
|---|---|---|---|---|
| `admin_correction` | ✅ | treasury | yes | — |
| `tournament_checkout` | ✅ | treasury | no | reachable only through the OD-007-gated paid checkout |
| `course_enrollment` | ✅ | treasury | no | reachable only through the OD-015-gated paid course flow |
| `store_order` | ✅ | treasury | no | DEC-022 permits coin for store purchases |
| `tournament_entry_fee` | ❌ | treasury | yes | **OD-007**: paid tournament registration not activated |
| `prize_reservation` | ❌ | prize_payable | no | prize payout deferred beyond DRAGON-11 |

Partial capture is `false` wherever a capture settles a purchase, because **a partial capture
is a partial refund by another name** and DEC-034 approves no return workflow.

A disabled purpose is **fail-closed**: creation returns a stable disabled error and produces
**no hold, journal, audit, or outbox effect**.

## Typed transfer boundaries — all gated

`TRANSFER_TYPES` exists so a gated transfer returns a stable disabled error with no side
effect. **Every one is disabled**, asserted by `holds.test.ts`:

| Transfer type | Source → destination | Gate reason |
|---|---|---|
| `user_to_user` | user → user | not enabled at this boundary |
| `refund_execution` | refund_clearing → user | refund execution deferred |
| `prize_payout` | prize_payable → user | prize payout deferred |
| `withdrawal` | user → cash_clearing | **withdrawable cash is not enabled** |

Peer transfer reaching users today goes through the `economy` module under DEC-022/023, not
through this gated `user_to_user` boundary.

## Payments

[modules/payments](apps/api/src/modules/payments) — **a deterministic mock provider only.**
No live payment provider is integrated anywhere in the repository.

- `PAYMENTS_MOCK_ENABLED` is **fail-closed in production**: enabled by default outside
  production, off in production unless explicitly set, asserted by `config.test.ts`.
- `PAYMENTS_CALLBACK_SECRET` is **production-required**; callbacks are signature-verified.
  Forged-signature, field-substitution, replay and fee-integrity cases are all covered by
  focused security tests.
- A replayed provider callback credits **once** — covered in the API suite and end to end in
  `academy-paid.spec.ts`.

Order settlement uses **exactly one asset (Dragon Coin)**; Toman buys Dragon Coin as a
separate, earlier step. There is **no mixed-payment order** (DECISIONS.md, 2026-07-29): DEC-050
permits no internal Toman balance to spend, and a split payment failure would leave an order
half-settled with no approved way to unwind it. A rial figure on a receipt is a **displayed
list price, never a charged amount**.

## Refunds — deliberately absent

**There is no refund, return, or RMA surface anywhere** (COMMERCE-010, DEC-034):

- `refund_execution` is a gated transfer type with no enabled path;
- `refund_clearing` exists as an account role with no transaction routing into a user;
- PAY-005 has six payment states and **no reversed, refunded or disputed state** — recorded as
  a Partial row, not hidden;
- entitlement revocation is absent under OD-020;
- Dragon Coin is non-redeemable, so capturing it creates **no cash obligation and therefore no
  refund path** — which is precisely why the paid flows are safe to enable while DEC-034 is
  unresolved.

The correction mechanism that *does* exist is `compensation`: an append-only reversing
transaction that preserves the original evidence.

## Prizes and payouts

[modules/prizes](apps/api/src/modules/prizes) — a nine-state entitlement lifecycle with:

- **actor-level dual control** (the approver cannot be the requester), including across a
  fail-then-retry path — a real DRAGON-25 Critical, fixed and regression-tested;
- recipient verification before settlement;
- retry on the same record;
- reversal that preserves the original evidence.

`/account/payouts` (PAGE-043) is **deliberately not built**: its own acceptance note is that no
withdrawal capability is shown unless legally activated, and no withdrawal exists.

## Reconciliation reports

All read-only, bounded, finance-permission gated:

| Report | Route | Reconciles |
|---|---|---|
| Holds | `POST /api/v1/admin/holds/reconciliation` | holds against ledger accounts; body caps at 100 account ids |
| Economy | `GET /api/v1/admin/economy/reconciliation` | coin movement against the ledger |
| Prizes / finance | `GET /api/v1/admin/finance/reconciliation` | definition → allocation → ledger → settlement, **naming every difference** |
| Store orders | `GET /api/v1/admin/store/reconciliation` | paid orders against captured holds |

Store and economy reports check **both directions** — record→evidence *and* evidence→record —
so an orphan on either side is visible.

The store never posts to the ledger itself; it settles through the shared holds boundary. That
is the ROLE-021 separation: a shop operator moves goods, not money.

## Stuck reservations

[modules/operations/recovery.ts](apps/api/src/modules/operations/recovery.ts) is a
**read-only detector, not a repair tool** (DECISIONS.md, 2026-07-29). It reports hold-backed
records stranded by a crash between the domain commit and the hold capture, bounded by an age
threshold and a per-workflow limit, and **repairs nothing**. Several remedies depend on policy
nobody has approved: DEC-034 approves no return workflow, so a captured-but-unfinished order
has no agreed resolution, and a repair endpoint able to move money is the one most likely to be
aimed at the wrong record. Its scan is index-served (`enrollment_state_created`,
`order_state_created`), asserted by query plan in the bounded performance tests.

## Tests

| Concern | Where |
|---|---|
| Exact-integer money, float error impossible | `money.test.ts`, `store.test.ts` |
| No negative user balance | ledger overdraft guard; `store.itest.ts`, `economy.itest.ts` |
| Hold and capture idempotency | `holds.itest.ts`, `store.itest.ts` |
| Transfer concurrency, atomic window claim | `economy.itest.ts`, perf scenarios A and B |
| Stock concurrency (one winner for the last unit) | `store.itest.ts`, perf scenario C |
| Immutable order snapshots | `store.itest.ts` |
| Reward uniqueness under replay | `economy.itest.ts` |
| Payout dual control, retry, reversal | `prizes.itest.ts` |
| Entitlement granted exactly once, after capture | `store.itest.ts` |
| Reconciliation both directions | store, economy and finance report tests |
| Gates fail closed with no side effect | `holds.test.ts`, `config.test.ts` |

## Limitations

- **Mock provider only.** No live payment provider, no acquirer, no settlement file. Local and
  test operation is not production readiness.
- **No refunds, returns, disputes, or chargebacks** (DEC-034, COMMERCE-010).
- **No cash-out or withdrawal** (DEC-024, DEC-050) — structurally absent, not flagged off.
- **No mixed-asset order.**
- **No production financial observation.** Reconciliation reports have been exercised against
  test data only; PERF-014 and OPS-014 remain blocked.
- **Stuck reservations are detected, never repaired** — the remedy is policy-blocked.
