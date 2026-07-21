import type { Db } from 'mongodb';
import { IDENTITY_COLLECTIONS } from './collections.ts';
import { maskMobile } from './mobile.ts';
import { newId } from '../../shared/ids.ts';
import { utcNow } from '../../shared/events.ts';
import type { Environment } from '../../config.ts';

/**
 * Deterministic mock SMS provider (DEC-041, INT-001).
 *
 * This is the approved provider for the current scope, not a placeholder. It
 * performs no network call. Behaviour is derived from the recipient number so
 * tests can exercise success, failure, and delayed delivery reproducibly.
 *
 * AUTH-003 and SEC-012: the delivery record never contains the OTP code and the
 * recipient is masked. The code is retained only in a development/test inbox
 * that is never written when NODE_ENV=production.
 */

/** SMS-001: only centrally approved templates exist; no user text can enter an OTP body. */
export const SMS_TEMPLATES = { otpLogin: 'auth.otp.login' } as const;

export type SmsTemplate = (typeof SMS_TEMPLATES)[keyof typeof SMS_TEMPLATES];
export type SmsStatus = 'sent' | 'queued' | 'failed';

export interface SmsSendInput {
  readonly recipient: string;
  readonly template: SmsTemplate;
  readonly locale: string;
  readonly code: string;
  readonly correlationId: string;
}

export interface SmsDeliveryRecord {
  _id: string;
  recipientMasked: string;
  template: SmsTemplate;
  locale: string;
  status: SmsStatus;
  correlationId: string;
  createdAt: string;
}

export interface SmsAdapter {
  send(input: SmsSendInput): Promise<SmsStatus>;
}

/** Deterministic scenarios selected by the last digits of the number. */
function simulatedStatus(recipient: string): SmsStatus {
  if (recipient.endsWith('0000')) return 'failed';
  if (recipient.endsWith('0001')) return 'queued';
  return 'sent';
}

const DEV_INBOX_TTL_SECONDS = 900;

export class MockSmsAdapter implements SmsAdapter {
  readonly #db: Db;
  readonly #env: Environment;

  constructor(db: Db, env: Environment) {
    this.#db = db;
    this.#env = env;
  }

  async send(input: SmsSendInput): Promise<SmsStatus> {
    const status = simulatedStatus(input.recipient);

    // SMS-004: traceable delivery record, masked recipient, no message body.
    await this.#db.collection<SmsDeliveryRecord>(IDENTITY_COLLECTIONS.smsDeliveries).insertOne({
      _id: newId(),
      recipientMasked: maskMobile(input.recipient),
      template: input.template,
      locale: input.locale,
      status,
      correlationId: input.correlationId,
      createdAt: utcNow()
    });

    // The code is only ever retained outside production, for the protected inbox.
    if (this.#env !== 'production' && status !== 'failed') {
      await this.#db.collection<DevInboxRecord>(IDENTITY_COLLECTIONS.devSmsInbox).insertOne({
        _id: newId(),
        recipient: input.recipient,
        template: input.template,
        locale: input.locale,
        code: input.code,
        createdAt: utcNow(),
        expiresAt: new Date(Date.now() + DEV_INBOX_TTL_SECONDS * 1000)
      });
    }

    return status;
  }
}

export interface DevInboxMessage {
  recipient: string;
  template: SmsTemplate;
  locale: string;
  code: string;
  createdAt: string;
}

interface DevInboxRecord extends DevInboxMessage {
  _id: string;
  expiresAt: Date;
}

/** Reads the development inbox. The route exposing this exists only outside production. */
export async function readDevInbox(db: Db, recipient: string, limit = 10): Promise<DevInboxMessage[]> {
  return db
    .collection<DevInboxMessage>(IDENTITY_COLLECTIONS.devSmsInbox)
    .find({ recipient }, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}
