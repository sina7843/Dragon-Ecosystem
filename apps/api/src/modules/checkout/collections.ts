import type { IndexDeclaration } from '../../shared/db/collections.ts';

/** Collections owned by the checkout module (DRAGON-12). */
export const CHECKOUT_COLLECTIONS = {
  checkouts: 'registration_checkouts'
} as const;

/**
 * Checkout integrity safeguards. A unique business reference makes duplicate
 * checkout creation for the same participant/tournament collapse to one; the
 * registration and provider-reference indexes back activation and callback lookup.
 */
export const CHECKOUT_INDEXES: readonly IndexDeclaration[] = [
  { collection: CHECKOUT_COLLECTIONS.checkouts, name: 'checkout_business_ref_unique', keys: { businessRef: 1 }, options: { unique: true } },
  { collection: CHECKOUT_COLLECTIONS.checkouts, name: 'checkout_registration_unique', keys: { registrationId: 1 }, options: { unique: true } },
  { collection: CHECKOUT_COLLECTIONS.checkouts, name: 'checkout_provider_request', keys: { providerRequestId: 1 }, options: { unique: true, partialFilterExpression: { providerRequestId: { $type: 'string' } } } },
  { collection: CHECKOUT_COLLECTIONS.checkouts, name: 'checkout_account_created', keys: { accountId: 1, createdAt: -1, _id: 1 } },
  { collection: CHECKOUT_COLLECTIONS.checkouts, name: 'checkout_state_expires', keys: { state: 1, expiresAt: 1 } }
];
