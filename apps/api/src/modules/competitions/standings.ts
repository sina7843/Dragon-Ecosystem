import type { CompetitionFormat } from './state.ts';

/**
 * Deterministic standings projection (BRACKET-015). Standings are a pure function
 * of the accepted results, the seeded participant order, and the (versioned) points
 * policy — never of the wall clock, insertion order, or database natural order.
 *
 * Points policy (documented default, versioned; a richer rule-profile policy is
 * gated by OD-006): a win scores one point; draws are not produced by the current
 * single-winner result model. Round-robin and Swiss rank by points with the seeded
 * order as the sole stable final fallback; opponent-based tiebreaks (Buchholz and
 * similar) are kept gated. Elimination formats rank by bracket placement.
 */

export const STANDINGS_POLICY_VERSION = 1;

export type StandingsStatus = 'final' | 'provisional' | 'partial';

export interface StandingRow {
  participantId: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  /** Format-specific tiebreak inputs, all deterministic (no wall clock). */
  tiebreaks: Record<string, number>;
  rank: number;
  /** True when this participant shares its rank with another (an unbroken tie). */
  shared: boolean;
  placement: 'champion' | 'runner_up' | 'eliminated' | 'active' | 'ranked' | 'unresolved';
}

/** One accepted result (a completed match or a structural bye). */
export interface AcceptedMatch {
  round: number;
  bracket: string;
  a: string | null;
  b: string | null;
  winner: string | null;
  bye: boolean;
  loserNextEliminates: boolean;
}

export interface StandingsInput {
  format: CompetitionFormat;
  /** Participants in seed order (index = seed rank; the stable final fallback). */
  order: readonly string[];
  matches: readonly AcceptedMatch[];
  competitionComplete: boolean;
}

export interface StandingsProjection {
  rows: StandingRow[];
  status: StandingsStatus;
}

/**
 * Assigns competition ranking (1, 2, 2, 4): a row's rank is one plus the number of
 * rows strictly ahead of it. Ties share a rank; the seed order only fixes a stable
 * display order within a tie, never breaks the tie.
 */
function assignRanks(rows: Array<Omit<StandingRow, 'rank' | 'shared'>>, rankOf: (r: Omit<StandingRow, 'rank' | 'shared'>) => number, order: readonly string[]): StandingRow[] {
  const seedRank = new Map(order.map((id, i) => [id, i]));
  const withRank = rows.map((r) => ({ ...r, rank: 0, shared: false }));
  // Stable order: rank key descending, then seed order ascending.
  withRank.sort((x, y) => rankOf(y) - rankOf(x) || (seedRank.get(x.participantId) ?? 0) - (seedRank.get(y.participantId) ?? 0));
  for (const row of withRank) {
    const strictlyAhead = withRank.filter((o) => rankOf(o) > rankOf(row)).length;
    row.rank = strictlyAhead + 1;
    row.shared = withRank.filter((o) => rankOf(o) === rankOf(row)).length > 1;
  }
  return withRank;
}

/** Points-based standings for round robin, Swiss, and manual/custom. */
function pointsStandings(input: StandingsInput): StandingRow[] {
  const tally = new Map<string, { played: number; wins: number; losses: number }>();
  for (const id of input.order) tally.set(id, { played: 0, wins: 0, losses: 0 });

  for (const m of input.matches) {
    if (m.bye) {
      // A Swiss bye scores as a win (09b policy); a round-robin rest scores nothing.
      if (input.format === 'swiss' && m.winner !== null) {
        const t = tally.get(m.winner);
        if (t !== undefined) { t.played += 1; t.wins += 1; }
      }
      continue;
    }
    if (m.a === null || m.b === null || m.winner === null) continue;
    const loser = m.winner === m.a ? m.b : m.a;
    const tw = tally.get(m.winner);
    const tl = tally.get(loser);
    if (tw !== undefined) { tw.played += 1; tw.wins += 1; }
    if (tl !== undefined) { tl.played += 1; tl.losses += 1; }
  }

  const rows = input.order.map((id) => {
    const t = tally.get(id) as { played: number; wins: number; losses: number };
    return {
      participantId: id,
      played: t.played,
      wins: t.wins,
      draws: 0,
      losses: t.losses,
      points: t.wins,
      tiebreaks: { wins: t.wins },
      placement: 'ranked' as const
    };
  });
  return assignRanks(rows, (r) => r.points, input.order);
}

/** Placement standings for single/double elimination, by elimination depth. */
function placementStandings(input: StandingsInput): StandingRow[] {
  // A participant's elimination round is the round of the match they lost and were
  // eliminated by (a match whose loser is eliminated). Champion loses nothing.
  const lossRound = new Map<string, number>();
  const played = new Map<string, number>();
  const wins = new Map<string, number>();
  let championMatchRound = 0;
  let champion: string | null = null;

  for (const id of input.order) { played.set(id, 0); wins.set(id, 0); }
  for (const m of input.matches) {
    if (m.bye || m.a === null || m.b === null || m.winner === null) continue;
    const loser = m.winner === m.a ? m.b : m.a;
    played.set(m.winner, (played.get(m.winner) ?? 0) + 1);
    played.set(loser, (played.get(loser) ?? 0) + 1);
    wins.set(m.winner, (wins.get(m.winner) ?? 0) + 1);
    if (m.loserNextEliminates) lossRound.set(loser, m.round);
    if (m.bracket === 'grand_final' || (input.format === 'single_elimination' && m.round > championMatchRound)) {
      if (m.round >= championMatchRound) { championMatchRound = m.round; champion = m.winner; }
    }
  }
  // The final (championship) match: for single elimination it is the last round; for
  // double elimination it is the grand final.
  const finalWinner = input.competitionComplete ? champion : null;

  const scoreById = new Map<string, number>();
  const rows = input.order.map((id) => {
    const eliminated = lossRound.has(id);
    let placement: StandingRow['placement'] = 'active';
    let score = 0;
    if (finalWinner === id) { placement = 'champion'; score = Number.MAX_SAFE_INTEGER; }
    else if (eliminated) { placement = 'eliminated'; score = lossRound.get(id) as number; }
    else if (input.competitionComplete) { placement = 'eliminated'; score = 0; }
    scoreById.set(id, score);
    return {
      participantId: id,
      played: played.get(id) ?? 0,
      wins: wins.get(id) ?? 0,
      draws: 0,
      losses: eliminated ? (input.format === 'double_elimination' ? 2 : 1) : 0,
      points: wins.get(id) ?? 0,
      tiebreaks: { eliminationRound: eliminated ? (lossRound.get(id) as number) : 0 },
      placement
    };
  });
  const ranked = assignRanks(rows, (r) => scoreById.get(r.participantId) ?? 0, input.order);
  // Runner-up is the second-placed participant of a completed elimination.
  for (const r of ranked) if (r.rank === 2 && input.competitionComplete && r.placement === 'eliminated') r.placement = 'runner_up';
  return ranked;
}

export function computeStandings(input: StandingsInput): StandingsProjection {
  const isElimination = input.format === 'single_elimination' || input.format === 'double_elimination';
  const rows = isElimination ? placementStandings(input) : pointsStandings(input);

  let status: StandingsStatus;
  if (input.format === 'manual') status = input.competitionComplete ? 'partial' : 'provisional';
  else status = input.competitionComplete ? 'final' : 'provisional';
  if (input.format === 'manual') for (const r of rows) r.placement = 'ranked';

  return { rows, status };
}
