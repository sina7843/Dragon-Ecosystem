import { nextPowerOfTwo, seedSlots, type Bracket, type EngineMatch } from './engine.ts';

/**
 * Deterministic double-elimination generator (BRACKET-002).
 *
 * Winners bracket (WB) and losers bracket (LB) with deterministic routing: a WB
 * loser drops to a fixed LB fixture, an LB loser is eliminated (a second loss), and
 * both bracket champions meet in a single grand final.
 *
 * Grand-final policy (gated): this slice implements a SINGLE deciding grand final.
 * The bracket-reset variant (where the LB champion must beat the WB champion twice)
 * is defined by a rule profile, which OD-006 keeps gated (BRACKET-007); it is an
 * explicit decision gate, not an invented rule. See DECISIONS.md.
 *
 * Byes (non-power-of-two counts) are modelled with permanently-empty slots so they
 * advance structurally without counting as a loss.
 */

type Source =
  | { kind: 'participant'; id: string }
  | { kind: 'empty' }
  | { kind: 'winner'; key: string }
  | { kind: 'loser'; key: string };

type Value = { kind: 'p'; id: string } | { kind: 'empty' } | { kind: 'unknown' };

interface Fixture {
  key: string;
  bracket: 'winners' | 'losers' | 'grand_final';
  round: number;
  index: number;
  phase: number;
  srcA: Source;
  srcB: Source;
  nextKey: string | null;
  nextSlot: 'a' | 'b' | null;
  loserNextKey: string | null;
  loserNextSlot: 'a' | 'b' | null;
}

export function generateDoubleElimination(seeded: readonly string[]): Bracket {
  const n = seeded.length;
  if (n < 2) throw new Error('double elimination requires at least two participants');
  const size = nextPowerOfTwo(n);
  const w = Math.log2(size);
  const slots = seedSlots(size);
  const seedSource = (seedNumber: number): Source => (seedNumber <= n ? { kind: 'participant', id: seeded[seedNumber - 1] as string } : { kind: 'empty' });

  const fixtures: Fixture[] = [];
  const byKey = new Map<string, Fixture>();
  const add = (f: Fixture): void => {
    fixtures.push(f);
    byKey.set(f.key, f);
  };
  const gfKey = 'gf';

  // --- Winners bracket ---
  for (let i = 0; i < size / 2; i += 1) {
    add({
      key: `wb-r1-m${String(i)}`,
      bracket: 'winners',
      round: 1,
      index: i,
      phase: 1,
      srcA: seedSource(slots[2 * i] as number),
      srcB: seedSource(slots[2 * i + 1] as number),
      nextKey: w > 1 ? `wb-r2-m${String(Math.floor(i / 2))}` : gfKey,
      nextSlot: w > 1 ? (i % 2 === 0 ? 'a' : 'b') : 'a',
      loserNextKey: null,
      loserNextSlot: null
    });
  }
  for (let r = 2; r <= w; r += 1) {
    for (let i = 0; i < size / 2 ** r; i += 1) {
      add({
        key: `wb-r${String(r)}-m${String(i)}`,
        bracket: 'winners',
        round: r,
        index: i,
        phase: r,
        srcA: { kind: 'winner', key: `wb-r${String(r - 1)}-m${String(2 * i)}` },
        srcB: { kind: 'winner', key: `wb-r${String(r - 1)}-m${String(2 * i + 1)}` },
        nextKey: r < w ? `wb-r${String(r + 1)}-m${String(Math.floor(i / 2))}` : gfKey,
        nextSlot: r < w ? (i % 2 === 0 ? 'a' : 'b') : 'a',
        loserNextKey: null,
        loserNextSlot: null
      });
    }
  }

  // --- Losers bracket ---
  const routeLoser = (wbKey: string, targetKey: string, slot: 'a' | 'b'): void => {
    const f = byKey.get(wbKey) as Fixture;
    f.loserNextKey = targetKey;
    f.loserNextSlot = slot;
  };
  let lbFinalKey: string | null = null;
  let lbRound = 0;
  if (w >= 2) {
    // LB round 1: pair the winners-bracket first-round losers.
    lbRound = 1;
    let current: string[] = [];
    for (let j = 0; j < size / 4; j += 1) {
      const key = `lb-r1-m${String(j)}`;
      add({
        key,
        bracket: 'losers',
        round: w + 1,
        index: j,
        phase: w + 1,
        srcA: { kind: 'loser', key: `wb-r1-m${String(2 * j)}` },
        srcB: { kind: 'loser', key: `wb-r1-m${String(2 * j + 1)}` },
        nextKey: null,
        nextSlot: null,
        loserNextKey: null,
        loserNextSlot: null
      });
      routeLoser(`wb-r1-m${String(2 * j)}`, key, 'a');
      routeLoser(`wb-r1-m${String(2 * j + 1)}`, key, 'b');
      current.push(key);
    }
    for (let wbRound = 2; wbRound <= w; wbRound += 1) {
      // Receive round: previous LB winners meet the WB losers dropping from this round.
      lbRound += 1;
      const recv: string[] = [];
      for (let j = 0; j < current.length; j += 1) {
        const key = `lb-r${String(lbRound)}-m${String(j)}`;
        add({
          key,
          bracket: 'losers',
          round: w + lbRound,
          index: j,
          phase: w + lbRound,
          srcA: { kind: 'winner', key: current[j] as string },
          srcB: { kind: 'loser', key: `wb-r${String(wbRound)}-m${String(j)}` },
          nextKey: null,
          nextSlot: null,
          loserNextKey: null,
          loserNextSlot: null
        });
        const feeder = byKey.get(current[j] as string) as Fixture;
        feeder.nextKey = key;
        feeder.nextSlot = 'a';
        routeLoser(`wb-r${String(wbRound)}-m${String(j)}`, key, 'b');
        recv.push(key);
      }
      current = recv;
      if (wbRound < w) {
        // Consolidation round: pair the receive-round winners.
        lbRound += 1;
        const cons: string[] = [];
        for (let j = 0; j < current.length / 2; j += 1) {
          const key = `lb-r${String(lbRound)}-m${String(j)}`;
          add({
            key,
            bracket: 'losers',
            round: w + lbRound,
            index: j,
            phase: w + lbRound,
            srcA: { kind: 'winner', key: current[2 * j] as string },
            srcB: { kind: 'winner', key: current[2 * j + 1] as string },
            nextKey: null,
            nextSlot: null,
            loserNextKey: null,
            loserNextSlot: null
          });
          (byKey.get(current[2 * j] as string) as Fixture).nextKey = key;
          (byKey.get(current[2 * j] as string) as Fixture).nextSlot = 'a';
          (byKey.get(current[2 * j + 1] as string) as Fixture).nextKey = key;
          (byKey.get(current[2 * j + 1] as string) as Fixture).nextSlot = 'b';
          cons.push(key);
        }
        current = cons;
      }
    }
    lbFinalKey = current[0] as string;
  }

  // --- Grand final (single deciding match; reset variant gated) ---
  const wbFinalKey = `wb-r${String(w)}-m0`;
  add({
    key: gfKey,
    bracket: 'grand_final',
    round: w + lbRound + 1,
    index: 0,
    phase: w + lbRound + 1,
    srcA: { kind: 'winner', key: wbFinalKey },
    srcB: lbFinalKey === null ? { kind: 'loser', key: wbFinalKey } : { kind: 'winner', key: lbFinalKey },
    nextKey: null,
    nextSlot: null,
    loserNextKey: null,
    loserNextSlot: null
  });
  if (lbFinalKey !== null) {
    const f = byKey.get(lbFinalKey) as Fixture;
    f.nextKey = gfKey;
    f.nextSlot = 'b';
  } else {
    // Two-player double elimination: the winners-final loser is the grand-final challenger.
    routeLoser(wbFinalKey, gfKey, 'b');
  }

  return resolve(fixtures, gfKey, w, lbRound);
}

