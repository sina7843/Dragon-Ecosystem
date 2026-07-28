import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ValidationError } from '../../shared/errors.ts';
import { newId } from '../../shared/ids.ts';
import { LocalStubStreamingProvider } from './provider.ts';
import { canStreamTransition, isPubliclyReadableStream, STREAM_STATES, type StreamRecord } from './state.ts';
import {
  assertScheduleOrdering,
  buildArchivePolicy,
  buildLinks,
  emptyLinks,
  parseDate,
  schedulingProblems,
  validateAccessMode
} from './validation.ts';

/** Pure lifecycle, validation, and provider-adapter behaviour (STREAM-002/003/007/009). */

function streamFixture(overrides: Partial<StreamRecord> = {}): StreamRecord {
  return {
    _id: newId(),
    slug: 'grand-final',
    state: 'draft',
    accessMode: 'public',
    translations: { fa: { title: 'فینال بزرگ', summary: '' }, en: { title: 'Grand final', summary: '' } },
    scheduledStartAt: '2026-09-01T18:00:00.000Z',
    scheduledEndAt: '2026-09-01T21:00:00.000Z',
    actualStartAt: null,
    actualEndAt: null,
    links: emptyLinks(),
    rights: { confirmed: true, reference: 'RIGHTS-2026-01', confirmedAt: '2026-08-01T00:00:00.000Z', confirmedBy: newId(), takedownAt: null, takedownReason: null },
    archivePolicy: { mode: 'disabled', retentionDays: null },
    provider: { name: 'stub', channelId: null, streamId: null, syncState: 'unlinked', lastSyncAt: null, lastError: null, attempts: 0 },
    coverImageUrl: null,
    version: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides
  };
}

describe('lifecycle state machine (STREAM-003, section 12.9)', () => {
  test('the documented happy path is allowed end to end', () => {
    assert.equal(canStreamTransition('draft', 'scheduled'), true);
    assert.equal(canStreamTransition('scheduled', 'live'), true);
    assert.equal(canStreamTransition('live', 'ended'), true);
    assert.equal(canStreamTransition('ended', 'archived'), true);
  });

  test('cancellation is reachable only before the stream runs', () => {
    assert.equal(canStreamTransition('draft', 'cancelled'), true);
    assert.equal(canStreamTransition('scheduled', 'cancelled'), true);
    assert.equal(canStreamTransition('live', 'cancelled'), false);
    assert.equal(canStreamTransition('ended', 'cancelled'), false);
  });

  test('failure is reachable from scheduled and live, and recovery leads back to the lifecycle', () => {
    assert.equal(canStreamTransition('scheduled', 'failed'), true);
    assert.equal(canStreamTransition('live', 'failed'), true);
    assert.equal(canStreamTransition('draft', 'failed'), false);
    for (const recovered of ['scheduled', 'live', 'ended'] as const) {
      assert.equal(canStreamTransition('failed', recovered), true);
    }
    assert.equal(canStreamTransition('failed', 'archived'), false);
  });

  test('cancelled and archived are terminal', () => {
    for (const target of STREAM_STATES) {
      assert.equal(canStreamTransition('cancelled', target), false, `cancelled -> ${target}`);
      assert.equal(canStreamTransition('archived', target), false, `archived -> ${target}`);
    }
  });

  test('a draft is the only state hidden from visitors; failed stays visible as the unavailable state', () => {
    assert.equal(isPubliclyReadableStream('draft'), false);
    for (const state of STREAM_STATES.filter((s) => s !== 'draft')) {
      assert.equal(isPubliclyReadableStream(state), true, `${state} must be publicly readable`);
    }
  });
});

