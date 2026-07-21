/**
 * Explicit release step for database migrations and the system seed (section 34.4).
 *
 * Usage: npm run migrate --workspace @dragon/api
 * The same work runs as a controlled startup job, so this entry point exists for
 * deployments that apply schema changes before activating the new application.
 */
import { loadConfig } from './config.ts';
import { Database } from './shared/db/client.ts';
import { appliedVersions } from './shared/db/migrations.ts';
import { prepareDatabase } from './server.ts';

const config = loadConfig();
const database = await Database.connect(config.mongoUri);

try {
  const applied = await prepareDatabase(database);
  const all = await appliedVersions(database.db);
  console.log(applied.length === 0 ? 'No new migrations.' : `Applied: ${applied.join(', ')}`);
  console.log(`Schema versions present: ${all.join(', ')}`);
} finally {
  await database.close();
}
