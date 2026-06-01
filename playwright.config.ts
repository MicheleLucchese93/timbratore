import { defineConfig, devices } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { STORAGE, URLS } from './e2e/fixtures/test-data';

// Load .env.e2e (gitignored) so secrets like E2E_PURGE_SECRET reach
// globalTeardown without forcing a shell export before every run.
if (existsSync('.env.e2e')) {
  for (const line of readFileSync('.env.e2e', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

// Four spec projects (web admin, web user, mobile admin, mobile user) +
// their setup projects. Setup projects log in once via the UI and persist
// storageState; spec projects depend on the matching setup and reuse it.
//
// Admin specs live in e2e/{web,mobile}/*.spec.ts.
// User specs live in e2e/{web,mobile}/user/*.spec.ts.
export default defineConfig({
  testDir: './e2e',
  globalTeardown: './e2e/setup/global-teardown.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/playwright-report' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    // --- Web (admin) -----------------------------------------------------
    {
      name: 'web-setup',
      testMatch: /web\.auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: URLS.web },
    },
    {
      name: 'web',
      testMatch: /web\/(?!user\/).*\.spec\.ts/,
      dependencies: ['web-setup'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: URLS.web,
        storageState: STORAGE.webAuth,
      },
    },

    // --- Web (employee/user role) ----------------------------------------
    {
      name: 'web-user-setup',
      testMatch: /web\.user-auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: URLS.web },
    },
    {
      name: 'web-user',
      testMatch: /web\/user\/.*\.spec\.ts/,
      dependencies: ['web-user-setup'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: URLS.web,
        storageState: STORAGE.webUserAuth,
      },
    },

    // --- Mobile (admin) --------------------------------------------------
    {
      name: 'mobile-setup',
      testMatch: /mobile\.auth\.setup\.ts/,
      use: { ...devices['Pixel 5'], baseURL: URLS.mobile },
    },
    {
      name: 'mobile',
      testMatch: /mobile\/(?!user\/).*\.spec\.ts/,
      dependencies: ['mobile-setup'],
      use: {
        ...devices['Pixel 5'],
        baseURL: URLS.mobile,
        storageState: STORAGE.mobileAuth,
      },
    },

    // --- Mobile (employee/user role) -------------------------------------
    {
      name: 'mobile-user-setup',
      testMatch: /mobile\.user-auth\.setup\.ts/,
      use: { ...devices['Pixel 5'], baseURL: URLS.mobile },
    },
    {
      name: 'mobile-user',
      testMatch: /mobile\/user\/.*\.spec\.ts/,
      dependencies: ['mobile-user-setup'],
      use: {
        ...devices['Pixel 5'],
        baseURL: URLS.mobile,
        storageState: STORAGE.mobileUserAuth,
      },
    },

    // --- Smoke (read-only prod monitor) ----------------------------------
    // Self-logs-in (no setup dependency), creates/mutates nothing. Run against
    // prod as a synthetic monitor:
    //   E2E_NO_WEBSERVER=1 E2E_SKIP_PURGE=1 npx playwright test --project=smoke
    {
      name: 'smoke',
      testMatch: /smoke\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.E2E_SMOKE_URL ?? 'https://app-sonoqui.xdevapp.it',
      },
    },
  ],
  webServer: process.env.E2E_NO_WEBSERVER
    ? undefined
    : [
        {
          command: 'npm run dev:web',
          url: URLS.web,
          reuseExistingServer: true,
          timeout: 120_000,
        },
        {
          command: 'npm --prefix apps/mobile run web',
          url: URLS.mobile,
          reuseExistingServer: true,
          timeout: 300_000,
        },
      ],
});
