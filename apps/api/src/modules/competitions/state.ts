import type { EntityId } from '../../shared/ids.ts';
import type { BracketSide, EngineFormat } from './engine.ts';
import type { StandingRow, StandingsStatus } from './standings.ts';

/**
 * Competition and match persistence contracts (BRACKET-001/003/016/018).
 *
 * A competition is generated once from a tournament's approved registrations; its
 * matches carry stable opaque ids and reference participants by their authoritative
 * registration, with the immutable registration-time roster snapshot for a team.
 */

export type CompetitionFormat = EngineFormat;
export type CompetitionState = 'generated' | 'in_progress' | 'completed';

/** A participant slot references the authoritative registration and its roster snapshot. */
export interface ParticipantRef {
  registrationId: EntityId;
  participantType: 'individual' | 'team';
  teamId: EntityId | null;
  /** Immutable registration-time roster snapshot for a team entry (TOURN-010). */
  rosterSnapshotId: EntityId | null;
}

export interface CompetitionRecord {
  _id: EntityId;
  tournamentId: EntityId;
  format: CompetitionFormat;
  /** The seed the bracket was generated from; regeneration with it is reproducible. */
  seed: string;
  legs: number;
  participantCount: number;
  /** Participants in seed order; the immutable roster snapshot travels with each. */
  participants: ParticipantRef[];
  state: CompetitionState;
  /** Swiss progression: how many rounds are planned and how many are generated so far. */
  swiss: { targetRounds: number; currentRound: number } | null;
  /** Correction/lock lifecycle (BRACKET-012): open → correction_limited → locked. */
  lockState: 'open' | 'correction_limited' | 'locked';
  /** Optimistic guard for lock transitions. */
  lockVersion: number;
  /** Monotonic calculation-version counter for standings projections. */
  standingsVersion: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Append-only standings projection snapshot (BRACKET-015). */
export interface StandingsSnapshotRecord {
  _id: EntityId;
  competitionId: EntityId;
  tournamentId: EntityId;
  format: CompetitionFormat;
  formatVersion: number;
  policyVersion: number;
  calculationVersion: number;
  /** Deterministic watermark of the source results this projection was calculated from. */
  sourceWatermark: number;
  status: StandingsStatus;
  /** Exactly one snapshot per competition is the current one. */
  current: boolean;
  rows: StandingRow[];
  /** Metadata only — never used to order standings. */
  calculatedAt: string;
}

/** Immutable record of a corrected match result (BRACKET-022, TOURN-022). */
export interface ResultCorrectionRecord {
  _id: EntityId;
  matchId: EntityId;
  competitionId: EntityId;
  tournamentId: EntityId;
  revisionNumber: number;
  priorWinner: EntityId | null;
  priorScoreA: number | null;
  priorScoreB: number | null;
  correctedWinner: EntityId;
  correctedScoreA: number | null;
  correctedScoreB: number | null;
  reason: string;
  actorId: EntityId;
  correlationId: string;
  createdAt: string;
}

export type MatchState = 'pending' | 'ready' | 'bye' | 'completed';

export interface MatchRecord {
  _id: EntityId;
  competitionId: EntityId;
  tournamentId: EntityId;
  format: CompetitionFormat;
  /** Deterministic logical key, unique within a competition (concurrency + graph identity). */
  key: string;
  bracket: BracketSide;
  round: number;
  index: number;
  slotA: ParticipantRef | null;
  slotB: ParticipantRef | null;
  /** A null slot that is permanently empty (a bye source), distinct from an awaiting slot. */
  slotAEmpty: boolean;
  slotBEmpty: boolean;
  state: MatchState;
  winner: ParticipantRef | null;
  scoreA: number | null;
  scoreB: number | null;
  /** Where the winner advances (single/double/manual); null for a final, round-robin, or Swiss match. */
  nextMatchId: EntityId | null;
  nextSlot: 'a' | 'b' | null;
  /** Where the loser drops (double elimination / manual); null means elimination. */
  loserNextMatchId: EntityId | null;
  loserNextSlot: 'a' | 'b' | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** A result may only be recorded for a match awaiting one (never a bye/pending/completed). */
export function canRecordResult(state: MatchState): boolean {
  return state === 'ready';
}
