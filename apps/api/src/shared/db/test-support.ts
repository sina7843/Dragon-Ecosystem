import { randomUUID } from 'node:crypto';
import { Database } from './client.ts';

/**
 * Test database isolation (TEST-003).
 *
 * Every integration test run gets its own throwaway database on the disposable
 * test server started by `docker-compose.test.yml`, so runs never share state and
 * a failure cannot leave data behind for the next run.
 */

export const TEST_MONGO_URI =
  process.env['MONGODB_TEST_URI'] ?? 'mongodb://127.0.0.1:27018/?directConnection=true';

export interface TestDatabase {
  readonly database: Database;
  readonly name: string;
  dispose(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `dragon_test_${randomUUID().replaceAll('-', '')}`;
  const database = await Database.connect(TEST_MONGO_URI, name);

  return {
    database,
    name,
    async dispose() {
      await database.db.dropDatabase();
      await database.close();
    }
  };
}
