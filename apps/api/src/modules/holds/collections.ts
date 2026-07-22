import type { IndexDeclaration } from '../../shared/db/collections.ts';

/** Collections owned by the holds module (DRAGON-11c). */
export const HOLDS_COLLECTIONS = {
  holds: 'dragon_coin_holds'
} as const;

/**
 * Hold integrity safeguards. Unique constraints — not read-before-write — enforce
 * one hold per business reference (duplicate creation cannot reserve funds twice)
 * and back the owner-history and active-expiry access paths.
 */
export const HOLDS_INDEXES: readonly IndexDeclaration[] = [
  { collection: HOLDS_COLLECTIONS.holds, name: 'hold_business_ref_unique', keys: { businessRef: 1 }, options: { unique: true } },
  { collection: HOLDS_COLLECTIONS.holds, name: 'hold_owner_created', keys: { ownerId: 1, createdAt: -1, _id: 1 } },
  // Active-expiry lookup for the bounded expiry primitive.
  { collection: HOLDS_COLLECTIONS.holds, name: 'hold_state_expires', keys: { state: 1, expiresAt: 1 } },
  { collection: HOLDS_COLLECTIONS.holds, name: 'hold_ledger_account', keys: { ledgerAccountId: 1, state: 1 } }
];
