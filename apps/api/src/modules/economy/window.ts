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

  // No live window: open one already carrying this transfer. `upsert` on the primary key
  // means a concurrent opener collides rather than creating a second window.
  const expiresAt = new Date(now.getTime() + limits.windowSeconds * 1000);
  try {
    await collection.updateOne(
      { _id: key },
      { $set: { count: 1, amount, expiresAt } },
      { upsert: true }
    );
    return 'claimed';
  } catch {
    // A racing opener won. Retry the claim once against the window it created.
    const retried = await collection.findOneAndUpdate(
      {
        _id: key,
        expiresAt: { $gt: now },
        count: { $lte: limits.transfersPerWindow - 1 },
        amount: { $lte: limits.transferAmountPerWindow - amount }
      },
      { $inc: { count: 1, amount } },
      { returnDocument: 'after' }
    );
    return retried === null ? 'amount_exceeded' : 'claimed';
  }
}

/** Returns a claimed budget when the transfer is refused after the claim (REWARD-007). */
export async function releaseTransferWindow(db: Db, senderId: string, amount: number): Promise<void> {
  await db
    .collection<WindowRecord>(ECONOMY_COLLECTIONS.transferWindows)
    .updateOne({ _id: `transfer_window:${senderId}` }, { $inc: { count: -1, amount: -amount } });
}
