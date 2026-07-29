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

/**
 * The name check happens before anything connects, deliberately.
 *
 * The override exists so the port or database name can move; it must never be able to turn
 * this into a drop of a real database. Reading the name off the URI rather than off a live
 * `client.db()` means the refusal does not depend on a server being reachable — otherwise a
 * caller pointed at a production-shaped name would get a connection timeout instead of a
 * refusal, and could not tell a working guard from an absent one. CI relies on exactly that
 * distinction to prove the guard still works.
 */
function databaseNameFrom(uri) {
  // Parsed by pattern rather than with `new URL`, which rejects the comma-separated
  // multi-host form MongoDB allows. Fail closed: a string this cannot read a database name
  // out of is refused rather than guessed at.
  const match = /^mongodb(?:\+srv)?:\/\/[^/]*\/([^?]*)/.exec(uri);
  const name = decodeURIComponent(match?.[1] ?? '');
  if (name === '') {
    // Any credentials in the string are stripped before it reaches a log.
    throw new Error(`The connection string names no database: ${uri.replace(/\/\/[^@/]*@/, '//<redacted>@')}`);
  }
  return name;
}

const DATABASE = databaseNameFrom(URI);
if (!/e2e|test/i.test(DATABASE)) {
  throw new Error(`Refusing to drop "${DATABASE}": the name must identify a test database.`);
}

const client = new MongoClient(URI, { serverSelectionTimeoutMS: 15_000 });
try {
  await client.connect();
  const db = client.db();
  const before = (await db.listCollections({}, { nameOnly: true }).toArray()).length;
  await db.dropDatabase();
  console.log(`reset ${db.databaseName}: dropped ${String(before)} collections`);
} finally {
  await client.close();
}
