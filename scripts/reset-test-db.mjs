/**
 * Drops the throwaway browser-suite database so every `npm run e2e` starts clean.
 *
 * The database was described as disposable but nothing ever disposed of it. By the time
 * DRAGON-29A measured it, it held 22,597 accounts and 90 collections of leftovers from
 * every previous run, which made two things worse at once: generated mobile numbers
 * collided with accounts from earlier runs often enough to reuse one about twice per
 * run, and shared, unbounded lists (the game selector, the moderation queue) were paged
 * against months of accumulated rows.
 *
 * The API recreates its schema on boot — `prepareDatabase` runs the migrations and the
 * system-configuration seed before it accepts traffic — so this must run before the
 * Playwright web servers start, which is why it lives in the root `e2e` script rather
 * than in a Playwright global setup (those run after the web servers are already up).
 */
import { MongoClient } from 'mongodb';

const URI = process.env['E2E_MONGODB_URI'] ?? 'mongodb://127.0.0.1:27018/dragon_e2e?directConnection=true';

const client = new MongoClient(URI, { serverSelectionTimeoutMS: 15_000 });
try {
  await client.connect();
  const db = client.db();
  // The override exists so the port or database name can move; it must never be able to
  // turn this into a drop of a real database.
  if (!/e2e|test/i.test(db.databaseName)) {
    throw new Error(`Refusing to drop "${db.databaseName}": the name must identify a test database.`);
  }
  const before = (await db.listCollections({}, { nameOnly: true }).toArray()).length;
  await db.dropDatabase();
  console.log(`reset ${db.databaseName}: dropped ${String(before)} collections`);
} finally {
  await client.close();
}
