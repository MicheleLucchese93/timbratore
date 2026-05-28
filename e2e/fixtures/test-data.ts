// Single source of truth for credentials + base URLs used across e2e specs.
// Real values live in env vars when CI runs; defaults match the dev test tenant
// documented in apps/web/.env.development.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const STORAGE = {
  webAuth: 'e2e/.auth/web.json',
  webUserAuth: 'e2e/.auth/web.user.json',
  mobileAuth: 'e2e/.auth/mobile.json',
  mobileUserAuth: 'e2e/.auth/mobile.user.json',
  // Per-run fixture user creds, written by web-setup (admin setup runs first
  // and has the token needed to create the fixture user). Web + mobile share
  // a single runner so the same user identity is exercised in both surfaces.
  userCreds: 'e2e/.auth/user.creds.json',
} as const;

type Creds = { email: string; password: string; displayName?: string };

// User credentials are dynamic: web-setup provisions a fresh
// `e2e-runner-*@e2e.local` user each run and writes its creds to
// STORAGE.userCreds. Specs that load CREDS.user get the per-run user; if no
// creds file exists (first run, non-mutating run, or setup skipped) we fall
// back to the legacy test3 QA account so read-only specs still work.
function loadCreds(path: string, fallback: Creds): Creds {
  try {
    const abs = resolve(process.cwd(), path);
    if (!existsSync(abs)) return fallback;
    const parsed = JSON.parse(readFileSync(abs, 'utf8')) as Partial<Creds>;
    if (parsed.email && parsed.password) {
      return {
        email: parsed.email,
        password: parsed.password,
        displayName: parsed.displayName ?? fallback.displayName,
      };
    }
  } catch {
    /* fall through to fallback */
  }
  return fallback;
}

const FALLBACK_USER: Creds = {
  email: process.env.E2E_USER_EMAIL ?? 'test3@test.it',
  password: process.env.E2E_USER_PASSWORD ?? 'Test123@!',
  displayName: 'Mario Rossi',
};

export const CREDS = {
  admin: {
    email: process.env.E2E_ADMIN_EMAIL ?? 'test1@test.it',
    password: process.env.E2E_ADMIN_PASSWORD ?? 'Test123@!',
  },
  user: loadCreds(STORAGE.userCreds, FALLBACK_USER),
} as const;

export const URLS = {
  web: process.env.E2E_WEB_URL ?? 'http://localhost:5173',
  mobile: process.env.E2E_MOBILE_URL ?? 'http://localhost:8082',
} as const;
