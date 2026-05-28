// Single source of truth for credentials + base URLs used across e2e specs.
// Real values live in env vars when CI runs; defaults match the dev test tenant
// documented in apps/web/.env.development.

export const CREDS = {
  admin: {
    email: process.env.E2E_ADMIN_EMAIL ?? 'test1@test.it',
    password: process.env.E2E_ADMIN_PASSWORD ?? 'Test123@!',
  },
  // test3 is the only non-admin on the test tenant. test1 & test2 are both
  // admins, so always use test3 for employee-role coverage.
  user: {
    email: process.env.E2E_USER_EMAIL ?? 'test3@test.it',
    password: process.env.E2E_USER_PASSWORD ?? 'Test123@!',
    displayName: 'Mario Rossi',
  },
} as const;

export const URLS = {
  web: process.env.E2E_WEB_URL ?? 'http://localhost:5173',
  mobile: process.env.E2E_MOBILE_URL ?? 'http://localhost:8082',
} as const;

export const STORAGE = {
  webAuth: 'e2e/.auth/web.json',
  webUserAuth: 'e2e/.auth/web.user.json',
  mobileAuth: 'e2e/.auth/mobile.json',
  mobileUserAuth: 'e2e/.auth/mobile.user.json',
} as const;