describe('scheduling readiness (rights confirmation, section 27)', () => {
  test('a fully prepared stream reports no problems', () => {
    assert.deepEqual(schedulingProblems(streamFixture()), []);
  });

  test('unconfirmed rights block scheduling', () => {
    const problems = schedulingProblems(
      streamFixture({ rights: { confirmed: false, reference: null, confirmedAt: null, confirmedBy: null, takedownAt: null, takedownReason: null } })
    );
    assert.equal(problems.some((p) => p.code === 'RIGHTS_NOT_CONFIRMED'), true);
  });

  test('every missing prerequisite is reported together, not one per attempt', () => {
    const problems = schedulingProblems(
      streamFixture({
        translations: { fa: { title: '', summary: '' }, en: { title: '', summary: '' } },
        scheduledStartAt: null,
        rights: { confirmed: false, reference: null, confirmedAt: null, confirmedBy: null, takedownAt: null, takedownReason: null }
      })
    );
    assert.equal(problems.length, 4);
  });
});

describe('schedule validation', () => {
  test('an end before or equal to the start is rejected', () => {
    assert.throws(() => assertScheduleOrdering('2026-09-01T20:00:00.000Z', '2026-09-01T18:00:00.000Z'), /schedule is not valid/i);
    assert.throws(() => assertScheduleOrdering('2026-09-01T20:00:00.000Z', '2026-09-01T20:00:00.000Z'), /schedule is not valid/i);
  });
  test('an open-ended window is allowed', () => {
    assert.doesNotThrow(() => assertScheduleOrdering('2026-09-01T20:00:00.000Z', null));
  });
  test('a malformed date is a validation error, never a silent null', () => {
    assert.throws(() => parseDate('not-a-date', 'scheduledStartAt', null), /date is not valid/i);
    assert.equal(parseDate(null, 'scheduledStartAt', '2026-01-01T00:00:00.000Z'), null);
    assert.equal(parseDate(undefined, 'scheduledStartAt', '2026-01-01T00:00:00.000Z'), '2026-01-01T00:00:00.000Z');
  });
});

describe('access mode (ASM-011)', () => {
  test('only public and authenticated are accepted; paid viewing has no representation', () => {
    assert.equal(validateAccessMode('public', 'public'), 'public');
    assert.equal(validateAccessMode('authenticated', 'public'), 'authenticated');
    assert.throws(() => validateAccessMode('paid', 'public'), /access mode is not valid/i);
  });
});

describe('relationship links (STREAM-004)', () => {
  test('every relationship kind is optional, so an unlinked stream is valid', () => {
    assert.deepEqual(buildLinks({}, emptyLinks()), emptyLinks());
  });

  test('duplicate ids collapse, because a link set has no multiplicity', () => {
    const id = newId();
    assert.deepEqual(buildLinks({ gameIds: [id, id] }, emptyLinks()).gameIds, [id]);
  });

  test('a non-identifier link is rejected rather than stored as an unresolvable reference', () => {
    assert.throws(() => buildLinks({ tournamentIds: ['../../etc/passwd'] }, emptyLinks()), /identifier is not valid/i);
  });

  test('channel keys are normalised and format-checked', () => {
    assert.deepEqual(buildLinks({ channelKeys: ['Main-Stage'] }, emptyLinks()).channelKeys, ['main-stage']);
    assert.throws(() => buildLinks({ channelKeys: ['bad key!'] }, emptyLinks()), /channel key is not valid/i);
  });

  test('an unbounded relationship fan-out is refused', () => {
    assert.throws(() => buildLinks({ matchIds: Array.from({ length: 51 }, () => newId()) }, emptyLinks()), /too many linked/i);
  });
});

