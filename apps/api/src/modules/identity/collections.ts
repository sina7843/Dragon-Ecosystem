import type { IndexDeclaration } from '../../shared/db/collections.ts';

/**
 * Collections owned by the identity module. No other module reads or writes
 * these directly (Requirements section 32.1).
 */
export const IDENTITY_COLLECTIONS = {
  accounts: 'accounts',
  identityMethods: 'identity_methods',
  otpChallenges: 'otp_challenges',
  sessions: 'sessions',
  securityEvents: 'security_events',
  userProfiles: 'user_profiles',
  rateLimits: 'rate_limits',
  smsDeliveries: 'sms_deliveries',
  /** Development and test only: never written when NODE_ENV=production. */
  devSmsInbox: 'dev_sms_inbox'
} as const;

export const IDENTITY_INDEXES: readonly IndexDeclaration[] = [
  // DATA-002: one active identity per canonical contact value.
  {
    collection: IDENTITY_COLLECTIONS.identityMethods,
    name: 'identity_type_canonical_unique',
    keys: { type: 1, canonical: 1 },
    options: { unique: true }
  },
  {
    collection: IDENTITY_COLLECTIONS.identityMethods,
    name: 'identity_account',
    keys: { accountId: 1 }
  },
  // Challenges are looked up by contact and expire on their own (DATA-003).
  {
    collection: IDENTITY_COLLECTIONS.otpChallenges,
    name: 'otp_canonical_status',
    keys: { canonical: 1, status: 1, createdAt: -1 }
  },
  {
    collection: IDENTITY_COLLECTIONS.otpChallenges,
    name: 'otp_expiresAt_ttl',
    keys: { expiresAt: 1 },
    options: { expireAfterSeconds: 0 }
  },
  // Sessions are found by token hash on every protected request (DATA-004).
  {
    collection: IDENTITY_COLLECTIONS.sessions,
    name: 'session_tokenHash_unique',
    keys: { tokenHash: 1 },
    options: { unique: true }
  },
  {
    collection: IDENTITY_COLLECTIONS.sessions,
    name: 'session_account_created',
    keys: { accountId: 1, createdAt: -1 }
  },
  {
    collection: IDENTITY_COLLECTIONS.sessions,
    name: 'session_expiresAt_ttl',
    keys: { expiresAt: 1 },
    options: { expireAfterSeconds: 0 }
  },
  // AUTH-013: the user can review their own security history.
  {
    collection: IDENTITY_COLLECTIONS.securityEvents,
    name: 'security_account_occurredAt',
    keys: { accountId: 1, occurredAt: -1 }
  },
  {
    collection: IDENTITY_COLLECTIONS.userProfiles,
    name: 'profile_username_unique',
    keys: { username: 1 },
    options: { unique: true }
  },
  // Fixed-window counters clean themselves up.
  {
    collection: IDENTITY_COLLECTIONS.rateLimits,
    name: 'rate_limit_expiresAt_ttl',
    keys: { expiresAt: 1 },
    options: { expireAfterSeconds: 0 }
  },
  // SMS-004: delivery is traceable without exposing the full number.
  {
    collection: IDENTITY_COLLECTIONS.smsDeliveries,
    name: 'sms_correlationId',
    keys: { correlationId: 1 }
  },
  {
    collection: IDENTITY_COLLECTIONS.smsDeliveries,
    name: 'sms_createdAt',
    keys: { createdAt: -1 }
  },
  {
    collection: IDENTITY_COLLECTIONS.devSmsInbox,
    name: 'dev_inbox_recipient_created',
    keys: { recipient: 1, createdAt: -1 }
  },
  {
    collection: IDENTITY_COLLECTIONS.devSmsInbox,
    name: 'dev_inbox_expiresAt_ttl',
    keys: { expiresAt: 1 },
    options: { expireAfterSeconds: 0 }
  }
];
