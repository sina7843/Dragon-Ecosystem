import type { Db } from 'mongodb';
import { ECONOMY_COLLECTIONS } from './collections.ts';

/**
 * Atomic rolling-window counter for transfer limits (REWARD-007).
 *
 * A read-then-decide-then-write check is not a limit: two concurrent requests both read
 * the same pre-race totals, both conclude they fit, and both are admitted. This claims the
 * window in a single conditional update instead, so the *second* request finds the counter
 * already moved and is refused.
 *
 * The count and the amount share one document because they must be claimed together —
 * claiming one and failing the other would leave the window overstated for the loser.
 */

interface WindowRecord {
  _id: string;
  count: number;
  amount: number;
  expiresAt: Date;
}

export type WindowOutcome = 'claimed' | 'count_exceeded' | 'amount_exceeded';

export async function claimTransferWindow(
  db: Db,
  senderId: string,
  amount: number,
  limits: { transfersPerWindow: number; transferAmountPerWindow: number; windowSeconds: number }
): Promise<WindowOutcome> {
  const collection = db.collection<WindowRecord>(ECONOMY_COLLECTIONS.transferWindows);
  const now = new Date();
  const key = `transfer_window:${senderId}`;

  // One conditional update claims both budgets. It matches only while the window is live
  // *and* both remaining budgets cover this transfer, so a losing racer matches nothing.
  const claimed = await collection.findOneAndUpdate(
    {
      _id: key,
      expiresAt: { $gt: now },
      count: { $lte: limits.transfersPerWindow - 1 },
      amount: { $lte: limits.transferAmountPerWindow - amount }
    },
    { $inc: { count: 1, amount } },
    { returnDocument: 'after' }
  );
  if (claimed !== null) return 'claimed';

  // Either the window lapsed or a budget is exhausted. Read once to tell them apart, so
  // the caller can report which limit was hit rather than a generic refusal.
  const current = await collection.findOne({ _id: key, expiresAt: { $gt: now } });
  if (current !== null) {
    if (current.count + 1 > limits.transfersPerWindow) return 'count_exceeded';
    return 'amount_exceeded';
  }

  // No live window. Drop a lapsed one first so its stale totals are not inherited, then
  // open a new one by *incrementing* rather than assigning.
  //
  // Assigning `count: 1` here was wrong: two concurrent openers both found no live window
  // and both wrote 1, so one claim was silently lost and the window admitted an extra
  // transfer. `$inc` with `$setOnInsert` accumulates instead, so concurrent openers add up.
  await collection.deleteOne({ _id: key, expiresAt: { $lte: now } });
  const expiresAt = new Date(now.getTime() + limits.windowSeconds * 1000);
  const opened = await collection.findOneAndUpdate(
    { _id: key },
    { $inc: { count: 1, amount }, $setOnInsert: { expiresAt } },
    { upsert: true, returnDocument: 'after' }
  );

  // Read back rather than assume: a racer may have opened the window microseconds earlier,
  // in which case this increment landed on theirs and may have passed a budget.
  if (opened !== null && opened.count <= limits.transfersPerWindow && opened.amount <= limits.transferAmountPerWindow) {
    return 'claimed';
  }
  // Over budget: hand back exactly what this attempt added, so a refusal costs the sender
  // nothing and the counter still reflects only claims that were granted.
  //
  // Scoped to the exact window generation this attempt incremented. Matching on `_id`
  // alone would let a compensation delayed across a full expiry land on a *newer* window
  // that some other request had just opened, corrupting a budget this call never touched.
  // Filtering on `expiresAt` makes a stale compensation match nothing instead.
  if (opened !== null) {
    await collection.updateOne({ _id: key, expiresAt: opened.expiresAt }, { $inc: { count: -1, amount: -amount } });
  }
  if (opened !== null && opened.count > limits.transfersPerWindow) return 'count_exceeded';
  return 'amount_exceeded';
}

/** Returns a claimed budget when the transfer is refused after the claim (REWARD-007). */
export async function releaseTransferWindow(db: Db, senderId: string, amount: number): Promise<void> {
  await db
    .collection<WindowRecord>(ECONOMY_COLLECTIONS.transferWindows)
    .updateOne({ _id: `transfer_window:${senderId}` }, { $inc: { count: -1, amount: -amount } });
}
