import { randomUUID } from 'node:crypto';

/**
 * Stable opaque public identifiers (DATA-001 principle, section 5.9).
 * IDs are never reused after deletion and are not derived from business data.
 */
export type EntityId = string;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function newId(): EntityId {
  return randomUUID();
}

export function isEntityId(value: unknown): value is EntityId {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** Throws when an identifier reaching a boundary is not a valid opaque ID. */
export function assertEntityId(value: unknown, field = 'id'): EntityId {
  if (!isEntityId(value)) throw new TypeError(`${field} must be a UUID identifier`);
  return value;
}
