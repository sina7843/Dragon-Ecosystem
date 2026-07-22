/**
 * Startup configuration for the Dragon API.
 *
 * Requirement notes:
 * - Section 32.3: configuration validation MUST fail startup when required values are missing.
 * - Section 34.5: safe defaults are allowed for development and test only.
 * - Section 16.1: OTP lifetime, resend interval, attempt count, and lockout are
 *   configurable security settings, so they live here rather than in code constants.
 * - IMPLEMENTATION_DECISIONS.md section 8: MongoDB is addressed internally as `mongo:27017`.
 */

export const ENVIRONMENTS = ['development', 'test', 'production'] as const;

export type Environment = (typeof ENVIRONMENTS)[number];

export interface AuthConfig {
  /** Keys OTP hashes and session-token hashes. Never logged, never sent to a client. */
  readonly secret: string;
  readonly otpTtlSeconds: number;
  readonly otpResendSeconds: number;
  readonly otpMaxAttempts: number;
  /** Fixed-window OTP request limits, separate from transactional SMS limits (SMS-005). */
  readonly otpRequestsPerMobile: number;
  readonly otpRequestsPerIp: number;
  readonly otpWindowSeconds: number;
  readonly sessionTtlHours: number;
  /** Window in which a session still counts as recently authenticated (AUTH-007). */
  readonly recentAuthMinutes: number;
}

export interface AppConfig {
  readonly env: Environment;
  readonly host: string;
  readonly port: number;
  readonly mongoUri: string;
  readonly auth: AuthConfig;
  /**
   * Reverse-proxy addresses whose `X-Forwarded-For` may be trusted (SEC-009).
   * Empty means trust nothing, so `request.ip` is the real socket peer — correct
   * for local development and tests where no proxy sits in front. In the Compose
   * production topology this is set to nginx's fixed address only, so a direct
   * client cannot supply a trusted forwarded-for header.
   */
  readonly trustedProxies: readonly string[];
  /**
   * Whether development-only privileged routes (notably the unauthenticated
   * `/api/v1/dev/grant-role`) are registered. Fail-closed: this is true only when
   * `ENABLE_DEV_ROUTES=true` is explicitly set AND the environment is not
   * production. Production never enables it regardless of the flag, so a missing
   * or stray flag can never expose the route in a real deployment.
   */
  readonly devRoutesEnabled: boolean;
}

/** Safe non-secret default used only outside production. */
const DEVELOPMENT_MONGO_URI = 'mongodb://mongo:27017/dragon';
/** Development-only placeholder; production startup fails without a real secret. */
const DEVELOPMENT_AUTH_SECRET = 'development-only-insecure-auth-secret';
const MIN_SECRET_LENGTH = 32;
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

function parseAuthSecret(raw: string | undefined, env: Environment, problems: string[]): string {
  const value = raw ?? '';
  if (value === '') {
    if (env === 'production') {
      problems.push('AUTH_SECRET is required when NODE_ENV=production');
      return '';
    }
    return DEVELOPMENT_AUTH_SECRET;
  }
  if (value.length < MIN_SECRET_LENGTH) {
    problems.push(`AUTH_SECRET must be at least ${String(MIN_SECRET_LENGTH)} characters`);
  }
  return value;
}

function parsePositiveInteger(
  raw: string | undefined,
  fallback: number,
  name: string,
  problems: string[]
): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    problems.push(`${name} must be a positive integer (received "${raw}")`);
    return fallback;
  }
  return value;
}

// IPv4 address, optionally with a CIDR suffix.
const IPV4_CIDR = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d|[12]\d|3[0-2]))?$/;
// Preset names accepted by the proxy-addr library Fastify uses.
const PROXY_PRESETS = new Set(['loopback', 'linklocal', 'uniquelocal']);

function isTrustedProxyEntry(entry: string): boolean {
  if (PROXY_PRESETS.has(entry)) return true;
  const match = IPV4_CIDR.exec(entry);
  if (match === null) return false;
  return [match[1], match[2], match[3], match[4]].every((octet) => Number(octet) <= 255);
}

/**
 * Parses the comma-separated trusted-proxy list. Each entry must be an IPv4
 * address, an IPv4 CIDR block, or a supported preset name, so a typo fails
 * startup rather than silently trusting nothing or everything.
 */
function parseTrustedProxies(raw: string | undefined, problems: string[]): string[] {
  if (raw === undefined || raw.trim() === '') return [];
  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');

  for (const entry of entries) {
    if (!isTrustedProxyEntry(entry)) {
      problems.push(`TRUSTED_PROXIES entry "${entry}" is not a valid IPv4 address, CIDR block, or preset`);
    }
  }
  return entries;
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
    mongoUri: parseMongoUri(source['MONGODB_URI'], env, problems),
    trustedProxies: parseTrustedProxies(source['TRUSTED_PROXIES'], problems),
    // Fail-closed: enabled only by an explicit flag, and never in production.
    devRoutesEnabled: env !== 'production' && (source['ENABLE_DEV_ROUTES'] ?? '').toLowerCase() === 'true',
    auth: {
      secret: parseAuthSecret(source['AUTH_SECRET'], env, problems),
      otpTtlSeconds: parsePositiveInteger(source['OTP_TTL_SECONDS'], 120, 'OTP_TTL_SECONDS', problems),
      otpResendSeconds: parsePositiveInteger(source['OTP_RESEND_SECONDS'], 60, 'OTP_RESEND_SECONDS', problems),
      otpMaxAttempts: parsePositiveInteger(source['OTP_MAX_ATTEMPTS'], 5, 'OTP_MAX_ATTEMPTS', problems),
      otpRequestsPerMobile: parsePositiveInteger(
        source['OTP_REQUESTS_PER_MOBILE'],
        5,
        'OTP_REQUESTS_PER_MOBILE',
        problems
      ),
      otpRequestsPerIp: parsePositiveInteger(source['OTP_REQUESTS_PER_IP'], 20, 'OTP_REQUESTS_PER_IP', problems),
      otpWindowSeconds: parsePositiveInteger(source['OTP_WINDOW_SECONDS'], 900, 'OTP_WINDOW_SECONDS', problems),
      sessionTtlHours: parsePositiveInteger(source['SESSION_TTL_HOURS'], 24 * 14, 'SESSION_TTL_HOURS', problems),
      recentAuthMinutes: parsePositiveInteger(source['RECENT_AUTH_MINUTES'], 15, 'RECENT_AUTH_MINUTES', problems)
    }
  };

  if (problems.length > 0) {
    throw new Error(`Invalid configuration:\n- ${problems.join('\n- ')}`);
  }
  return config;
}
