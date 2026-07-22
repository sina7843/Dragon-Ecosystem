import { ValidationError, type FieldError } from '../../shared/errors.ts';
import type { Bracket, EngineMatch } from './engine.ts';

/**
 * Manual / custom competition as a validated declarative graph (BRACKET-005).
 *
 * The graph is data, never executable code (OD-006): each fixture is either seeded
 * from a participant or filled by exactly one upstream result, and its winner/loser
 * route to declared downstream slots. The graph is validated as an acyclic, fully
 * reachable structure with unique keys and no conflicting writers before anything
 * is generated, so a result can only ever propagate inside the validated graph.
 */

const MAX_FIXTURES = 256;
const MAX_DEPTH = 32;

export interface ManualTransition {
  key: string;
  slot: 'a' | 'b';
}

export interface ManualFixtureSpec {
  key: string;
  /** Participant seed index for slot A, or null when the slot is filled by an upstream result. */
  seedA: number | null;
  seedB: number | null;
  winnerNext: ManualTransition | null;
  loserNext: ManualTransition | null;
}

export interface ManualGraphSpec {
  fixtures: ManualFixtureSpec[];
}

function fail(code: string, message: string, field = 'graph'): never {
  throw new ValidationError('The custom competition graph is not valid.', [{ field, code, message } satisfies FieldError]);
}

/** Validates the graph and returns each fixture's topological depth (1-based round). */
export function validateManualGraph(spec: ManualGraphSpec, participantCount: number): Map<string, number> {
  const fixtures = spec.fixtures;
  if (fixtures.length === 0 || fixtures.length > MAX_FIXTURES) fail('GRAPH_TOO_LARGE', `Use between 1 and ${String(MAX_FIXTURES)} fixtures.`);

  const keys = new Set<string>();
  for (const f of fixtures) {
    if (keys.has(f.key)) fail('DUPLICATE_FIXTURE_KEY', `Fixture key ${f.key} is duplicated.`);
    keys.add(f.key);
  }

  const inRange = (s: number | null): boolean => s === null || (Number.isInteger(s) && s >= 0 && s < participantCount);
  const writers = new Map<string, number>(); // `${key}:${slot}` → number of upstream writers
  const byKey = new Map(fixtures.map((f) => [f.key, f]));
  // A participant enters the graph at most once; reusing a seed would double-book a
  // participant and could route the same participant into both slots of a later
  // fixture (self-play). Group/round-robin-style manual schedules with repeated
  // participants are out of scope for this slice (DRAGON-09b).
  const seedsUsed = new Set<number>();

  for (const f of fixtures) {
    if (!inRange(f.seedA) || !inRange(f.seedB)) fail('INVALID_SEED_REF', 'A participant seed reference is out of range.');
    if (f.seedA !== null && f.seedB !== null && f.seedA === f.seedB) fail('SELF_PAIR', 'A fixture cannot pit a participant against itself.');
    for (const s of [f.seedA, f.seedB]) {
      if (s === null) continue;
      if (seedsUsed.has(s)) fail('DUPLICATE_SEED_USE', `Participant seed ${String(s)} is used more than once.`);
      seedsUsed.add(s);
    }
    for (const t of [f.winnerNext, f.loserNext]) {
      if (t === null) continue;
      if (!byKey.has(t.key)) fail('MISSING_FIXTURE_REF', `Transition targets unknown fixture ${t.key}.`);
      if (t.slot !== 'a' && t.slot !== 'b') fail('INVALID_SLOT', 'A transition slot must be a or b.');
      if (t.key === f.key) fail('SELF_DEPENDENCY', `Fixture ${f.key} cannot depend on itself.`);
      const w = `${t.key}:${t.slot}`;
      writers.set(w, (writers.get(w) ?? 0) + 1);
    }
  }

  // Each slot is seeded XOR written by exactly one upstream transition.
  for (const f of fixtures) {
    for (const slot of ['a', 'b'] as const) {
      const seeded = (slot === 'a' ? f.seedA : f.seedB) !== null;
      const writerCount = writers.get(`${f.key}:${slot}`) ?? 0;
      if (writerCount > 1) fail('CONFLICTING_WRITER', `Slot ${slot} of ${f.key} has multiple writers.`);
      if (seeded && writerCount === 1) fail('CONFLICTING_WRITER', `Slot ${slot} of ${f.key} is both seeded and written.`);
      if (!seeded && writerCount === 0) fail('UNREACHABLE_FIXTURE', `Slot ${slot} of ${f.key} has no source.`);
    }
  }

  // Dependency edges: a writer fixture must be processed before the fixture it fills.
  const indegree = new Map(fixtures.map((f) => [f.key, 0]));
  const dependents = new Map<string, string[]>(fixtures.map((f) => [f.key, []]));
  for (const f of fixtures) {
    for (const t of [f.winnerNext, f.loserNext]) {
      if (t === null) continue;
      indegree.set(t.key, (indegree.get(t.key) as number) + 1);
      (dependents.get(f.key) as string[]).push(t.key);
    }
  }
  // Kahn topological order with depth (longest path).
  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const f of fixtures) if ((indegree.get(f.key) as number) === 0) { queue.push(f.key); depth.set(f.key, 1); }
  let processed = 0;
  while (queue.length > 0) {
    const key = queue.shift() as string;
    processed += 1;
    for (const next of dependents.get(key) as string[]) {
      depth.set(next, Math.max(depth.get(next) ?? 1, (depth.get(key) as number) + 1));
      indegree.set(next, (indegree.get(next) as number) - 1);
      if ((indegree.get(next) as number) === 0) queue.push(next);
    }
  }
  if (processed !== fixtures.length) fail('CYCLIC_GRAPH', 'The custom graph contains a cycle.');
  for (const [, d] of depth) if (d > MAX_DEPTH) fail('GRAPH_TOO_DEEP', `The graph exceeds the maximum depth of ${String(MAX_DEPTH)}.`);

  if (!fixtures.some((f) => f.winnerNext === null)) fail('NO_TERMINAL', 'The graph has no terminal (championship) fixture.');

  return depth;
}

/** Builds the manual competition fixtures after validation. */
export function buildManual(spec: ManualGraphSpec, participants: readonly string[]): Bracket {
  const depth = validateManualGraph(spec, participants.length);
  const matches: EngineMatch[] = spec.fixtures.map((f, index) => {
    const a = f.seedA === null ? null : (participants[f.seedA] as string);
    const b = f.seedB === null ? null : (participants[f.seedB] as string);
    return {
      key: f.key,
      bracket: 'manual',
      round: depth.get(f.key) as number,
      index,
      a,
      b,
      aEmpty: false,
      bEmpty: false,
      nextKey: f.winnerNext?.key ?? null,
      nextSlot: f.winnerNext?.slot ?? null,
      loserNextKey: f.loserNext?.key ?? null,
      loserNextSlot: f.loserNext?.slot ?? null,
      bye: false,
      winner: null
    };
  });
  const rounds = Math.max(...[...depth.values()], 1);
  return { format: 'manual', rounds, matches };
}
