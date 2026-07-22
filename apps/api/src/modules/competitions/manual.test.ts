import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildManual, validateManualGraph, type ManualGraphSpec } from './manual.ts';

/** Manual declarative-graph validation and safe propagation (BRACKET-005). */

function code(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return (error as { fieldErrors?: Array<{ code: string }> }).fieldErrors?.[0]?.code;
  }
}

const semisAndFinal = (): ManualGraphSpec => ({
  fixtures: [
    { key: 'sf1', seedA: 0, seedB: 3, winnerNext: { key: 'final', slot: 'a' }, loserNext: null },
    { key: 'sf2', seedA: 1, seedB: 2, winnerNext: { key: 'final', slot: 'b' }, loserNext: null },
    { key: 'final', seedA: null, seedB: null, winnerNext: null, loserNext: null }
  ]
});

describe('validateManualGraph', () => {
  test('accepts a valid acyclic graph and returns depths', () => {
    const depth = validateManualGraph(semisAndFinal(), 4);
    assert.equal(depth.get('sf1'), 1);
    assert.equal(depth.get('final'), 2);
  });

  test('rejects duplicate keys, missing refs, self-dependency, and invalid slot', () => {
    const dup = semisAndFinal();
    dup.fixtures[1]!.key = 'sf1';
    assert.equal(code(() => validateManualGraph(dup, 4)), 'DUPLICATE_FIXTURE_KEY');

    const missing = semisAndFinal();
    missing.fixtures[0]!.winnerNext = { key: 'nope', slot: 'a' };
    assert.equal(code(() => validateManualGraph(missing, 4)), 'MISSING_FIXTURE_REF');

    const selfDep = semisAndFinal();
    selfDep.fixtures[2]!.winnerNext = { key: 'final', slot: 'a' };
    assert.equal(code(() => validateManualGraph(selfDep, 4)), 'SELF_DEPENDENCY');
  });

  test('rejects cycles', () => {
    const spec: ManualGraphSpec = {
      fixtures: [
        { key: 'x', seedA: 0, seedB: null, winnerNext: { key: 'y', slot: 'a' }, loserNext: null },
        { key: 'y', seedA: null, seedB: 1, winnerNext: { key: 'x', slot: 'b' }, loserNext: null }
      ]
    };
    assert.equal(code(() => validateManualGraph(spec, 4)), 'CYCLIC_GRAPH');
  });

  test('rejects conflicting downstream writers', () => {
    const spec = semisAndFinal();
    spec.fixtures[1]!.winnerNext = { key: 'final', slot: 'a' }; // both semis write final.a
    assert.equal(code(() => validateManualGraph(spec, 4)), 'CONFLICTING_WRITER');
  });

  test('rejects an orphan slot with no source', () => {
    const spec = semisAndFinal();
    spec.fixtures[1]!.winnerNext = null; // final.b now has no writer and is not seeded
    assert.equal(code(() => validateManualGraph(spec, 4)), 'UNREACHABLE_FIXTURE');
  });

  test('rejects reusing a participant seed across fixtures (double-booking / downstream self-play)', () => {
    const spec: ManualGraphSpec = {
      fixtures: [
        { key: 'm1', seedA: 0, seedB: 1, winnerNext: { key: 'final', slot: 'a' }, loserNext: null },
        { key: 'm2', seedA: 0, seedB: 2, winnerNext: { key: 'final', slot: 'b' }, loserNext: null }, // seed 0 reused
        { key: 'final', seedA: null, seedB: null, winnerNext: null, loserNext: null }
      ]
    };
    assert.equal(code(() => validateManualGraph(spec, 4)), 'DUPLICATE_SEED_USE');
  });

  test('rejects a self-pairing and an out-of-range seed', () => {
    const selfPair = semisAndFinal();
    selfPair.fixtures[0]!.seedB = 0;
    assert.equal(code(() => validateManualGraph(selfPair, 4)), 'SELF_PAIR');

    const badSeed = semisAndFinal();
    badSeed.fixtures[0]!.seedA = 99;
    assert.equal(code(() => validateManualGraph(badSeed, 4)), 'INVALID_SEED_REF');
  });

  test('rejects a graph that is too large', () => {
    const many: ManualGraphSpec = { fixtures: Array.from({ length: 300 }, (_, i) => ({ key: `k${String(i)}`, seedA: 0, seedB: 1, winnerNext: null, loserNext: null })) };
    assert.equal(code(() => validateManualGraph(many, 4)), 'GRAPH_TOO_LARGE');
  });
});

describe('buildManual + safe propagation', () => {
  test('a result propagates only inside the validated graph', () => {
    const bracket = buildManual(semisAndFinal(), ['p0', 'p1', 'p2', 'p3']);
    const byKey = new Map(bracket.matches.map((m) => [m.key, { ...m }]));
    const final = byKey.get('final');
    assert.ok(final && final.a === null && final.b === null); // awaiting upstream

    // Simulate: sf1 winner → final.a, sf2 winner → final.b, all inside the graph.
    for (const key of ['sf1', 'sf2']) {
      const m = byKey.get(key);
      assert.ok(m && m.a !== null && m.b !== null); // both seeded → ready
      const winner = m.a as string;
      if (m.nextKey !== null && m.nextSlot !== null) {
        const target = byKey.get(m.nextKey);
        assert.ok(target, 'winnerNext stays inside the graph');
        if (m.nextSlot === 'a') target.a = winner; else target.b = winner;
      }
    }
    assert.equal(final.a, 'p0');
    assert.equal(final.b, 'p1');
  });
});
