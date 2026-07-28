/**
 * Spreads demo audit events across a realistic time window.
 *
 * A seed run writes every audit event within the same second, so the administration audit
 * list showed one timestamp for hundreds of rows: day grouping, relative time ("2 days
 * ago"), and the date-range filter all had nothing to distinguish. This step restamps
 * `occurredAt` so the same events land evenly across the preceding weeks.
 *
 * It is the one place the seeder writes an append-only collection, and it is deliberately
 * confined here: it runs last, changes only the timestamp (never an actor, action, or
 * payload), and preserves the original ordering — event N stays before event N+1. Only the
 * development demo seeder calls it; the seeder itself refuses to run outside a development
 * database (see guard.ts). Anchoring the window to UTC midnight keeps it idempotent: reruns
 * on the same day compute the identical timestamps and write nothing.
 */
import type { SeedSummary } from './harness.ts';
import type { Services } from './wiring.ts';

const WINDOW_DAYS = 45;
const DAY = 86_400_000;

export async function seedAuditTimeline(services: Services, summary: SeedSummary): Promise<void> {
  const events = services.db.collection<{ _id: string; occurredAt: string }>('audit_events');
  const rows = await events.find({}, { projection: { _id: 1, occurredAt: 1 } }).sort({ occurredAt: 1, _id: 1 }).toArray();
  if (rows.length < 2) return;

  const end = Math.floor(Date.now() / DAY) * DAY; // UTC midnight — stable within the day
  const start = end - WINDOW_DAYS * DAY;
  const step = (end - start) / (rows.length - 1);

  const operations = [];
  for (const [index, row] of rows.entries()) {
    const occurredAt = new Date(Math.round(start + index * step)).toISOString();
    if (row.occurredAt === occurredAt) continue;
    operations.push({ updateOne: { filter: { _id: row._id }, update: { $set: { occurredAt } } } });
  }
  if (operations.length > 0) await events.bulkWrite(operations, { ordered: false });
  summary.record('audit timeline', operations.length, rows.length - operations.length);
}
