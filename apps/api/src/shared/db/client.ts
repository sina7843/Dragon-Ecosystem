import { MongoClient, type ClientSession, type Db } from 'mongodb';

/**
 * MongoDB connection management and transaction helpers.
 *
 * Section 32.1 requires atomic transactions, which MongoDB provides only on a
 * replica set. Compose runs a single-node replica set (`rs0`) for this reason.
 */
export class Database {
  // Explicit fields rather than TypeScript parameter properties: Node runs these
  // sources directly via type stripping, which does not support that shorthand.
  readonly #client: MongoClient;
  readonly #database: Db;

  private constructor(client: MongoClient, database: Db) {
    this.#client = client;
    this.#database = database;
  }

  static async connect(uri: string, databaseName?: string): Promise<Database> {
    const client = new MongoClient(uri, {
      // Fail fast instead of queueing requests behind an unreachable server.
      serverSelectionTimeoutMS: 5_000,
      retryWrites: true
    });
    await client.connect();
    const database = databaseName === undefined ? client.db() : client.db(databaseName);
    return new Database(client, database);
  }

  get db(): Db {
    return this.#database;
  }

  /** Readiness probe dependency: cheap round trip, no heavy load (section 28.4). */
  async ping(): Promise<boolean> {
    const result = await this.#database.command({ ping: 1 });
    return result['ok'] === 1;
  }

  /**
   * Runs `work` inside a transaction. Every write that must land atomically with
   * its outbox event and audit row goes through here.
   */
  async withTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = this.#client.startSession();
    try {
      let result: T | undefined;
      let executed = false;
      await session.withTransaction(async () => {
        result = await work(session);
        executed = true;
      });
      if (!executed) throw new Error('Transaction body did not execute');
      return result as T;
    } finally {
      await session.endSession();
    }
  }

  async close(): Promise<void> {
    await this.#client.close();
  }
}
