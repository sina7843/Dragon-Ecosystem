import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { swissPairKey, swissPairRound, type SwissPairingResult } from './swiss.ts';

/** Deterministic Swiss pairing invariants (BRACKET-004), validated by a multi-round play-out. */

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `p${String(i + 1).padStart(3, '0')}`);

/** Runs `rounds` Swiss rounds (deterministic winner = lexicographically smaller id, bye = win). */
function play(n: number, rounds: number): { perRound: SwissPairingResult[]; findings: string[] } {
  const order = ids(n);
  const wins = new Map<string, number>();
  const byeCounts = new Map<string, number>();
  const priorPairs = new Set<string>();
  const perRound: SwissPairingResult[] = [];
  const findings: string[] = [];

  for (let r = 1; r <= rounds; r += 1) {
    const priorSnapshot = new Set(priorPairs);
    const result = swissPairRound({ order, wins, priorPairs, byeCounts });
    perRound.push(result);

    const seen = new Set<string>();
    for (const [a, b] of result.pairs) {
      if (a === b) findings.push(`round ${String(r)}: self-play`);
      if (seen.has(a) || seen.has(b)) findings.push(`round ${String(r)}: duplicate participant`);
      seen.add(a);
      seen.add(b);
      if (!result.usedFallback && priorSnapshot.has(swissPairKey(a, b))) findings.push(`round ${String(r)}: avoidable rematch ${a}-${b}`);
      priorPairs.add(swissPairKey(a, b));
      wins.set(a < b ? a : b, (wins.get(a < b ? a : b) ?? 0) + 1);
    }
    if (result.bye !== null) {
      if (seen.has(result.bye)) findings.push(`round ${String(r)}: bye already playing`);
      byeCounts.set(result.bye, (byeCounts.get(result.bye) ?? 0) + 1);
      wins.set(result.bye, (wins.get(result.bye) ?? 0) + 1);
    }
    // Coverage: everyone appears exactly once (paired or bye).
    const covered = seen.size + (result.bye === null ? 0 : 1);
    if (covered !== n) findings.push(`round ${String(r)}: covered ${String(covered)} of ${String(n)}`);
    if (n % 2 === 1 && result.bye === null) findings.push(`round ${String(r)}: odd count without a bye`);
    if (n % 2 === 0 && result.bye !== null) findings.push(`round ${String(r)}: even count with a bye`);
  }
  return { perRound, findings };
}

describe('Swiss pairing (BRACKET-004)', () => {
  for (const n of [2, 4, 5, 6, 7, 8, 15, 16]) {
    test(`n=${String(n)}: valid pairings with rematch avoidance and fair byes over multiple rounds`, () => {
      const rounds = Math.min(n - 1, 5);
      const { perRound, findings } = play(n, rounds);
      assert.deepEqual(findings, [], 'no invariant violations');
      // Within the round-robin horizon, no fallback (rematch) should ever be needed.
      assert.ok(perRound.every((r) => !r.usedFallback), 'no avoidable rematches within n-1 rounds');
      // Byes stay fair: no participant receives a second bye while another has none.
      if (n % 2 === 1) {
        const byeRecipients = perRound.map((r) => r.bye);
        assert.equal(new Set(byeRecipients).size, byeRecipients.length, 'no repeated byes within the horizon');
      }
    });
  }

  test('first-round pairing is deterministic for the same seed order', () => {
    const a = swissPairRound({ order: ids(8), wins: new Map(), priorPairs: new Set(), byeCounts: new Map() });
    const b = swissPairRound({ order: ids(8), wins: new Map(), priorPairs: new Set(), byeCounts: new Map() });
    assert.deepEqual(a, b);
  });

  test('a deterministic fallback is used only when a rematch-free pairing is impossible', () => {
    // Four players exhaust distinct opponents after 3 rounds; a 4th must rematch.
    const { perRound } = play(4, 4);
    assert.ok(!perRound[0]?.usedFallback && !perRound[1]?.usedFallback && !perRound[2]?.usedFallback);
    assert.equal(perRound[3]?.usedFallback, true);
    // Deterministic: same run reproduces the fallback pairing.
    const again = play(4, 4);
    assert.deepEqual(perRound[3], again.perRound[3]);
  });
});
