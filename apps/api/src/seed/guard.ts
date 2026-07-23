/**
 * Fail-closed safety gate for the development demo seeder (see DEMO_DATA.md).
 *
 * The seeder writes fictional data through real services. It must be impossible to
 * point it at anything but a clearly-marked local development database, so every guard
 * here refuses by default and only a database whose name proves it is a dev/demo/local
 * copy is allowed. None of this touches secrets — it inspects the database NAME only.
 */

export type SeedEnv = 'development' | 'test' | 'production' | string;

export interface SeedSafetyInput {
  readonly env: SeedEnv;
  readonly mongoUri: string;
}

/** The database name must contain "dragon" and at least one of these markers. */
const REQUIRED_NAME = /dragon/i;
const DEV_MARKERS = /(dev|demo|local)/i;

/**
 * Extracts the database name from a mongodb connection string.
 * `mongodb://host:27017/dragon_dev?replicaSet=rs0` -> `dragon_dev`.
 * Returns '' when no database path segment is present (which the caller treats as unsafe).
 */
export function databaseNameFromUri(uri: string): string {
  // Strip scheme, then take the path after the authority, then drop any query/options.
  const afterScheme = uri.replace(/^mongodb(\+srv)?:\/\//i, '');
  const slash = afterScheme.indexOf('/');
  if (slash === -1) return '';
  const path = afterScheme.slice(slash + 1);
  const name = path.split(/[?/]/)[0] ?? '';
  return decodeURIComponent(name).trim();
}

export class SeedRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedRefused';
  }
}

/**
 * Throws SeedRefused unless it is safe to seed. Safe requires ALL of:
 * - NODE_ENV is exactly "development" (production and test fail closed);
 * - the database name contains "dragon"; and
 * - the database name contains one of dev / demo / local.
 * Returns the validated database name on success.
 */
export function assertSeedAllowed(input: SeedSafetyInput): string {
  if (input.env !== 'development') {
    throw new SeedRefused(
      `demo seeder runs only when NODE_ENV=development (got "${String(input.env)}"). Refusing.`
    );
  }
  const name = databaseNameFromUri(input.mongoUri);
  if (!name) {
    throw new SeedRefused('could not determine the database name from MONGODB_URI. Refusing.');
  }
  if (!REQUIRED_NAME.test(name)) {
    throw new SeedRefused(`database "${name}" does not contain "dragon". Refusing (looks production-like).`);
  }
  if (!DEV_MARKERS.test(name)) {
    throw new SeedRefused(
      `database "${name}" is missing a dev/demo/local marker. ` +
        'Use a name like dragon_dev or dragon_demo so the production "dragon" database can never be seeded. Refusing.'
    );
  }
  return name;
}
