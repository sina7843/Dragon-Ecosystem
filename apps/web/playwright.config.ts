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
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: String(API_PORT),
        // Disposable test database from docker-compose.test.yml; `npm run e2e` starts it.
        MONGODB_URI: 'mongodb://127.0.0.1:27018/dragon_e2e?directConnection=true'
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
