import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertEntityId, isEntityId, newId } from './ids.ts';
import { createDomainEvent, utcNow } from './events.ts';
import { createAuditEvent } from './audit.ts';
import { ANONYMOUS_ACTOR, SYSTEM_ACTOR, createRequestContext } from './context.ts';
import {
  type AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  toErrorBody
} from './errors.ts';

test('identifiers are opaque UUIDs and validated at boundaries', () => {
  const id = newId();
  assert.equal(isEntityId(id), true);
  assert.notEqual(newId(), newId());
  assert.equal(isEntityId('12345'), false);
  assert.equal(isEntityId(undefined), false);
  assert.throws(() => assertEntityId('not-an-id', 'accountId'), /accountId must be a UUID/);
});

test('timestamps are UTC ISO 8601 (DEC-005)', () => {
  assert.match(utcNow(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('domain events carry the full envelope required by section 5.9', () => {
  const aggregateId = newId();
  const event = createDomainEvent({
    eventName: 'account.registered',
    eventVersion: 1,
    aggregateId,
    producer: 'dragon-api',
    correlationId: 'corr-1',
    payload: { locale: 'fa' }
  });

  for (const field of [
    'eventId',
    'eventName',
    'eventVersion',
    'aggregateId',
    'occurredAt',
    'producer',
    'correlationId',
    'causationId',
    'payload'
  ]) {
    assert.ok(field in event, `envelope is missing ${field}`);
  }
  assert.equal(event.aggregateId, aggregateId);
  assert.equal(event.causationId, null);
  assert.equal(isEntityId(event.eventId), true);
});

test('domain events reject an incomplete envelope', () => {
  const base = { eventVersion: 1, aggregateId: newId(), producer: 'p', correlationId: 'c', payload: {} };
  assert.throws(() => createDomainEvent({ ...base, eventName: '  ' }), /eventName is required/);
  assert.throws(() => createDomainEvent({ ...base, eventName: 'a.b', eventVersion: 0 }), /eventVersion/);
  assert.throws(() => createDomainEvent({ ...base, eventName: 'a.b', correlationId: '' }), /correlationId/);
});

test('audit events record actor, resource, reason, and correlation (DATA-083)', () => {
  const audit = createAuditEvent({
    action: 'role.assigned',
    resourceType: 'account',
    resourceId: newId(),
    actor: SYSTEM_ACTOR,
    correlationId: 'corr-2',
    before: { roles: [] },
    after: { roles: ['player'] },
    reason: 'seed'
  });

  assert.equal(audit.actor.kind, 'system');
  assert.deepEqual(audit.before, { roles: [] });
  assert.equal(audit.reason, 'seed');
  assert.match(audit.occurredAt, /Z$/);
});

test('request context defaults to an anonymous actor', () => {
  const context = createRequestContext('corr-3');
  assert.equal(context.actor, ANONYMOUS_ACTOR);
  assert.equal(context.actor.accountId, null);
  assert.throws(() => createRequestContext(''), /correlationId is required/);
});

test('client errors map to their status and stay readable', () => {
  const cases: Array<[AppError, number, string]> = [
    [new ValidationError(), 422, 'VALIDATION_FAILED'],
    [new ForbiddenError(), 403, 'FORBIDDEN'],
    [new NotFoundError(), 404, 'RESOURCE_NOT_FOUND'],
    [new ConflictError(), 409, 'RESOURCE_CONFLICT']
  ];

  for (const [error, status, code] of cases) {
    const mapped = toErrorBody(error, 'corr-4');
    assert.equal(mapped.status, status);
    assert.equal(mapped.body.error.code, code);
    assert.equal(mapped.body.error.correlationId, 'corr-4');
    assert.equal(mapped.body.error.message, error.message);
  }
});

test('validation errors carry field errors', () => {
  const error = new ValidationError('Invalid input.', [
    { field: 'mobile', code: 'INVALID_FORMAT', message: 'Enter a valid mobile number.' }
  ]);
  const mapped = toErrorBody(error, 'corr-5');
  assert.equal(mapped.body.error.fieldErrors.length, 1);
  assert.equal(mapped.body.error.fieldErrors[0]?.field, 'mobile');
});

test('unexpected failures never leak internal detail (SEC-018)', () => {
  const mapped = toErrorBody(new Error('connection string mongodb://user:secret@host failed'), 'corr-6');
  assert.equal(mapped.status, 500);
  assert.equal(mapped.body.error.code, 'INTERNAL_ERROR');
  assert.equal(mapped.body.error.message, 'An unexpected error occurred.');
  assert.doesNotMatch(mapped.body.error.message, /mongodb|secret/);
  assert.equal(mapped.body.error.retryable, true);
});

test('rate limited and provider failures are retryable, client errors are not', () => {
  assert.equal(toErrorBody(new NotFoundError(), 'c').body.error.retryable, false);
  assert.equal(toErrorBody({ statusCode: 429, code: 'RATE_LIMITED' }, 'c').body.error.retryable, true);
});
