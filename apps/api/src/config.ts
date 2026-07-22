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

export interface PaymentsConfig {
  /**
   * Whether the deterministic mock payment provider and its test-control route are
   * active. Fail-closed: never true in production unless PAYMENTS_MOCK_ENABLED is
   * explicitly set, so production cannot accidentally expose the mock pay control.
   */
  readonly mockEnabled: boolean;
  /** HMAC key that authenticates provider callbacks. Never logged, never sent to a client. */
  readonly callbackSecret: string;
  /** How long a created purchase stays payable before it expires. */
  readonly purchaseTtlSeconds: number;
}

export interface AppConfig {
  readonly env: Environment;
  readonly host: string;
  readonly port: number;
  readonly mongoUri: string;
  readonly auth: AuthConfig;
  readonly payments: PaymentsConfig;
  /**
   * OD-007 feature gate for paid tournament registration checkout. Fail-closed:
   * paid checkout stays disabled everywhere unless PAID_TOURNAMENTS_ENABLED=true is
   * explicitly set (kept off until fee/payout templates are approved). Free
   * tournaments are unaffected.
   */
  readonly paidTournamentsEnabled: boolean;
  /**
   * Notification channel gates. Fail-closed under OD-008 (only security-essential
   * mock SMS — OTP — is active; tournament SMS stays off) and OD-003 (transactional
   * email stays off): both default false and only turn on with an explicit `true`.
   * In-app notifications are always active and need no gate.
   */
  readonly notificationsSmsEnabled: boolean;
  readonly notificationsEmailEnabled: boolean;
  /**
   * OD-026 gate. Analytics events are always recorded to the internal sink; this only
   * governs whether they are also forwarded to an external tracker. Fail-closed: off
   * unless ANALYTICS_EXTERNAL_ENABLED is exactly `true`, so no external tracker is
   * activated until the decision is made.
   */
  readonly analyticsExternalEnabled: boolean;
  /**
   * Secret salt for analytics pseudonymization (OD-026). Separate from AUTH_SECRET and
   * the payment callback secret (secrets are never reused across security functions).
   * Required and length-checked in production so a real deployment never pseudonymizes
   * with a public, source-committed salt; a development placeholder is used otherwise.
   */
  readonly pseudonymSalt: string;
  /**
   * Maximum accepted media upload size in bytes (MEDIA-001). Enforced on the decoded
   * bytes before any validation, so an oversize payload is rejected up front.
   */
  readonly mediaMaxBytes: number;
  /**
   * Absolute public origin used to build sitemap/robots/canonical URLs on the server
   * (SEO-005/006). Empty falls back to a relative sitemap; set to the real origin in
   * production so crawlers receive absolute locations.
   */
  readonly publicOrigin: string;
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

/** Development-only placeholder; production startup fails without a real callback secret. */
const DEVELOPMENT_PAYMENTS_CALLBACK_SECRET = 'development-only-insecure-payments-callback-secret';

/** Development-only placeholder; production startup fails without a real pseudonym salt. */
const DEVELOPMENT_PSEUDONYM_SALT = 'development-only-insecure-analytics-pseudonym-salt';

/**
 * Public origin for SEO URLs and, security-critically, the cross-origin (CSRF) request
 * allowlist. Required in production and must be an absolute http(s) origin — the CSRF
 * guard is inert without it, so a production deployment must not start without a real
 * origin to compare against. Empty is allowed only outside production (local/dev/test).
 */
function parsePublicOrigin(raw: string | undefined, env: Environment, problems: string[]): string {
  const value = (raw ?? '').replace(/\/+$/, '');
  if (value === '') {
    if (env === 'production') problems.push('PUBLIC_ORIGIN is required when NODE_ENV=production (SEO URLs and the cross-origin/CSRF guard)');
    return '';
  }
  if (!/^https?:\/\/[^/\s]+$/.test(value)) {
    problems.push('PUBLIC_ORIGIN must be an absolute origin such as https://dragon.example');
  }
  return value;
}

/** Fail-closed secret loader: required + length-checked in production, dev placeholder otherwise. */
function parseRequiredSecret(raw: string | undefined, env: Environment, name: string, devDefault: string, problems: string[]): string {
  const value = raw ?? '';
  if (value === '') {
    if (env === 'production') {
      problems.push(`${name} is required when NODE_ENV=production`);
      return '';
    }
    return devDefault;
  }
  if (value.length < MIN_SECRET_LENGTH) {
    problems.push(`${name} must be at least ${String(MIN_SECRET_LENGTH)} characters`);
  }
  return value;
}

/**
 * Payment configuration. Fail-closed on two fronts: the mock provider is never
 * active in production unless PAYMENTS_MOCK_ENABLED is explicitly set, and the
 * callback-verification secret is required and length-checked in production so a
 * real deployment cannot process unauthenticated provider callbacks.
 */
function parsePayments(source: NodeJS.ProcessEnv, env: Environment, problems: string[]): PaymentsConfig {
  const mockFlag = (source['PAYMENTS_MOCK_ENABLED'] ?? '').toLowerCase();
  const mockEnabled = env === 'production' ? mockFlag === 'true' : mockFlag !== 'false';

  const rawSecret = source['PAYMENTS_CALLBACK_SECRET'] ?? '';
  let callbackSecret = rawSecret;
  if (rawSecret === '') {
    if (env === 'production') {
      problems.push('PAYMENTS_CALLBACK_SECRET is required when NODE_ENV=production');
      callbackSecret = '';
    } else {
      callbackSecret = DEVELOPMENT_PAYMENTS_CALLBACK_SECRET;
    }
  } else if (rawSecret.length < MIN_SECRET_LENGTH) {
    problems.push(`PAYMENTS_CALLBACK_SECRET must be at least ${String(MIN_SECRET_LENGTH)} characters`);
  }

  return {
    mockEnabled,
    callbackSecret,
    purchaseTtlSeconds: parsePositiveInteger(source['PAYMENTS_PURCHASE_TTL_SECONDS'], 900, 'PAYMENTS_PURCHASE_TTL_SECONDS', problems)
  };
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
    // OD-007 fail-closed: paid tournament checkout is off unless explicitly enabled.
    paidTournamentsEnabled: (source['PAID_TOURNAMENTS_ENABLED'] ?? '').toLowerCase() === 'true',
    // OD-008 / OD-003 fail-closed: notification SMS and email channels are off unless explicitly enabled.
    notificationsSmsEnabled: (source['NOTIFICATIONS_SMS_ENABLED'] ?? '').toLowerCase() === 'true',
    notificationsEmailEnabled: (source['NOTIFICATIONS_EMAIL_ENABLED'] ?? '').toLowerCase() === 'true',
    // OD-026 fail-closed: no external analytics tracker unless explicitly enabled.
    analyticsExternalEnabled: (source['ANALYTICS_EXTERNAL_ENABLED'] ?? '').toLowerCase() === 'true',
    pseudonymSalt: parseRequiredSecret(source['ANALYTICS_PSEUDONYM_SALT'], env, 'ANALYTICS_PSEUDONYM_SALT', DEVELOPMENT_PSEUDONYM_SALT, problems),
    // MEDIA-001: default 5 MB cap on uploads; a valid positive override is honoured.
    mediaMaxBytes: parsePositiveInteger(source['MEDIA_MAX_BYTES'], 5_000_000, 'MEDIA_MAX_BYTES', problems),
    publicOrigin: parsePublicOrigin(source['PUBLIC_ORIGIN'], env, problems),
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
    },
    payments: parsePayments(source, env, problems)
  };

  if (problems.length > 0) {
    throw new Error(`Invalid configuration:\n- ${problems.join('\n- ')}`);
  }
  return config;
}
