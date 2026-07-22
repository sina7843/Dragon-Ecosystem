import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { canRegistrationTransition, isActiveState, seatOf } from './state.ts';
import { buildAnswers, eligibilityProblems, type EligibilityFacts } from './validation.ts';
import type { TournamentRecord } from '../tournaments/index.ts';

/** Pure registration lifecycle and eligibility rules (TOURN-007, TOURN-008). */

describe('registration state machine', () => {
  test('valid transitions', () => {
    assert.equal(canRegistrationTransition('pending', 'approved'), true);
    assert.equal(canRegistrationTransition('pending', 'waitlisted'), true);
    assert.equal(canRegistrationTransition('waitlisted', 'approved'), true);
    assert.equal(canRegistrationTransition('approved', 'cancelled'), true);
  });
  test('terminal and illegal transitions', () => {
    assert.equal(canRegistrationTransition('approved', 'rejected'), false);
    assert.equal(canRegistrationTransition('rejected', 'approved'), false);
    assert.equal(canRegistrationTransition('cancelled', 'approved'), false);
  });
  test('seat and active mapping', () => {
    assert.equal(seatOf('approved'), 'main');
    assert.equal(seatOf('waitlisted'), 'waitlist');
    assert.equal(seatOf('pending'), 'none');
    assert.equal(isActiveState('rejected'), false);
    assert.equal(isActiveState('pending'), true);
  });
});

function tournament(overrides: Partial<TournamentRecord> = {}): TournamentRecord {
  return {
    _id: 't', slug: 's', state: 'published',
    translations: { fa: { name: 'ن', summary: 's', description: '', seoTitle: '', seoDescription: '' }, en: { name: 'N', summary: 's', description: '', seoTitle: '', seoDescription: '' } },
    gameId: 'g', participantType: 'individual', capacity: 16,
    registration: { opensAt: null, closesAt: null }, schedule: { startAt: null, endAt: null },
    format: 'single_elimination', ruleProfile: { kind: 'custom', text: { fa: '', en: '' } },
    approvalMode: 'automatic', waitlistMode: 'disabled',
    eligibility: { minAge: null, requireCompleteProfile: false, requireGameIdentity: false },
    questionSet: { version: 0, questions: [] }, fee: { kind: 'free', components: [] },
    refundPolicy: { kind: 'no_refund', text: { fa: '', en: '' } }, prizes: { version: 0, placements: [] },
    version: 1, organizerId: 'o', createdAt: 'x', updatedAt: 'x', publishedAt: 'x', cancelledAt: null,
    ...overrides
  };
}

function facts(overrides: Partial<EligibilityFacts> = {}): EligibilityFacts {
  return { tournament: tournament(), now: new Date('2026-09-05T00:00:00.000Z'), participantType: 'individual', hasCompleteProfile: true, age: 25, hasGameIdentity: true, ...overrides };
}

describe('eligibility (TOURN-008)', () => {
  test('an eligible individual has no problems', () => {
    assert.equal(eligibilityProblems(facts()).length, 0);
  });
  test('participant type must match', () => {
    const p = eligibilityProblems(facts({ participantType: 'team' }));
    assert.equal(p[0]?.code, 'PARTICIPANT_TYPE_MISMATCH');
  });
  test('registration window is enforced', () => {
    const t = tournament({ registration: { opensAt: '2026-09-10T00:00:00.000Z', closesAt: '2026-09-20T00:00:00.000Z' } });
    assert.ok(eligibilityProblems(facts({ tournament: t })).some((x) => x.code === 'REGISTRATION_NOT_OPEN'));
    const t2 = tournament({ registration: { opensAt: '2026-09-01T00:00:00.000Z', closesAt: '2026-09-02T00:00:00.000Z' } });
    assert.ok(eligibilityProblems(facts({ tournament: t2 })).some((x) => x.code === 'REGISTRATION_CLOSED'));
  });
  test('profile, age, and game identity requirements', () => {
    const t = tournament({ eligibility: { minAge: 18, requireCompleteProfile: true, requireGameIdentity: true } });
    const p = eligibilityProblems(facts({ tournament: t, hasCompleteProfile: false, age: 15, hasGameIdentity: false })).map((x) => x.code);
    assert.ok(p.includes('PROFILE_REQUIRED'));
    assert.ok(p.includes('BELOW_MINIMUM_AGE'));
    assert.ok(p.includes('GAME_IDENTITY_REQUIRED'));
  });
});

describe('answers (TOURN-007)', () => {
  const qs = { version: 3, questions: [
    { key: 'handle', prompt: { fa: 'ه', en: 'Handle' }, type: 'short_text' as const, required: true, options: [] },
    { key: 'region', prompt: { fa: 'م', en: 'Region' }, type: 'single_choice' as const, required: true, options: [{ fa: 'ا', en: 'EU' }, { fa: 'ب', en: 'NA' }] }
  ] };
  test('valid answers are stamped with the question version', () => {
    const r = buildAnswers(qs, [{ key: 'handle', value: 'x' }, { key: 'region', value: '1' }]);
    assert.equal(r.version, 3);
    assert.equal(r.answers.length, 2);
  });
  test('a missing required answer is rejected', () => {
    assert.throws(() => buildAnswers(qs, [{ key: 'handle', value: 'x' }]));
  });
  test('an out-of-range choice index is rejected', () => {
    assert.throws(() => buildAnswers(qs, [{ key: 'handle', value: 'x' }, { key: 'region', value: '5' }]));
  });
});
