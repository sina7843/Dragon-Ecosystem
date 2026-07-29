import type { IndexDeclaration } from '../../shared/db/collections.ts';

/** Collections owned by the economy module (REWARD-002..008). */
export const ECONOMY_COLLECTIONS = {
  transfers: 'coin_transfers',
  rewardRules: 'reward_rules',
  rewardGrants: 'reward_grants',
  /** Atomic rolling-window counters that make the transfer limits enforceable. */
  transferWindows: 'coin_transfer_windows'
} as const;

export const ECONOMY_INDEXES: readonly IndexDeclaration[] = [
  // REWARD-005: the same sender and key never move value twice. Enforced by the index
  // inside the write transaction, not by a read-before-write.
  {
    collection: ECONOMY_COLLECTIONS.transfers,
    name: 'transfer_sender_key_unique',
    keys: { senderId: 1, idempotencyKey: 1 },
    options: { unique: true }
  },
  // The rolling-window limit reads a sender's recent transfers on every attempt.
  { collection: ECONOMY_COLLECTIONS.transfers, name: 'transfer_sender_created', keys: { senderId: 1, createdAt: -1 } },
  { collection: ECONOMY_COLLECTIONS.transfers, name: 'transfer_recipient_created', keys: { recipientId: 1, createdAt: -1 } },
  // The review queue is worked oldest-first.
  { collection: ECONOMY_COLLECTIONS.transfers, name: 'transfer_state_created', keys: { state: 1, createdAt: 1 } },

  { collection: ECONOMY_COLLECTIONS.rewardRules, name: 'reward_rule_code_unique', keys: { code: 1 }, options: { unique: true } },
  // Issuance creates coin, so "granted once per rule per account" is enforced by an index
  // rather than by application logic that a replay could race.
  {
    collection: ECONOMY_COLLECTIONS.rewardGrants,
    name: 'reward_grant_rule_account_unique',
    keys: { ruleId: 1, accountId: 1 },
    options: { unique: true }
  },
  { collection: ECONOMY_COLLECTIONS.rewardGrants, name: 'reward_grant_account_created', keys: { accountId: 1, createdAt: -1 } },

  // Expired windows are swept by Mongo rather than by a job.
  {
    collection: ECONOMY_COLLECTIONS.transferWindows,
    name: 'transfer_window_ttl',
    keys: { expiresAt: 1 },
    options: { expireAfterSeconds: 0 }
  }
];
