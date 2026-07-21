import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

/**
 * Foundation collections and their declared indexes.
 *
 * PERF-010 requires ordinary list queries to avoid unbounded scans, so every
 * access path a foundation service uses is backed by a declared index here and
 * created by the migration that owns it.
 */
export const COLLECTIONS = {
  schemaMigrations: 'schema_migrations',
  auditEvents: 'audit_events',
  domainEventOutbox: 'domain_event_outbox',
  idempotencyKeys: 'idempotency_keys',
  jobExecutions: 'job_executions',
  roleDefinitions: 'role_definitions'
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

export interface IndexDeclaration {
  /** Any collection name: domain modules declare indexes for the collections they own. */
  readonly collection: string;
  readonly name: string;
  readonly keys: IndexSpecification;
  readonly options?: CreateIndexesOptions;
}

export const INDEX_DECLARATIONS: readonly IndexDeclaration[] = [
  // Audit lookups are always scoped to a resource, an actor, or a correlation trail.
  {
    collection: COLLECTIONS.auditEvents,
    name: 'audit_resource_occurredAt',
    keys: { resourceType: 1, resourceId: 1, occurredAt: -1 }
  },
  {
    collection: COLLECTIONS.auditEvents,
    name: 'audit_actor_occurredAt',
    keys: { 'actor.accountId': 1, occurredAt: -1 }
  },
  {
    collection: COLLECTIONS.auditEvents,
    name: 'audit_correlationId',
    keys: { correlationId: 1 }
  },
  // The outbox dispatcher polls pending events in insertion order.
  {
    collection: COLLECTIONS.domainEventOutbox,
    name: 'outbox_state_occurredAt',
    keys: { state: 1, 'event.occurredAt': 1 }
  },
  {
    collection: COLLECTIONS.domainEventOutbox,
    name: 'outbox_eventId_unique',
    keys: { 'event.eventId': 1 },
    options: { unique: true }
  },
  // One stored outcome per idempotency key within a scope (section 15.1).
  {
    collection: COLLECTIONS.idempotencyKeys,
    name: 'idempotency_scope_key_unique',
    keys: { scope: 1, key: 1 },
    options: { unique: true }
  },
  // Expired reservations are reclaimed by MongoDB rather than an application job.
  {
    collection: COLLECTIONS.idempotencyKeys,
    name: 'idempotency_expiresAt_ttl',
    keys: { expiresAt: 1 },
    options: { expireAfterSeconds: 0 }
  },
  {
    collection: COLLECTIONS.jobExecutions,
    name: 'jobs_state_createdAt',
    keys: { state: 1, createdAt: 1 }
  },
  {
    collection: COLLECTIONS.jobExecutions,
    name: 'jobs_correlationId',
    keys: { correlationId: 1 }
  }
];
