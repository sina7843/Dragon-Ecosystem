import type { Db } from 'mongodb';
import type { Database } from '../../shared/db/client.ts';
import type { EntityId } from '../../shared/ids.ts';
import { HOLDS_COLLECTIONS } from '../holds/index.ts';
import type { HoldRecord } from '../holds/index.ts';

/**
 * Detects hold-backed domain records that can no longer complete on their own.
 *
 * The gap this closes: store checkout and course enrolment commit the domain record —
 * claiming stock or a place — and only then reserve and capture the Dragon Coin. If the
 * process dies in that window, the record stays `pending_payment` forever with its
 * resource still claimed. In-process failures are already handled and tested; a dead
 * process is not, and nothing was watching for the result.
 *
 * **This detector never moves money and never repairs anything.** Every outcome here is a
 * finding for an operator. That is deliberate: the correct remedy differs per case and
 * several of them depend on policy nobody has approved — DEC-034 approves no return
 * workflow, so a captured-but-unfinished order has no agreed refund path. Guessing one
 * would be worse than surfacing the state. Where a remedy *is* unambiguous it still stays
 * out of here, because a repair endpoint that can touch money is the thing most likely to
 * be pointed at the wrong record.
 */

/** One stale domain record, as its own module describes it. */
export interface StaleReservation {
  id: EntityId;
  accountId: EntityId;
  /** The hold this record reserved, or null when it never got that far. */
  holdId: EntityId | null;
  state: string;
  createdAt: string;
  /** What the record claims, for the operator: stock units, a seat, a place on a course. */
  claim: string;
}

/**
 * What the detector needs from a module that reserves value against a domain record.
 *
 * Each module answers for its own records rather than the detector reaching into their
 * collections, so a new hold-backed workflow is added by supplying an adapter and nothing
 * in here changes.
 */
export interface ReservationSource {
  /** Stable workflow name, used in findings and alerts. */
  readonly workflow: string;
  /** Records still awaiting payment that were created before `olderThan`. */
  findStale(olderThan: string, limit: number): Promise<StaleReservation[]>;
}

export type StuckKind =
  /** Committed with its resource claimed, but no reservation was ever recorded. */
  | 'reservation_missing'
  /** The reservation is gone (released, expired, cancelled) and the record never finished. */
  | 'reservation_terminal'
  /** The money was taken and the record still never finished. */
  | 'captured_not_finalized'
  /** The reservation is still open but the record has sat far past its window. */
  | 'reservation_open_stale';

export type StuckSeverity = 'critical' | 'warning';

export interface StuckFinding {
  workflow: string;
  kind: StuckKind;
  severity: StuckSeverity;
  recordId: EntityId;
  accountId: EntityId;
  holdId: EntityId | null;
  holdState: string | null;
  recordState: string;
  claim: string;
  createdAt: string;
  /** Plain description of what is wrong, for an operator who did not write this code. */
  explanation: string;
}

const DEFAULT_STALE_SECONDS = 900;
const DEFAULT_LIMIT = 200;

/** Hold states that mean the reservation no longer holds anything. */
const RELEASED_STATES: ReadonlySet<string> = new Set(['released', 'expired', 'cancelled']);

export class StuckReservationDetector {
  readonly #db: Db;
  readonly #sources: readonly ReservationSource[];

  constructor(database: Database, sources: readonly ReservationSource[]) {
    this.#db = database.db;
    this.#sources = sources;
  }

