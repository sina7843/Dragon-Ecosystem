import type { Db } from 'mongodb';
import { newId } from '../../shared/ids.ts';
import { utcNow } from '../../shared/events.ts';
import type { Environment } from '../../config.ts';
import { NOTIFICATIONS_COLLECTIONS } from './collections.ts';
import type { Locale } from './state.ts';

/**
 * Deterministic mock notification channels (DRAGON-13, INT-001/DEC-041).
 *
 * These are the approved adapters for the current scope, not placeholders. They
 * perform no network call and derive their outcome from the recipient so tests can
 * exercise success, failure, and retry reproducibly. A real provider could implement
 * `NotificationChannelAdapter` without changing any notification rule. Recipients are
 * masked in every stored delivery record; only the local test sink (never in
 * production) retains a full recipient for developer inspection.
 */

export interface ChannelSend {
  readonly recipient: string;
  readonly locale: Locale;
  readonly subject: string;
  readonly body: string;
  readonly correlationId: string;
}

export interface NotificationChannelAdapter {
  readonly name: 'sms' | 'email';
  /** Attempts delivery; returns 'sent' or 'failed'. Never throws for a normal failure. */
  send(input: ChannelSend): Promise<'sent' | 'failed'>;
}

/** Deterministic outcome by the last digits of a mobile number (mirrors the OTP mock). */
function simulatedSmsStatus(recipient: string): 'sent' | 'failed' {
  return recipient.endsWith('0000') ? 'failed' : 'sent';
}

export class MockSmsChannel implements NotificationChannelAdapter {
  readonly name = 'sms' as const;
  send(input: ChannelSend): Promise<'sent' | 'failed'> {
    return Promise.resolve(simulatedSmsStatus(input.recipient));
  }
}

export class MockEmailChannel implements NotificationChannelAdapter {
  readonly name = 'email' as const;
  readonly #db: Db;
  readonly #env: Environment;

  constructor(db: Db, env: Environment) {
    this.#db = db;
    this.#env = env;
  }

  async send(input: ChannelSend): Promise<'sent' | 'failed'> {
    const status: 'sent' | 'failed' = input.recipient.endsWith('@fail.test') ? 'failed' : 'sent';
    // Local sink for developer inspection only — never written in production.
    if (this.#env !== 'production' && status === 'sent') {
      await this.#db.collection<{ _id: string } & Record<string, unknown>>(NOTIFICATIONS_COLLECTIONS.deliveries + '_email_sink').insertOne({ _id: newId(), recipient: input.recipient, locale: input.locale, subject: input.subject, body: input.body, correlationId: input.correlationId, createdAt: utcNow() });
    }
    return status;
  }
}

/** Masks a recipient for a stored delivery log (mobile or email). */
export function maskRecipient(recipient: string): string {
  if (recipient.includes('@')) {
    const [user, domain] = recipient.split('@');
    const head = (user ?? '').slice(0, 2);
    return `${head}***@${domain ?? ''}`;
  }
  if (recipient.length <= 4) return '***';
  return `${recipient.slice(0, 4)}***${recipient.slice(-2)}`;
}
