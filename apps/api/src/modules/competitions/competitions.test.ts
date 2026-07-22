import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { validateCompetitionConfig } from './validation.ts';

/** Competition configuration validation (BRACKET-007/011, UC-010). */

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `p${String(i)}`);

function code(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return (error as { fieldErrors?: Array<{ code: string }> }).fieldErrors?.[0]?.code;
  }
}

describe('validateCompetitionConfig', () => {
  test('accepts the supported formats and returns the normalized config', () => {
    assert.deepEqual(validateCompetitionConfig({ format: 'single_elimination', participantIds: ids(8) }), { format: 'single_elimination', legs: 1 });
    assert.deepEqual(validateCompetitionConfig({ format: 'round_robin', participantIds: ids(6), legs: 2 }), { format: 'round_robin', legs: 2 });
  });

  test('rejects unsupported formats (delivered by DRAGON-09b)', () => {
    for (const format of ['double_elimination', 'swiss', 'custom', 'nope']) {
      assert.equal(code(() => validateCompetitionConfig({ format, participantIds: ids(8) })), 'UNSUPPORTED_FORMAT');
    }
  });

  test('rejects duplicate participants', () => {
    assert.equal(code(() => validateCompetitionConfig({ format: 'single_elimination', participantIds: ['a', 'b', 'a', 'c'] })), 'DUPLICATE_PARTICIPANT');
  });

  test('rejects counts outside each format limit', () => {
    assert.equal(code(() => validateCompetitionConfig({ format: 'single_elimination', participantIds: ids(1) })), 'INVALID_PARTICIPANT_COUNT');
    assert.equal(code(() => validateCompetitionConfig({ format: 'single_elimination', participantIds: ids(1001) })), 'INVALID_PARTICIPANT_COUNT');
    assert.equal(code(() => validateCompetitionConfig({ format: 'round_robin', participantIds: ids(65) })), 'INVALID_PARTICIPANT_COUNT');
    assert.equal(code(() => validateCompetitionConfig({ format: 'round_robin', participantIds: ids(64) })), undefined);
  });

  test('rejects invalid legs and multi-leg single elimination', () => {
    assert.equal(code(() => validateCompetitionConfig({ format: 'round_robin', participantIds: ids(4), legs: 0 })), 'INVALID_LEGS');
    assert.equal(code(() => validateCompetitionConfig({ format: 'round_robin', participantIds: ids(4), legs: 5 })), 'INVALID_LEGS');
    assert.equal(code(() => validateCompetitionConfig({ format: 'single_elimination', participantIds: ids(4), legs: 2 })), 'INVALID_LEGS');
  });
});
