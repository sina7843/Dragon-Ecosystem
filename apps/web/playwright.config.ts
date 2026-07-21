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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
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
        // Validated at startup but not yet dialled: the data layer lands in DRAGON-01.
        MONGODB_URI: 'mongodb://127.0.0.1:27017/dragon-e2e'
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
