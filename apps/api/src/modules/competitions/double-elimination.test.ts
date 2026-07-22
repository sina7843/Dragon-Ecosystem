import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { generateDoubleElimination } from './double-elimination.ts';
import { seedOrder, type EngineMatch } from './engine.ts';

/**
 * Double-elimination invariants (BRACKET-002), validated by playing out the whole
 * bracket with a deterministic in-memory simulator that mirrors the service's
 * routing (winner → next, loser → losers bracket, empty-sibling → structural bye).
 */

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `p${String(i + 1).padStart(4, '0')}`);

interface SimMatch {
  key: string;
  bracket: string;
  round: number;
  a: string | null;
  b: string | null;
  aEmpty: boolean;
  bEmpty: boolean;
  state: 'pending' | 'ready' | 'bye' | 'completed';
  winner: string | null;
  nextKey: string | null;
  nextSlot: 'a' | 'b' | null;
  loserNextKey: string | null;
  loserNextSlot: 'a' | 'b' | null;
}

/** Plays the bracket to completion; returns champion, per-participant loss counts, and structural findings. */
function simulate(matches: EngineMatch[]): { champion: string; losses: Map<string, number>; findings: string[] } {
  const findings: string[] = [];
  const state = new Map<string, SimMatch>();
  for (const m of matches) {
    state.set(m.key, {
      key: m.key, bracket: m.bracket, round: m.round, a: m.a, b: m.b, aEmpty: m.aEmpty, bEmpty: m.bEmpty,
      state: m.bye ? 'bye' : m.a !== null && m.b !== null ? 'ready' : 'pending',
      winner: m.winner, nextKey: m.nextKey, nextSlot: m.nextSlot, loserNextKey: m.loserNextKey, loserNextSlot: m.loserNextSlot
    });
  }
  const losses = new Map<string, number>();
  const bump = (id: string): number => {
    const v = (losses.get(id) ?? 0) + 1;
    losses.set(id, v);
    return v;
  };

  const fill = (key: string | null, slot: 'a' | 'b' | null, id: string): void => {
    if (key === null || slot === null) return;
    const m = state.get(key);
    if (m === undefined) {
      findings.push(`dangling reference ${key}`);
      return;
    }
    if (slot === 'a') { m.a = id; m.aEmpty = false; } else { m.b = id; m.bEmpty = false; }
    const otherId = slot === 'a' ? m.b : m.a;
    const otherEmpty = slot === 'a' ? m.bEmpty : m.aEmpty;
    if (otherId !== null) m.state = 'ready';
    else if (otherEmpty) {
      // Sibling permanently empty → structural bye; advance without a loss.
      m.state = 'completed';
      m.winner = id;
      fill(m.nextKey, m.nextSlot, id);
    }
  };

  let guard = 0;
  for (;;) {
    const ready = [...state.values()].find((m) => m.state === 'ready');
    if (ready === undefined) break;
    if ((guard += 1) > 100_000) throw new Error('simulation did not terminate');
    const a = ready.a as string;
    const b = ready.b as string;
    if (a === b) findings.push(`self-play in ${ready.key}`);
    const winner = a < b ? a : b;
    const loser = a < b ? b : a;
    ready.state = 'completed';
    ready.winner = winner;
    const loserLosses = bump(loser);
    if (ready.loserNextKey === null && ready.bracket === 'losers' && loserLosses !== 2) {
      findings.push(`${loser} eliminated in losers bracket with ${String(loserLosses)} losses (expected 2)`);
    }
    fill(ready.nextKey, ready.nextSlot, winner);
    fill(ready.loserNextKey, ready.loserNextSlot, loser);
  }

  // No participant appears twice among the known slots of a single round.
  const byRound = new Map<number, string[]>();
  for (const m of state.values()) {
    const list = byRound.get(m.round) ?? [];
    for (const id of [m.a, m.b]) if (id !== null) list.push(id);
    byRound.set(m.round, list);
  }
  for (const [round, list] of byRound) {
    if (new Set(list).size !== list.length) findings.push(`duplicate participant in round ${String(round)}`);
  }

  const gf = state.get('gf');
  if (gf === undefined || gf.winner === null) throw new Error('grand final did not resolve');
  return { champion: gf.winner, losses, findings };
}

describe('double elimination generation and routing (BRACKET-002)', () => {
  for (const n of [2, 3, 4, 5, 6, 7, 8, 11, 16, 24, 32]) {
    test(`n=${String(n)}: valid bracket, correct routing, single champion`, () => {
      const bracket = generateDoubleElimination(seedOrder(ids(n), 'seed'));
      // References resolve.
      const keys = new Set(bracket.matches.map((m) => m.key));
      for (const m of bracket.matches) {
        if (m.nextKey !== null) assert.ok(keys.has(m.nextKey), `nextKey ${m.nextKey} exists`);
        if (m.loserNextKey !== null) assert.ok(keys.has(m.loserNextKey), `loserNextKey exists`);
        if (m.a !== null && m.b !== null) assert.notEqual(m.a, m.b, 'no self-play at generation');
      }
      // Every non-bye winners-bracket real match routes its loser somewhere.
      for (const m of bracket.matches) {
        if (m.bracket === 'winners' && !m.bye) assert.ok(m.loserNextKey !== null, `winners match ${m.key} routes its loser`);
      }
      const { champion, losses, findings } = simulate(bracket.matches);
      assert.deepEqual(findings, [], 'no invariant violations during play-out');
      assert.ok(champion.length > 0);
      // Champion has at most one loss (single grand final policy).
      assert.ok((losses.get(champion) ?? 0) <= 1, 'champion loses at most once');
      // No participant exceeds two losses.
      for (const [, l] of losses) assert.ok(l <= 2, 'no participant exceeds two losses');
    });
  }

  test('generation is deterministic for the same seeded input', () => {
    const seeded = seedOrder(ids(11), 'x');
    assert.deepEqual(generateDoubleElimination(seeded), generateDoubleElimination(seeded));
  });

  test('winners losers route to the losers bracket; losers-bracket losers are eliminated', () => {
    const bracket = generateDoubleElimination(seedOrder(ids(8), 's'));
    const losers = bracket.matches.filter((m) => m.bracket === 'losers');
    // Every losers-bracket fixture eliminates its loser (no loserNext).
    assert.ok(losers.every((m) => m.loserNextKey === null));
    // Every non-bye winners fixture that has a real match drops its loser into a losers fixture.
    const lbKeys = new Set(losers.map((m) => m.key));
    const wbReal = bracket.matches.filter((m) => m.bracket === 'winners' && !m.bye);
    assert.ok(wbReal.every((m) => m.loserNextKey !== null && lbKeys.has(m.loserNextKey)));
  });

  test('rejects fewer than two participants', () => {
    assert.throws(() => generateDoubleElimination(ids(1)));
  });
});
