import { readFileSync } from 'node:fs';
import { z } from 'zod';

function loadDotenv(): void {
  const env = process.env.NODE_ENV ?? 'development';
  const path = `.env.${env}`;
  try {
    const raw = readFileSync(path, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // file optional
  }
}

loadDotenv();

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  ADMIN_DATABASE_URL: z.string().optional(),
  GOTRUE_JWT_SECRET: z.string().min(32),
  GOTRUE_JWT_ISSUER: z.string().min(1),
  GOTRUE_JWT_AUDIENCE: z.string().optional(),
  GOTRUE_URL: z.string().min(1),
  GOTRUE_SERVICE_ROLE_KEY: z.string().min(1),
  CORS_ORIGINS: z.string().min(1),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().default(1000),
  BACKEND_URL: z.string().min(1),
  WEB_PUBLIC_URL: z.string().min(1),
  SCHEDULER_ENABLED: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  CRON_SECRET: z.string().min(8),
  TRUSTED_PROXY_HOPS: z.coerce.number().default(0),
  DEV_AUTH_ENABLED: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  STORAGE_DRIVER: z.enum(['disk', 'r2']).default('disk'),
  STORAGE_DISK_PATH: z.string().default('./storage'),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  NOMINATIM_USER_AGENT: z.string().default('SonoQui/0.1'),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  CENTRIFUGO_API_URL: z.string().optional(),
  CENTRIFUGO_API_KEY: z.string().optional(),
  CENTRIFUGO_PROXY_SECRET: z.string().optional(),
});

export const env = Env.parse(process.env);

if (env.NODE_ENV === 'production') {
  if (env.DEV_AUTH_ENABLED) {
    throw new Error('DEV_AUTH_ENABLED must be false in production');
  }
  if (!env.GOTRUE_JWT_AUDIENCE) {
    console.warn('Warning: GOTRUE_JWT_AUDIENCE not pinned in production');
  }
}
