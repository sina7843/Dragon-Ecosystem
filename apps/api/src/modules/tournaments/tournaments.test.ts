import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { canTournamentTransition, MAX_CAPACITY, type TournamentRecord } from './state.ts';
import {
  assertDateOrdering,
  buildFee,
  buildPrizes,
  buildQuestions,
  publicationProblems,
  validateCapacity
} from './validation.ts';

/** Pure validators and lifecycle guards for tournament authoring (TOURN-002, 007, 012). */

describe('lifecycle state machine', () => {
  test('draft may publish, cancel, or archive; archived is terminal', () => {
    assert.equal(canTournamentTransition('draft', 'published'), true);
    assert.equal(canTournamentTransition('draft', 'cancelled'), true);
    assert.equal(canTournamentTransition('draft', 'archived'), true);
    assert.equal(canTournamentTransition('published', 'completed'), true);
    assert.equal(canTournamentTransition('archived', 'draft'), false);
    assert.equal(canTournamentTransition('draft', 'completed'), false);
  });
});

describe('fee definitions (TOURN-012)', () => {
  test('free has no components', () => {
    assert.deepEqual(buildFee({ kind: 'free' }).components, []);
  });
  test('toman is stored as integer rial (Toman * 10)', () => {
    const fee = buildFee({ kind: 'toman', tomanAmount: 5000 });
    assert.equal(fee.components[0]?.assetCode, 'IRR');
    assert.equal(fee.components[0]?.amountInteger, 50000);
  });
  test('mixed carries an exact Toman and Dragon Coin component', () => {
    const fee = buildFee({ kind: 'mixed', tomanAmount: 100, dragonCoinAmount: 3 });
    assert.equal(fee.components.length, 2);
    assert.equal(fee.components[0]?.amountInteger, 1000);
    assert.equal(fee.components[1]?.assetCode, 'DRC');
    assert.equal(fee.components[1]?.amountInteger, 3);
  });
  test('a non-positive or fractional amount is rejected', () => {
    assert.throws(() => buildFee({ kind: 'toman', tomanAmount: 0 }));
    assert.throws(() => buildFee({ kind: 'dragon_coin', dragonCoinAmount: 2.5 }));
    assert.throws(() => buildFee({ kind: 'toman' }));
  });
  test('an amount beyond the domain ceiling is a clean validation error, not an overflow', () => {
    // 2e12 Toman would be 2e13 rial; the ceiling keeps Toman*10 a safe integer so
    // this surfaces as a 422 ValidationError rather than a RangeError / opaque 500.
    assert.throws(() => buildFee({ kind: 'toman', tomanAmount: 2_000_000_000_000 }), /amount is not valid/i);
  });
});

describe('prize definitions (versioned)', () => {
  test('changing placements bumps the version; an unchanged set does not', () => {
    const base = buildPrizes({ placements: [{ rank: 1, tomanAmount: 1000 }] }, { version: 0, placements: [] });
    assert.equal(base.version, 1);
    const same = buildPrizes({ placements: [{ rank: 1, tomanAmount: 1000 }] }, base);
    assert.equal(same.version, 1);
    const changed = buildPrizes({ placements: [{ rank: 1, tomanAmount: 2000 }] }, base);
    assert.equal(changed.version, 2);
  });
  test('duplicate ranks and empty rewards are rejected', () => {
    assert.throws(() => buildPrizes({ placements: [{ rank: 1, tomanAmount: 1 }, { rank: 1, dragonCoinAmount: 1 }] }, { version: 0, placements: [] }));
    assert.throws(() => buildPrizes({ placements: [{ rank: 1 }] }, { version: 0, placements: [] }));
  });
});

describe('capacity (DEC-046)', () => {
  test('1..1000 accepted, out of range rejected', () => {
    assert.equal(validateCapacity(1, 8), 1);
    assert.equal(validateCapacity(MAX_CAPACITY, 8), 1000);
    assert.throws(() => validateCapacity(0, 8));
    assert.throws(() => validateCapacity(1001, 8));
    assert.throws(() => validateCapacity(1.5, 8));
  });
});

