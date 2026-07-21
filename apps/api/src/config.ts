/**
 * Startup configuration for the Dragon API.
 *
 * Requirement notes:
 * - Section 32.3: configuration validation MUST fail startup when required values are missing.
 * - Section 34.5: safe defaults are allowed for development and test only.
 * - IMPLEMENTATION_DECISIONS.md section 8: MongoDB is addressed internally as `mongo:27017`.
 */

export const ENVIRONMENTS = ['development', 'test', 'production'] as const;

export type Environment = (typeof ENVIRONMENTS)[number];

export interface AppConfig {
  readonly env: Environment;
  readonly host: string;
  readonly port: number;
  readonly mongoUri: string;
}

/** Safe non-secret default used only outside production. */
const DEVELOPMENT_MONGO_URI = 'mongodb://mongo:27017/dragon';
const DEFAULT_PORT = 3000;
/** Containers must listen on all interfaces; the published surface is controlled by Compose. */
const DEFAULT_HOST = '0.0.0.0';

function parseEnvironment(raw: string | undefined, problems: string[]): Environment {
  if (raw === undefined || raw === '') return 'development';
  if ((ENVIRONMENTS as readonly string[]).includes(raw)) return raw as Environment;
  problems.push(`NODE_ENV must be one of ${ENVIRONMENTS.join(', ')} (received "${raw}")`);
  return 'development';
}

function parsePort(raw: string | undefined, problems: string[]): number {
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push(`PORT must be an integer between 1 and 65535 (received "${raw}")`);
    return DEFAULT_PORT;
  }
  return port;
}

function parseMongoUri(raw: string | undefined, env: Environment, problems: string[]): string {
  const value = raw ?? '';
  if (value === '') {
    // Production must never fall back to a guessed connection string.
    if (env === 'production') {
      problems.push('MONGODB_URI is required when NODE_ENV=production');
      return '';
    }
    return DEVELOPMENT_MONGO_URI;
  }
  if (!value.startsWith('mongodb://') && !value.startsWith('mongodb+srv://')) {
    problems.push('MONGODB_URI must start with mongodb:// or mongodb+srv://');
  }
  return value;
}

/**
 * Builds validated configuration. Throws with every problem at once so a
 * misconfigured deployment fails fast and loudly instead of degrading silently.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const problems: string[] = [];
  const env = parseEnvironment(source['NODE_ENV'], problems);
  const config: AppConfig = {
    env,
    host: source['HOST'] ?? DEFAULT_HOST,
    port: parsePort(source['PORT'], problems),
    mongoUri: parseMongoUri(source['MONGODB_URI'], env, problems)
  };

  if (problems.length > 0) {
    throw new Error(`Invalid configuration:\n- ${problems.join('\n- ')}`);
  }
  return config;
}
