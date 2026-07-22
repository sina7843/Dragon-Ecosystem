import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { computeStandings, type AcceptedMatch, type StandingsInput } from './standings.ts';

/** Deterministic standings invariants (BRACKET-015). */

const rr = (a: string, b: string, winner: string): AcceptedMatch => ({ round: 1, bracket: 'round_robin', a, b, winner, bye: false, loserNextEliminates: false });
const elim = (round: number, a: string, b: string, winner: string, bracket = 'winners'): AcceptedMatch => ({ round, bracket, a, b, winner, bye: false, loserNextEliminates: true });

function rankOf(proj: ReturnType<typeof computeStandings>, id: string): number {
  return proj.rows.find((r) => r.participantId === id)?.rank ?? -1;
}

describe('round robin standings', () => {
  const order = ['p1', 'p2', 'p3', 'p4'];
  // p1 beats all; p2 beats p3,p4; p3 beats p4; → wins 3,2,1,0.
  const matches: AcceptedMatch[] = [rr('p1', 'p2', 'p1'), rr('p1', 'p3', 'p1'), rr('p1', 'p4', 'p1'), rr('p2', 'p3', 'p2'), rr('p2', 'p4', 'p2'), rr('p3', 'p4', 'p3')];
  const input: StandingsInput = { format: 'round_robin', order, matches, competitionComplete: true };

  test('points, played, and distinct ranks', () => {
    const proj = computeStandings(input);
    assert.equal(proj.status, 'final');
    assert.deepEqual(proj.rows.map((r) => r.participantId), ['p1', 'p2', 'p3', 'p4']);
    assert.deepEqual(proj.rows.map((r) => r.points), [3, 2, 1, 0]);
    assert.deepEqual(proj.rows.map((r) => r.rank), [1, 2, 3, 4]);
    assert.ok(proj.rows.every((r) => r.played === 3));
  });

  test('identical input produces identical output; input order does not matter', () => {
    const shuffled: StandingsInput = { ...input, matches: [...matches].reverse(), order: [...order].reverse() };
    assert.deepEqual(computeStandings(input), computeStandings({ ...shuffled, order }));
  });

  test('every participant appears exactly once, none unknown', () => {
    const proj = computeStandings(input);
    assert.equal(new Set(proj.rows.map((r) => r.participantId)).size, order.length);
    assert.ok(proj.rows.every((r) => order.includes(r.participantId)));
  });

  test('ties share a rank (competition ranking 1,2,2,4)', () => {
    // p2 and p3 both win exactly one of their mutual pair; construct a 4-way with a tie.
    const tie: AcceptedMatch[] = [rr('p1', 'p2', 'p1'), rr('p1', 'p3', 'p1'), rr('p1', 'p4', 'p1'), rr('p2', 'p3', 'p2'), rr('p4', 'p2', 'p4'), rr('p4', 'p3', 'p4')];
    // wins: p1=3, p4=2, p2=1, p3=0 → all distinct; adjust to force a tie:
    const tie2: AcceptedMatch[] = [rr('p1', 'p4', 'p1'), rr('p2', 'p3', 'p2'), rr('p1', 'p2', 'p1'), rr('p3', 'p4', 'p3'), rr('p1', 'p3', 'p1'), rr('p2', 'p4', 'p2')];
    // wins: p1=3, p2=2, p3=1, p4=0 still distinct. Use a direct 2-2 tie:
    void tie;
    const proj = computeStandings({ format: 'round_robin', order, matches: tie2, competitionComplete: true });
    // Force a real tie: p2 and p3 with equal points via a minimal set.
    const equal: AcceptedMatch[] = [rr('p1', 'p2', 'p1'), rr('p3', 'p4', 'p3'), rr('p1', 'p4', 'p1'), rr('p2', 'p3', 'p2')];
    // p1=2, p2=1, p3=1, p4=0 → p2,p3 tie at rank 2 (shared), p4 rank 4.
    const tied = computeStandings({ format: 'round_robin', order, matches: equal, competitionComplete: true });
    assert.equal(rankOf(tied, 'p1'), 1);
    assert.equal(rankOf(tied, 'p2'), 2);
    assert.equal(rankOf(tied, 'p3'), 2);
    assert.equal(rankOf(tied, 'p4'), 4);
    assert.ok(tied.rows.find((r) => r.participantId === 'p2')?.shared);
    void proj;
  });
});

describe('single elimination placement', () => {
  const order = ['p1', 'p2', 'p3', 'p4'];
  const matches: AcceptedMatch[] = [elim(1, 'p1', 'p4', 'p1'), elim(1, 'p2', 'p3', 'p2'), { ...elim(2, 'p1', 'p2', 'p1'), bracket: 'winners' }];

  test('champion, runner-up, and shared rank for the same elimination round', () => {
    const proj = computeStandings({ format: 'single_elimination', order, matches, competitionComplete: true });
    assert.equal(proj.rows.find((r) => r.participantId === 'p1')?.placement, 'champion');
    assert.equal(rankOf(proj, 'p1'), 1);
    assert.equal(proj.rows.find((r) => r.participantId === 'p2')?.placement, 'runner_up');
    assert.equal(rankOf(proj, 'p2'), 2);
    // p3 and p4 eliminated in round 1 → shared rank 3.
    assert.equal(rankOf(proj, 'p3'), 3);
    assert.equal(rankOf(proj, 'p4'), 3);
    assert.ok(proj.rows.find((r) => r.participantId === 'p3')?.shared);
  });

  test('an in-progress competition is provisional with active participants', () => {
    const partial = computeStandings({ format: 'single_elimination', order, matches: [elim(1, 'p1', 'p4', 'p1')], competitionComplete: false });
    assert.equal(partial.status, 'provisional');
    assert.ok(partial.rows.some((r) => r.placement === 'active'));
  });
});

describe('swiss and manual', () => {
  test('a Swiss bye scores as a win', () => {
    const order = ['p1', 'p2', 'p3'];
    const matches: AcceptedMatch[] = [
      { round: 1, bracket: 'swiss', a: 'p1', b: 'p2', winner: 'p1', bye: false, loserNextEliminates: false },
      { round: 1, bracket: 'swiss', a: 'p3', b: null, winner: 'p3', bye: true, loserNextEliminates: false }
    ];
    const proj = computeStandings({ format: 'swiss', order, matches, competitionComplete: false });
    assert.equal(proj.rows.find((r) => r.participantId === 'p3')?.points, 1);
    assert.equal(proj.rows.find((r) => r.participantId === 'p3')?.played, 1);
  });

  test('manual standings are partial and derived from wins only', () => {
    const order = ['p1', 'p2', 'p3', 'p4'];
    const matches: AcceptedMatch[] = [
      { round: 1, bracket: 'manual', a: 'p1', b: 'p2', winner: 'p1', bye: false, loserNextEliminates: false },
      { round: 1, bracket: 'manual', a: 'p3', b: 'p4', winner: 'p3', bye: false, loserNextEliminates: false }
    ];
    const proj = computeStandings({ format: 'manual', order, matches, competitionComplete: false });
    assert.equal(proj.status, 'provisional');
    assert.ok(proj.rows.every((r) => r.placement === 'ranked'));
    assert.equal(rankOf(proj, 'p1'), 1);
    assert.equal(rankOf(proj, 'p3'), 1); // p1, p3 both 1 win → shared rank 1
  });
});
