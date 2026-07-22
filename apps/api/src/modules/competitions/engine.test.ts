import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  generateRoundRobin,
  generateSingleElimination,
  nextPowerOfTwo,
  seedOrder,
  seedSlots,
  type Bracket
} from './engine.ts';

/** Deterministic-engine invariants (BRACKET-001/003/008/009). Property/exhaustive over representative counts. */

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `p${String(i + 1).padStart(4, '0')}`);

describe('deterministic seeding (BRACKET-008)', () => {
  test('reproducible from the same inputs and independent of input order', () => {
    const a = seedOrder(ids(10), 'seed-1');
    const b = seedOrder([...ids(10)].reverse(), 'seed-1');
    assert.deepEqual(a, b);
    // Same participants, different seed → generally a different order.
    const c = seedOrder(ids(10), 'seed-2');
    assert.notDeepEqual(a, c);
    // It is a permutation of the input.
    assert.deepEqual([...a].sort(), ids(10).sort());
  });
  test('a manual order must be a permutation', () => {
    assert.deepEqual(seedOrder(ids(4), 's', ['p0002', 'p0001', 'p0004', 'p0003']), ['p0002', 'p0001', 'p0004', 'p0003']);
    assert.throws(() => seedOrder(ids(4), 's', ['p0001', 'p0001', 'p0003', 'p0004']));
    assert.throws(() => seedOrder(ids(4), 's', ['p0001', 'p0002']));
  });
});

describe('seed slots', () => {
  test('balanced seeding properties for every bracket size', () => {
    assert.deepEqual(seedSlots(2), [1, 2]);
    for (const size of [2, 4, 8, 16, 32, 64]) {
      const slots = seedSlots(size);
      // A permutation of 1..size.
      assert.deepEqual([...slots].sort((a, b) => a - b), Array.from({ length: size }, (_, i) => i + 1));
      // Top seed opens; each first-round pair is (seed s, seed size+1-s).
      assert.equal(slots[0], 1);
      for (let i = 0; i < size; i += 2) {
        assert.equal((slots[i] as number) + (slots[i + 1] as number), size + 1, 'each pair sums to size+1');
      }
      // Seeds 1 and 2 are in opposite halves, so they can only meet in the final.
      const seed2Index = slots.indexOf(2);
      assert.ok(seed2Index >= size / 2, 'seed 2 sits in the opposite half from seed 1');
    }
  });
  test('nextPowerOfTwo', () => {
    assert.equal(nextPowerOfTwo(2), 2);
    assert.equal(nextPowerOfTwo(3), 4);
    assert.equal(nextPowerOfTwo(1000), 1024);
  });
});

function filledSlots(m: { a: string | null; b: string | null }): string[] {
  return [m.a, m.b].filter((x): x is string => x !== null);
}

function assertNoDuplicatePerRound(bracket: Bracket): void {
  const byRound = new Map<number, string[]>();
  for (const m of bracket.matches) {
    const list = byRound.get(m.round) ?? [];
    list.push(...filledSlots(m));
    byRound.set(m.round, list);
  }
  for (const [, list] of byRound) {
    assert.equal(new Set(list).size, list.length, 'a participant must not appear twice in the same round');
  }
}

function assertNoSelfPlay(bracket: Bracket): void {
  for (const m of bracket.matches) {
    if (m.a !== null && m.b !== null) assert.notEqual(m.a, m.b, 'no participant may play itself');
  }
}

describe('single elimination (BRACKET-001/009)', () => {
  // Powers of two, non-powers, and the minimum.
  for (const n of [2, 3, 4, 5, 7, 8, 9, 16, 31, 32, 100, 1000]) {
    test(`n=${String(n)}: byes, uniqueness, and structure`, () => {
      const bracket = generateSingleElimination(ids(n));
      const size = nextPowerOfTwo(n);
      assert.equal(bracket.matches.length, size - 1, 'total matches = bracketSize - 1');
      // Every participant appears exactly once across round-1 slots.
      const roundOne = bracket.matches.filter((m) => m.round === 1).flatMap(filledSlots);
      assert.equal(new Set(roundOne).size, n);
      assert.equal(roundOne.length, n);
      // Byes count matches the deficit and are all in round 1.
      const byes = bracket.matches.filter((m) => m.bye);
      assert.equal(byes.length, size - n);
      assert.ok(byes.every((m) => m.round === 1 && m.winner !== null));
      assertNoSelfPlay(bracket);
      assertNoDuplicatePerRound(bracket);
      // Exactly one final with no successor.
      const finals = bracket.matches.filter((m) => m.nextKey === null);
      assert.equal(finals.length, 1);
      assert.equal(finals[0]?.round, bracket.rounds);
    });
  }

  test('generation is deterministic for the same seeded input', () => {
    const seeded = seedOrder(ids(11), 'x');
    assert.deepEqual(generateSingleElimination(seeded), generateSingleElimination(seeded));
  });

  test('rejects fewer than two participants', () => {
    assert.throws(() => generateSingleElimination(ids(1)));
  });
});

describe('round robin (BRACKET-003)', () => {
  function pairCounts(bracket: Bracket): Map<string, number> {
    const counts = new Map<string, number>();
    for (const m of bracket.matches) {
      if (m.a === null || m.b === null) continue;
      const key = [m.a, m.b].sort().join('|');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  for (const n of [2, 3, 4, 5, 6, 7, 8, 11, 12]) {
    test(`n=${String(n)}: every pair once, valid byes, no self-play`, () => {
      const bracket = generateRoundRobin(ids(n));
      const counts = pairCounts(bracket);
      const expectedPairs = (n * (n - 1)) / 2;
      assert.equal(counts.size, expectedPairs, 'every distinct pairing present');
      assert.ok([...counts.values()].every((c) => c === 1), 'each pairing exactly once per leg');
      assertNoSelfPlay(bracket);
      // Odd → exactly one bye per round; even → none.
      const byes = bracket.matches.filter((m) => m.bye);
      if (n % 2 === 1) {
        assert.equal(byes.length, n, 'one bye per round for an odd count');
        const roundsWithBye = new Set(byes.map((m) => m.round));
        assert.equal(roundsWithBye.size, n);
      } else {
        assert.equal(byes.length, 0);
      }
    });
  }

  test('multiple legs produce each pairing once per leg', () => {
    const bracket = generateRoundRobin(ids(4), 2);
    const counts = pairCounts(bracket);
    assert.ok([...counts.values()].every((c) => c === 2), 'each pairing exactly twice across two legs');
    assert.equal(bracket.rounds, 3 * 2);
  });

  test('is deterministic and rejects invalid legs', () => {
    assert.deepEqual(generateRoundRobin(ids(6)), generateRoundRobin(ids(6)));
    assert.throws(() => generateRoundRobin(ids(4), 0));
  });
});
