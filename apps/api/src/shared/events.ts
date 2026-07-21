import { newId, type EntityId } from './ids.ts';

/**
 * Domain-event envelope required by Requirements section 5.9.
 * Consumers MUST ignore unknown additive fields, so the envelope only ever grows.
 */
export interface DomainEvent<TPayload = unknown> {
  readonly eventId: EntityId;
  readonly eventName: string;
  readonly eventVersion: number;
  readonly aggregateId: EntityId;
  readonly occurredAt: string;
  readonly producer: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly payload: TPayload;
}

export interface NewDomainEvent<TPayload> {
  readonly eventName: string;
  readonly eventVersion: number;
  readonly aggregateId: EntityId;
  readonly producer: string;
  readonly correlationId: string;
  readonly causationId?: string | null;
  readonly payload: TPayload;
}

/** Timestamps are stored in UTC (DEC-005, section 17.4). */
export function utcNow(): string {
  return new Date().toISOString();
}

export function createDomainEvent<TPayload>(input: NewDomainEvent<TPayload>): DomainEvent<TPayload> {
  if (input.eventName.trim() === '') throw new TypeError('eventName is required');
  if (!Number.isInteger(input.eventVersion) || input.eventVersion < 1) {
    throw new TypeError('eventVersion must be a positive integer');
  }
  if (input.correlationId.trim() === '') throw new TypeError('correlationId is required');

  return {
    eventId: newId(),
    eventName: input.eventName,
    eventVersion: input.eventVersion,
    aggregateId: input.aggregateId,
    occurredAt: utcNow(),
    producer: input.producer,
    correlationId: input.correlationId,
    causationId: input.causationId ?? null,
    payload: input.payload
  };
}
