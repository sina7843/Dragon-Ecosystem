import type { ClientSession, Db } from 'mongodb';
import type { Database } from './client.ts';
import { COLLECTIONS } from './collections.ts';
import { enqueueDomainEvent } from './outbox.ts';
import { createAuditEvent, type AuditEvent, type NewAuditEvent } from '../audit.ts';
import { createDomainEvent, type NewDomainEvent } from '../events.ts';
import type { RequestContext } from '../context.ts';

/**
 * The repository boundary every domain write goes through.
 *
 * Acceptance rule for the platform: no domain feature may bypass validation,
 * authorization context, audit correlation, or repository boundaries. A unit of
 * work carries the request context, and its audit rows and domain events are
 * committed in the same transaction as the state change (AUDIT-001, EVENT-001).
 */

type AuditInput = Omit<NewAuditEvent, 'correlationId' | 'actor'> & { actor?: NewAuditEvent['actor'] };
type EventInput<TPayload> = Omit<NewDomainEvent<TPayload>, 'correlationId' | 'producer'> & {
  producer?: string;
};

export interface UnitOfWork {
  readonly db: Db;
  readonly session: ClientSession;
  readonly context: RequestContext;
  /** Queues an audit row; written before the transaction commits. */
  audit(input: AuditInput): void;
  /** Queues a domain event; written to the outbox before the transaction commits. */
  publish<TPayload>(input: EventInput<TPayload>): void;
}

export const DEFAULT_PRODUCER = 'dragon-api';

export async function runUnitOfWork<T>(
  database: Database,
  context: RequestContext,
  work: (uow: UnitOfWork) => Promise<T>
): Promise<T> {
  return database.withTransaction(async (session) => {
    const auditQueue: AuditEvent[] = [];
    const eventQueue: ReturnType<typeof createDomainEvent>[] = [];

    const uow: UnitOfWork = {
      db: database.db,
      session,
      context,
      audit(input) {
        auditQueue.push(
          createAuditEvent({
            ...input,
            actor: input.actor ?? context.actor,
            correlationId: context.correlationId
          })
        );
      },
      publish(input) {
        eventQueue.push(
          createDomainEvent({
            ...input,
            producer: input.producer ?? DEFAULT_PRODUCER,
            correlationId: context.correlationId
          })
        );
      }
    };

    const result = await work(uow);

    if (auditQueue.length > 0) {
      await database.db
        .collection<AuditEvent>(COLLECTIONS.auditEvents)
        .insertMany(auditQueue, { session });
    }
    for (const event of eventQueue) {
      await enqueueDomainEvent(database.db, event, session);
    }

    return result;
  });
}
