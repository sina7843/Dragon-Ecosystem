/**
 * Deterministic Swiss pairing (BRACKET-004).
 *
 * Pairing policy (documented default, gated for rule-profile override): players are
 * grouped by accepted-result score (wins), ordered by score descending then seed
 * rank, and paired by a deterministic backtracking matching that avoids any prior
 * pairing when a rematch-free perfect matching exists, falling back deterministically
 * otherwise. An odd count gives one bye to the player with the fewest prior byes,
 * then the lowest score, then the lowest seed. The bye's scoring effect (a win by
 * default) is a rule-profile concern kept behind OD-006; see DECISIONS.md.
 *
 * This computes only the minimum ordering needed to pair; full standings and
 * tiebreaker presentation are DRAGON-09c.
 */

export interface SwissPairingInput {
  /** Participants in seed-rank order (index = rank; lower is a higher seed). */
  order: readonly string[];
  /** Accepted-result score per participant (wins; a bye counts per the configured effect). */
  wins: ReadonlyMap<string, number>;
  /** Prior opponents as `min|max` keys, to avoid rematches. */
  priorPairs: ReadonlySet<string>;
  /** How many byes each participant has already received (fair-bye selection). */
  byeCounts: ReadonlyMap<string, number>;
}

export interface SwissPairingResult {
  pairs: Array<[string, string]>;
  bye: string | null;
  /** True when a rematch-free perfect matching was impossible and a fallback was used. */
  usedFallback: boolean;
}

export function swissPairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function swissPairRound(input: SwissPairingInput): SwissPairingResult {
  const rank = new Map(input.order.map((id, i) => [id, i]));
  const wins = (id: string): number => input.wins.get(id) ?? 0;
  const byes = (id: string): number => input.byeCounts.get(id) ?? 0;

  let players = [...input.order];
  let bye: string | null = null;
  if (players.length % 2 === 1) {
    // Fair bye: fewest prior byes, then lowest score, then lowest seed (highest rank index).
    const candidates = [...players].sort(
      (x, y) => byes(x) - byes(y) || wins(x) - wins(y) || (rank.get(y) as number) - (rank.get(x) as number)
    );
    bye = candidates[0] as string;
    players = players.filter((p) => p !== bye);
  }

  // Score groups descending, then by seed rank ascending — deterministic order.
  players.sort((x, y) => wins(y) - wins(x) || (rank.get(x) as number) - (rank.get(y) as number));

  const attempt = (allowRematch: boolean): Array<[string, string]> | null => {
    const solve = (remaining: readonly string[]): Array<[string, string]> | null => {
      if (remaining.length === 0) return [];
      const first = remaining[0] as string;
      const rest = remaining.slice(1);
      for (const opp of rest) {
        if (!allowRematch && input.priorPairs.has(swissPairKey(first, opp))) continue;
        const sub = solve(rest.filter((p) => p !== opp));
        if (sub !== null) return [[first, opp], ...sub];
      }
      return null;
    };
    return solve(players);
  };

  const rematchFree = attempt(false);
  const pairs = rematchFree ?? (attempt(true) as Array<[string, string]>);
  return { pairs, bye, usedFallback: rematchFree === null };
}
