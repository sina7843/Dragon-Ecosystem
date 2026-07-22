import type { IndexDeclaration } from '../../shared/db/collections.ts';

/** Collections owned by the prizes module (DRAGON-12). */
export const PRIZES_COLLECTIONS = {
  allocations: 'prize_allocations',
  entitlements: 'prize_entitlements'
} as const;

/**
 * Prize integrity safeguards. One allocation per standings version makes allocation
 * idempotent; one cash entitlement per (tournament, allocation version, rank)
 * prevents duplicate cash prizes; owner/state indexes back the read and finance
 * queues.
 */
export const PRIZES_INDEXES: readonly IndexDeclaration[] = [
  { collection: PRIZES_COLLECTIONS.allocations, name: 'allocation_standings_unique', keys: { tournamentId: 1, standingsVersion: 1 }, options: { unique: true } },
  { collection: PRIZES_COLLECTIONS.allocations, name: 'allocation_version_unique', keys: { tournamentId: 1, version: 1 }, options: { unique: true } },
  { collection: PRIZES_COLLECTIONS.entitlements, name: 'entitlement_rank_unique', keys: { tournamentId: 1, allocationVersion: 1, rank: 1 }, options: { unique: true } },
  { collection: PRIZES_COLLECTIONS.entitlements, name: 'entitlement_account_created', keys: { accountId: 1, createdAt: -1, _id: 1 } },
  { collection: PRIZES_COLLECTIONS.entitlements, name: 'entitlement_tournament_state', keys: { tournamentId: 1, state: 1 } }
];
