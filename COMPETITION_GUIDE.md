# Tournament-rule and competition-engine guide

The formats the engine produces, how byes and progression work, how standings and tiebreaks
are computed, and what is deliberately gated — satisfying DOC-011.

This describes current behavior. Anything gated or absent is named as such.

## Design: a pure engine behind a persistent service

| Layer | File | Responsibility |
|---|---|---|
| Engine | [apps/api/src/modules/competitions/engine.ts](apps/api/src/modules/competitions/engine.ts) | Pure structure generation and progression. **No I/O, no clock, no RNG.** |
| Format modules | `double-elimination.ts`, `swiss.ts`, `manual.ts` | Format-specific structure |
| Standings | `standings.ts` | Deterministic projection over accepted results |
| Service | `service.ts` | Persistence, authorization, versioning, concurrency |

Every engine function is a total function of its inputs: **the same participants and seed
always produce the same bracket** (BRACKET-001/003/008/009, BRACKET-018). That is what makes
regeneration, rollback and the property tests possible.

Match keys are logical and positional — `r2m0` — so structure is comparable across runs; the
service maps each key to a stable opaque id on write. Never expose a positional key as an API
identity.

## Formats

`EngineFormat` = `single_elimination` | `double_elimination` | `round_robin` | `swiss` |
`manual`.

`BracketSide` records which sub-bracket a fixture belongs to: `winners`, `losers`,
`grand_final` (double elimination), or the flat families `round_robin`, `swiss`, `manual`.
The public bracket UI groups by band and only labels bands when a format emits more than one.

| Format | Structure | Progression |
|---|---|---|
| `single_elimination` | Power-of-two tree; non-power-of-two fields get byes assigned to the **top seeds** (BRACKET-009) | Winner advances to `nextKey`/`nextSlot` |
| `double_elimination` | `winners` + `losers` + `grand_final` | Winners-bracket loser is routed into the losers bracket |
| `round_robin` | Every participant meets every other once | No advancement; standings rank the field |
| `swiss` | Round-by-round pairing; rounds are generated on demand | An explicit operator action generates the next round |
| `manual` | Operator-defined fixtures | Operator-controlled |

## Byes

A `null` slot means one of two different things, and the distinction matters:

- **pending** — the participant is not known yet (an earlier match has not resolved);
- **permanently empty** — the bye source produced no participant. Marked by the `bye` flag.

When a participant is routed into the sibling of a permanently-empty slot, that fixture is a
**structural bye**: it advances without a result, and its `winner` is known at generation
time rather than resolved from a submitted result.

Every bye winner is **pre-advanced into its next-round slot during generation**, so a match
whose both slots are filled by byes becomes immediately playable and the whole structure stays
reproducible. Without pre-advancement the bracket would depend on the order results arrive.

## Standings

`standings.ts` is a **pure projection** of accepted results, the seeded participant order, and
the versioned points policy — "never of the wall clock, insertion order, or database natural
order" (BRACKET-015). `STANDINGS_POLICY_VERSION` is currently `1`.

`StandingRow` carries `played`, `wins`, `draws`, `losses`, `points`, `tiebreaks`, `rank`,
`shared`, and `placement` (`champion` | `runner_up` | `eliminated` | `active` | `ranked` |
`unresolved`).

`StandingsStatus` is `final` | `provisional` | `partial`. **Only `final` standings are quoted
as a result**: the public tournament page announces a champion only when the snapshot is
`final`, because a provisional one can still change and announcing a champion that later moves
is worse than showing nothing.

### Points policy

- A win scores **one point**.
- **Draws are not produced** by the current single-winner result model. The `draws` field
  exists on the row and is always zero.
- Round-robin and Swiss rank by points, with **the seeded order as the sole stable final
  fallback**.
- Elimination formats rank by bracket placement, not points.

### Tiebreaks

`tiebreaks` is a per-format map of deterministic inputs:

| Format family | Tiebreak input |
|---|---|
| Round-robin / Swiss | `wins` |
| Elimination | `eliminationRound` (0 when not eliminated) |

**Opponent-strength tiebreaks — Buchholz and similar — are implemented nowhere and are
deliberately gated.** A richer rule-profile-driven points policy is gated behind **OD-006**.
Until that decision lands, an unbroken tie is reported honestly: `shared: true` on every row
sharing the rank, rather than being resolved by an invented rule.

## Operator actions

All under `/api/v1/admin/tournaments/:id/…`
([routes.ts](apps/api/src/modules/competitions/routes.ts)):

| Action | Route |
|---|---|
| Generate / read competition | `POST` / `GET .../competition` |
| Record a match result | `POST .../matches/:mid/result` |
| Correct an accepted result | `POST .../matches/:mid/correct` |
| Lock / unlock | `POST .../competition/lock` |
| Recalculate standings | `POST .../competition/recalculate` |
| Generate the next Swiss round | `POST .../competition/swiss-round` |
| List versions | `GET .../competition/versions` |
| Preview / apply regeneration | `POST .../competition/regenerate/preview`, `.../regenerate` |
| Roll back to a version | `POST .../competition/rollback` |

Public reads are `GET /api/v1/tournaments/:id/standings` and `.../bracket`, both paged.

Regeneration and rollback are versioned: a regeneration preview shows what would change
before it is applied, and **recorded results survive a regeneration and rollback cycle** —
asserted by `competitions-versions.itest.ts` and by the browser suite
(`competitions.spec.ts`, "an operator regenerates and rolls back a bracket without losing
recorded results").

Every mutation is authorized server-side, audited, and version-checked. Concurrent standings
writes are covered by `standings-concurrency.itest.ts`.

## Events

The engine emits no events. The service publishes, through the transactional outbox
(see [DOMAIN_EVENTS.md](DOMAIN_EVENTS.md)): `competition.generated`,
`competition.match_completed`, `competition.result_corrected`, `competition.lock_changed`,
`competition.swiss_round`, `competition.regenerated`, `competition.rolled_back`.

**None of them is mapped to a notification template**, so no competition event currently
messages a participant.

## Tests

| Concern | File |
|---|---|
| Engine structure and determinism | `engine.test.ts`, `competitions.test.ts` |
| Double elimination | `double-elimination.test.ts` |
| Swiss | `swiss.test.ts` |
| Manual | `manual.test.ts` |
| Standings and tiebreaks | `standings.test.ts` |
| Persistence, authorization, progression | `competitions.itest.ts`, `competitions-advanced.itest.ts` |
| Versioning, regeneration, rollback | `competitions-versions.itest.ts` |
| Concurrent standings writes | `standings-concurrency.itest.ts` |
| Bracket and standings in the browser | `apps/web/e2e/competitions.spec.ts` |

## Limitations

- **No draw result.** The result model has a single winner; `draws` is structurally always 0.
- **No opponent-strength tiebreak** (gated, OD-006). Unbroken ties are reported as shared.
- **No match scheduling or rescheduling.** Match times come from generation; there is no
  reschedule operation, no old/new-time record, and no reschedule notification
  (API-043, TOURN-020, both still open). A per-account match schedule page does not exist
  either (PAGE-018).
- **No per-match referee scope.** TOURN-021 and ROLE-010 remain partial: authorization is
  tournament-level, not per match.
- **No player check-in.** Deliberate — asserted absent by the closure check
  (`TOURN-024`: no registered route exposes check-in).
- **Capacity is bounded at ≤1,000 participants** for the verified envelope; larger fields are
  untested at scale (DEC-046).
