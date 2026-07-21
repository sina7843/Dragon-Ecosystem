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
}

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
    occurredAt: utcNow()
  };
}
