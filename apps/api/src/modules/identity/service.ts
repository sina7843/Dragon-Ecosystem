import { createHash } from 'node:crypto';
import type { AuthConfig, Environment } from '../../config.ts';
import type { Database } from '../../shared/db/client.ts';
import { runUnitOfWork } from '../../shared/db/unit-of-work.ts';
import { createRequestContext, SYSTEM_ACTOR, type RequestContext } from '../../shared/context.ts';
import { utcNow } from '../../shared/events.ts';
import { newId, type EntityId } from '../../shared/ids.ts';
import { ForbiddenError, RateLimitError, UnauthenticatedError, ValidationError } from '../../shared/errors.ts';
import { generateOtpCode, generateSessionToken, hashOtpCode, hashSessionToken, safeEquals } from './crypto.ts';
import { maskMobile, normalizeIranianMobile } from './mobile.ts';
import { consumeRateLimit } from './rate-limit.ts';
import { SMS_TEMPLATES, type SmsAdapter } from './sms.ts';
import {
  assertMinimumAge,
  normalizeUsername,
  validateDisplayName,
  validateTimeZone
} from './profile-rules.ts';
import {
  accounts,
  canTransition,
  identityMethods,
  otpChallenges,
  securityEvents,
  sessions,
  userProfiles,
  type AccountRecord,
  type AccountState,
  type ProfileVisibility,
  type SessionRecord,
  type UserProfileRecord
} from './store.ts';

/**
 * Identity domain service: OTP authentication, sessions, and profiles.
 *
 * Anti-enumeration (AUTH-012) is the governing rule for the OTP endpoints:
 * request and verify return the same shape whether or not an account exists, and
 * every verification failure returns one indistinguishable error.
 */

export interface OtpRequestResult {
  readonly resendAfterSeconds: number;
}

export interface AuthenticatedSession {
  readonly token: string;
  readonly session: SessionRecord;
  readonly account: AccountRecord;
  readonly profileComplete: boolean;
}

export interface ProfileInput {
  readonly username: string;
  readonly displayName: string;
  readonly birthDate: string;
  readonly bio?: string;
  readonly visibility?: ProfileVisibility;
  readonly locale?: string;
  readonly timeZone?: string;
}

const DEFAULT_LOCALE = 'fa';
const DEFAULT_TIME_ZONE = 'Asia/Tehran';
const SUPPORTED_LOCALES = new Set(['fa', 'en']);
const USER_AGENT_MAX_LENGTH = 200;

/** One generic failure for every unsuccessful verification (AUTH-012). */
function invalidOtp(): ValidationError {
  return new ValidationError('The code is not valid or has expired.', [
    { field: 'code', code: 'INVALID_OTP', message: 'The code is not valid or has expired.' }
  ]);
}

