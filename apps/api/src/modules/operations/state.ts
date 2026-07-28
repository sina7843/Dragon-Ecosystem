import type { EntityId } from '../../shared/ids.ts';

/**
 * Analytics, job, and alert contracts (DRAGON-14).
 *
 * Analytics events are pseudonymous and consent-aware: an essential (security/ops)
 * event is always recorded to the internal sink; a nonessential event is recorded
 * only with consent, and always under a per-account pseudonym rather than the raw
 * account id. No external tracker is activated (OD-026). Errors are captured with a
 * redacted message. Jobs and alerts give operators observability into failures.
 */

export type BoundedProps = Readonly<Record<string, string | number | boolean>>;

export interface AnalyticsEventRecord {
  _id: EntityId;
  name: string;
  essential: boolean;
  /** Stable per-account pseudonym; null for an anonymous or essential-system event. */
  pseudonymId: string | null;
  props: BoundedProps;
  correlationId: string;
  createdAt: string;
}

export interface AnalyticsErrorRecord {
  _id: EntityId;
  code: string;
  /** Redacted message — never a raw stack trace or secret. */
  message: string;
  context: BoundedProps;
  correlationId: string;
  createdAt: string;
}

export type AlertCategory = 'otp_mock' | 'payment_mock' | 'ledger' | 'bracket' | 'queue' | 'mongo' | 'stream';
export type AlertSeverity = 'warning' | 'critical';

export interface AlertRecord {
  _id: EntityId;
  category: AlertCategory;
  severity: AlertSeverity;
  message: string;
  detail: BoundedProps;
  status: 'open' | 'acknowledged';
  acknowledgedBy: EntityId | null;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
}

export type JobStatus = 'running' | 'succeeded' | 'failed';

export interface JobExecutionRecord {
  _id: EntityId;
  jobName: string;
  status: JobStatus;
  startedAt: string;
  finishedAt: string | null;
  result: BoundedProps | null;
  error: string | null;
  correlationId: string;
}
