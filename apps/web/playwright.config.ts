import { cpus } from 'node:os';
import { defineConfig, devices } from '@playwright/test';

/**
 * Host ports for the suite. They stay 4173/3000 unless the environment says otherwise,
 * which is the escape hatch when the host has already reserved one: on Windows, WinNAT
 * claims dynamic ranges (2969-3068 and 7984-8083 have both been seen) and the bind then
 * fails with a permissions error even though nothing is listening. `netsh interface ipv4
 * show excludedportrange protocol=tcp` lists the current reservations.
 */
const WEB_PORT = Number(process.env['E2E_WEB_PORT'] ?? 4173);
const API_PORT = Number(process.env['E2E_API_PORT'] ?? 3000);
const isCi = process.env['CI'] !== undefined;

/**
 * The browser suite runs against the production build (TEST-015), not a dev server.
 * Additional browsers and viewports from Requirements section 31 are owned by DRAGON-16a.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCi,
  retries: 0,
  reporter: 'list',
  /**
   * Playwright's default is one worker per two cores, which assumes a worker costs one
   * browser page. It does not here: the multi-actor journeys (an owner and an invitee,
   * an author and a moderator, a sender and a recipient) run two or three pages each,
   * so the default put roughly three renderer processes per core against a single API
   * process and one mongod. DRAGON-29A measured the consequence in a full parallel run:
   * two tests failed with "Test timeout of 30000ms exceeded while setting up page" —
   * Chromium could not even open a page inside thirty seconds — and three more failed
   * with the application demonstrably mid-request when the assertion's budget ran out.
   * One worker per four cores keeps the page count near the core count. This is a real
   * shared-resource limit, not a way to slow the suite until failures stop.
   */
  workers: Number(process.env['E2E_WORKERS'] ?? Math.max(2, Math.floor(cpus().length / 4))),
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    /**
     * Retries are off, so `on-first-retry` never produced a single artifact: every
     * browser failure so far had to be diagnosed from the reporter line alone.
     * Retaining on failure costs nothing on a green run and is the only way an
     * intermittent failure can be explained after the fact.
     */
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  /**
   * Representative viewports from Requirements section 22.1. Small mobile is the
   * 320px floor that must never produce horizontal scrolling. The remaining
   * browser engines from section 31 are added by DRAGON-16a.
   */
  projects: [
    {
      name: 'small-mobile',
      use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 640 } }
    },
    {
      name: 'mobile',
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 667 } }
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }
    }
  ],
  webServer: [
    {
      command: 'node ../api/dist/server.js',
      // Readiness, not liveness. `/health` answers as soon as the process can serve a
      // request, which is before the Mongo connection, the startup migrations, and the
      // system-configuration seed have finished; the first tests were being dispatched
      // into that window. `/health/ready` pings the database and only then reports 200.
      url: `http://127.0.0.1:${API_PORT}/health/ready`,
      reuseExistingServer: !isCi,
      timeout: 30_000,
      env: {
        // The automated-test environment (section 35.1). The web bundle under test is
        // still the production build; only the API runs in test mode, which is what
        // exposes the mock SMS inbox the browser tests read codes from.
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: String(API_PORT),
        // Disposable test database from docker-compose.test.yml; `npm run e2e` starts it.
        MONGODB_URI: 'mongodb://127.0.0.1:27018/dragon_e2e?directConnection=true',
        AUTH_SECRET: 'e2e-only-auth-secret-value-not-a-real-secret',
        // The content publishing journey uses the dev-only role-grant route to set
        // up a publisher; it is registered only behind this explicit flag.
        ENABLE_DEV_ROUTES: 'true',
        // Keep the browser suite from tripping the resend interval between tests.
        OTP_RESEND_SECONDS: '1',
        OTP_REQUESTS_PER_MOBILE: '50',
        // Every browser test signs in at least once, and the suite has grown past 300
        // tests across three viewports — one run now spends several hundred OTP requests
        // from a single loopback address inside one window. At 500 a second run in the
        // same 15 minutes started failing unrelated specs with sign-in errors, which
        // reads as a regression and is not one. The limiter itself is unchanged and
        // still enforced; the browser suite is simply not the abuse case it exists for.
        OTP_REQUESTS_PER_IP: '5000',
        // DRAGON-12: exercise the paid checkout flow behind its OD-007 gate.
        PAID_TOURNAMENTS_ENABLED: 'true',
        // DRAGON-21: exercise the paid course journey behind its OD-015 gate. The gate is
        // still fail-closed everywhere else — `.env.example` ships it false — but the
        // Phase 3 acceptance criteria require the paid journey to be run end to end.
        PAID_COURSES_ENABLED: 'true',
        PAYMENTS_CALLBACK_SECRET: 'e2e-only-payments-callback-secret-not-real'
      }
    },
    {
      command: `npm run preview -- --port ${WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}/en`,
      reuseExistingServer: !isCi,
      timeout: 60_000,
      // The preview proxy must follow the API onto whichever port it was moved to.
      env: { API_PROXY_TARGET: `http://127.0.0.1:${String(API_PORT)}` }
    }
  ]
});
