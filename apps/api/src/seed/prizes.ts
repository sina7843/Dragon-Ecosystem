/**
 * Prize allocation and the cash-entitlement lifecycle, through the real prize and ledger
 * services — never by writing an entitlement or a ledger row directly.
 *
 * Nothing had ever been allocated, so the prize table, the finance queue, and the payout
 * history were all empty. This allocates every tournament that has both prize placements
 * and final standings, then walks the resulting cash entitlements far enough to show each
 * state an operator actually sees: one left `pending`, one `approved` and awaiting
 * settlement, one `paid`. Dragon Coin rewards need no such walk — `allocate` credits them
 * to the winner's wallet through a balanced double-entry posting.
 *
 * Every step is idempotent: `allocate` is keyed on the standings version and returns the
 * existing allocation on a rerun, and each transition is attempted only from the state
 * that precedes it.
 */
import type { SeedSummary } from './harness.ts';
import type { UserRegistry } from './users.ts';
import { accountContext, type Services } from './wiring.ts';

/** How far each rank is taken, so all three entitlement states are represented. */
const RANK_PLAN: Readonly<Record<number, 'paid' | 'approved' | 'pending'>> = { 1: 'paid', 2: 'approved', 3: 'pending' };

interface Entitlement {
  _id: string;
  rank: number;
  state: string;
  version: number;
}

export async function seedPrizes(services: Services, summary: SeedSummary, users: UserRegistry): Promise<void> {
  const db = services.db;
  // A finance operator is the real actor for these decisions, so the audit trail and the
  // `approvedBy`/`paidBy` fields name a plausible person rather than "system".
  const operator = users.get('op-finance') ?? users.get('admin-super');
  if (operator === undefined) return;
  const ctx = () => accountContext(operator.accountId, ['finance_operator', 'platform_administrator']);

  const candidates = (await db
    .collection('tournaments')
    .find({ 'prizes.placements.0': { $exists: true } }, { projection: { _id: 1 } })
    .toArray()) as unknown as Array<{ _id: string }>;

  let allocated = 0;
  let reused = 0;
  for (const tournament of candidates) {
    const standings = await services.competitions.getStandings(tournament._id);
    if (standings === null || standings.status !== 'final') continue; // still in play
    const before = await db.collection('prize_allocations').countDocuments({ tournamentId: tournament._id });
    try {
      await services.prizes.allocate(ctx(), tournament._id);
    } catch {
      // No participant reached a prize rank, or the standings moved mid-run: skip it.
      continue;
    }
    const after = await db.collection('prize_allocations').countDocuments({ tournamentId: tournament._id });
    if (after > before) allocated += 1;
    else reused += 1;
  }
  summary.record('prize allocations', allocated, reused);

  // Walk the cash entitlements to their planned states.
  const entitlements = (await db
    .collection('prize_entitlements')
    .find({ state: { $in: ['pending', 'approved'] } }, { projection: { _id: 1, rank: 1, state: 1, version: 1 } })
    .sort({ rank: 1, _id: 1 })
    .toArray()) as unknown as Entitlement[];

  let advanced = 0;
  for (const entitlement of entitlements) {
    const target = RANK_PLAN[entitlement.rank] ?? 'pending';
    if (target === 'pending') continue;
    let current = entitlement;
    if (current.state === 'pending') {
      const approved = await services.prizes.approveEntitlement(ctx(), current._id, {
        expectedVersion: current.version,
        reason: 'Demo: verified against the final standings.'
      });
      current = { ...current, state: approved.state, version: approved.version };
      advanced += 1;
    }
    if (target === 'paid' && current.state === 'approved') {
      await services.prizes.payEntitlement(ctx(), current._id, {
        expectedVersion: current.version,
        reason: 'Demo: settled off-platform.',
        settlementEvidence: `demo-settlement-${current._id.slice(0, 8)}`
      });
      advanced += 1;
    }
  }
  summary.record('prize entitlement decisions', advanced, Math.max(0, entitlements.length - advanced));
}
