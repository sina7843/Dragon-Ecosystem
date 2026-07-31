import { defineConfig, devices } from '@playwright/test';

/**
 * Browser harness for the Persian manual: capture and walkthrough verification.
 *
 * Separate from `playwright.config.ts` on purpose, for two reasons.
 *
 * **The product suite must stay untouched.** It is a release gate; adding capture work to it
 * would make every screenshot change a gate change.
 *
 * **The environment has to match what the manual documents.** The product suite runs with
 * `PAID_TOURNAMENTS_ENABLED` and `PAID_COURSES_ENABLED` forced on, because its acceptance
 * criteria require exercising those journeys. Those are OD-007 and OD-015 gates that ship
 * *closed*, so a screenshot taken there would show a paid-course control that a reader
 * following `.env.example` does not have. This harness therefore runs the shipped defaults
 * and captures gated-open states only where a caption says the gate was opened.
 *
 * `ENABLE_DEV_ROUTES` is on so operator screenshots can be produced without a human
 * assigning roles by hand. That route is development-only and fail-closed in production; the
 * manual documents the real mechanism (`bootstrap:superadmin`, then the roles API) and never
 * presents the development route as an operational workflow.
 */

const WEB_PORT = Number(process.env['GUIDE_WEB_PORT'] ?? process.env['E2E_WEB_PORT'] ?? 4173);
const API_PORT = Number(process.env['GUIDE_API_PORT'] ?? 3100);

export default defineConfig({
  testDir: './e2e-guide',
  // Capture is inherently sequential: the manual's figure numbers follow the reading order,
  // and a parallel run would interleave the diagnostic evidence for the two reported faults.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 90_000,
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'off',
    // Screenshots go in the manual, so they are taken at a fixed scale: a device pixel
    // ratio that varies between machines would make figures unreadable at 100% zoom.
    deviceScaleFactor: 2
  },
  projects: [
    {
      name: 'fa-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, locale: 'fa-IR' }
    },
    {
      name: 'fa-mobile',
      use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 800 }, locale: 'fa-IR' }
    },
    {
      name: 'en-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, locale: 'en-US' }
    }
  ],
  webServer: [
    {
      command: 'node ../api/dist/server.js',
      url: `http://127.0.0.1:${API_PORT}/health/ready`,
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: String(API_PORT),
        // Its own database, so capture never disturbs (or is disturbed by) the product suite.
        MONGODB_URI: 'mongodb://127.0.0.1:27018/dragon_guide?directConnection=true',
        AUTH_SECRET: 'guide-capture-only-auth-secret-not-a-real-secret',
        ENABLE_DEV_ROUTES: 'true',
        OTP_RESEND_SECONDS: '1',
        OTP_REQUESTS_PER_MOBILE: '50',
        OTP_REQUESTS_PER_IP: '5000',
        PAYMENTS_CALLBACK_SECRET: 'guide-capture-only-payments-callback-secret-not-real'
        // Deliberately absent, matching `.env.example`: PAID_TOURNAMENTS_ENABLED,
        // PAID_COURSES_ENABLED, SOCIAL_BLOCKING_ENABLED, MODERATION_APPEALS_ENABLED,
        // PUSH_NOTIFICATIONS_ENABLED, PHYSICAL_FULFILLMENT_ENABLED,
        // ENTITLEMENT_REVOCATION_ENABLED, NOTIFICATIONS_SMS_ENABLED,
        // NOTIFICATIONS_EMAIL_ENABLED, ANALYTICS_EXTERNAL_ENABLED,
        // STREAM_RIGHTS_POLICY_APPROVED. Every one of them is fail-closed by design.
      }
    },
    {
      command: `npm run preview -- --port ${WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}/fa`,
      reuseExistingServer: true,
      timeout: 60_000,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${String(API_PORT)}` }
    }
  ]
});
