/**
 * Development demo-data seeder (see DEMO_DATA.md).
 *
 * Usage (inside the dev API container, compiled):
 *   node apps/api/dist/seed-demo.js            # idempotent populate
 *   node apps/api/dist/seed-demo.js --reset --confirm   # remove demo-owned rows, then repopulate
 *
 * Safety: refuses unless NODE_ENV=development AND the database name proves it is a
 * dev/demo/local copy (see seed/guard.ts). Never runs on startup, never exposes an HTTP
 * route, never prints OTP codes or secrets, and reaches domain state only through the
 * real application services.
 */
import { loadConfig } from './config.ts';
import { Database } from './shared/db/client.ts';
import { AppError } from './shared/errors.ts';
import { prepareDatabase } from './server.ts';
import { assertSeedAllowed, SeedRefused } from './seed/guard.ts';
import { SeedSummary } from './seed/harness.ts';
import { DemoRegistry, resetDemo } from './seed/registry.ts';
import { buildServices } from './seed/wiring.ts';
import { seedUsers } from './seed/users.ts';
import { seedCatalog } from './seed/catalog.ts';
import { seedCommunity } from './seed/community.ts';
import { seedTournaments, seedRegistrations } from './seed/tournaments.ts';
import { seedEconomy } from './seed/economy.ts';
import { seedEngagement } from './seed/engagement.ts';
import { seedMedia } from './seed/media.ts';
import { seedCompetitions } from './seed/competitions.ts';

interface Options {
  readonly reset: boolean;
  readonly confirm: boolean;
}

function parseOptions(argv: readonly string[]): Options {
  return { reset: argv.includes('--reset'), confirm: argv.includes('--confirm') };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const config = loadConfig();

  // Fail closed before opening any connection.
  let dbName: string;
  try {
    dbName = assertSeedAllowed({ env: config.env, mongoUri: config.mongoUri });
  } catch (error) {
    if (error instanceof SeedRefused) {
      console.error(`Demo seeder refused: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const database = await Database.connect(config.mongoUri);
  const summary = new SeedSummary();

  try {
    await prepareDatabase(database);
    const services = buildServices(database, config);
    const registry = new DemoRegistry(database.db);
    await registry.ensureIndex();

    if (options.reset) {
      if (!options.confirm) {
        console.error('Refused: --reset requires --confirm. Nothing was changed.');
        process.exitCode = 1;
        return;
      }
      const report = await resetDemo(database.db, registry);
      const resetTotal = Object.values(report.mutableReset).reduce((a, b) => a + b, 0);
      const cascadeTotal = Object.values(report.cascadeReset).reduce((a, b) => a + b, 0);
      console.log('Reset (development-only, immutable history never deleted):');
      console.log(`  mutable demo records reset: ${resetTotal}`);
      for (const [name, n] of Object.entries(report.mutableReset)) if (n > 0) console.log(`    ${name}: ${n}`);
      if (cascadeTotal > 0) {
        console.log(`  dependent editorial rows reset: ${cascadeTotal}`);
        for (const [name, n] of Object.entries(report.cascadeReset)) if (n > 0) console.log(`    ${name}: ${n}`);
      }
      console.log(`  immutable / append-only demo records preserved and reused: ${report.preserved}`);
    }

    console.log(`Seeding demo data into "${dbName}" (development)...`);
    const users = await seedUsers(services, registry, summary);
    const authorId = users.get('admin-content')?.accountId ?? users.get('admin-super')?.accountId;
    if (authorId === undefined) throw new Error('demo seed: no admin account to author catalog content');
    const catalog = await seedCatalog(services, registry, summary, authorId);
    await seedMedia(services, registry, summary, catalog, authorId);
    await seedCommunity(services, registry, summary, users, catalog);
    const tournaments = await seedTournaments(services, registry, summary, users, catalog);
    await seedRegistrations(services, summary, users, tournaments);
    await seedCompetitions(services, registry, summary, users, catalog);
    await seedEconomy(services, registry, summary, users);
    await seedEngagement(services, registry, summary, users);

    console.log('\nDemo data summary (records newly created vs reused):');
    for (const line of summary.lines()) console.log(line);
    console.log('\nOpen the app at: http://localhost:8080');
    console.log('Sign in with any demo mobile (see DEMO_DATA.md). Request the OTP through the normal');
    console.log('sign-in screen, then read the code from the dev SMS inbox — no code is printed here.');
  } catch (error) {
    console.error(`Demo seed failed: ${error instanceof AppError ? error.message : String(error)}`);
    if (!(error instanceof AppError)) console.error(error);
    process.exitCode = 1;
  } finally {
    await database.close();
  }
}

await main();
