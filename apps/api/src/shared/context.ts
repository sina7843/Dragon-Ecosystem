/**
 * Request context carried through every domain operation.
 *
 * Section 16.2 requires authorization to combine account state, global permission,
 * resource-scoped assignment, ownership, relationship, feature activation, business
 * state, and risk restriction. DRAGON-01 defines the carrier; the evaluator that
 * consumes it is implemented by DRAGON-04.
 */

export type ActorKind = 'anonymous' | 'account' | 'system';

export interface ActorContext {
  readonly kind: ActorKind;
  /** Null for anonymous and system actors. */
  readonly accountId: string | null;
  /** Global role codes. Resource-scoped assignments are resolved by DRAGON-04. */
  readonly roles: readonly string[];
}

export interface RequestContext {
  readonly correlationId: string;
  readonly actor: ActorContext;
}

export const ANONYMOUS_ACTOR: ActorContext = Object.freeze({
  kind: 'anonymous',
  accountId: null,
  roles: Object.freeze([]) as readonly string[]
});

/** Actor used by migrations, seeds, and background jobs so audit rows always name a source. */
export const SYSTEM_ACTOR: ActorContext = Object.freeze({
  kind: 'system',
  accountId: null,
  roles: Object.freeze(['system']) as readonly string[]
});

export function createRequestContext(correlationId: string, actor: ActorContext = ANONYMOUS_ACTOR): RequestContext {
  if (correlationId.trim() === '') throw new TypeError('correlationId is required');
  return { correlationId, actor };
}
