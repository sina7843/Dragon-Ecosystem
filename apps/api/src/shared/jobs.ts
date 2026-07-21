import type { EntityId } from './ids.ts';

/**
 * Background and scheduled job contract (DATA-085, section 32.1).
 *
 * DRAGON-01 defines the interface and the execution record only. The worker and
 * scheduler processes that consume them are delivered by DRAGON-14.
 */

export type JobState = 'pending' | 'running' | 'succeeded' | 'failed';

export interface JobExecution {
  readonly _id: EntityId;
  readonly type: string;
  readonly state: JobState;
  readonly attempts: number;
  readonly correlationId: string;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface JobContext {
  readonly correlationId: string;
  readonly attempt: number;
}

export interface JobHandler<TPayload = Record<string, unknown>> {
  readonly type: string;
  /** Handlers must be safe to retry: only idempotent work may be retried automatically (section 29). */
  readonly idempotent: boolean;
  handle(payload: TPayload, context: JobContext): Promise<void>;
}
