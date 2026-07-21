import { newId, type EntityId } from './ids.ts';
import { utcNow } from './events.ts';
import type { ActorContext } from './context.ts';

/**
 * Append-only audit record (DATA-083, AUDIT-001..008).
 * Audit rows are never updated or deleted by ordinary application workflows.
 */
export interface AuditEvent {
  readonly _id: EntityId;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly actor: ActorContext;
  readonly before: unknown;
  readonly after: unknown;
  readonly reason: string | null;
  readonly correlationId: string;
  readonly occurredAt: string;
  /** Emergency super-administrator actions get enhanced audit and oversight (ADMIN-010, MOD-009). */
  readonly emergency: boolean;
}

export interface NewAuditEvent {
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly actor: ActorContext;
  readonly correlationId: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly reason?: string | null;
  readonly emergency?: boolean;
}

/**
 * Builds an append-only audit record. Callers pass only already-redacted values
 * for before/after; this function never inspects or stores raw secrets (AUDIT-003).
 */
export function createAuditEvent(input: NewAuditEvent): AuditEvent {
  if (input.action.trim() === '') throw new TypeError('action is required');
  if (input.resourceType.trim() === '') throw new TypeError('resourceType is required');
  if (input.correlationId.trim() === '') throw new TypeError('correlationId is required');

  return {
    _id: newId(),
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    actor: input.actor,
    before: input.before ?? null,
    after: input.after ?? null,
    reason: input.reason ?? null,
    correlationId: input.correlationId,
    occurredAt: utcNow(),
    emergency: input.emergency ?? false
  };
}
