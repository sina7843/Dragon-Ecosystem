import type { Db } from 'mongodb';
import { IDENTITY_COLLECTIONS } from './collections.ts';
import type { EntityId } from '../../shared/ids.ts';

/**
 * Document shapes and typed collection access for the identity module.
 * Nothing outside this module reads these collections (section 32.1).
 */

/** Section 12.3 account state machine. `closed` is terminal for authentication. */
export const ACCOUNT_STATES = [
  'pending_verification',
  'active',
  'suspended',
  'deletion_requested',
  'anonymizing',
  'closed'
] as const;

export type AccountState = (typeof ACCOUNT_STATES)[number];

/** Transitions permitted by section 12.3. */
const ALLOWED_TRANSITIONS: Readonly<Record<AccountState, readonly AccountState[]>> = {
  pending_verification: ['active', 'closed'],
  active: ['suspended', 'deletion_requested'],
  suspended: ['active', 'deletion_requested'],
  deletion_requested: ['anonymizing'],
  anonymizing: ['closed'],
  closed: []
};

export function canTransition(from: AccountState, to: AccountState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export interface AccountRecord {
  _id: EntityId;
  state: AccountState;
  locale: string;
  timeZone: string;
  createdAt: string;
  updatedAt: string;
  /** Optimistic concurrency for mutable records (section 14.1). */
  version: number;
}

export interface IdentityMethodRecord {
  _id: EntityId;
  accountId: EntityId;
  type: 'mobile' | 'email';
  /** Canonical form: E.164 for mobile, normalized address for email. */
  canonical: string;
  verified: boolean;
  createdAt: string;
}

export type OtpChallengeStatus = 'pending' | 'used' | 'expired' | 'failed';

export interface OtpChallengeRecord {
  _id: EntityId;
  canonical: string;
  /** AUTH-003: keyed hash only, never the code. */
  codeHash: string;
  status: OtpChallengeStatus;
  attempts: number;
  createdAt: string;
  resendAfter: string;
  expiresAt: Date;
}

export interface SessionRecord {
  _id: EntityId;
  accountId: EntityId;
  tokenHash: string;
  createdAt: string;
  /** Drives the recent-authentication window (AUTH-007). */
  authenticatedAt: string;
  lastSeenAt: string;
  expiresAt: Date;
  revokedAt: string | null;
  /** Truncated so a session list is useful without storing a full fingerprint. */
  userAgent: string;
}

export interface SecurityEventRecord {
  _id: EntityId;
  accountId: EntityId | null;
  type: string;
  occurredAt: string;
  correlationId: string;
  /** Only masked, non-sensitive detail (SEC-012). */
  detail: Record<string, string>;
}

export type ProfileVisibility = 'private' | 'public';

export interface UserProfileRecord {
  /** Same identifier as the owning account. */
  _id: EntityId;
  username: string;
  displayName: string;
  birthDate: string;
  bio: string;
  /** Privacy by default (DEC-043): profiles start private. */
  visibility: ProfileVisibility;
  createdAt: string;
  updatedAt: string;
}

export function accounts(db: Db) {
  return db.collection<AccountRecord>(IDENTITY_COLLECTIONS.accounts);
}

export function identityMethods(db: Db) {
  return db.collection<IdentityMethodRecord>(IDENTITY_COLLECTIONS.identityMethods);
}

export function otpChallenges(db: Db) {
  return db.collection<OtpChallengeRecord>(IDENTITY_COLLECTIONS.otpChallenges);
}

export function sessions(db: Db) {
  return db.collection<SessionRecord>(IDENTITY_COLLECTIONS.sessions);
}

export function securityEvents(db: Db) {
  return db.collection<SecurityEventRecord>(IDENTITY_COLLECTIONS.securityEvents);
}

export function userProfiles(db: Db) {
  return db.collection<UserProfileRecord>(IDENTITY_COLLECTIONS.userProfiles);
}