describe('archive policy under OD-014', () => {
  const disabled = { mode: 'disabled', retentionDays: null } as const;

  test('with the rights policy unapproved, retention cannot be enabled at all', () => {
    assert.throws(
      () => buildArchivePolicy({ mode: 'retain', retentionDays: 30 }, disabled, false),
      (error: unknown) =>
        error instanceof ValidationError && error.fieldErrors.some((f) => f.code === 'ARCHIVE_POLICY_NOT_APPROVED' && /OD-014/.test(f.message))
    );
  });

  test('with the policy unapproved, the stored policy is forced to disabled', () => {
    assert.deepEqual(buildArchivePolicy(undefined, { mode: 'retain', retentionDays: 30 }, false), disabled);
  });

  test('with the policy approved, an approved retention duration is stored', () => {
    assert.deepEqual(buildArchivePolicy({ mode: 'retain', retentionDays: 30 }, disabled, true), { mode: 'retain', retentionDays: 30 });
  });

  test('an out-of-range retention duration is rejected', () => {
    assert.throws(() => buildArchivePolicy({ mode: 'retain', retentionDays: 0 }, disabled, true), /retention period is not valid/i);
    assert.throws(() => buildArchivePolicy({ mode: 'retain', retentionDays: 4000 }, disabled, true), /retention period is not valid/i);
  });
});

describe('streaming provider adapter (STREAM-002, STREAM-007)', () => {
  const provider = new LocalStubStreamingProvider('test-secure-link-secret');

  test('provisioning is idempotent: the same stream always resolves to the same resource', async () => {
    const streamId = newId();
    const first = await provider.provision({ streamId, channelKey: 'main-stage' });
    const second = await provider.provision({ streamId, channelKey: 'main-stage' });
    assert.deepEqual(first, second);
    assert.equal(first.ingestReady, true);
  });

  test('different streams get different provider resources', async () => {
    const a = await provider.provision({ streamId: newId(), channelKey: 'main-stage' });
    const b = await provider.provision({ streamId: newId(), channelKey: 'main-stage' });
    assert.notEqual(a.streamId, b.streamId);
    // The channel is shared, which is what lets one channel carry a series of streams.
    assert.equal(a.channelId, b.channelId);
  });

  test('a provider id is derived from the Dragon id and never replaces it (STREAM-001)', async () => {
    const streamId = newId();
    const result = await provider.provision({ streamId, channelKey: 'main-stage' });
    assert.notEqual(result.streamId, streamId);
    assert.match(result.streamId, /^st_[0-9a-f]{24}$/);
  });

  test('playback configuration carries an expiring token and no secret', async () => {
    const config = await provider.playback({ providerStreamId: 'st_abc', viewerScope: 'anonymous', ttlSeconds: 300 });
    assert.equal(config.provider, 'stub');
    assert.ok(Date.parse(config.expiresAt) > Date.now());
    for (const url of [config.embedUrl, config.playbackUrl]) {
      assert.equal(url.includes('test-secure-link-secret'), false, 'the signing secret must never reach a viewer URL');
      assert.match(url, /token=/);
    }
  });

  test('the link is bound to its viewer scope, so it cannot be replayed as another viewer', async () => {
    const at = new Date('2026-09-01T18:00:00.000Z');
    const fixed = new LocalStubStreamingProvider('test-secure-link-secret', () => at);
    const mine = await fixed.playback({ providerStreamId: 'st_abc', viewerScope: 'account-a', ttlSeconds: 300 });
    const theirs = await fixed.playback({ providerStreamId: 'st_abc', viewerScope: 'account-b', ttlSeconds: 300 });
    assert.notEqual(mine.playbackUrl, theirs.playbackUrl);
    // Same scope + same clock is reproducible, which is what makes the signature verifiable.
    const again = await fixed.playback({ providerStreamId: 'st_abc', viewerScope: 'account-a', ttlSeconds: 300 });
    assert.equal(mine.playbackUrl, again.playbackUrl);
  });

  test('an empty secure-link secret is refused at construction', () => {
    assert.throws(() => new LocalStubStreamingProvider('  '), /secure-link secret is required/i);
  });

  test('describe reports an unknown resource as absent so reconciliation can converge', async () => {
    assert.equal(await provider.describe(''), null);
    assert.deepEqual(await provider.describe('st_abc'), { providerStreamId: 'st_abc', live: false, archiveReady: false });
  });
});
