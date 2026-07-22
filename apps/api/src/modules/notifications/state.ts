import type { EntityId } from '../../shared/ids.ts';
import type { NotificationCategory, NotificationChannel } from './templates.ts';

export const NOTIFICATION_LOCALES = ['fa', 'en'] as const;
export type Locale = (typeof NOTIFICATION_LOCALES)[number];
export function isNotificationLocale(value: unknown): value is Locale {
  return value === 'fa' || value === 'en';
}

/**
 * Notification persistence contracts (DRAGON-13).
 *
 * The in-app inbox is the always-on channel; SMS and email deliveries are separate
 * attempt records with retry/dead-letter, gated by OD-008/OD-003. Recipients are
 * masked in every stored delivery record — a full mobile or email is never logged.
 */

export type BoundedParams = Readonly<Record<string, string | number>>;

/** One in-app inbox item. Localized client-side from `templateKey` + `params`. */
export interface NotificationRecord {
  _id: EntityId;
  accountId: EntityId;
  /** The outbox event that produced this notification (idempotency key). */
  sourceEventId: EntityId;
  templateKey: string;
  category: NotificationCategory;
  params: BoundedParams;
  correlationId: string;
  readAt: string | null;
  createdAt: string;
}

export type DeliveryStatus = 'pending' | 'sent' | 'suppressed' | 'dead';

/** A channel delivery attempt log. `recipient` (full) is never stored — only the mask. */
export interface NotificationDeliveryRecord {
  _id: EntityId;
  notificationId: EntityId;
  accountId: EntityId;
  channel: Exclude<NotificationChannel, 'in_app'>;
  templateKey: string;
  category: NotificationCategory;
  recipientMasked: string;
  locale: Locale;
  status: DeliveryStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  /** Why a delivery was suppressed (gate off, no consent, no approved template). */
  suppressedReason: string | null;
  nextAttemptAt: string;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
}

/** A versioned, localized SMS/email template subject to admin approval. */
export interface NotificationTemplateRecord {
  _id: EntityId;
  templateKey: string;
  channel: Exclude<NotificationChannel, 'in_app'>;
  version: number;
  category: NotificationCategory;
  status: 'draft' | 'approved';
  locales: Record<Locale, { subject: string; body: string }>;
  createdBy: EntityId;
  approvedBy: EntityId | null;
  createdAt: string;
  updatedAt: string;
}

/** Enables an approved template's messages for one tournament (still SMS/email gated). */
export interface TemplateEnablementRecord {
  _id: EntityId;
  tournamentId: EntityId;
  templateKey: string;
  enabledBy: EntityId;
  createdAt: string;
}

/**
 * Per-account channel preferences by category. In-app transactional is always on
 * (security-essential); marketing and SMS/email classes are opt-in and stay gated
 * off under OD-008 — never letting marketing reuse transactional consent.
 */
export interface NotificationPreferenceRecord {
  _id: EntityId;
  categories: {
    transactional: { in_app: boolean; sms: boolean; email: boolean };
    marketing: { in_app: boolean; sms: boolean; email: boolean };
  };
  updatedAt: string;
}

export const DEFAULT_PREFERENCES: NotificationPreferenceRecord['categories'] = {
  transactional: { in_app: true, sms: false, email: false },
  marketing: { in_app: false, sms: false, email: false }
};
