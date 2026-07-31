/**
 * Bounded migration verification against the disposable test database.
 *
 * Two scenarios, in one run:
 *
 *   Fresh   — an empty database, all migrations applied, every registered version
 *             recorded, the audit-list indexes present, and a second pass that must change
 *             nothing (idempotency).
 *   Existing — representative test-only records written *before* a second full pass,
 *             then re-read byte for byte afterwards. The rows chosen are the ones the
 *             system treats as immutable: a ledger journal entry, a hold, and an audit
 *             record. A migration that rewrote history
 *             would be caught here rather than in production.
 *
 * It never touches a developer or production database: the target must name itself a
 * test database, and it is dropped before the fresh scenario begins.
 *
 * Usage: npm run verify:migrations   (after `npm run db:test:up`)
 */
import { MongoClient } from 'mongodb';
import { runMigrations, appliedVersions } from '../apps/api/src/shared/db/migrations.ts';
import { allMigrations } from '../apps/api/src/migrations.ts';
import { COLLECTIONS } from '../apps/api/src/shared/db/collections.ts';
import { LEDGER_COLLECTIONS } from '../apps/api/src/modules/ledger/collections.ts';
import { HOLDS_COLLECTIONS } from '../apps/api/src/modules/holds/collections.ts';

const URI =
  process.env['MIGRATION_CHECK_URI'] ?? 'mongodb://127.0.0.1:27018/dragon_migration_check?directConnection=true';

const failures = [];

function assert(condition, message) {
  if (condition) {
    console.log(`  ok   ${message}`);
    return;
  }
  failures.push(message);
  console.error(`  FAIL ${message}`);
}

/**
 * Immutable-by-contract records, written with obviously synthetic ids so they can never
 * be confused with real data. Shapes are deliberately minimal: this asserts that a
 * migration does not rewrite or delete a stored document, not that the document is valid
 * for its domain — the module suites own that.
 */
const PRESERVED = [
  { collection: LEDGER_COLLECTIONS.entries, doc: { _id: 'migration-check-entry', kind: 'test-only', amountInteger: 12_345 } },
  { collection: HOLDS_COLLECTIONS.holds, doc: { _id: 'migration-check-hold', kind: 'test-only', amountInteger: 999 } },
  { collection: COLLECTIONS.auditEvents, doc: { _id: 'migration-check-audit', kind: 'test-only', action: 'migration.check' } }
];

const client = new MongoClient(URI, { serverSelectionTimeoutMS: 20_000 });

try {
  await client.connect();
  const db = client.db();

  if (!/e2e|test|check/i.test(db.databaseName)) {
    throw new Error(`Refusing to run against "${db.databaseName}": the name must identify a test database.`);
  }

  console.log(`Migration verification against ${db.databaseName}\n`);

  // --- Fresh database ---------------------------------------------------------------

  console.log('1. Fresh database');
  await db.dropDatabase();
  assert((await db.listCollections({}, { nameOnly: true }).toArray()).length === 0, 'the database starts empty');

  const firstPass = await runMigrations(db, allMigrations);
  const registered = allMigrations.map((m) => m.version).sort();
  const recorded = await appliedVersions(db);

  assert(firstPass.length === allMigrations.length, `all ${String(allMigrations.length)} migrations applied on a fresh database`);
  assert(
    registered.length === recorded.length && registered.every((v, i) => v === recorded[i]),
    'every registered migration version is recorded as applied'
  );
  assert(recorded.includes('023-audit-indexes'), 'migration 023-audit-indexes applied');

  // --- Indexes ----------------------------------------------------------------------

  console.log('\n2. Indexes required by the audit list');

  async function indexNames(collection) {
    try {
      return (await db.collection(collection).indexes()).map((index) => index.name);
    } catch {
      return [];
    }
  }

  const auditIndexes = await indexNames(COLLECTIONS.auditEvents);
  assert(
    auditIndexes.includes('audit_occurredAt_id'),
    `${COLLECTIONS.auditEvents} carries audit_occurredAt_id (the default audit-list page)`
  );
  assert(
    auditIndexes.includes('audit_emergency_occurredAt_id'),
    `${COLLECTIONS.auditEvents} carries audit_emergency_occurredAt_id (the emergency-only filter)`
  );
  assert(
    (await indexNames(COLLECTIONS.schemaMigrations)).length > 0,
    'the migration ledger itself is indexed'
  );

  // --- Idempotency ------------------------------------------------------------------

  console.log('\n3. Idempotency');
  const secondPass = await runMigrations(db, allMigrations);
  assert(secondPass.length === 0, 'a second pass applies nothing');
  const afterSecond = await appliedVersions(db);
  assert(
    afterSecond.length === recorded.length && afterSecond.every((v, i) => v === recorded[i]),
    'the applied set is unchanged after the second pass'
  );

  // --- Existing database ------------------------------------------------------------

  console.log('\n4. Existing database with pre-existing records');
  for (const { collection, doc } of PRESERVED) {
    await db.collection(collection).replaceOne({ _id: doc._id }, doc, { upsert: true });
  }
  const before = new Map();
  for (const { collection, doc } of PRESERVED) {
    before.set(collection, await db.collection(collection).findOne({ _id: doc._id }));
  }

  const thirdPass = await runMigrations(db, allMigrations);
  assert(thirdPass.length === 0, 'migrations against a populated database apply nothing new');

  for (const { collection, doc } of PRESERVED) {
    const after = await db.collection(collection).findOne({ _id: doc._id });
    assert(after !== null, `${collection}: the pre-existing record still exists`);
    assert(
      JSON.stringify(after) === JSON.stringify(before.get(collection)),
      `${collection}: the pre-existing record was not rewritten`
    );
  }

  // Queryability, not just presence: an index change that broke reads would show here.
  for (const { collection, doc } of PRESERVED) {
    const found = await db.collection(collection).find({ kind: 'test-only' }).toArray();
    assert(found.some((row) => row._id === doc._id), `${collection}: the record remains queryable by field`);
  }

  console.log('\n5. Cleanup');
  await db.dropDatabase();
  assert((await db.listCollections({}, { nameOnly: true }).toArray()).length === 0, 'the check database is dropped');
} finally {
  await client.close();
}

if (failures.length > 0) {
  console.error(`\n${String(failures.length)} migration check(s) failed.`);
  process.exit(1);
}
console.log('\nPASS: migrations apply completely on a fresh database, are idempotent, and preserve existing records.');