/** Rate-limit buckets are keyed by a hash so the raw number is never a document id. */
function bucketKey(prefix: string, value: string): string {
  return `${prefix}:${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}

export class IdentityService {
  readonly #database: Database;
  readonly #config: AuthConfig;
  readonly #sms: SmsAdapter;
  readonly #env: Environment;

  constructor(database: Database, config: AuthConfig, sms: SmsAdapter, env: Environment) {
    this.#database = database;
    this.#config = config;
    this.#sms = sms;
    this.#env = env;
  }

  get #db() {
    return this.#database.db;
  }

  async #recordSecurityEvent(
    accountId: EntityId | null,
    type: string,
    correlationId: string,
    detail: Record<string, string> = {}
  ): Promise<void> {
    await securityEvents(this.#db).insertOne({
      _id: newId(),
      accountId,
      type,
      occurredAt: utcNow(),
      correlationId,
      detail
    });
  }

  /**
   * Issues an OTP. The response is identical for known and unknown numbers.
   * AUTH-002: limited per mobile and per IP with separate buckets.
   */
  async requestOtp(input: {
    mobile: string;
    locale: string;
    ip: string;
    correlationId: string;
  }): Promise<OtpRequestResult> {
    const canonical = normalizeIranianMobile(input.mobile);
    const locale = SUPPORTED_LOCALES.has(input.locale) ? input.locale : DEFAULT_LOCALE;

    const perMobile = await consumeRateLimit(
      this.#db,
      bucketKey('otp:mobile', canonical),
      this.#config.otpRequestsPerMobile,
      this.#config.otpWindowSeconds
    );
    const perIp = await consumeRateLimit(
      this.#db,
      bucketKey('otp:ip', input.ip),
      this.#config.otpRequestsPerIp,
      this.#config.otpWindowSeconds
    );

    if (!perMobile.allowed || !perIp.allowed) {
      await this.#recordSecurityEvent(null, 'otp.rate_limited', input.correlationId, {
        mobile: maskMobile(canonical)
      });
      throw new RateLimitError('Too many code requests. Try again later.');
    }

    // Honour the resend interval before issuing another code (section 16.1).
    const now = Date.now();
    const pending = await otpChallenges(this.#db).findOne(
      { canonical, status: 'pending' },
      { sort: { createdAt: -1 } }
    );
    if (pending !== null && new Date(pending.resendAfter).getTime() > now) {
      const retryAfterSeconds = Math.ceil((new Date(pending.resendAfter).getTime() - now) / 1000);
      throw new RateLimitError(`Wait ${String(retryAfterSeconds)} seconds before requesting a new code.`);
    }

    const challengeId = newId();
    const code = generateOtpCode();

    await otpChallenges(this.#db).insertOne({
      _id: challengeId,
      canonical,
      codeHash: hashOtpCode(this.#config.secret, challengeId, code),
      status: 'pending',
      attempts: 0,
      createdAt: utcNow(),
      resendAfter: new Date(now + this.#config.otpResendSeconds * 1000).toISOString(),
      expiresAt: new Date(now + this.#config.otpTtlSeconds * 1000)
    });

    await this.#sms.send({
      recipient: canonical,
      template: SMS_TEMPLATES.otpLogin,
      locale,
      code,
      correlationId: input.correlationId
    });

    await this.#recordSecurityEvent(null, 'otp.requested', input.correlationId, {
      mobile: maskMobile(canonical)
    });

    return { resendAfterSeconds: this.#config.otpResendSeconds };
  }

  /**
   * Verifies an OTP and starts a session. A valid code authenticates exactly
   * once; invalid, expired, reused, and unknown codes fail identically (AUTH-001).
   */
  async verifyOtp(input: {
    mobile: string;
    code: string;
    ip: string;
    userAgent: string;
    correlationId: string;
  }): Promise<AuthenticatedSession> {
    const canonical = normalizeIranianMobile(input.mobile);

    // Verification attempts are limited separately from code issuance.
    const attempts = await consumeRateLimit(
      this.#db,
      bucketKey('otp:verify', canonical),
      this.#config.otpRequestsPerMobile * this.#config.otpMaxAttempts,
      this.#config.otpWindowSeconds
    );
    if (!attempts.allowed) throw new RateLimitError('Too many attempts. Try again later.');

    const challenge = await otpChallenges(this.#db).findOne(
      { canonical, status: 'pending' },
      { sort: { createdAt: -1 } }
    );
    if (challenge === null) throw invalidOtp();

    if (challenge.expiresAt.getTime() <= Date.now()) {
      await otpChallenges(this.#db).updateOne({ _id: challenge._id }, { $set: { status: 'expired' } });
      throw invalidOtp();
    }

    if (challenge.attempts >= this.#config.otpMaxAttempts) {
      await otpChallenges(this.#db).updateOne({ _id: challenge._id }, { $set: { status: 'failed' } });
      await this.#recordSecurityEvent(null, 'otp.locked', input.correlationId, {
        mobile: maskMobile(canonical)
      });
      throw invalidOtp();
    }

    const expected = hashOtpCode(this.#config.secret, challenge._id, input.code);
    if (!safeEquals(expected, challenge.codeHash)) {
      await otpChallenges(this.#db).updateOne({ _id: challenge._id }, { $inc: { attempts: 1 } });
      await this.#recordSecurityEvent(null, 'otp.failed', input.correlationId, {
        mobile: maskMobile(canonical)
      });
      throw invalidOtp();
    }

    // Single use: only the request that flips pending → used may proceed, so a
    // replayed code cannot authenticate twice.
    const claimed = await otpChallenges(this.#db).findOneAndUpdate(
      { _id: challenge._id, status: 'pending' },
      { $set: { status: 'used' } }
    );
    if (claimed === null) throw invalidOtp();

    const account = await this.#findOrCreateAccount(canonical, input.correlationId);
    if (account.state === 'closed') throw invalidOtp();
    if (account.state === 'suspended') {
      await this.#recordSecurityEvent(account._id, 'login.blocked_suspended', input.correlationId);
      throw new ForbiddenError('This account is suspended.');
    }

    const authenticated = await this.#createSession(account._id, input.userAgent, input.correlationId);
    const profile = await userProfiles(this.#db).findOne({ _id: account._id });

    return { ...authenticated, account, profileComplete: profile !== null };
  }

  async #findOrCreateAccount(canonical: string, correlationId: string): Promise<AccountRecord> {
    const existing = await identityMethods(this.#db).findOne({ type: 'mobile', canonical });
    if (existing !== null) {
      const account = await accounts(this.#db).findOne({ _id: existing.accountId });
      if (account === null) throw new Error(`Identity ${existing._id} has no account`);
      return account;
    }

    const accountId = newId();
    const now = utcNow();
    const record: AccountRecord = {
      _id: accountId,
      // The mobile is verified at this moment, so the account starts active.
      state: 'active',
      locale: DEFAULT_LOCALE,
      timeZone: DEFAULT_TIME_ZONE,
      createdAt: now,
      updatedAt: now,
      version: 1
    };

    const context = createRequestContext(correlationId, SYSTEM_ACTOR);
    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        await accounts(uow.db).insertOne(record, { session: uow.session });
        await identityMethods(uow.db).insertOne(
          {
            _id: newId(),
            accountId,
            type: 'mobile',
            canonical,
            verified: true,
            createdAt: now
          },
          { session: uow.session }
        );
        uow.audit({ action: 'account.registered', resourceType: 'account', resourceId: accountId });
        uow.publish({
          eventName: 'account.registered',
          eventVersion: 1,
          aggregateId: accountId,
          payload: { mobile: maskMobile(canonical) }
        });
      });
    } catch (error) {
      // A concurrent first login for the same number loses the unique-index race;
      // the winner's account is the correct one (UC-001: no duplicate account).
      const raced = await identityMethods(this.#db).findOne({ type: 'mobile', canonical });
      if (raced === null) throw error;
      const account = await accounts(this.#db).findOne({ _id: raced.accountId });
      if (account === null) throw error;
      return account;
    }

    await this.#recordSecurityEvent(accountId, 'account.registered', correlationId);
    return record;
  }

  async #createSession(
    accountId: EntityId,
    userAgent: string,
    correlationId: string
  ): Promise<{ token: string; session: SessionRecord }> {
    const token = generateSessionToken();
    const now = utcNow();
    const session: SessionRecord = {
      _id: newId(),
      accountId,
      tokenHash: hashSessionToken(this.#config.secret, token),
      createdAt: now,
      authenticatedAt: now,
      lastSeenAt: now,
      expiresAt: new Date(Date.now() + this.#config.sessionTtlHours * 3600 * 1000),
      revokedAt: null,
      userAgent: userAgent.slice(0, USER_AGENT_MAX_LENGTH)
    };

    await sessions(this.#db).insertOne(session);
    await this.#recordSecurityEvent(accountId, 'session.created', correlationId);
    return { token, session };
  }

  /** Resolves a bearer cookie to a live session. Returns null for anything unusable. */
  async resolveSession(token: string): Promise<{ session: SessionRecord; account: AccountRecord } | null> {
    const tokenHash = hashSessionToken(this.#config.secret, token);
    const session = await sessions(this.#db).findOne({ tokenHash });
    if (session === null || session.revokedAt !== null) return null;
    if (session.expiresAt.getTime() <= Date.now()) return null;

    const account = await accounts(this.#db).findOne({ _id: session.accountId });
    if (account === null || account.state === 'closed') return null;

    await sessions(this.#db).updateOne({ _id: session._id }, { $set: { lastSeenAt: utcNow() } });
    return { session, account };
  }

  async logout(sessionId: EntityId, accountId: EntityId, correlationId: string): Promise<void> {
    await sessions(this.#db).updateOne(
      { _id: sessionId, revokedAt: null },
      { $set: { revokedAt: utcNow() } }
    );
    await this.#recordSecurityEvent(accountId, 'session.logout', correlationId);
  }

  /**
   * Revokes every other session (AUTH-006). Requires recent authentication
   * because it is a security-sensitive change (AUTH-007).
   */
  async revokeOtherSessions(
    session: SessionRecord,
    correlationId: string
  ): Promise<{ revoked: number }> {
    this.#assertRecentAuth(session);
    const result = await sessions(this.#db).updateMany(
      { accountId: session.accountId, _id: { $ne: session._id }, revokedAt: null },
      { $set: { revokedAt: utcNow() } }
    );
    await this.#recordSecurityEvent(session.accountId, 'session.revoked_others', correlationId, {
      count: String(result.modifiedCount)
    });
    return { revoked: result.modifiedCount };
  }

  #assertRecentAuth(session: SessionRecord): void {
    const age = Date.now() - new Date(session.authenticatedAt).getTime();
    if (age > this.#config.recentAuthMinutes * 60 * 1000) {
      throw new UnauthenticatedError('Sign in again to complete this action.');
    }
  }

  async listSessions(accountId: EntityId): Promise<SessionRecord[]> {
    return sessions(this.#db)
      .find({ accountId, revokedAt: null })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
  }

  async listSecurityEvents(accountId: EntityId) {
    return securityEvents(this.#db)
      .find({ accountId }, { projection: { _id: 0, accountId: 0 } })
      .sort({ occurredAt: -1 })
      .limit(50)
      .toArray();
  }

  async getProfile(accountId: EntityId): Promise<UserProfileRecord | null> {
    return userProfiles(this.#db).findOne({ _id: accountId });
  }

  /** Creates or updates the profile (FORM-003). Age and username rules apply on every write. */
  async saveProfile(
    account: AccountRecord,
    input: ProfileInput,
    correlationId: string
  ): Promise<UserProfileRecord> {
    const username = normalizeUsername(input.username);
    const displayName = validateDisplayName(input.displayName);
    assertMinimumAge(input.birthDate, new Date());

    const locale = input.locale === undefined ? account.locale : input.locale;
    if (!SUPPORTED_LOCALES.has(locale)) {
      throw new ValidationError('The language is not supported.', [
        { field: 'locale', code: 'UNSUPPORTED_LOCALE', message: 'Choose a supported language.' }
      ]);
    }
    const timeZone = validateTimeZone(input.timeZone ?? account.timeZone);

    const taken = await userProfiles(this.#db).findOne({ username, _id: { $ne: account._id } });
    if (taken !== null) {
      throw new ValidationError('That username is taken.', [
        { field: 'username', code: 'USERNAME_TAKEN', message: 'That username is already in use.' }
      ]);
    }

    const existing = await this.getProfile(account._id);
    const now = utcNow();
    const profile: UserProfileRecord = {
      _id: account._id,
      username,
      displayName,
      birthDate: input.birthDate,
      bio: (input.bio ?? existing?.bio ?? '').slice(0, 500),
      // Privacy by default: a new profile is private unless explicitly published.
      visibility: input.visibility ?? existing?.visibility ?? 'private',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    const context = createRequestContext(correlationId, {
      kind: 'account',
      accountId: account._id,
      roles: []
    });

    try {
      await runUnitOfWork(this.#database, context, async (uow) => {
        await userProfiles(uow.db).replaceOne({ _id: account._id }, profile, {
          upsert: true,
          session: uow.session
        });
        await accounts(uow.db).updateOne(
          { _id: account._id },
          { $set: { locale, timeZone, updatedAt: now }, $inc: { version: 1 } },
          { session: uow.session }
        );
        uow.audit({
          action: existing === null ? 'profile.created' : 'profile.updated',
          resourceType: 'account',
          resourceId: account._id,
          before: existing === null ? null : { username: existing.username, visibility: existing.visibility },
          after: { username, visibility: profile.visibility }
        });
      });
    } catch (error) {
      // The unique index is the authority on username collisions under concurrency.
      if (typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000) {
        throw new ValidationError('That username is taken.', [
          { field: 'username', code: 'USERNAME_TAKEN', message: 'That username is already in use.' }
        ]);
      }
      throw error;
    }

    return profile;
  }

  /** Public player identity. A private profile is indistinguishable from a missing one (section 16.4). */
  async getPublicProfile(username: string): Promise<{ username: string; displayName: string } | null> {
    const profile = await userProfiles(this.#db).findOne({
      username: username.trim().toLowerCase(),
      visibility: 'public'
    });
    if (profile === null) return null;
    return { username: profile.username, displayName: profile.displayName };
  }

  /** AUTH-009: invalid state transitions are rejected. Used by administration in DRAGON-04. */
  async transitionAccountState(
    accountId: EntityId,
    to: AccountState,
    context: RequestContext,
    reason: string
  ): Promise<void> {
    const account = await accounts(this.#db).findOne({ _id: accountId });
    if (account === null) throw new ValidationError('Unknown account.');
    if (!canTransition(account.state, to)) {
      throw new ValidationError(`Cannot move an account from ${account.state} to ${to}.`);
    }

    await runUnitOfWork(this.#database, context, async (uow) => {
      await accounts(uow.db).updateOne(
        { _id: accountId, version: account.version },
        { $set: { state: to, updatedAt: utcNow() }, $inc: { version: 1 } },
        { session: uow.session }
      );
      uow.audit({
        action: 'account.state_changed',
        resourceType: 'account',
        resourceId: accountId,
        before: { state: account.state },
        after: { state: to },
        reason
      });
    });

    await this.#recordSecurityEvent(accountId, 'account.state_changed', context.correlationId, { state: to });
  }

  get environment(): Environment {
    return this.#env;
  }
}
