import type { IndexDeclaration } from '../../shared/db/collections.ts';

/** Collections owned by the payments module (DRAGON-11b). */
export const PAYMENTS_COLLECTIONS = {
  purchases: 'dragon_coin_purchases',
  providerEvents: 'payment_provider_events'
} as const;

/**
 * Payment integrity safeguards. Unique constraints — not read-before-write — are
 * the authority behind one-purchase-per-id, one-business-reference, one-successful-
 * ledger-transaction per purchase, one-accepted-provider-event per replay identity,
 * and one-correction per correction reference.
 */
export const PAYMENTS_INDEXES: readonly IndexDeclaration[] = [
  { collection: PAYMENTS_COLLECTIONS.purchases, name: 'purchase_business_ref_unique', keys: { businessRef: 1 }, options: { unique: true } },
  // One ledger transaction can back at most one purchase (partial: only successful purchases have one).
  { collection: PAYMENTS_COLLECTIONS.purchases, name: 'purchase_ledger_tx_unique', keys: { ledgerTransactionId: 1 }, options: { unique: true, partialFilterExpression: { ledgerTransactionId: { $type: 'string' } } } },
  // One correction per correction reference.
  { collection: PAYMENTS_COLLECTIONS.purchases, name: 'purchase_correction_ref_unique', keys: { correctionRef: 1 }, options: { unique: true, partialFilterExpression: { correctionRef: { $type: 'string' } } } },
  // Owner history listing by account, newest first.
  { collection: PAYMENTS_COLLECTIONS.purchases, name: 'purchase_account_created', keys: { accountId: 1, createdAt: -1, _id: 1 } },
  { collection: PAYMENTS_COLLECTIONS.purchases, name: 'purchase_provider_request', keys: { providerRequestId: 1 } },
  { collection: PAYMENTS_COLLECTIONS.purchases, name: 'purchase_state', keys: { state: 1, expiresAt: 1 } },

  // Exactly one accepted provider event per (provider, replay identity).
  { collection: PAYMENTS_COLLECTIONS.providerEvents, name: 'provider_event_replay_unique', keys: { provider: 1, eventId: 1 }, options: { unique: true } },
  { collection: PAYMENTS_COLLECTIONS.providerEvents, name: 'provider_event_purchase', keys: { purchaseId: 1, receivedAt: 1 } }
];