/** Resolves byes/empties deterministically and emits the persisted match structure. */
function resolve(fixtures: Fixture[], _gfKey: string, w: number, lbRound: number): Bracket {
  const winnerVal = new Map<string, Value>();
  const loserVal = new Map<string, Value>();
  const emitted = new Map<string, EngineMatch>();

  const resolveSource = (src: Source): Value => {
    switch (src.kind) {
      case 'participant':
        return { kind: 'p', id: src.id };
      case 'empty':
        return { kind: 'empty' };
      case 'winner':
        return winnerVal.get(src.key) ?? { kind: 'unknown' };
      case 'loser':
        return loserVal.get(src.key) ?? { kind: 'unknown' };
    }
  };

  for (const f of [...fixtures].sort((x, y) => x.phase - y.phase)) {
    const av = resolveSource(f.srcA);
    const bv = resolveSource(f.srcB);
    const pA = av.kind === 'p';
    const pB = bv.kind === 'p';
    const eA = av.kind === 'empty';
    const eB = bv.kind === 'empty';

    if (eA && eB) {
      // Wholly empty fixture: it produces no participant and is not persisted.
      winnerVal.set(f.key, { kind: 'empty' });
      loserVal.set(f.key, { kind: 'empty' });
      continue;
    }

    let bye = false;
    let winner: string | null = null;
    if (pA && eB) {
      bye = true;
      winner = (av as { id: string }).id;
      winnerVal.set(f.key, { kind: 'p', id: winner });
      loserVal.set(f.key, { kind: 'empty' });
    } else if (eA && pB) {
      bye = true;
      winner = (bv as { id: string }).id;
      winnerVal.set(f.key, { kind: 'p', id: winner });
      loserVal.set(f.key, { kind: 'empty' });
    } else {
      // A real (or still-pending) match: winner and loser are unknown at generation.
      winnerVal.set(f.key, { kind: 'unknown' });
      loserVal.set(f.key, { kind: 'unknown' });
    }

    emitted.set(f.key, {
      key: f.key,
      bracket: f.bracket,
      round: f.round,
      index: f.index,
      a: pA ? (av as { id: string }).id : null,
      b: pB ? (bv as { id: string }).id : null,
      aEmpty: eA,
      bEmpty: eB,
      nextKey: f.nextKey,
      nextSlot: f.nextSlot,
      loserNextKey: f.loserNextKey,
      loserNextSlot: f.loserNextSlot,
      bye,
      winner
    });
  }

  // Sanitize references to wholly-empty fixtures that were not persisted. These
  // only occur on bye matches (a real match's winner/loser always feeds a fixture
  // with a real source), and the service never routes a bye's loser anyway.
  for (const m of emitted.values()) {
    if (m.nextKey !== null && !emitted.has(m.nextKey)) { m.nextKey = null; m.nextSlot = null; }
    if (m.loserNextKey !== null && !emitted.has(m.loserNextKey)) { m.loserNextKey = null; m.loserNextSlot = null; }
  }

  return { format: 'double_elimination', rounds: w + lbRound + 1, matches: [...emitted.values()] };
}