describe('cross-field date ordering (TOURN-002)', () => {
  const base = {
    registration: { opensAt: '2026-08-01T00:00:00.000Z', closesAt: '2026-08-10T00:00:00.000Z' },
    schedule: { startAt: '2026-08-11T00:00:00.000Z', endAt: '2026-08-12T00:00:00.000Z' }
  };
  test('correctly ordered dates pass', () => {
    assert.doesNotThrow(() => assertDateOrdering(base));
  });
  test('registration closing before it opens is rejected', () => {
    assert.throws(() => assertDateOrdering({ ...base, registration: { opensAt: '2026-08-10T00:00:00.000Z', closesAt: '2026-08-01T00:00:00.000Z' } }));
  });
  test('start before registration close is rejected', () => {
    assert.throws(() => assertDateOrdering({ ...base, schedule: { startAt: '2026-08-05T00:00:00.000Z', endAt: '2026-08-12T00:00:00.000Z' } }));
  });
  test('end before start is rejected', () => {
    assert.throws(() => assertDateOrdering({ ...base, schedule: { startAt: '2026-08-11T00:00:00.000Z', endAt: '2026-08-10T00:00:00.000Z' } }));
  });
});

describe('publication validation (TOURN-002)', () => {
  function draft(overrides: Partial<TournamentRecord> = {}): TournamentRecord {
    return {
      _id: 't', slug: 's', state: 'draft',
      translations: {
        fa: { name: 'ن', summary: 'خ', description: '', seoTitle: '', seoDescription: '' },
        en: { name: 'N', summary: 'S', description: '', seoTitle: '', seoDescription: '' }
      },
      gameId: 'g', participantType: 'individual', capacity: 16,
      registration: { opensAt: '2026-08-01T00:00:00.000Z', closesAt: '2026-08-10T00:00:00.000Z' },
      schedule: { startAt: '2026-08-11T00:00:00.000Z', endAt: '2026-08-12T00:00:00.000Z' },
      format: 'single_elimination', ruleProfile: { kind: 'custom', text: { fa: 'ق', en: 'R' } },
      approvalMode: 'manual', waitlistMode: 'disabled', participantsPublic: false, coverImageUrl: null,
      eligibility: { minAge: null, requireCompleteProfile: true, requireGameIdentity: false },
      questionSet: { version: 0, questions: [] },
      fee: { kind: 'free', components: [] },
      refundPolicy: { kind: 'no_refund', text: { fa: '', en: '' } },
      prizes: { version: 0, placements: [] },
      version: 1, organizerId: 'o', createdAt: 'x', updatedAt: 'x', publishedAt: null, cancelledAt: null,
      ...overrides
    };
  }
  test('a complete draft has no problems', () => {
    assert.equal(publicationProblems(draft()).length, 0);
  });
  test('a missing English name and missing dates are reported', () => {
    const problems = publicationProblems(draft({
      translations: { fa: { name: 'ن', summary: 'خ', description: '', seoTitle: '', seoDescription: '' }, en: { name: '', summary: 'S', description: '', seoTitle: '', seoDescription: '' } },
      schedule: { startAt: null, endAt: null }
    }));
    const fields = problems.map((p) => p.field);
    assert.ok(fields.includes('translations.en.name'));
    assert.ok(fields.includes('schedule.startAt'));
    assert.ok(problems.every((p) => p.code === 'REQUIRED_FOR_PUBLICATION'));
  });
});

describe('custom questions (TOURN-007 versioning)', () => {
  test('adding a question bumps the set version and assigns a key', () => {
    const set = buildQuestions([{ prompt: { fa: 'س', en: 'Q' }, type: 'short_text' }], { version: 0, questions: [] });
    assert.equal(set.version, 1);
    assert.equal(set.questions[0]?.key, 'q1');
  });
  test('a single-choice question needs at least two options', () => {
    assert.throws(() => buildQuestions([{ prompt: { fa: 'س', en: 'Q' }, type: 'single_choice', options: [{ fa: 'ی', en: 'A' }] }], { version: 0, questions: [] }));
  });
});
