import type { ClientSession, Db } from 'mongodb';
import { COLLECTIONS } from './collections.ts';
import { utcNow } from '../events.ts';
import type { DomainEvent } from '../events.ts';

/**
 * Transactional outbox (DATA-084, EVENT-*). Section 32.1 makes an outbox mandatory.
 * Events are written in the same transaction as the state change that produced them,
 * so a committed change can never lose its event and a rollback never emits one.
 */

export type OutboxState = 'pending' | 'dispatched' | 'failed';

export interface OutboxRecord {
  _id: string;
  event: DomainEvent;
  state: OutboxState;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

export async function enqueueDomainEvent(
  db: Db,
  event: DomainEvent,
  session?: ClientSession
): Promise<void> {
  await db.collection<OutboxRecord>(COLLECTIONS.domainEventOutbox).insertOne(
    {
      _id: event.eventId,
      event,
      state: 'pending',
      attempts: 0,
      lastError: null,
      createdAt: utcNow()
    },
    session === undefined ? {} : { session }
  );
}

/** Dispatcher read path; the dispatcher process itself is delivered by DRAGON-14. */
export async function readPendingEvents(db: Db, limit = 100): Promise<OutboxRecord[]> {
  return db
    .collection<OutboxRecord>(COLLECTIONS.domainEventOutbox)
    .find({ state: 'pending' })
    .sort({ 'event.occurredAt': 1 })
    .limit(limit)
    .toArray();
}