  #holds() {
    return this.#db.collection<HoldRecord>(HOLDS_COLLECTIONS.holds);
  }

  /**
   * Read-only inspection. Returns what is stuck and why; changes nothing.
   *
   * Bounded by both an age threshold and a per-workflow limit, so it cannot turn into an
   * unbounded scan as the collections grow.
   */
  async inspect(options: { staleAfterSeconds?: number; limit?: number } = {}): Promise<{
    staleAfterSeconds: number;
    inspectedWorkflows: string[];
    findings: StuckFinding[];
  }> {
    const staleAfterSeconds = Math.max(60, options.staleAfterSeconds ?? DEFAULT_STALE_SECONDS);
    const limit = Math.min(1000, Math.max(1, options.limit ?? DEFAULT_LIMIT));
    const olderThan = new Date(Date.now() - staleAfterSeconds * 1000).toISOString();

    const findings: StuckFinding[] = [];
    for (const source of this.#sources) {
      const stale = await source.findStale(olderThan, limit);
      if (stale.length === 0) continue;

      // One query per workflow rather than one per record: the resolution must not become
      // an N+1 scan just because a lot of records are stuck at once.
      const holdIds = stale.map((row) => row.holdId).filter((id): id is EntityId => id !== null);
      const holds =
        holdIds.length === 0
          ? []
          : await this.#holds().find({ _id: { $in: holdIds } }, { projection: { _id: 1, state: 1, ownerId: 1, amount: 1 } }).toArray();
      const holdById = new Map(holds.map((hold) => [hold._id, hold]));

      for (const row of stale) {
        findings.push(this.#classify(source.workflow, row, row.holdId === null ? null : (holdById.get(row.holdId) ?? null)));
      }
    }

    return {
      staleAfterSeconds,
      inspectedWorkflows: this.#sources.map((s) => s.workflow),
      findings
    };
  }

  #classify(workflow: string, row: StaleReservation, hold: Pick<HoldRecord, '_id' | 'state' | 'ownerId'> | null): StuckFinding {
    const base = {
      workflow,
      recordId: row.id,
      accountId: row.accountId,
      holdId: row.holdId,
      holdState: hold?.state ?? null,
      recordState: row.state,
      claim: row.claim,
      createdAt: row.createdAt
    };

    if (row.holdId === null) {
      // The crash window itself: the resource is claimed and no money was ever reserved
      // against it. Nothing will ever complete this record.
      return {
        ...base,
        kind: 'reservation_missing',
        severity: 'critical',
        explanation: `The record claims ${row.claim} but no reservation was recorded, so it can never complete. The claim is held against nothing.`
      };
    }
    if (hold === null) {
      return {
        ...base,
        kind: 'reservation_missing',
        severity: 'critical',
        explanation: `The record references reservation ${row.holdId}, which does not exist. The claim is held against nothing.`
      };
    }
    // A hold whose owner is not the record's account means the two disagree about who is
    // paying — worth an operator's attention regardless of state.
    if (hold.ownerId !== row.accountId) {
      return {
        ...base,
        kind: 'reservation_missing',
        severity: 'critical',
        explanation: `The reservation belongs to a different account (${hold.ownerId}) than the record (${row.accountId}).`
      };
    }
    if (hold.state === 'captured' || hold.state === 'partially_captured') {
      // The worst case: the customer paid and the record never finished, so they hold
      // neither their money nor what they bought.
      return {
        ...base,
        kind: 'captured_not_finalized',
        severity: 'critical',
        explanation: `The reservation was captured but the record never finished. The account has paid and holds neither the money nor ${row.claim}.`
      };
    }
    if (RELEASED_STATES.has(hold.state)) {
      return {
        ...base,
        kind: 'reservation_terminal',
        severity: 'critical',
        explanation: `The reservation is ${hold.state} but the record is still ${row.state}, so ${row.claim} stays claimed with nothing reserving it.`
      };
    }
    return {
      ...base,
      kind: 'reservation_open_stale',
      severity: 'warning',
      explanation: `The reservation is still open but the record has been ${row.state} since ${row.createdAt}. It may be in flight, or it may have been abandoned.`
    };
  }
}

/**
 * Builds a source from a plain Mongo collection.
 *
 * Kept generic so a new hold-backed workflow supplies field names rather than code, and
 * so nothing here couples to store-only or education-only fields.
 */
export function collectionReservationSource(
  db: Db,
  input: {
    workflow: string;
    collection: string;
    /** Domain states that mean "still waiting for payment". */
    pendingStates: readonly string[];
    /** Field holding the reservation id; may be absent on older records. */
    holdField: string;
    accountField: string;
    /** Human description of what the record claims while pending. */
    claim: string;
  }
): ReservationSource {
  return {
    workflow: input.workflow,
    async findStale(olderThan, limit) {
      const rows = await db
        .collection<Record<string, unknown>>(input.collection)
        // Indexed on (state, createdAt) in every collection this is used with, so the
        // scan stays bounded rather than walking the collection.
        .find({ state: { $in: [...input.pendingStates] }, createdAt: { $lt: olderThan } })
        .sort({ createdAt: 1 })
        .limit(limit)
        .toArray();
      return rows.map((row) => ({
        id: String(row['_id']),
        accountId: String(row[input.accountField] ?? ''),
        holdId: (row[input.holdField] as string | null | undefined) ?? null,
        state: String(row['state'] ?? ''),
        createdAt: String(row['createdAt'] ?? ''),
        claim: input.claim
      }));
    }
  };
}
