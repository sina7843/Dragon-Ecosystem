import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = 4173;
const API_PORT = 3000;
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
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'on-first-retry'
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
      url: `http://127.0.0.1:${API_PORT}/health`,
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
        OTP_REQUESTS_PER_IP: '500',
        // DRAGON-12: exercise the paid checkout flow behind its OD-007 gate.
        PAID_TOURNAMENTS_ENABLED: 'true',
        PAYMENTS_CALLBACK_SECRET: 'e2e-only-payments-callback-secret-not-real'
      }
    },
    {
      command: `npm run preview -- --port ${WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}/en`,
      reuseExistingServer: !isCi,
      timeout: 60_000
    }
  ]
});
