import type { EntityId } from '../../shared/ids.ts';
import type { EngineFormat } from './engine.ts';

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
  state: CompetitionState;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type MatchState = 'pending' | 'ready' | 'bye' | 'completed';

export interface MatchRecord {
  _id: EntityId;
  competitionId: EntityId;
  tournamentId: EntityId;
  format: CompetitionFormat;
  round: number;
  index: number;
  slotA: ParticipantRef | null;
  slotB: ParticipantRef | null;
  state: MatchState;
  winner: ParticipantRef | null;
  scoreA: number | null;
  scoreB: number | null;
  /** Single-elimination advancement target; null for a final or round-robin match. */
  nextMatchId: EntityId | null;
  nextSlot: 'a' | 'b' | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** A result may only be recorded for a match awaiting one (never a bye/pending/completed). */
export function canRecordResult(state: MatchState): boolean {
  return state === 'ready';
}
