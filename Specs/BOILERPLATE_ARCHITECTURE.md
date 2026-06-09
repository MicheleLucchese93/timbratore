# Cross-Platform App — Architecture & Deploy Boilerplate

A reusable template for shipping a TypeScript product that targets **web + iOS + Android** with self-hosted infrastructure on OVH. Use it as the starting blueprint when spinning up a new product. Replace every `<app>`, `<org>`, `<root>` placeholder with the real names; everything else is meant to be copied verbatim.

The shape was validated on a production product that ships:

- An Express 5 API in Docker
- Self-hosted GoTrue for auth (Google, Apple, email/password)
- Centrifugo for realtime websockets, fed by a Postgres outbox
- Postgres directly (no PostgREST, no Supabase Edge Functions)
- Cloudflare R2 for object storage, Cloudflare DNS + Turnstile in front
- A Vite + React SPA in nginx-Docker
- An Astro static marketing site copied straight to the host webroot
- An Expo React Native app with a self-hosted OTA server (no EAS Update)
- Caddy gateway terminating TLS with a Cloudflare Origin Certificate
- GitHub Actions doing SSH-based `git pull` deploys to one OVH VM
- A monthly systemd timer that rotates the Apple Sign-In `client_secret` JWT

---

## 0. Glossary of placeholders

| Token | Meaning | Example |
| --- | --- | --- |
| `<app>` | Lower-case product slug, used in container names, DB names, repo paths | `widgets` |
| `<App>` | Pascal-case product name, used in mobile bundle identifier and Xcode project | `Widgets` |
| `<org>` | Lower-case reverse-DNS org root for bundle ids | `acme` |
| `<root>` | The public DNS root that hosts everything | `acme.app` |
| `<server-ip>` | The OVH VM's public IPv4 | `51.x.y.z` |

The same product typically owns these subdomains under `<root>`:

| Host | Service |
| --- | --- |
| `<root>` (apex) | Marketing site (Astro, static) |
| `app.<root>` / `app-staging.<root>` | Web SPA (Vite + nginx in Docker) |
| `api.<root>` / `api-staging.<root>` | Backend API (Express in Docker) |
| `auth.<root>` / `auth-staging.<root>` | GoTrue |
| `ws.<root>` / `ws-staging.<root>` | Centrifugo |
| `ota.<root>` | OTA update server for the mobile app |
| `logs.<root>` | Dozzle (optional log viewer) |

Bot protection / Turnstile / WAF rules: keep on the **marketing apex only**. The auth/api/ws/ota subdomains are consumed by mobile apps and CI runners that cannot solve JS challenges — turning Bot Fight Mode on them WILL break the product.

---

## 1. Architecture overview

```
            ┌───────────────────────────────────────────┐
            │            Cloudflare (DNS proxy)         │
            │   Bot protection on apex only             │
            │   Turnstile CAPTCHA                       │
            │   R2 (S3-compatible object storage)       │
            │   Origin Certificate signed by CF private │
            └────────────┬─────────────────────────────┘
                         │ TLS
                         ▼
            ┌───────────────────────────────────────────┐
            │           Caddy (one VM, host-level)      │
            │   Full(Strict) TLS, Host-based routing    │
            │   Renews via HTTP-01 (Let's Encrypt) or   │
            │   serves Cloudflare Origin Cert directly  │
            └────────────┬─────────────────────────────┘
                         │
        ┌────────────────┼────────────────┬───────────────┐
        ▼                ▼                ▼               ▼
   ┌─────────┐    ┌──────────┐    ┌────────────┐   ┌─────────┐
   │ <app>-  │    │ gotrue-  │    │centrifugo- │   │  <app>- │
   │  api    │    │  <app>   │    │   <app>    │   │   web   │
   │ Express │    │  GoTrue  │    │ Realtime   │   │ nginx + │
   │ Node 24 │    │ v2.188.x │    │   v6       │   │  Vite   │
   └────┬────┘    └────┬─────┘    └─────┬──────┘   └─────────┘
        │              │                │
        └──────────────┴────────────────┘
                         │ infra_internal network
                         ▼
                  ┌───────────────┐
                  │   Postgres    │   (in a separate shared infra stack)
                  └───────────────┘

                  ┌───────────────┐
                  │  ota-<app>    │   (Expo Open OTA / eoas)
                  │ ghcr.io image │
                  └───────────────┘

      /var/www/<app>-website/   ← Astro static build (Caddy serves directly)
```

Two separate docker compose stacks per environment (`docker-compose.yml`, `docker-compose.staging.yml`), both joining two **external** Docker networks: `gateway` (Caddy is here) and `infra_internal` (Postgres is here). Postgres is owned by a separate "infra" repo cloned to `/opt/infra/` so multiple products can share one DB instance with their own databases.

---

## 2. Monorepo layout

```
/<app>/
├── apps/
│   ├── backend/                # Express 5 API + supabase/migrations + seeds
│   ├── mobile/                 # Expo React Native (iOS + Android + RN-Web)
│   ├── web/                    # Vite + React SPA (authenticated product)
│   └── website/                # Astro static marketing + legal + SEO
├── packages/
│   └── shared/                 # Cross-app code: API client, Supabase client,
│                                 Centrifuge client, zustand stores, i18n, types,
│                                 design tokens. Consumed by web + mobile.
├── centrifugo/
│   └── config.json             # Template with __HMAC_SECRET__ / __API_KEY__ /
│                                 __PG_DSN__ placeholders; sed-substituted at
│                                 container boot.
├── gotrue-templates/           # confirmation.html, recovery.html (bilingual,
│                                 mounted ro into the GoTrue container)
├── ota/
│   ├── keys/.gitkeep           # Real .pem files generated locally + scp'd
│   └── README.md
├── scripts/
│   ├── rotate-apple-jwt/       # Systemd timer + bash + Node ES256 signer
│   ├── setup-stripe-products.ts
│   └── ...
├── .github/
│   ├── workflows/              # 6 workflows (see §13)
│   └── dependabot.yml
├── Dockerfile                  # Builds the API image
├── docker-compose.yml          # Production stack
├── docker-compose.staging.yml  # Staging stack
├── deploy.sh                   # Manual escape-hatch SSH deploy
├── .dockerignore
├── .gitleaks.toml
├── .trivyignore
├── eslint.config.mjs
├── tsconfig.json               # Root TS project references
├── package.json                # npm workspaces root
└── package-lock.json
```

Workspaces (`package.json:workspaces`):
```json
["apps/backend", "apps/mobile", "apps/web", "apps/website", "packages/shared"]
```

---

## 3. Pinned tech stack

| Component | Pin | Notes |
| --- | --- | --- |
| Node | `24-alpine` | Same image for both build and runtime stages |
| nginx | `1.29-alpine` | Web SPA runtime container |
| GoTrue | `supabase/auth:v2.188.1` | Self-hosted, NOT the Supabase platform |
| Centrifugo | `centrifugo/centrifugo:v6` | v6 series, Postgres consumer enabled |
| Expo Open OTA | `ghcr.io/axelmarciano/expo-open-ota:v2.3.16` | server image, pinned `linux/amd64` |
| `eoas` CLI | `eoas@2.3.17` | OTA publisher used in CI |
| Postgres | Owned by infra stack (separate repo) | Same instance hosts `<app>` and `<app>_staging` |
| Caddy | Owned by infra stack | Auto-issues HTTP-01 certs or serves CF Origin |
| Express | `^5.2.1` | Plain Express, no Fastify, no Nest |
| `pg` | `^8.13.0` | Direct Postgres client, no ORM |
| `jose` | `^6.2.2` | JWT verification |
| `zod` | `^4.4.1` | Env + payload validation |
| `node-cron` | `^4.2.1` | In-process scheduler |
| `helmet` | `^8.0.0` | Security headers |
| `express-rate-limit` | `^8.5.1` | Per-IP rate limiting |
| `@aws-sdk/client-s3` | `^3.1044.0` | Talks to Cloudflare R2 |
| `stripe` | `^22.1.1` | Web payments |
| `expo-server-sdk` | latest stable | Server-to-Expo push relay |
| Expo SDK | `~55` | New Architecture (Fabric + TurboModules) |
| React Native | `0.83.x` | Hermes engine both platforms |
| React | `19.2.0` | All targets (web, mobile, RN-Web) |
| Vite | `^8.0.10` | Web SPA bundler |
| Astro | `^6.1.9` | Marketing site |
| Tailwind | `^4.1.4` | Tailwind v4, no `tailwind.config`; tokens in CSS |
| TypeScript | `^6.0.3` | Strict mode in every workspace |
| Zustand | `^5.0.12` | Sole state library |
| RevenueCat (mobile) | `react-native-purchases ^10.x` | iOS + Android IAP |

---

## 4. Backend service (`apps/backend/`)

### 4.1 Framework — plain Express 5

Entry point `apps/backend/src/index.ts`:

```ts
import { createApp } from './app';
import { env } from './env';
import { pool } from './lib/db';
import { createLogger } from './lib/logger';
import { schedulerService } from './services/schedulerService';

const logger = createLogger('Server');
const app = createApp();

const server = app.listen(env.PORT, async () => {
  logger.info('Server started', { port: env.PORT, env: env.NODE_ENV });
  try { await pool.query('SELECT 1'); logger.info('Database connection verified'); }
  catch (err) { logger.error('Database connection FAILED on startup', {}, err as Error); }
  if (env.SCHEDULER_ENABLED) schedulerService.start();
});

const shutdown = () => {
  schedulerService.stop();
  server.close(() => { logger.info('Server stopped'); process.exit(0); });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

Middleware order (createApp, top to bottom):

1. `app.set('trust proxy', env.TRUSTED_PROXY_HOPS)` — default 1 (Caddy is the one hop)
2. `requestIdMiddleware` — attaches `req.id` (UUID v4)
3. `requestLogger` — structured JSON logs with request id + duration
4. `compression()`
5. `cors({ origin: explicit allowlist callback, credentials: true })` — NEVER `*`
6. `helmet({ hsts: { maxAge: 63072000, includeSubDomains: true, preload: true } })`
7. `express.raw({ type: 'application/json', limit: '1mb' })` mounted at `/api/v1/webhooks/stripe` BEFORE the JSON parser (Stripe needs the raw body for signature verification)
8. `express.json({ limit: '1mb' })`
9. `sanitizeBody` (uses `xss` package)
10. `requestTimeout(30_000, [{ path: '/transactions/import-pdf/preview', ms: 150_000 }])`
11. `rateLimit` — 10× max in development; skips `/health*` paths

CSP applied to static HTML routes:

```
default-src 'self';
script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com;
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
connect-src 'self' https://challenges.cloudflare.com;
frame-src https://challenges.cloudflare.com;
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
object-src 'none';
```

### 4.2 Folder layout

```
apps/backend/
├── package.json
├── tsconfig.json
├── jest.config.js
├── public/                         # Static HTML pages served same-origin
│   ├── confirm-email.html
│   ├── email-confirmed.html
│   ├── reset-password.html
│   ├── helpdesk.html
│   └── templates/                  # Templates fetched by GoTrue
├── scripts/                        # tsx-runnable one-shots (seeds, refreshes)
├── supabase/
│   ├── migrations/                 # NNN_descriptive.sql, 3-digit prefix
│   ├── seeds/                      # 001_preset_*.sql etc.
│   ├── .staging-bootstrap-migrations  # Idempotent SQL to re-run every deploy
│   └── .prod-bootstrap-migrations
└── src/
    ├── app.ts                      # createApp() — middleware + route wiring
    ├── env.ts                      # zod-validated env, dotenv-loaded by NODE_ENV
    ├── index.ts                    # listen + db ping + scheduler start
    ├── errors/                     # AppError, ValidationError, UnauthorizedError,
    │                                 ExternalServiceError
    ├── lib/                        # apiResponse, container (DI), db (pg Pool +
    │                                 withRLS), logger, r2, openai, registerServices
    ├── middleware/                 # auth, accountSwitcher, errorHandler, intentToken,
    │                                 rateLimiters, requestId, requestLogger,
    │                                 requestTimeout, requirePremium, sanitize,
    │                                 turnstile, validate
    ├── repositories/
    │   ├── interfaces/             # I*Repository contracts
    │   └── pg/                     # pg implementations (one file per aggregate)
    ├── routes/                     # 25+ Express routers, mounted at /api/v1/*
    ├── services/                   # 30+ service classes (one file per use case)
    ├── validators/                 # zod schemas per route domain
    └── __tests__/                  # mirrors src/ paths; Jest + ts-jest
```

### 4.3 Postgres connection pool + per-request RLS

`apps/backend/src/lib/db.ts`:

```ts
import { Pool, PoolClient, types } from 'pg';
import { env } from '../env.js';

// DATE OID 1082 kept as string (not JS Date) for stable ISO formatting
types.setTypeParser(1082, (val) => val);

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
});

export type { PoolClient };

export async function withRLS<T>(
  userId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

Routes that touch user data run their queries inside `withRLS(req.user.id, …)`. The DB layer reads `app.current_user_id` from the per-transaction GUC inside `auth.uid()`:

```sql
-- supabase/migrations/<NNN>_auth_setup.sql
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
$$;
```

This sidesteps PostgREST (the backend talks plain SQL via `pg`) but reuses every RLS policy that Supabase tooling writes against `auth.uid()`.

### 4.4 JWT verification

`apps/backend/src/middleware/auth.ts`:

```ts
import { jwtVerify } from 'jose';
const secret = new TextEncoder().encode(env.GOTRUE_JWT_SECRET);

const { payload } = await jwtVerify(token, secret, {
  ...(env.GOTRUE_JWT_AUDIENCE ? { audience: env.GOTRUE_JWT_AUDIENCE } : {}),
  ...(env.GOTRUE_JWT_ISSUER ? { issuer: env.GOTRUE_JWT_ISSUER } : {}),
});
```

GoTrue v2.188.x ships `aud: ""` regardless of `GOTRUE_JWT_AUDIENCE` — pin only when verified populated. `GOTRUE_JWT_ISSUER` is set to the public auth URL (`https://auth.<root>`); the backend pins it.

### 4.5 Env schema (zod-validated)

`apps/backend/src/env.ts` loads `.env.${NODE_ENV ?? 'development'}` via `dotenv`, then validates with zod. Mandatory variables:

```
NODE_ENV                       # 'development' | 'production'
PORT                           # default 4000
DATABASE_URL                   # postgres://<role>:<pwd>@postgres:5432/<db>
GOTRUE_JWT_SECRET              # min length 32, HS256
GOTRUE_JWT_ISSUER              # https://auth.<root>
GOTRUE_JWT_AUDIENCE            # optional, blank-tolerant
GOTRUE_URL                     # https://auth.<root>
GOTRUE_SERVICE_ROLE_KEY        # for admin-only operations
CENTRIFUGO_API_URL             # http://centrifugo-<app>:8000/api
CENTRIFUGO_API_KEY             # HMAC for publishing
CENTRIFUGO_PROXY_SECRET        # validates inbound proxy calls
CORS_ORIGINS                   # comma-separated, no '*'
RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX
BACKEND_URL                    # https://api.<root>
CRON_SECRET                    # Bearer for /api/v1/cron/* HTTP triggers
SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, HELPDESK_TO
TURNSTILE_SECRET_KEY           # paired with VITE_TURNSTILE_SITE_KEY on the SPA
TURNSTILE_FAIL_OPEN            # default false; warn on startup if true
TRUSTED_PROXY_HOPS             # default 1
OPENAI_API_KEY                 # optional, AI features degrade if absent
R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID_*
REVENUECAT_WEBHOOK_AUTH
WEB_PUBLIC_URL                 # https://app.<root>
SCHEDULER_ENABLED              # default true; set false on staging if sharing prod DB
```

Startup security warnings: refuse to start in production when JWT issuer/audience aren't pinned, when CORS_ORIGINS is empty, or when `TURNSTILE_FAIL_OPEN=true`.

### 4.6 In-process scheduler (`node-cron`)

`apps/backend/src/services/schedulerService.ts`:

```ts
import cron from 'node-cron';

class SchedulerService {
  private jobs: cron.ScheduledTask[] = [];
  start() {
    this.jobs.push(cron.schedule('0 3 * * *', () => recurringRunner()));
    this.jobs.push(cron.schedule('30 3 * * *', () => reconcileBalances()));
    this.jobs.push(cron.schedule('15 4 * * *', () => processScheduledDeletions()));
    this.jobs.push(cron.schedule('0 5 * * *', () => pruneExpiredAssets()));
    this.jobs.push(cron.schedule('*/30 * * * *', () => drainSubscriptionEvents()));
    this.jobs.push(cron.schedule('*/15 * * * *', () => enqueuePromoExpiries()));
    this.jobs.push(cron.schedule('0 14 * * *', () => gracePeriodReminder()));
    this.jobs.push(cron.schedule('0 10 * * 1', () => weeklySettlementReminder()));
    this.jobs.push(cron.schedule('0 5 * * *', () => pruneWebhookEvents()));
  }
  stop() { for (const j of this.jobs) j.stop(); this.jobs = []; }
}
export const schedulerService = new SchedulerService();
```

Disable via `SCHEDULER_ENABLED=false` on any environment that **shares another environment's database** — otherwise multiple instances fire identical crons at the same minute.

### 4.7 HTTP-triggered cron endpoints

`apps/backend/src/routes/cron.ts` — manual triggers gated by `Authorization: Bearer ${CRON_SECRET}` with `crypto.timingSafeEqual`. Useful for external schedulers (Cloudflare Cron Triggers, GitHub Actions, systemd) when in-process cron is undesirable.

### 4.8 Dependency injection container

`apps/backend/src/lib/container.ts` — bespoke 50-line factory-based singleton container (`registerSingleton`, `resolve`, `replace`, `reset`, `clear`). Service tokens at `serviceTokens.ts`. Registration is explicit in `registerServices.ts`. Tests use `container.replace(SOME_TOKEN, fake)` for mocking.

### 4.9 Receipts / object storage

`apps/backend/src/lib/r2.ts`:

```ts
import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});
```

Bucket layout:

```
receipts/<userId>/<txId>.<ext>
groups/<groupId>/receipts/<groupTxId>.<ext>
groups/<groupId>/exports/<format>-v<version>-<locale>.<format>
exports/<userId>/<filename>
```

Signed URLs cached in-process (LRU bounded at 1000, stale buffer 60s).

---

## 5. Postgres + migrations

### 5.1 Where Postgres lives

In a **separate "infra" repo** cloned to `/opt/infra/` on the same VM, owning the Postgres container and Caddy. The infra `docker-compose.yml` declares two external networks:

```yaml
networks:
  gateway:
    external: true
  infra_internal:
    external: true
```

Postgres is on `infra_internal`. The `<app>` stack joins both networks and reaches Postgres by the docker DNS hostname `postgres:5432`.

### 5.2 Databases

One Postgres instance, multiple logical databases:

- `<app>` — production
- `<app>_staging` — staging
- `<other_app>` — another product on the same VM

Two roles per app:

- `<app>` — owner role used by GoTrue and the API (full CRUD)
- `app` — least-privilege read+notify role used by Centrifugo (no DDL)

### 5.3 Migrations folder

`apps/backend/supabase/migrations/NNN_descriptive_snake_case.sql` — sequential 3-digit prefix. Idempotent SQL (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) so retried deploys don't fail.

### 5.4 Bootstrap migration lists

Two checked-in files:

- `apps/backend/supabase/.staging-bootstrap-migrations` — applied to `<app>_staging` every deploy
- `apps/backend/supabase/.prod-bootstrap-migrations` — applied to `<app>` every staging deploy (because the prod deploy workflow does not run migrations automatically; this is the catch-up channel)

Format: one filename per line, `#`-prefixed comments allowed. Helper:

```bash
read_bootstrap_list() {
  local file="$1"
  [ -f "$file" ] || return 0
  sed -E -e 's/#.*$//' -e 's/^[[:space:]]+|[[:space:]]+$//g' "$file" | grep -v '^$'
}
```

Don't use `xargs` — it barfs on apostrophes in SQL file headers.

### 5.5 Diff-based migration application

The staging deploy workflow applies only **newly added** migrations:

```bash
NEW_MIGRATIONS=$(git diff --name-only --diff-filter=A "$OLD_SHA" "$NEW_SHA" -- apps/backend/supabase/migrations/ | sort)
while IFS= read -r m; do
  [ -z "$m" ] && continue
  docker exec -i postgres psql -U <app> -d <app>_staging -v ON_ERROR_STOP=1 < "$m"
done <<< "$NEW_MIGRATIONS"
```

Modified files (`--diff-filter=M`) are intentionally skipped — re-running them is the operator's call via the manual workflow (§13.3).

### 5.6 Production migration path

**Production migrations are not auto-applied.** Three options:

1. Add the file to `.prod-bootstrap-migrations` (idempotent only). The staging deploy will apply it to the prod DB on its next run.
2. Manual psql over SSH: `docker exec -i postgres psql -U <app> -d <app> -v ON_ERROR_STOP=1 < apps/backend/supabase/migrations/<file>.sql`
3. The manual workflow `staging-apply-migration.yml` can be adapted to target the prod DB by changing the `-d` argument (or duplicate it as `prod-apply-migration.yml`).

### 5.7 Refresh staging from prod

`apps/backend/scripts/refresh-staging.sh`:

```bash
# Drops <app>_staging, pg_dumps <app> over docker exec, restores,
# then re-applies every migration file (pg_dump drops triggers/functions),
# then restarts the staging API + auth + realtime containers.
```

Run only with explicit operator approval; truncates all staging data.

---

## 6. Auth — self-hosted GoTrue

### 6.1 Container

`docker-compose.yml`:

```yaml
gotrue-<app>:
  image: supabase/auth:v2.188.1
  container_name: gotrue-<app>
  restart: unless-stopped
  environment:
    GOTRUE_API_HOST: "0.0.0.0"
    GOTRUE_API_PORT: "9999"
    GOTRUE_DB_DRIVER: "postgres"
    GOTRUE_DB_DATABASE_URL: "postgres://<app>:${POSTGRES_PASSWORD}@postgres:5432/<app>?sslmode=disable"
    GOTRUE_SITE_URL: "https://api.<root>"
    GOTRUE_URI_ALLOW_LIST: "<app>://auth-callback,<app>://*,https://api.<root>/**,https://app.<root>/**"
    GOTRUE_JWT_SECRET: "${<APP>_JWT_SECRET}"
    GOTRUE_JWT_ISSUER: "https://auth.<root>"
    GOTRUE_JWT_EXP: "3600"
    GOTRUE_EXTERNAL_EMAIL_ENABLED: "true"
    GOTRUE_MAILER_AUTOCONFIRM: "false"
    GOTRUE_MAILER_OTP_EXP: "86400"
    GOTRUE_MAILER_SUBJECTS_CONFIRMATION: '{{ if eq (.Data.language) "it" }}Conferma la registrazione{{ else }}Confirm Your Signup{{ end }}'
    GOTRUE_MAILER_SUBJECTS_RECOVERY: '{{ if eq (.Data.language) "it" }}Reimposta la password{{ else }}Reset Your Password{{ end }}'
    GOTRUE_MAILER_TEMPLATES_CONFIRMATION: "http://<app>-api:4000/templates/confirmation.html"
    GOTRUE_MAILER_TEMPLATES_RECOVERY:     "http://<app>-api:4000/templates/recovery.html"
    GOTRUE_SMTP_HOST: "${SMTP_HOST}"
    GOTRUE_SMTP_PORT: "${SMTP_PORT}"
    GOTRUE_SMTP_USER: "${SMTP_USER}"
    GOTRUE_SMTP_PASS: "${SMTP_PASS}"
    GOTRUE_SMTP_ADMIN_EMAIL: "noreply@<root>"
    GOTRUE_MAILER_URLPATHS_CONFIRMATION: "/verify"
    GOTRUE_MAILER_URLPATHS_RECOVERY: "/verify"
    GOTRUE_EXTERNAL_GOOGLE_ENABLED: "${<APP>_GOOGLE_ENABLED:-false}"
    GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID: "${<APP>_GOOGLE_CLIENT_ID}"
    GOTRUE_EXTERNAL_GOOGLE_SECRET:    "${<APP>_GOOGLE_SECRET}"
    GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI: "https://auth.<root>/callback"
    GOTRUE_EXTERNAL_APPLE_ENABLED:  "${<APP>_APPLE_ENABLED:-false}"
    # client_id: comma-separated, web Services ID first, iOS Bundle ID second
    GOTRUE_EXTERNAL_APPLE_CLIENT_ID: "${<APP>_APPLE_CLIENT_ID:-com.<org>.<app>.auth,com.<org>.<app>}"
    GOTRUE_EXTERNAL_APPLE_SECRET:    "${<APP>_APPLE_SECRET}"
    GOTRUE_EXTERNAL_APPLE_REDIRECT_URI: "https://auth.<root>/callback"
    GOTRUE_DISABLE_SIGNUP: "false"
    GOTRUE_RATE_LIMIT_HEADER: "CF-Connecting-IP"
    GOTRUE_SECURITY_CAPTCHA_ENABLED: "true"
    GOTRUE_SECURITY_CAPTCHA_PROVIDER: "turnstile"
    GOTRUE_SECURITY_CAPTCHA_SECRET: "${<APP>_TURNSTILE_SECRET_KEY}"
    API_EXTERNAL_URL: "https://auth.<root>"
  volumes:
    - ./gotrue-templates:/templates:ro
  networks:
    - infra_internal
    - gateway
  deploy:
    resources:
      limits:
        memory: 256M
        cpus: '0.50'
```

### 6.2 Email templates

`gotrue-templates/confirmation.html` — bilingual via Go-template branching:

```html
{{ if eq (.Data.language) "it" }}
<h2>Conferma la registrazione</h2>
<p>Clicca sul link seguente per confermare il tuo account:</p>
<p><a href="{{ .SiteURL }}/confirm-email.html?token_hash={{ .TokenHash }}&type=signup">Conferma email</a></p>
{{ else }}
<h2>Confirm your signup</h2>
<p>Follow this link to confirm your account:</p>
<p><a href="{{ .SiteURL }}/confirm-email.html?token_hash={{ .TokenHash }}&type=signup">Confirm email</a></p>
{{ end }}
```

The page at `{{ .SiteURL }}/confirm-email.html` (served by the API's static `public/` dir) reads `token_hash`+`type` and posts to GoTrue's `/verify` endpoint — gives you control over the look-and-feel without rebuilding the GoTrue image.

### 6.3 Apple Sign-In specifics

- **Two `client_id`s**: Services ID (web flow) AND iOS Bundle ID. GoTrue accepts them comma-separated.
- **`client_secret` is a JWT** signed by the Apple `.p8` private key with ES256. Max 6-month TTL; recommended rotation: monthly.
- **Use SMTP from Brevo** (or any transactional provider). Apple OAuth ships an `@privaterelay.appleid.com` proxy address — `helmet`/email logic must NOT block addresses with that domain.

### 6.4 Rate-limit header

`GOTRUE_RATE_LIMIT_HEADER: "CF-Connecting-IP"` — Caddy + Cloudflare normalize to the real client IP. Without this, every request looks like it comes from Caddy's container IP and rate limits never trigger.

### 6.5 Bot protection / Turnstile placement

- Cloudflare Bot Fight Mode: **OFF on `auth.<root>`** (mobile + CI cannot solve JS challenges).
- Turnstile widget rendered in the web SPA's login/register/forgot-password forms; token passed to GoTrue via `signInWithPassword`/`signUp`/`resetPasswordForEmail`'s `captchaToken` option.
- GoTrue verifies via `GOTRUE_SECURITY_CAPTCHA_SECRET`. Mobile flows don't send a captcha token — `GOTRUE_SECURITY_CAPTCHA_VERIFY` accepts that by default for native flows; if you turn it strict, mobile auth will break.

---

## 7. Realtime — Centrifugo

### 7.1 Container

```yaml
centrifugo-<app>:
  image: centrifugo/centrifugo:v6
  container_name: centrifugo-<app>
  restart: unless-stopped
  entrypoint: ["/bin/sh", "-c"]
  command:
    - >-
      sed
      -e "s|__HMAC_SECRET__|$$CENTRIFUGO_HMAC_SECRET|g"
      -e "s|__API_KEY__|$$CENTRIFUGO_API_KEY|g"
      -e "s|__PG_DSN__|$$CENTRIFUGO_PG_DSN|g"
      /centrifugo/config.template.json > /tmp/config.json &&
      centrifugo --config=/tmp/config.json
  environment:
    CENTRIFUGO_HMAC_SECRET: "${CENTRIFUGO_<APP>_HMAC_SECRET}"
    CENTRIFUGO_API_KEY:     "${CENTRIFUGO_<APP>_API_KEY}"
    CENTRIFUGO_PG_DSN:      "postgresql://app:${APP_PG_PASS}@postgres:5432/<app>"
  volumes:
    - ./centrifugo/config.json:/centrifugo/config.template.json:ro
  networks:
    - infra_internal
    - gateway
  deploy:
    resources:
      limits:
        memory: 256M
        cpus: '0.50'
```

The `sed` substitution at boot turns `__PLACEHOLDERS__` into real values from the container's env. The template stays plaintext in git — secrets never appear in the repo.

### 7.2 Config template (`centrifugo/config.json`)

```json
{
  "client": {
    "token": { "hmac_secret_key": "__HMAC_SECRET__" },
    "allowed_origins": ["https://app.<root>", "https://app-staging.<root>"],
    "proxy": {
      "connect": {
        "endpoint": "http://<app>-api:4000/api/v1/centrifugo/connect",
        "http": { "static_headers": { "X-Centrifugo-Secret": "__API_KEY__" } }
      }
    }
  },
  "channel": {
    "namespaces": [{ "name": "<app>" }],
    "proxy": {
      "subscribe": {
        "endpoint": "http://<app>-api:4000/api/v1/centrifugo/subscribe",
        "http": { "static_headers": { "X-Centrifugo-Secret": "__API_KEY__" } }
      }
    }
  },
  "http_api": { "key": "__API_KEY__" },
  "consumers": [
    {
      "enabled": true,
      "name": "postgresql",
      "type": "postgresql",
      "postgresql": {
        "dsn": "__PG_DSN__",
        "outbox_table_name": "centrifugo_outbox",
        "num_partitions": 1
      }
    }
  ]
}
```

### 7.3 Outbox pattern (the load-bearing trick)

DB triggers append rows to `centrifugo_outbox`; Centrifugo's built-in Postgres consumer drains the table and broadcasts. Means: **no Redis, no message bus, no separate worker**. Writes are atomic with the user's transaction — if the row commits, the realtime event will fire.

Migration sketch:

```sql
-- NNN_centrifugo_outbox.sql
CREATE TABLE IF NOT EXISTS centrifugo_outbox (
  id BIGSERIAL PRIMARY KEY,
  method TEXT NOT NULL,                     -- 'publish'
  payload JSONB NOT NULL,                   -- { channel, data }
  partition INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- NNN_centrifugo_outbox_triggers.sql
CREATE OR REPLACE FUNCTION emit_centrifugo_event(p_channel TEXT, p_data JSONB)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO centrifugo_outbox (method, payload)
  VALUES ('publish', jsonb_build_object('channel', p_channel, 'data', p_data));
END $$;

-- Then per-domain triggers AFTER INSERT/UPDATE that call emit_centrifugo_event(...)
```

### 7.4 Proxy endpoints (API side)

`apps/backend/src/routes/centrifugo.ts`:

```ts
// X-Centrifugo-Secret guard
const expected = env.CENTRIFUGO_PROXY_SECRET;
const got = req.header('x-centrifugo-secret') ?? '';
if (!expected || !crypto.timingSafeEqual(
  Buffer.from(expected.padEnd(64)), Buffer.from(got.padEnd(64))
)) throw new UnauthorizedError('Invalid centrifugo proxy secret');

// /connect: verify GoTrue JWT, return user info
const { payload } = await jwtVerify(token, secret, { issuer: env.GOTRUE_JWT_ISSUER });
return res.json({ result: { user: payload.sub, expire_at: payload.exp } });

// /subscribe: enforce channel name matches authenticated user
const expectedSuffix = `#${req.user.id}`;
if (!channel.endsWith(expectedSuffix)) {
  throw new UnauthorizedError('Channel/user mismatch');
}
```

Naming convention: channel name is `<namespace>#<userId>` so the suffix check is trivial.

---

## 8. Cloudflare layer

Pure dashboard config — there is no `wrangler.toml` in this template.

| Surface | Role |
| --- | --- |
| DNS | Proxied A records for every public hostname |
| Bot Fight Mode | **Apex only** (`<root>`). Off everywhere else |
| Origin Certificate | Generated in dashboard; pasted into Caddy on the VM |
| Turnstile | Site key for SPA + Secret key for GoTrue captcha config |
| R2 | Object storage; bucket has CORS for `https://app.<root>` and the local-dev origins |
| WAF | Custom rule blocking known abusive UAs on `<root>` only |
| Cache | Default behavior: bypass for HTML on `app.<root>`, cache static on `<root>` |
| Rules → Configuration Rules → Apex page rules | Disable email obfuscation; cache aggressively |

R2 CORS sample (apply per bucket in dashboard):
```json
[{
  "AllowedOrigins": ["https://app.<root>", "https://app-staging.<root>", "http://localhost:5173"],
  "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
  "AllowedHeaders": ["*"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3600
}]
```

---

## 9. Caddy gateway (lives in `/opt/infra/`)

Not in the product repo. Sample stanzas the operator must add when bringing up a new app:

```caddy
# Marketing site (static files)
<root>, www.<root> {
  root * /var/www/<app>-website
  file_server
  encode gzip zstd
  header {
    Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
    X-Frame-Options "SAMEORIGIN"
    X-Content-Type-Options "nosniff"
  }
}

# SPA
app.<root> {
  reverse_proxy <app>-web:80
}
app-staging.<root> {
  reverse_proxy <app>-web-staging:80
}

# API
api.<root> {
  reverse_proxy <app>-api:4000
}
api-staging.<root> {
  reverse_proxy <app>-api-staging:4000
}

# GoTrue (preserve Origin for CORS)
auth.<root> {
  reverse_proxy gotrue-<app>:9999 {
    header_up Origin {http.request.header.Origin}
  }
  @options method OPTIONS
  respond @options 204
}
auth-staging.<root> {
  reverse_proxy gotrue-<app>-staging:9999 {
    header_up Origin {http.request.header.Origin}
  }
}

# Centrifugo (websocket upgrade)
ws.<root> {
  reverse_proxy centrifugo-<app>:8000
}
ws-staging.<root> {
  reverse_proxy centrifugo-<app>-staging:8000
}

# OTA
ota.<root> {
  reverse_proxy ota-<app>:3000
}
```

Reload after edit: `docker exec caddy caddy reload --config /etc/caddy/Caddyfile`.

TLS — pick one:

- **HTTP-01 + Let's Encrypt** (default Caddy): point DNS at the VM, set Cloudflare to "DNS only" (gray cloud) for the first issuance, then re-enable the proxy. Caddy renews automatically.
- **Cloudflare Origin Certificate** (preferred when Cloudflare proxy is on): generate in dashboard (15-year cert), paste the PEM + key into `/etc/caddy/certs/<root>.pem` and `.key`, configure Caddy with `tls /etc/caddy/certs/<root>.pem /etc/caddy/certs/<root>.key`. Cloudflare must be in **Full (Strict)** mode.

---

## 10. Web SPA — `apps/web`

Vite 8 + React 19 SPA. No Next.js, no SSR.

### 10.1 Folder layout

```
apps/web/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html                 # CSP meta tag, Inter font preconnect
├── Dockerfile                 # node:24-alpine → nginx:1.29-alpine
├── nginx.conf                 # SPA fallback + cache headers
└── src/
    ├── main.tsx               # ReactDOM.createRoot, <BrowserRouter>
    ├── pre-bootstrap.ts       # registerStorage(webStorage) — runs FIRST
    ├── bootstrap.ts           # registerConfig, registerSupabaseClient,
    │                            registerApiClient
    ├── App.tsx                # <Routes> table, lazy-imported pages
    ├── i18n.tsx               # I18nProvider, useTranslation
    ├── config/env.ts          # frozen ENV object reading import.meta.env.VITE_*
    ├── auth/AuthGuard.tsx     # AuthBootstrap, RequireAuth, RedirectIfAuth
    ├── components/            # Button, Input, FilterBar, Dialogs, OAuthButtons,
    │                            Turnstile, charts, …
    ├── layouts/AppLayout.tsx
    ├── pages/
    │   ├── auth/              # LoginPage, RegisterPage, ForgotPasswordPage,
    │   │                        AuthCallbackPage
    │   ├── SubscriptionPage.tsx
    │   ├── CheckoutSuccessPage.tsx
    │   └── CheckoutCancelPage.tsx
    ├── services/
    │   ├── authService.ts
    │   └── secureStorage.ts   # zustand StateStorage adapter; PKCE-aware
    ├── styles/globals.css     # @import 'tailwindcss' + @theme tokens
    └── utils/                 # csvExport, xlsxExport, format, …
```

### 10.2 Vite config (verbatim shape)

```ts
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiUrl = env.VITE_API_URL || 'http://localhost:4000';

  const sharedProxy = {
    '/api': {
      target: apiUrl,
      changeOrigin: true,
      configure: (proxy) => {
        proxy.on('proxyReq', (proxyReq) => proxyReq.removeHeader?.('origin'));
      },
    },
    '/_supabase': {
      target: env.VITE_SUPABASE_PROXY_TARGET || env.VITE_SUPABASE_URL_REAL,
      changeOrigin: true,
      rewrite: (p) => p.replace(/^\/_supabase/, ''),
    },
    '/_centrifugo': {
      target: env.VITE_CENTRIFUGO_PROXY_TARGET || 'wss://ws-staging.<root>',
      changeOrigin: true,
      ws: true,
      rewrite: (p) => p.replace(/^\/_centrifugo/, ''),
    },
  };

  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': path.resolve(__dirname, './src') } },
    server: { port: 5173, strictPort: false, proxy: sharedProxy },
    preview: { proxy: sharedProxy },
    build: {
      outDir: 'dist',
      sourcemap: mode !== 'production',
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            if (!id.includes('node_modules')) return undefined;
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler|use-sync-external-store|zustand)[\\/]/.test(id)) {
              return 'react-vendor';
            }
            return undefined;
          },
        },
      },
    },
  };
});
```

The `manualChunks` rule for `react-vendor` resolves a cyclic-init crash with the `use-sync-external-store` CJS shim in production builds — keep it.

### 10.3 Pre-bootstrap → bootstrap ordering

Two side-effect modules imported BEFORE the React tree:

```ts
// src/pre-bootstrap.ts
import { registerStorage } from '@<app>/shared/storage';
import { webStorage } from './services/secureStorage';
registerStorage(webStorage);

// src/bootstrap.ts
import { registerConfig, registerSupabaseClient,
         createSupabaseClient, createApiClient, registerApiClient } from '@<app>/shared';
import { ENV } from './config/env';
import { useAccountStore, useAuthStore } from '@<app>/shared/stores';

registerConfig({ apiUrl: ENV.API_URL, centrifugoUrl: ENV.CENTRIFUGO_URL });

const supabase = createSupabaseClient({
  url: ENV.SUPABASE_URL,
  anonKey: ENV.SUPABASE_ANON_KEY,
  storage: webStorage,
  detectSessionInUrl: false,   // /auth/callback calls exchangeCodeForSession explicitly
});
registerSupabaseClient(supabase);

const isLocalhost = typeof window !== 'undefined' &&
  /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
const apiBaseUrl = import.meta.env.DEV || isLocalhost ? '' : ENV.API_URL;

registerApiClient(createApiClient({
  baseUrl: apiBaseUrl,
  supabase,
  getActiveWalletId: () => useAccountStore.getState().activeAccountId,
  onAuthCleared: () => useAuthStore.getState().clearAuth(),
}));
```

In dev/preview, `baseUrl=''` so requests hit the Vite proxy at `/api/*`. In prod, `baseUrl=ENV.API_URL` (absolute origin, baked at build time).

### 10.4 PKCE-aware storage

`apps/web/src/services/secureStorage.ts` — zustand `StateStorage` adapter; for any key ending in `-code-verifier`, the value is ALSO written to a `SameSite=Lax; Secure; Max-Age=600` cookie. Edge / Safari Tracking Prevention can partition or wipe `localStorage` during the OAuth roundtrip; the cookie survives the cross-site navigation and is read back on `/auth/callback`. Cookie is **not** `HttpOnly` (the client must read it to call `exchangeCodeForSession`).

### 10.5 Web env vars (all build-time)

`apps/web/src/config/env.ts`:

```ts
const get = (key, fallback = '') =>
  (import.meta.env as Record<string, string | undefined>)[key] ?? fallback;

export const ENV = {
  API_URL:            get('VITE_API_URL', 'http://localhost:4000'),
  CENTRIFUGO_URL:     get('VITE_CENTRIFUGO_URL'),
  SUPABASE_URL:       get('VITE_SUPABASE_URL'),
  SUPABASE_ANON_KEY:  get('VITE_SUPABASE_ANON_KEY'),
  TURNSTILE_SITE_KEY: get('VITE_TURNSTILE_SITE_KEY', ''),
  WEB_ORIGIN:
    typeof window !== 'undefined' ? window.location.origin : 'https://app.<root>',
} as const;
```

Vite inlines `import.meta.env.VITE_*` at build, so **rotating any key requires a Docker rebuild**.

Dev convenience: `apps/web/.env.local` is the *only* file Vite picks up automatically — point it at staging so `npm run dev` works against real auth + real DB:

```
VITE_API_URL=https://api-staging.<root>
VITE_SUPABASE_URL=/_supabase
VITE_SUPABASE_PROXY_TARGET=https://auth-staging.<root>
VITE_SUPABASE_ANON_KEY=<the staging GoTrue anon JWT>
VITE_CENTRIFUGO_URL=ws://localhost:5174/_centrifugo/connection/websocket
VITE_CENTRIFUGO_PROXY_TARGET=wss://ws-staging.<root>
```

The dev proxy strips the `Origin` header (`proxy.on('proxyReq')`) so a CORS-restricted backend treats the proxied request as same-origin.

### 10.6 Dockerfile (verbatim shape)

```Dockerfile
# syntax=docker/dockerfile:1.6
FROM node:24-alpine AS builder
WORKDIR /repo

COPY package.json package-lock.json ./
COPY .npmrc ./
COPY tsconfig.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

RUN npm ci --workspace=@<app>/web --include-workspace-root

ARG VITE_API_URL=https://api.<root>
ARG VITE_SUPABASE_URL=https://auth.<root>
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_CENTRIFUGO_URL=wss://ws.<root>/connection/websocket
ARG VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA

ENV VITE_API_URL=$VITE_API_URL \
    VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_CENTRIFUGO_URL=$VITE_CENTRIFUGO_URL \
    VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY

RUN npm run build --workspace=@<app>/web

FROM nginx:1.29-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

Default `VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA` is Cloudflare's "always-pass" test sitekey — useful for CI builds where the real key isn't injected.

### 10.7 nginx config

```nginx
server {
  listen 80;
  server_name _;

  root /usr/share/nginx/html;
  index index.html;

  # Hashed assets — long cache
  location /assets/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
    try_files $uri =404;
  }

  # Static favicon, manifest, etc.
  location ~* \.(?:ico|png|svg|webp|woff2?)$ {
    expires 30d;
    add_header Cache-Control "public";
    try_files $uri =404;
  }

  # SPA fallback — every unknown path serves index.html
  location / {
    try_files $uri $uri/ /index.html;
  }

  add_header X-Frame-Options "SAMEORIGIN" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
}
```

### 10.8 Tailwind v4 — no config file, tokens in CSS

`apps/web/src/styles/globals.css`:

```css
@import 'tailwindcss';

@theme {
  --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;

  --color-primary: #24389c;
  --color-primary-container: #3f51b5;
  --color-secondary: #b7131a;
  --color-on-secondary: #ffffff;
  --color-surface: #f4faff;
  --color-surface-container-lowest: #ffffff;
  --color-surface-container-low: #e9f6fd;
  --color-surface-container: #e3f0f8;
  --color-surface-container-high: #ddeaf2;
  --color-on-surface: #111d23;
  --color-on-surface-variant: #454652;
  --color-outline: #757684;
  --color-outline-variant: #c5c5d4;
  --color-error: #ba1a1a;
}
```

Material-3 token vocabulary recurs in classNames (`bg-surface`, `text-on-surface`, `border-outline-variant/40`). No `dark:` variants — pick light or dark up front; dark mode is out-of-scope until explicitly added.

### 10.9 Payments wiring (Stripe, redirect-only)

The SPA does **not** import `@stripe/stripe-js`. Three routes:

- `/settings/subscription` — picks plan, posts `POST /api/v1/stripe/checkout`, `window.location.href = res.data.url`.
- `/checkout/success` — polls `GET /profiles/me` (max 8 attempts × 1500ms) until `subscription.tier === 'premium'` and `status` is `active|trialing`, redirects to settings.
- `/checkout/cancel` — static message + back button.

Backend uses `stripe.checkout.sessions.create` and `stripe.billingPortal.sessions.create`. The Stripe webhook lives at `POST /api/v1/webhooks/stripe`, mounted with `express.raw` BEFORE the JSON parser (signature verification needs the raw body).

---

## 11. Marketing site — `apps/website`

Astro 6 static SSG. No Dockerfile — built on the CI runner, copied to `/var/www/<app>-website/` on the VM via SSH/rsync, served directly by Caddy.

### 11.1 Folder layout

```
apps/website/
├── package.json                  # astro, @astrojs/sitemap, tailwindcss,
│                                   vanilla-cookieconsent
├── astro.config.mjs
├── tsconfig.json
├── public/
│   ├── favicon.{svg,png}, icon.png
│   ├── robots.txt
│   ├── llms.txt, llms-full.txt
│   ├── _redirects                # Netlify-style; honored by Caddy via a
│                                   matcher rule in /opt/infra/Caddyfile
│   ├── .well-known/
│   │   ├── apple-app-site-association
│   │   └── assetlinks.json
│   ├── screenshots/, videos/
│   └── vendor/lenis.min.js
└── src/
    ├── pages/
    │   ├── index.astro            # redirects to /it/
    │   ├── it/index.astro
    │   ├── en/index.astro
    │   ├── it/{cookie-policy,privacy-policy,...}.astro
    │   ├── en/{cookie-policy,privacy-policy,...}.astro
    │   ├── [lang]/[slug].astro    # dynamic SEO pages
    │   └── p/index.astro          # universal-link landing
    ├── layouts/
    │   ├── BaseLayout.astro       # <head>, OG, canonical, hreflang, JSON-LD
    │   └── LegalLayout.astro      # prose styles
    ├── i18n/
    │   ├── ui.ts                  # flat translation object (it + en side-by-side)
    │   └── utils.ts               # getLangFromUrl, useTranslations, getAlternateUrl
    ├── data/seo.ts                # SITE_URL, APP_STORE_URL, WEB_APP_URL, schema.org
    ├── components/                # Hero, Header, Footer, FAQ, Premium, …
    └── styles/global.css          # @import 'tailwindcss' + @theme tokens
```

### 11.2 Astro config (key shape)

```js
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

const site = 'https://<root>';

export default defineConfig({
  site,
  integrations: [
    sitemap({
      changefreq: 'weekly',
      priority: 0.7,
      filter: (page) => page !== `${site}/`,
      serialize: (item) => { /* attach alternate hreflang links per URL */ return item; },
    }),
  ],
  i18n: {
    defaultLocale: 'it',
    locales: ['it', 'en'],
    routing: { prefixDefaultLocale: true },
  },
  vite: { plugins: [tailwindcss()] },
});
```

`prefixDefaultLocale: true` means every URL is `/{lang}/…`; the root `/` is a 302 redirect (`pages/index.astro`).

### 11.3 robots.txt — LLM-aware allowlist

```
User-agent: OAI-SearchBot
Allow: /
User-agent: ChatGPT-User
Allow: /
User-agent: Claude-SearchBot
Allow: /
User-agent: Claude-User
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Perplexity-User
Allow: /

User-agent: GPTBot
Disallow: /
User-agent: ClaudeBot
Disallow: /
User-agent: CCBot
Disallow: /

User-agent: *
Allow: /
Content-Signal: search=yes, ai-input=yes, ai-train=no

Sitemap: https://<root>/sitemap-index.xml
```

Permits *retrieval-only* LLM agents (chat-time citations) but blocks *training-corpus* crawlers. Adjust per legal preference.

### 11.4 Universal links / App Links

- `apps/website/public/.well-known/apple-app-site-association` — JSON declaring which paths the iOS app handles (`applinks` section with team-id + bundle-id).
- `apps/website/public/.well-known/assetlinks.json` — Android equivalent for App Links (declares the SHA-256 of the **upload key**, not the debug key).

Caddy must serve `.well-known/*` with `Content-Type: application/json` — Caddy's default `file_server` does this correctly.

---

## 12. Mobile — `apps/mobile`

Expo SDK 55 (managed-ish; `ios/` and `android/` are gitignored, regenerated by `expo prebuild --clean`).

### 12.1 Dependencies (key block)

```json
{
  "dependencies": {
    "@<app>/shared": "*",
    "@react-navigation/bottom-tabs": "^7.x",
    "@react-navigation/native": "^7.x",
    "@react-navigation/native-stack": "^7.x",
    "@supabase/supabase-js": "^2.x",
    "axios": "^1.x",
    "centrifuge": "^5.x",
    "expo": "~55.0.x",
    "expo-apple-authentication": "~55.0.x",
    "expo-auth-session": "~55.0.x",
    "expo-camera": "~55.0.x",
    "expo-constants": "~55.0.x",
    "expo-crypto": "~55.0.x",
    "expo-device": "~55.0.x",
    "expo-font": "~55.0.x",
    "expo-haptics": "~55.0.x",
    "expo-image-manipulator": "~55.0.x",
    "expo-image-picker": "~55.0.x",
    "expo-linear-gradient": "~55.0.x",
    "expo-local-authentication": "~55.0.x",
    "expo-localization": "~55.0.x",
    "expo-notifications": "~55.0.x",
    "expo-secure-store": "~55.0.x",
    "expo-splash-screen": "~55.0.x",
    "expo-system-ui": "~55.0.x",
    "expo-updates": "~55.0.x",
    "expo-web-browser": "~55.0.x",
    "react": "19.2.0",
    "react-dom": "19.2.0",
    "react-native": "0.83.x",
    "react-native-purchases": "^10.x",
    "react-native-purchases-ui": "^10.x",
    "react-native-safe-area-context": "^5.x",
    "react-native-screens": "^4.x",
    "react-native-web": "^0.21.x",
    "zustand": "^5.x"
  }
}
```

State via Zustand, persistence via `expo-secure-store` (registered before any store is imported). Realtime via `centrifuge`. IAP via RevenueCat (`react-native-purchases`).

### 12.2 `app.config.ts` (dynamic config)

```ts
import { ExpoConfig, ConfigContext } from 'expo/config';
import * as dotenv from 'dotenv';
import * as path from 'path';

const envFile = process.env.APP_ENV === 'development' ? '.env.development' : '.env.production';
dotenv.config({ path: path.resolve(__dirname, envFile) });

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: '<App>',
  slug: '<app>',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  scheme: '<app>',

  // STATIC hex string — must equal @expo/fingerprint hash of the binary
  // currently on devices. Pair with .native-fingerprint.json baseline.
  runtimeVersion: '<40-char-hex-fingerprint>',

  updates: {
    enabled: true,
    fallbackToCacheTimeout: 0,
    url: 'https://ota.<root>/api/manifest',
    codeSigningCertificate: './credentials/certificate.pem',
    codeSigningMetadata: { keyid: 'main', alg: 'rsa-v1_5-sha256' },
    requestHeaders: {
      'expo-channel-name':
        process.env.OTA_CHANNEL ??
        (process.env.APP_ENV === 'development' ? 'development' : 'production'),
    },
  },

  splash: {
    image: './assets/splash-blank.png',
    resizeMode: 'cover',
    backgroundColor: '#13546D',
  },

  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.<org>.<app>',
    buildNumber: '1',
    infoPlist: {
      UIBackgroundModes: ['remote-notification'],
      NSCameraUsageDescription: '<copy>',
      NSPhotoLibraryUsageDescription: '<copy>',
      NSMicrophoneUsageDescription: '<copy>',
      NSFaceIDUsageDescription: '<copy>',
    },
    usesAppleSignIn: true,
    associatedDomains: ['applinks:<root>'],
    config: { usesNonExemptEncryption: false },
  },

  android: {
    package: 'com.<org>.<app>',
    adaptiveIcon: {
      backgroundColor: '#f4faff',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO'],
    intentFilters: [{
      action: 'VIEW',
      autoVerify: true,
      data: [{ scheme: 'https', host: '<root>', pathPrefix: '/p/' }],
      category: ['BROWSABLE', 'DEFAULT'],
    }],
  },

  plugins: [
    ['expo-notifications', { icon: './assets/icon.png', color: '#24389c' }],
    'expo-secure-store',
    ['expo-local-authentication', { faceIDPermission: '<copy>' }],
    'expo-font',
    'expo-apple-authentication',
    'expo-web-browser',
    'expo-system-ui',
    'expo-localization',
    ['expo-camera', { cameraPermission: '<copy>' }],
    ['expo-splash-screen', {
      image: './assets/splash-blank.png',
      resizeMode: 'cover',
      backgroundColor: '#13546D',
    }],
  ],

  extra: {
    apiUrl:                process.env.API_URL                ?? '',
    supabaseUrl:           process.env.SUPABASE_URL           ?? '',
    supabaseAnonKey:       process.env.SUPABASE_ANON_KEY      ?? '',
    centrifugoUrl:         process.env.CENTRIFUGO_URL         ?? '',
    revenueCatApiKeyIOS:   process.env.REVENUECAT_API_KEY_IOS ?? '',
    revenueCatApiKeyAndroid: process.env.REVENUECAT_API_KEY_ANDROID ?? '',
    eas: { projectId: '<eas-project-uuid>' },
  },

  web: { favicon: './assets/favicon.png' },
});
```

Permission strings are pinned in `ios.infoPlist` AND in each plugin's options — defense-in-depth, since the plugin mod chain has historically wiped sibling contributions.

### 12.3 `eas.json`

```json
{
  "cli": { "version": ">= 12.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "channel": "development",
      "ios": { "simulator": true },
      "android": { "buildType": "apk" },
      "env": {
        "OTA_CHANNEL": "development",
        "APP_ENV": "development",
        "API_URL": "http://localhost:4000",
        "SUPABASE_URL": "https://auth-staging.<root>",
        "SUPABASE_ANON_KEY": "<staging-anon-jwt>",
        "CENTRIFUGO_URL": "wss://ws-staging.<root>/connection/websocket"
      }
    },
    "staging": {
      "distribution": "internal",
      "channel": "staging",
      "ios": { "simulator": false },
      "android": { "buildType": "apk" },
      "env": {
        "OTA_CHANNEL": "staging",
        "API_URL": "https://api-staging.<root>",
        "SUPABASE_URL": "https://auth-staging.<root>",
        "SUPABASE_ANON_KEY": "<staging-anon-jwt>",
        "CENTRIFUGO_URL": "wss://ws-staging.<root>/connection/websocket"
      }
    },
    "production": {
      "autoIncrement": true,
      "channel": "production",
      "env": {
        "OTA_CHANNEL": "production",
        "API_URL": "https://api.<root>",
        "SUPABASE_URL": "https://auth.<root>",
        "SUPABASE_ANON_KEY": "<prod-anon-jwt>",
        "CENTRIFUGO_URL": "wss://ws.<root>/connection/websocket"
      }
    }
  },
  "submit": {
    "production": {
      "ios":     { "appleId": "<apple-id>", "ascAppId": "<asc-app-id>" },
      "android": { "serviceAccountKeyPath": "./google-services.json" }
    }
  }
}
```

### 12.4 OTA — self-hosted (`expo-open-ota`), NOT EAS Update

```yaml
# docker-compose.yml — production stack
ota-<app>:
  image: ghcr.io/axelmarciano/expo-open-ota:v2.3.16
  container_name: ota-<app>
  platform: linux/amd64
  restart: unless-stopped
  environment:
    PORT: "3000"
    BASE_URL: "https://ota.<root>"
    EXPO_APP_ID: "<eas-project-uuid>"
    EXPO_ACCESS_TOKEN: "${EXPO_ACCESS_TOKEN}"
    JWT_SECRET: "${OTA_JWT_SECRET}"
    ADMIN_PASSWORD: "${OTA_ADMIN_PASSWORD}"
    USE_DASHBOARD: "true"
    STORAGE_MODE: "local"
    LOCAL_BUCKET_BASE_PATH: "/data/updates"
    CACHE_MODE: "local"
    KEYS_STORAGE_TYPE: "local"
    PUBLIC_LOCAL_EXPO_KEY_PATH: "/data/keys/public-key.pem"
    PRIVATE_LOCAL_EXPO_KEY_PATH: "/data/keys/private-key.pem"
  volumes:
    - <app>_ota_data:/data/updates
    - ./ota/keys:/data/keys:ro
  networks:
    - gateway
  deploy:
    resources:
      limits:
        memory: 128M
        cpus: '0.25'

volumes:
  <app>_ota_data:
```

Key gen (locally, ONCE):

```bash
cd apps/mobile
npx eoas generate-certs
# Produces credentials/private-key.pem + credentials/public-key.pem
# + credentials/certificate.pem
```

Then:

- Commit `credentials/certificate.pem` (the .gitignore allowlists it).
- Save `credentials/private-key.pem` as a GitHub Actions secret `OTA_PRIVATE_KEY`.
- Save `credentials/public-key.pem` to the VM at `/opt/<app>/ota/keys/public-key.pem` (chmod 600).
- Save the private key to the VM at `/opt/<app>/ota/keys/private-key.pem` (chmod 600).
- Add `credentials/private-key.pem` to `.gitignore` (it's not the same as the cert).

If `/opt/<app>/ota/keys/private-key.pem` ever goes missing, the OTA server returns signed manifests for `/api/manifest` (200) but the `expo-updates` client rejects them silently — clients log "code signing verification failed" and refuse to install. **Test signed updates with the client, not with `curl`.** An unsigned `curl` will return 200 and look fine.

### 12.5 Runtime version + fingerprint baseline

`apps/mobile/.native-fingerprint.json` (committed):

```json
{"hash":"<40-char-hex>","updatedAt":"<ISO-8601>"}
```

CI compares the current fingerprint (`npx -y @expo/fingerprint@<pinned> fingerprint:generate .`) against this baseline. Match → OTA-safe (publishes a JS-only update). Mismatch → native rebuild required; the workflow exits 0 with a step-summary explaining.

**Pin `@expo/fingerprint` by version, not `@latest`** — `expo-updates` bakes a specific version into the binary, and `@latest` drifts between runs.

To re-baseline after a native rebuild ships to at least one device:

```bash
cd apps/mobile
HASH=$(npx -y @expo/fingerprint@<pinned> fingerprint:generate . | jq -r .hash)
echo "{\"hash\":\"$HASH\",\"updatedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > .native-fingerprint.json
git add .native-fingerprint.json && git commit -m "chore(mobile): bump OTA fingerprint baseline"
```

### 12.6 Bootstrap ordering (load-bearing)

`apps/mobile/index.ts`:

```ts
import './src/pre-bootstrap';   // registerStorage(secureStorage) — FIRST
import './src/bootstrap';       // registerConfig, registerSupabaseClient,
                                 // registerApiClient
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
```

A root-level shim at `/index.js` re-requires `./apps/mobile/index` so Expo CLI doesn't pick up the hoisted `expo/AppEntry.js` (whose hardcoded `../../App` resolves OUTSIDE the workspace in a monorepo and breaks startup):

```js
// /index.js (repo root)
require('./apps/mobile/index');
```

### 12.7 Auth (mobile)

Supabase client init in `apps/mobile/src/bootstrap.ts`:

```ts
const supabase = createSupabaseClient({
  url: ENV.SUPABASE_URL,
  anonKey: ENV.SUPABASE_ANON_KEY,
  storage: secureStorage,
  detectSessionInUrl: false,
});
registerSupabaseClient(supabase);
```

`secureStorage` — platform-split. Web → `localStorage`; native → `expo-secure-store` with a cold-start retry ladder (200ms → 500ms → 1500ms) on iOS keychain transient failures. Uses `keychainAccessible: AFTER_FIRST_UNLOCK` so post-reboot reads don't fail with "device locked."

Google OAuth: `signInWithOAuth({ provider: 'google', redirectTo: '<app>://auth-callback' })` → hosted login URL → `WebBrowser.openAuthSessionAsync(url, '<app>://auth-callback')` → parse `code=` → `exchangeCodeForSession(code)`.

Apple Sign-In (iOS only): `expo-apple-authentication` triggers native sheet → identity token → `signInWithIdToken({ provider: 'apple', token })` to Supabase. No round-trip through `auth.<root>`.

Auth state machine: `supabase.auth.onAuthStateChange` filters to `SIGNED_OUT`, `SIGNED_IN`, `TOKEN_REFRESHED` only. Ignore `INITIAL_SESSION` with null session — otherwise cold start writes `user:null` back to disk on every launch.

### 12.8 Push notifications — Expo Push (recommended)

Provider: Expo Push Service (Expo cloud), not direct APNs/FCM. Server uses `expo-server-sdk`.

Mobile flow:

1. `Notifications.setNotificationHandler({...})` at module load.
2. `setupAndroidChannel()` creates `default` (MAX), `<feature>` (HIGH), `reminders` (DEFAULT) channels.
3. `Notifications.getExpoPushTokenAsync({ projectId: <eas-uuid> })` → `ExponentPushToken[...]`.
4. `PATCH /api/v1/profiles/me/push-token` to persist server-side. Idempotent via a per-user SecureStore key `push_token_synced:<userId>`.
5. `addNotificationReceivedListener` → foreground store update.
6. `addNotificationResponseReceivedListener` + `getLastNotificationResponseAsync()` (cold-start) → switch on `data.type` and `navigationRef.navigate(...)`.

Expo Go gotcha (SDK 53+ Android): `expo-notifications` was removed from Expo Go Android; its module-load side-effect throws. Workaround:

```js
// metro.config.js (excerpt)
if (process.env.EXPO_PUBLIC_USE_EXPO_GO === '1') {
  config.resolver.extraNodeModules = {
    ...config.resolver.extraNodeModules,
    'expo-notifications': require.resolve('./src/stubs/expo-notifications'),
  };
}
```

Plus a `notificationsCompat.ts` runtime selector keyed on `Constants.appOwnership === 'expo'`. Every service that uses notifications imports `getNotifications()` from this compat layer.

iOS plumbing:
- `aps-environment: development` in entitlements (flip to `production` for store builds; Apple resolves automatically when stored bundle vs adhoc).
- `UIBackgroundModes: ['remote-notification']` in Info.plist.

Android plumbing:
- The `expo-notifications` plugin injects icon + color into `AndroidManifest.xml`.
- Firebase messaging service registration is contributed automatically; you do NOT need `google-services.json` for push (Expo Push relays). You DO need it if you submit to Play with `eas submit --platform android`.

### 12.9 Prebuild survival kit

`ios/` and `android/` are gitignored. Every `npx expo prebuild --clean` wipes them and you must re-apply the following:

- **Podfile `post_install` block** (for AD-bound Macs where the user's primary group is `<DOMAIN>\Domain Users`, which `chown` rejects). Pin `INSTALL_GROUP = admin` and `DSTGROUP = admin` on every build configuration of every Pod target, every project config, and the host app's user_project via each aggregate target. Also sweep `.DS_Store` files from `Pods/`.

```ruby
post_install do |installer|
  Dir.glob(File.join(installer.sandbox.root, '**', '.DS_Store')).each { |f| File.delete(f) rescue nil }

  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |c|
      c.build_settings['INSTALL_GROUP'] = 'admin'
      c.build_settings['DSTGROUP'] = 'admin'
    end
  end
  installer.pods_project.build_configurations.each do |c|
    c.build_settings['INSTALL_GROUP'] = 'admin'
    c.build_settings['DSTGROUP'] = 'admin'
  end
  installer.aggregate_targets.each do |aggregate_target|
    user_project = aggregate_target.user_project
    user_project.native_targets.each do |t|
      t.build_configurations.each do |c|
        c.build_settings['INSTALL_GROUP'] = 'admin'
        c.build_settings['DSTGROUP'] = 'admin'
      end
    end
    user_project.build_configurations.each do |c|
      c.build_settings['INSTALL_GROUP'] = 'admin'
      c.build_settings['DSTGROUP'] = 'admin'
    end
    user_project.save
  end
end
```

- **Workspace casing fix**: `ios/<Name>.xcworkspace/contents.xcworkspacedata` references `<Name>.xcodeproj` but disk has `<name>.xcodeproj` (case mismatch on case-insensitive HFS+). Edit to match.

- **AppIcon set**: copy `assets/ios/AppIcon.appiconset/` into `ios/<Name>/Images.xcassets/AppIcon.appiconset/`. Prebuild flattens to a single 1024×1024 PNG and loses iphone/ipad/car variants.

- **Android keystore**: restore three pieces:
  - `android/app/android_keystore_<env>.jks` (binary, scp'd)
  - `android/keystore.properties`:
    ```
    storeFile=app/android_keystore_<env>.jks
    storePassword=<hex>
    keyAlias=<hex>
    keyPassword=<hex>
    ```
  - `release` `signingConfig` block in `android/app/build.gradle` — prebuild omits this; Expo defaults to debug-signing the release variant, which Play rejects.

```gradle
// In android/app/build.gradle
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
def hasReleaseKeystore = keystorePropertiesFile.exists()
if (hasReleaseKeystore) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        if (hasReleaseKeystore) {
            release {
                storeFile rootProject.file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
    }
    buildTypes {
        debug { signingConfig signingConfigs.debug }
        release {
            signingConfig hasReleaseKeystore ? signingConfigs.release : signingConfigs.debug
            // shrinkResources / minifyEnabled / proguard ...
        }
    }
}
```

  Verify upload-key SHA1 with `bundletool` before uploading to Play.

- **`pod install`** must be prefixed with UTF-8 locale on macOS:
  ```
  LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install --repo-update
  ```
  CocoaPods 1.16 + Homebrew Ruby 3.4 crashes on ASCII-8BIT otherwise.

### 12.10 RN-Web target

`react-native-web ^0.21` + `react-dom 19.2.0`. `npm run web` → `expo start --web`. Useful for e2e tests and quick demos. Lazy-import every native-only module so the web bundle doesn't link `expo-secure-store`, `expo-local-authentication`, `react-native-purchases`, etc.:

```ts
if (Platform.OS === 'web') return localStorage…;
const SecureStore = require('expo-secure-store');  // intentionally lazy
```

`metro.config.js` must disable `unstable_enablePackageExports` (forces CJS resolution) so Zustand's ESM build's `import.meta.env` doesn't break the web bundle:

```js
const config = getDefaultConfig(__dirname);
config.resolver.unstable_enablePackageExports = false;
```

The HTML shell at `apps/mobile/web/index.html` polyfills `globalThis.__import_meta_env__` for safety.

---

## 13. CI/CD — GitHub Actions

All six workflows live in `.github/workflows/`. Third-party actions are pinned by **commit SHA with version tag in a trailing comment**.

### 13.1 `deploy.yml` — production deploy (push to `main`)

```yaml
on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>  # v4.x.x
      - uses: actions/setup-node@<sha>  # v4.x.x
        with: { node-version: '24', cache: 'npm' }
      - run: npm ci
      - run: npm run lint
      - run: npm run -w apps/backend build
      - run: npm run -w apps/mobile  -- --noEmit  # tsc only
      - run: npm run -w apps/web     -- --noEmit
      - run: npm run -w apps/website build
      - run: npm test --workspace=apps/backend
      - run: cd apps/mobile && npx jest --forceExit --detectOpenHandles

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: appleboy/ssh-action@<sha>  # v1.x.x
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ubuntu
          key: ${{ secrets.SERVER_SSH_KEY }}
          port: 2222
          command_timeout: 10m
          script: |
            set -eo pipefail
            cd /opt/<app>

            LAST_SHA_FILE=/opt/<app>/.last-deployed-sha
            OLD_SHA=$(cat "$LAST_SHA_FILE" 2>/dev/null || echo "none")

            # Preserve env across hard reset
            cp apps/backend/.env.production /tmp/.env.production.bak 2>/dev/null || true

            git fetch origin main
            git reset --hard origin/main
            NEW_SHA=$(git rev-parse HEAD)

            cp /tmp/.env.production.bak apps/backend/.env.production 2>/dev/null || true

            should_rebuild() {
              if [ "$OLD_SHA" = "none" ]; then return 0; fi
              git diff --name-only "$OLD_SHA" "$NEW_SHA" -- "$@" | grep -q .
            }

            # Marketing site (host-served static)
            if should_rebuild apps/website/ package-lock.json package.json patches/; then
              echo "==> Rebuilding website…"
              npm ci
              npm run build --workspace=apps/website
              find /var/www/<app>-website -mindepth 1 -delete
              cp -r apps/website/dist/. /var/www/<app>-website/
            fi

            # API container
            if should_rebuild apps/backend/ Dockerfile docker-compose.yml package-lock.json package.json; then
              echo "==> Rebuilding API container…"
              docker compose build --no-cache <app>-api
              docker compose up -d <app>-api
              docker image prune -f
              sleep 15
              docker compose exec -T <app>-api wget -q -O- http://localhost:4000/health || exit 1
            fi

            # SPA container
            if should_rebuild apps/web/ packages/shared/ docker-compose.yml package-lock.json package.json || \
               [ -z "$(docker ps -q -f name=<app>-web)" ]; then
              echo "==> Rebuilding SPA container…"
              docker compose build --no-cache <app>-web
              docker compose up -d <app>-web
              docker image prune -f
            fi

            # Compose-level reconcile
            if should_rebuild docker-compose.yml; then
              docker compose up -d
            fi

            echo "$NEW_SHA" > "$LAST_SHA_FILE"

            # Disk discipline
            docker builder prune -a -f --filter "until=72h"
```

### 13.2 `deploy-staging.yml` — staging deploy (push to `staging`)

Same shape, plus:

- **Bootstrap clone** on first run (`if [ ! -d /opt/<app>-staging/.git ]; then git clone …`).
- **Secret upsert** into `apps/backend/.env.staging` via an `upsert_env` bash helper, fed from `secrets.STAGING_*` via `envs_format: export {NAME}={VALUE}`. Secrets never appear in logs (only the keys are echoed).
- **Migration runner**: applies only newly-added migration files (`git diff --diff-filter=A`) plus the two bootstrap lists (`.staging-bootstrap-migrations` for the staging DB, `.prod-bootstrap-migrations` for the prod DB).
- **Env-hash drift detection**: sha256 the env file before + after upsert, plus persist `/opt/<app>-staging/.last-recreated-env-hash`. Three states: full rebuild (code changed), force-recreate only (env changed but code didn't), no-op (neither changed).
- **Orphan container cleanup**: `docker ps -a --format '{{.Names}}' | grep -E '(_|^)<app>-web-staging$' | xargs -r docker rm -f` before recreate.

`upsert_env` helper (paste this into the deploy script):

```bash
ENV_FILE="apps/backend/.env.staging"
[ -f "$ENV_FILE" ] || touch "$ENV_FILE"

upsert_env() {
  local key="$1"; local value="$2"
  [ -z "$value" ] && return 0
  if grep -q "^${key}=" "$ENV_FILE"; then
    local escaped; escaped=$(printf '%s' "$value" | sed 's/|/\\|/g')
    sed -i "s|^${key}=.*|${key}=${escaped}|" "$ENV_FILE"
    echo "==> upserted $key (replaced)"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
    echo "==> upserted $key (appended)"
  fi
}

upsert_env OPENAI_API_KEY              "$STAGING_OPENAI_API_KEY"
upsert_env R2_ACCOUNT_ID               "$STAGING_R2_ACCOUNT_ID"
upsert_env R2_BUCKET                   "$STAGING_R2_BUCKET"
upsert_env R2_ACCESS_KEY_ID            "$STAGING_R2_ACCESS_KEY_ID"
upsert_env R2_SECRET_ACCESS_KEY        "$STAGING_R2_SECRET_ACCESS_KEY"
# … repeat for every per-deploy secret
```

### 13.3 `staging-apply-migration.yml` — manual migration runner

`workflow_dispatch` with a comma-separated `migrations:` input. SSHes to the host and pipes each named file through `docker exec -i postgres psql -U <app> -d <app>_staging -v ON_ERROR_STOP=1 < <file>`. Use cases: modified migration files (which the main staging workflow skips by design), cherry-picks, and pre-auto-apply files left un-applied.

```yaml
on:
  workflow_dispatch:
    inputs:
      migrations:
        description: 'Comma-separated migration filenames under apps/backend/supabase/migrations/'
        required: true
        type: string

jobs:
  apply:
    runs-on: ubuntu-latest
    steps:
      - uses: appleboy/ssh-action@<sha>
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ubuntu
          key: ${{ secrets.SERVER_SSH_KEY }}
          port: 22
          envs: MIGRATIONS
          script: |
            set -eo pipefail
            cd /opt/<app>-staging
            git pull origin staging
            IFS=',' read -ra FILES <<< "$MIGRATIONS"
            for f in "${FILES[@]}"; do
              f="$(echo "$f" | xargs)"
              path="apps/backend/supabase/migrations/$f"
              [ -f "$path" ] || { echo "missing: $path"; exit 1; }
              echo "==> applying $f"
              docker exec -i postgres psql -U <app> -d <app>_staging -v ON_ERROR_STOP=1 < "$path"
            done
        env:
          MIGRATIONS: ${{ inputs.migrations }}
```

### 13.4 `mobile-ota.yml` — OTA publish

```yaml
on:
  push:
    branches: [main]
    tags: ['mobile-prod-v*']
    paths:
      - 'apps/mobile/**'
      - '!apps/mobile/.native-fingerprint.json'
      - '!apps/mobile/**/*.md'
  workflow_dispatch:
    inputs:
      branch:
        description: 'Update branch (staging|production)'
        required: true
        default: staging

jobs:
  decide:
    runs-on: ubuntu-latest
    outputs:
      ota_safe: ${{ steps.fp.outputs.ota_safe }}
      branch:   ${{ steps.route.outputs.branch }}
    steps:
      - uses: actions/checkout@<sha>
      - uses: actions/setup-node@<sha>
        with: { node-version: '24', cache: 'npm' }
      - run: npm ci
      - id: fp
        working-directory: apps/mobile
        run: |
          npx -y @expo/fingerprint@0.16.6 fingerprint:generate . > fingerprint.json
          HASH=$(node -e "console.log(require('./fingerprint.json').hash)")
          BASE=$(node -e "console.log(require('./.native-fingerprint.json').hash)")
          if [ "$HASH" = "$BASE" ]; then
            echo "ota_safe=true" >> "$GITHUB_OUTPUT"
          else
            echo "ota_safe=false" >> "$GITHUB_OUTPUT"
            echo "::warning::Native fingerprint changed — rebuild required"
          fi
      - id: route
        run: |
          if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then
            echo "branch=${{ github.event.inputs.branch }}" >> "$GITHUB_OUTPUT"
          elif [[ "${{ github.ref }}" == refs/tags/mobile-prod-v* ]]; then
            echo "branch=production" >> "$GITHUB_OUTPUT"
          else
            echo "branch=staging" >> "$GITHUB_OUTPUT"
          fi

  publish:
    needs: decide
    if: needs.decide.outputs.ota_safe == 'true' || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
      - uses: actions/setup-node@<sha>
        with: { node-version: '24', cache: 'npm' }
      - run: npm ci

      - name: Restore signing key
        env: { OTA_PRIVATE_KEY: ${{ secrets.OTA_PRIVATE_KEY }} }
        run: |
          mkdir -p apps/mobile/credentials
          printf '%s' "$OTA_PRIVATE_KEY" > apps/mobile/credentials/private-key.pem
          chmod 600 apps/mobile/credentials/private-key.pem

      - name: Pin OTA hostname to origin IP (bypass Cloudflare Bot Fight Mode)
        run: |
          echo "${{ secrets.OTA_ORIGIN_IP }} ota.<root>" | sudo tee -a /etc/hosts
          getent hosts ota.<root>

      - name: Publish
        working-directory: apps/mobile
        env:
          NODE_TLS_REJECT_UNAUTHORIZED: '0'
          EXPO_TOKEN:        ${{ secrets.EXPO_TOKEN }}
          API_URL:           ${{ secrets.MOBILE_ENV_API_URL }}
          SUPABASE_URL:      ${{ secrets.MOBILE_ENV_SUPABASE_URL }}
          SUPABASE_ANON_KEY: ${{ secrets.MOBILE_ENV_SUPABASE_ANON_KEY }}
          CENTRIFUGO_URL:    ${{ secrets.MOBILE_ENV_CENTRIFUGO_URL }}
          EXPO_PUBLIC_COMMIT_SHA: ${{ github.sha }}
          OTA_CHANNEL: ${{ needs.decide.outputs.branch }}
        run: |
          npx -y eoas@2.3.17 publish \
            --platform all \
            --branch "${{ needs.decide.outputs.branch }}" \
            --nonInteractive \
            --disableRepositoryCheck

      - name: Wipe signing key
        if: always()
        run: rm -f apps/mobile/credentials/private-key.pem
```

`NODE_TLS_REJECT_UNAUTHORIZED=0` is acceptable: bundles are RSA-signed and the mobile client verifies the signature on launch. Transport TLS is defense-in-depth.

### 13.5 `check-apple-key-age.yml` — monthly Apple `.p8` rotation tickler

```yaml
on:
  schedule:
    - cron: '0 8 1 * *'    # 1st of each month, 08:00 UTC
  workflow_dispatch: {}

permissions:
  issues: write
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
      - id: age
        uses: appleboy/ssh-action@<sha>
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ubuntu
          key: ${{ secrets.SERVER_SSH_KEY }}
          script_stop: true
          script: |
            set -eo pipefail
            P8=/opt/<app>/secrets/apple-key.p8
            [ -f "$P8" ] || { echo "::error::missing $P8"; exit 1; }
            AGE_DAYS=$(( ( $(date +%s) - $(stat -c %Y "$P8") ) / 86400 ))
            echo "age_days=$AGE_DAYS" >> "$GITHUB_OUTPUT"
      - name: Open rotation issue if >330d
        if: steps.age.outputs.age_days > 330
        env: { GH_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
        run: |
          EXISTING=$(gh issue list --label apple-key-rotation --state open --json number --jq 'length')
          [ "$EXISTING" -gt 0 ] && { echo "issue exists"; exit 0; }
          gh issue create --label apple-key-rotation \
            --title "Rotate Apple Sign-In .p8 (now $AGE_DAYS days old)" \
            --body "Procedure: 1) Developer portal → Keys → '+' → Sign In with Apple. 2) Download new .p8. 3) scp to /opt/<app>/secrets/apple-key.p8 (chmod 600, chown root:root). 4) Update APPLE_KEY_ID constant in scripts/rotate-apple-jwt/rotate.sh. 5) Trigger systemd timer: sudo systemctl start <app>-apple-jwt-rotate.service. 6) Verify journalctl -u <app>-apple-jwt-rotate.service shows success."
```

Apple has no public API to create keys — full automation is impossible. This is the "you must do it" reminder.

### 13.6 `security-scan.yml` — Trivy + Gitleaks

```yaml
on:
  push: { branches: [main] }
  pull_request:
  schedule:
    - cron: '0 6 * * 1'
  workflow_dispatch:

jobs:
  trivy-repo:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
      - uses: aquasecurity/trivy-action@<sha>  # 0.x.x
        with:
          scan-type: 'fs'
          scanners: 'vuln,misconfig,secret'
          severity: 'HIGH,CRITICAL'
          ignore-unfixed: true
          exit-code: '1'
          skip-dirs: 'node_modules,apps/mobile/ios,apps/mobile/android'

  trivy-images:
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    strategy:
      matrix:
        image:
          - supabase/auth:v2.188.1
          - centrifugo/centrifugo:v6
          - ghcr.io/axelmarciano/expo-open-ota:v2.3.16
    steps:
      - uses: aquasecurity/trivy-action@<sha>
        with:
          image-ref: ${{ matrix.image }}
          severity: 'HIGH,CRITICAL'
          exit-code: '0'  # informational

  gitleaks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
        with: { fetch-depth: 0 }
      - uses: gitleaks/gitleaks-action@<sha>
        env: { GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
```

`.gitleaks.toml`:

```toml
[extend]
useDefault = true

[allowlist]
description = "Project allowlist"
regexTarget = "match"
regexes = [
  # Anon JWT shipped to mobile/web clients; public-by-design, abuse-mitigated by
  # GoTrue rate limit + Turnstile. If rotated, replace this regex.
  '''<JWT-regex>''',
]
paths = [
  '''<app>/config\.json''',
  '''apps/backend/src/__tests__/.*\.test\.ts''',
]
```

`.trivyignore`:
```
# nginx official image runs as root to bind port 80. Tracked separately.
DS-0002
```

### 13.7 `.github/dependabot.yml`

```yaml
version: 2
updates:
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule: { interval: "weekly" }
    labels: ["dependencies", "ci"]
    open-pull-requests-limit: 5

  - package-ecosystem: "docker"
    directory: "/"
    schedule: { interval: "weekly" }
    labels: ["dependencies", "docker"]

  - package-ecosystem: "docker"
    directory: "/apps/web"
    schedule: { interval: "weekly" }
    labels: ["dependencies", "docker", "web"]

  - package-ecosystem: "npm"
    directory: "/"
    schedule: { interval: "weekly" }
    labels: ["dependencies", "npm"]
    open-pull-requests-limit: 10
    groups:
      production-deps:
        dependency-type: "production"
        update-types: ["minor", "patch"]
      dev-deps:
        dependency-type: "development"
        update-types: ["minor", "patch"]

  # Repeat the npm block per workspace
  - package-ecosystem: "npm"
    directory: "/apps/backend"
    schedule: { interval: "weekly" }
    labels: ["dependencies", "npm", "backend"]
    groups:
      production-deps: { dependency-type: "production", update-types: ["minor","patch"] }
      dev-deps:        { dependency-type: "development", update-types: ["minor","patch"] }

  # … one per workspace (mobile, web, website, shared)
```

---

## 14. Deploy target — OVH VM

The same SSH-based pattern transfers to any IaaS that gives you a Linux box with Docker. Recommended OVH specs to start (single-product, ~10k MAU):

| Resource | Suggested baseline |
| --- | --- |
| Instance | OVH Public Cloud "B3-16" (Ryzen-7-class) or "S1-8" (general purpose) |
| OS | Ubuntu 24.04 LTS |
| RAM | 8 GB minimum, 16 GB recommended |
| vCPU | 4 |
| Disk | 80 GB SSD (system) + 40 GB SSD volume for backups |
| Network | Public IPv4 + IPv6 |
| Firewall | OVH "infrastructure security" rule set: 22 (or custom SSH port), 80, 443 only |
| Backup | OVH-side weekly snapshot |

### 14.1 First-time VM setup

```bash
# As root via OVH console:
adduser ubuntu --gecos "" --disabled-password
usermod -aG sudo ubuntu
echo "ubuntu ALL=(ALL) NOPASSWD:ALL" >/etc/sudoers.d/ubuntu

# SSH key for GitHub Actions deploy
mkdir -p /home/ubuntu/.ssh
cat >>/home/ubuntu/.ssh/authorized_keys <<'EOF'
<paste your deploy key public part>
EOF
chmod 700 /home/ubuntu/.ssh
chmod 600 /home/ubuntu/.ssh/authorized_keys
chown -R ubuntu:ubuntu /home/ubuntu/.ssh

# Optional: change SSH port
sed -i 's/^#Port 22$/Port 2222/' /etc/ssh/sshd_config
systemctl restart ssh

# Docker
apt update && apt -y install ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | tee /etc/apt/sources.list.d/docker.list >/dev/null
apt update && apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker ubuntu

# Directory skeleton
mkdir -p /opt/<app> /opt/<app>-staging /opt/infra /var/www/<app>-website
chown -R ubuntu:ubuntu /opt/<app> /opt/<app>-staging /var/www/<app>-website

# External networks (must exist BEFORE any compose up)
docker network create gateway --driver bridge
docker network create infra_internal --driver bridge

# Clone infra repo (Caddy + Postgres) into /opt/infra
# Clone product repo into /opt/<app>

# UFW firewall (if not handled at the OVH layer)
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp     # or your custom SSH port
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

### 14.2 First-time DNS

In Cloudflare:

1. Add `<root>` as a zone (orange-cloud proxy ON for `<root>` and `app.<root>`, OFF for `auth.<root>`, `api.<root>`, `ws.<root>`, `ota.<root>` initially; can flip ON later once Caddy is happy).
2. A records for every subdomain pointing at `<server-ip>`.
3. Apex: `<root>` A → `<server-ip>` and `www.<root>` CNAME → `<root>`.
4. Issue a Cloudflare Origin Certificate for `*.<root>` + `<root>` (15-year). Paste into `/etc/caddy/certs/<root>.pem` + `.key`.
5. SSL/TLS → set to **Full (Strict)**.
6. Bot Fight Mode → ON for `<root>` only (use a Configuration Rule scoped to `host eq "<root>"`).
7. Turnstile → create a site key + secret key.

### 14.3 Bootstrap the infra stack

```bash
cd /opt/infra
git clone <infra-repo-url> .
cp .env.example .env
# Edit .env: POSTGRES_PASSWORD, OAuth client IDs/secrets, JWT secrets, etc.
docker compose --env-file /opt/infra/.env up -d
# Wait for postgres healthy then run:
docker exec postgres psql -U postgres -c "CREATE DATABASE <app>;"
docker exec postgres psql -U postgres -c "CREATE DATABASE <app>_staging;"
docker exec postgres psql -U postgres -c "CREATE ROLE <app> WITH LOGIN PASSWORD '<pwd>';"
docker exec postgres psql -U postgres -c "GRANT ALL ON DATABASE <app> TO <app>;"
docker exec postgres psql -U postgres -c "GRANT ALL ON DATABASE <app>_staging TO <app>;"
docker exec postgres psql -U postgres -c "CREATE ROLE app WITH LOGIN PASSWORD '<app-pwd>';"
docker exec postgres psql -U postgres -d <app> -c "GRANT pg_monitor TO app;"
```

### 14.4 Bootstrap the product stack

```bash
cd /opt/<app>
git clone <product-repo-url> .
git checkout main
cp apps/backend/.env.example apps/backend/.env.production
# Fill in DATABASE_URL, GOTRUE_*, CENTRIFUGO_*, R2_*, STRIPE_*, etc.

# OTA keys (already generated locally and scp'd here)
mkdir -p ota/keys
scp <local>/credentials/private-key.pem  /opt/<app>/ota/keys/private-key.pem
scp <local>/credentials/public-key.pem   /opt/<app>/ota/keys/public-key.pem
chmod 600 ota/keys/*.pem

# Apple .p8 (if Sign in with Apple)
mkdir -p secrets
scp <local>/AuthKey_<KEY_ID>.p8 /opt/<app>/secrets/apple-key.p8
chmod 600 secrets/apple-key.p8
chown root:root secrets/apple-key.p8

# Bring up containers
docker compose --env-file /opt/infra/.env -f docker-compose.yml up -d

# Apply all migrations to a fresh DB (one-shot bootstrap)
for f in apps/backend/supabase/migrations/*.sql; do
  docker exec -i postgres psql -U <app> -d <app> -v ON_ERROR_STOP=1 < "$f"
done
for f in apps/backend/supabase/seeds/*.sql; do
  docker exec -i postgres psql -U <app> -d <app> -v ON_ERROR_STOP=1 < "$f"
done

# Record the deployed SHA
git rev-parse HEAD > /opt/<app>/.last-deployed-sha
```

### 14.5 Caddy add stanzas

Append the §9 stanzas to `/opt/infra/Caddyfile`, then:

```bash
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

### 14.6 Manual escape-hatch deploy (`deploy.sh` at repo root)

```bash
#!/bin/bash
set -e

SERVER="ubuntu@<server-ip>"
SSH_PORT=2222
PROJECT_DIR="/opt/<app>"

echo "==> Deploying <App> API to OVH..."

ssh -p $SSH_PORT $SERVER "cd $PROJECT_DIR && \
  git pull origin main && \
  docker compose build --no-cache <app>-api && \
  docker compose up -d <app>-api && \
  docker image prune -f && \
  echo '==> Waiting for health check...' && \
  sleep 5 && \
  docker compose ps"

echo "==> Checking health endpoint..."
curl -sf https://api.<root>/health && echo "" || echo "Health check failed!"

echo "==> Deploy complete."
```

---

## 15. Secrets inventory

### 15.1 GitHub Actions secrets (the full list)

| Secret | Used by | Purpose |
| --- | --- | --- |
| `SERVER_HOST` | all SSH workflows | OVH VM hostname/IP |
| `SERVER_SSH_KEY` | all SSH workflows | Private key for `ubuntu@<host>` |
| `OTA_PRIVATE_KEY` | mobile-ota | PEM-encoded RSA key (signs OTA bundles) |
| `OTA_ORIGIN_IP` | mobile-ota | VM IP for `/etc/hosts` pin |
| `EXPO_TOKEN` | mobile-ota | Expo personal access token |
| `MOBILE_ENV_API_URL` | mobile-ota | Inlined into mobile JS bundle |
| `MOBILE_ENV_SUPABASE_URL` | mobile-ota | " |
| `MOBILE_ENV_SUPABASE_ANON_KEY` | mobile-ota | " |
| `MOBILE_ENV_CENTRIFUGO_URL` | mobile-ota | " |
| `STAGING_OPENAI_API_KEY` | deploy-staging | Upserted into `.env.staging` |
| `STAGING_R2_ACCOUNT_ID` | deploy-staging | " |
| `STAGING_R2_BUCKET` | deploy-staging | " |
| `STAGING_R2_ACCESS_KEY_ID` | deploy-staging | " |
| `STAGING_R2_SECRET_ACCESS_KEY` | deploy-staging | " |
| `STAGING_STRIPE_SECRET_KEY` | deploy-staging | " |
| `STAGING_STRIPE_WEBHOOK_SECRET` | deploy-staging | " |
| `<APP>_SUPABASE_ANON_KEY` | deploy (Docker build args) | Baked into SPA bundle at build |
| `<APP>_TURNSTILE_SITE_KEY` | deploy | " |
| `<APP>_STAGING_SUPABASE_ANON_KEY` | deploy-staging | " |
| `<APP>_STAGING_TURNSTILE_SITE_KEY` | deploy-staging | " |

### 15.2 Host env files

| File | Loaded by | Contents |
| --- | --- | --- |
| `/opt/infra/.env` | `docker compose --env-file` (both stacks) | `POSTGRES_PASSWORD`, OAuth client IDs/secrets, JWT secrets used for compose interpolation, captcha keys, `EXPO_ACCESS_TOKEN`, `OTA_JWT_SECRET`, `OTA_ADMIN_PASSWORD`, `<APP>_SUPABASE_ANON_KEY` (also referenced as a build arg by web compose) |
| `/opt/<app>/apps/backend/.env.production` | `<app>-api` via `env_file:` | DATABASE_URL, GOTRUE_*, CENTRIFUGO_*, R2_*, STRIPE_*, OPENAI_API_KEY, CRON_SECRET, CORS_ORIGINS, etc. |
| `/opt/<app>-staging/apps/backend/.env.staging` | `<app>-api-staging` via `env_file:` | Same shape, staging values |
| `/opt/<app>/secrets/apple-key.p8` | `scripts/rotate-apple-jwt/rotate.sh` | Apple Sign-In private key, mode 600 root:root |
| `/opt/<app>/ota/keys/private-key.pem` | `ota-<app>` volume mount (RO) | Signs OTA manifests, mode 600 |
| `/opt/<app>/ota/keys/public-key.pem` | `ota-<app>` volume mount (RO) | Embedded in mobile binary at build, mode 600 |

Critical: `apps/backend/.env.production` is **preserved across `git reset --hard`** in the deploy workflow:

```bash
cp apps/backend/.env.production /tmp/.env.production.bak 2>/dev/null || true
git reset --hard origin/main
cp /tmp/.env.production.bak apps/backend/.env.production 2>/dev/null || true
```

If the file vanishes (e.g. someone runs `git clean -fdx`), restore it from the running container before any `up -d`:

```bash
docker inspect <app>-api --format '{{ range .Config.Env }}{{ . }}{{ "\n" }}{{ end }}' > apps/backend/.env.production
```

---

## 16. Apple OAuth automation

Apple's `client_secret` is a **JWT signed with ES256** by a `.p8` private key. Max 6-month TTL — rotate monthly to be safe.

### 16.1 Pieces

- `/opt/<app>/secrets/apple-key.p8` (mode 600 root:root) — the `.p8` from Apple Developer → Keys.
- `scripts/rotate-apple-jwt/gen-jwt.mjs` — Node script, signs ES256 JWT from env:
  ```js
  // Reads APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_SERVICES_ID,
  // APPLE_KEY_PATH, APPLE_JWT_TTL_DAYS (default 180). Prints JWT to stdout.
  ```
- `scripts/rotate-apple-jwt/rotate.sh` — bash wrapper: runs `gen-jwt.mjs`, atomically rewrites `<APP>_APPLE_SECRET=…` in `/opt/infra/.env` with timestamped backup, then `docker compose up -d --force-recreate gotrue-<app>`. Warns if `.p8` is older than 330 days.
- `scripts/rotate-apple-jwt/<app>-apple-jwt-rotate.service` — systemd oneshot, runs as root.
- `scripts/rotate-apple-jwt/<app>-apple-jwt-rotate.timer`:
  ```ini
  [Timer]
  OnCalendar=*-*-01 03:00:00 UTC
  Persistent=true
  RandomizedDelaySec=1h
  Unit=<app>-apple-jwt-rotate.service
  ```
  `Persistent=true` catches up missed runs after host downtime.
- `scripts/rotate-apple-jwt/install.sh` — one-time installer copying units into `/etc/systemd/system/`.

### 16.2 First-time install

```bash
cd /opt/<app>/scripts/rotate-apple-jwt
sudo ./install.sh
sudo systemctl enable --now <app>-apple-jwt-rotate.timer
sudo systemctl start <app>-apple-jwt-rotate.service  # do the first rotation now
journalctl -u <app>-apple-jwt-rotate.service -e
```

### 16.3 Apple flow summary

- The `client_id` value in GoTrue is **comma-separated**: web Services ID first, iOS Bundle ID second.
- Sign in with Apple consent screen: keep "Hide my email" disabled if you want a real email back. If a user enables it, you get `<random>@privaterelay.appleid.com` — that's the real address for that user, and email delivery works through Apple's relay.
- Apple's "ASWebAuthenticationSession" callback URL must be `https://auth.<root>/callback` exactly — pre-register in Apple Developer → Services IDs → Sign in with Apple Configure.
- Mobile uses native `expo-apple-authentication`, NOT the OAuth web flow — it sends the identity token directly to GoTrue's `/token?grant_type=id_token`. The `.p8` is still needed server-side because GoTrue must verify Apple's token issuer chain.

---

## 17. Cross-cutting patterns worth keeping verbatim

### 17.1 Two compose stacks, two repo clones, shared external networks

`docker-compose.yml`:

```yaml
networks:
  gateway:
    external: true
  infra_internal:
    external: true
```

`docker-compose.staging.yml`:

```yaml
networks:
  gateway:
    external: true
  infra_internal:
    external: true
```

Both reference the same external networks so containers from either stack can reach the shared Postgres and pass through the same Caddy.

### 17.2 Healthchecks on every API container

```yaml
healthcheck:
  test: ["CMD", "wget", "--spider", "-q", "http://localhost:4000/health"]
  interval: 30s
  timeout: 5s
  retries: 3
  start_period: 10s
```

API exposes `/health`, `/health/live`, `/health/ready`. `/health` returns `{status: "ok"}` unconditionally. `/health/ready` runs `SELECT 1`. The deploy script grep-checks `docker compose ps` for `(healthy)` before claiming success.

### 17.3 Resource limits on every container

```yaml
deploy:
  resources:
    limits:
      memory: 256M
      cpus: '0.50'
```

Prevents one runaway container (a leaked Centrifugo connection, a stuck Node event loop) from starving its siblings on a small VM.

### 17.4 SCHEDULER_ENABLED guard

Set `SCHEDULER_ENABLED=false` on any environment that shares another env's database. The in-process `node-cron` would otherwise fire identical jobs at the same minute from two API containers.

### 17.5 `.dockerignore`

```
node_modules/
dist/
build/
coverage/
.git/
.env
.env.*
!.env.example
apps/mobile/
Docs/
Specs/
.DS_Store
*.log
*.tsbuildinfo
firebase-service-account.json
.mcp.json
.claude/
```

Excludes the mobile workspace (large; not needed for API/web Docker builds) and every `.env*` file except templates.

### 17.6 Cloudflare Origin Cert + `NODE_TLS_REJECT_UNAUTHORIZED=0` for CI publish

Caddy serves a Cloudflare Origin Certificate — signed by Cloudflare's private CA, not in Node's default trust store. Any CI step that has to bypass Cloudflare (via `/etc/hosts` pin to the origin IP) MUST set `NODE_TLS_REJECT_UNAUTHORIZED=0`. Acceptable when the payload is independently signed (OTA bundles are RSA-signed and verified by the client).

### 17.7 Trust-proxy + CF-Connecting-IP

GoTrue: `GOTRUE_RATE_LIMIT_HEADER: "CF-Connecting-IP"`.
API: `app.set('trust proxy', env.TRUSTED_PROXY_HOPS)` (default 1, for Caddy). Without these two, rate limiting fires on Caddy's container IP for every request.

### 17.8 Static runtimeVersion + fingerprint baseline

Don't use `{ policy: "fingerprint" }` in `app.config.ts`. Pin a static hex string and commit `.native-fingerprint.json`. CI compares; the human controls when to re-baseline.

### 17.9 Three permission strings

- `ios.infoPlist.NS*UsageDescription` — defense-in-depth source of truth
- Plugin options (e.g. `expo-camera`'s `cameraPermission`) — also set
- Per-plugin permission overlays — also set if applicable

Plugin mod ordering has historically wiped sibling contributions; redundancy is the workaround.

### 17.10 Self-hosted OTA over EAS Update

Less vendor lock-in, no per-update charge, and you control the manifest format. The trade-off is operating one more container + signing key — both manageable.

---

## 18. New-product bootstrap checklist

A condensed onboarding sequence:

1. **Domain + Cloudflare**
   - [ ] Buy `<root>` domain
   - [ ] Add to Cloudflare as a zone
   - [ ] Issue Origin Certificate for `*.<root>` + `<root>`
   - [ ] Set up Turnstile site key + secret key
   - [ ] Create R2 bucket + access keys
   - [ ] Configure DNS A records for all subdomains
   - [ ] Bot Fight Mode ON for `<root>` only (Configuration Rule)

2. **OVH VM**
   - [ ] Provision Ubuntu 24.04 LTS, 4 vCPU / 16 GB / 80 GB
   - [ ] Create `ubuntu` user, install SSH key, configure sudo
   - [ ] Install Docker + Docker Compose
   - [ ] Create `gateway` + `infra_internal` external networks
   - [ ] Clone infra repo to `/opt/infra/`, bring up Caddy + Postgres
   - [ ] Create `<app>` + `<app>_staging` databases + roles
   - [ ] Paste Origin Cert into `/etc/caddy/certs/`

3. **Repos**
   - [ ] Copy this template into a new repo `<app>`
   - [ ] Replace every `<app>`, `<App>`, `<org>`, `<root>` placeholder
   - [ ] Generate JWT secret: `openssl rand -hex 48`
   - [ ] Generate Centrifugo HMAC + API key: `openssl rand -hex 32` (×2)
   - [ ] Configure GitHub Actions secrets (§15.1)

4. **Auth providers**
   - [ ] Apple Developer: create App ID, Services ID, Sign in with Apple Key (.p8)
   - [ ] Configure return URLs: `https://auth.<root>/callback` AND `https://auth-staging.<root>/callback`
   - [ ] scp `.p8` to `/opt/<app>/secrets/apple-key.p8` (mode 600 root:root)
   - [ ] Google Cloud Console: OAuth client ID + secret, both web and iOS variants
   - [ ] Set client IDs/secrets in `/opt/infra/.env`

5. **OTA**
   - [ ] `cd apps/mobile && npx eoas generate-certs`
   - [ ] Commit `credentials/certificate.pem`
   - [ ] Save private key as `OTA_PRIVATE_KEY` GH secret
   - [ ] scp private + public keys to `/opt/<app>/ota/keys/` (mode 600)

6. **Mobile**
   - [ ] Apple Developer: create bundle id, push key, App Store Connect app
   - [ ] Google Play Console: create app, upload service account JSON
   - [ ] Configure RevenueCat (or Stripe-only) for IAP
   - [ ] Configure Expo Push project on Expo dashboard
   - [ ] EAS project: `eas init` → set `eas.projectId` in `app.config.ts`
   - [ ] Run `npx expo prebuild --clean` once, apply prebuild-survival fixes, commit assets
   - [ ] First native build via `eas build --profile production --platform all`
   - [ ] First store submission via `eas submit --profile production`
   - [ ] Baseline fingerprint: `.native-fingerprint.json` commit

7. **Web SPA + Marketing**
   - [ ] Add Caddy stanzas for `app.<root>`, `app-staging.<root>`, `<root>`
   - [ ] First deploy via GitHub Actions push to `main`
   - [ ] Verify SPA via `https://app.<root>`
   - [ ] Verify marketing via `https://<root>`

8. **Apple JWT automation**
   - [ ] `cd scripts/rotate-apple-jwt && sudo ./install.sh`
   - [ ] `sudo systemctl enable --now <app>-apple-jwt-rotate.timer`
   - [ ] First manual rotation: `sudo systemctl start <app>-apple-jwt-rotate.service`

9. **Smoke test**
   - [ ] `/health` returns 200 on all 4 API hosts (api, api-staging)
   - [ ] `GET /api/v1/profiles/me` requires Bearer token
   - [ ] Sign up via SPA, confirm email arrives, sign in
   - [ ] Sign in with Apple from iOS test device
   - [ ] Push notification round-trip
   - [ ] OTA: push a JS change to `main`, watch mobile-ota workflow, restart app

---

## 19. Common gotchas worth knowing up-front

1. **Postgres migrations don't auto-apply in prod.** Either use the `.prod-bootstrap-migrations` list (idempotent SQL), or run them manually over SSH. The staging deploy workflow handles new files, but only for the staging DB.

2. **`apps/backend/.env.production` lives on the host**, not in the repo. The deploy workflow preserves it across `git reset --hard`. If it vanishes, reconstruct from the running container via `docker inspect`.

3. **OTA private key going missing fails silently.** Signed manifest fetches return 200 from the server but the `expo-updates` client rejects them. Test signed updates with the client, not `curl`.

4. **Pod install needs UTF-8 locale** on macOS: `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install --repo-update`. Without this, CocoaPods 1.16+ crashes on ASCII-8BIT.

5. **AD-bound Mac users** need the Podfile `post_install` block (§12.9) or every archive fails with `chown: <DOMAIN>\Domain Users: illegal group name`.

6. **iOS version bumps go in TWO places**: `apps/mobile/app.config.ts` AND `ios/<Name>/Info.plist` (Xcode reads the plist, not the config).

7. **Cloudflare Bot Fight Mode on `auth.<root>`** silently breaks mobile login. Keep it apex-only.

8. **`SCHEDULER_ENABLED=false`** on any environment that shares another env's DB.

9. **Pin every external action by SHA** with a version tag in a trailing comment. Floating tags get hijacked.

10. **Cloudflare R2 needs all four env vars together** (`R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`). Missing any → backend routes degrade with 503.

11. **Postgres `gotrue` schema is owned by GoTrue**. Do not edit `auth.*` tables directly. Override `auth.uid()` from your own migration (it's not a GoTrue-managed object).

12. **Centrifugo HMAC secret must match between Centrifugo's config and the API's JWT signer.** Same with the API key (used for outbox proxy). Single source of truth is `/opt/infra/.env`; compose interpolates.

13. **Tailwind v4 has no config file.** Tokens live in CSS via `@theme { … }`. There is no `tailwind.config.js` to look for.

14. **The marketing site has no `.env`.** All URLs are constants in `apps/website/src/data/seo.ts` and `astro.config.mjs`. Don't try to template them — Astro builds once per release, not per environment.

15. **Apple has no API for creating keys.** Yearly `.p8` rotation requires a human in the Apple Developer portal. The GitHub Actions workflow only opens a tickler issue.

---

## 20. Recommended further reading

When ramping up a new contributor, point them at these inline files in the new repo (substitute names appropriately — none of them ship by default but they're listed here so you know to write them):

- `Docs/Specs/docker-deploy-guide.md` — Caddy stanza details, hostnames, troubleshooting
- `apps/web/DEPLOY.md` — SPA deploy runbook (Turnstile, CSP, CORS)
- `apps/mobile/OTA.md` — mobile OTA architecture (signing, channels, fingerprint)
- `ota/README.md` — OTA server operations (keys, backups, restore)
- `scripts/rotate-apple-jwt/README.md` — Apple key rotation procedure
- `apps/backend/scripts/refresh-staging.sh` — staging-from-prod refresh
- `.github/workflows/*` — six workflow files, each ~150-300 lines, heavily commented

---

## Appendix A — Full file tree skeleton

```
<app>/
├── .github/
│   ├── workflows/
│   │   ├── deploy.yml
│   │   ├── deploy-staging.yml
│   │   ├── staging-apply-migration.yml
│   │   ├── mobile-ota.yml
│   │   ├── check-apple-key-age.yml
│   │   └── security-scan.yml
│   └── dependabot.yml
├── .dockerignore
├── .gitignore
├── .gitleaks.toml
├── .npmrc
├── .prettierrc.json
├── .trivyignore
├── Dockerfile
├── apps/
│   ├── backend/
│   │   ├── jest.config.js
│   │   ├── package.json
│   │   ├── scripts/
│   │   ├── public/
│   │   ├── src/...
│   │   ├── supabase/
│   │   │   ├── .prod-bootstrap-migrations
│   │   │   ├── .staging-bootstrap-migrations
│   │   │   ├── migrations/NNN_*.sql
│   │   │   └── seeds/001_*.sql
│   │   ├── tsconfig.json
│   │   ├── .env.example
│   │   └── .env.staging.example
│   ├── mobile/
│   │   ├── app.config.ts
│   │   ├── eas.json
│   │   ├── index.ts
│   │   ├── App.tsx
│   │   ├── metro.config.js
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── credentials/certificate.pem        # committed
│   │   ├── credentials/private-key.pem        # gitignored
│   │   ├── credentials/public-key.pem         # gitignored
│   │   ├── .env.development                   # gitignored
│   │   ├── .env.production                    # gitignored
│   │   ├── .env.example
│   │   ├── .native-fingerprint.json
│   │   ├── assets/
│   │   ├── modules/                           # local Expo config plugins
│   │   ├── scripts/build-android-aab.sh
│   │   ├── scripts/install-aab-on-device.sh
│   │   ├── src/...
│   │   └── web/index.html
│   ├── web/
│   │   ├── Dockerfile
│   │   ├── nginx.conf
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── public/
│   │   └── src/...
│   └── website/
│       ├── astro.config.mjs
│       ├── package.json
│       ├── tsconfig.json
│       ├── public/
│       │   ├── robots.txt
│       │   ├── llms.txt
│       │   ├── llms-full.txt
│       │   ├── _redirects
│       │   └── .well-known/
│       └── src/
├── centrifugo/
│   └── config.json
├── deploy.sh
├── docker-compose.yml
├── docker-compose.staging.yml
├── eslint.config.mjs
├── gotrue-templates/
│   ├── confirmation.html
│   └── recovery.html
├── ota/
│   ├── keys/.gitkeep
│   └── README.md
├── package.json
├── package-lock.json
├── packages/
│   └── shared/
│       ├── package.json
│       └── src/
│           ├── api/
│           ├── auth/
│           ├── config/
│           ├── i18n/
│           ├── locales/{en,it}.json
│           ├── realtime/
│           ├── services/
│           ├── storage/
│           ├── stores/
│           ├── supabase/
│           ├── tokens/
│           ├── types/
│           ├── utils/
│           └── index.ts
├── patches/                                    # patch-package
├── scripts/
│   ├── rotate-apple-jwt/
│   │   ├── gen-jwt.mjs
│   │   ├── rotate.sh
│   │   ├── install.sh
│   │   ├── <app>-apple-jwt-rotate.service
│   │   ├── <app>-apple-jwt-rotate.timer
│   │   └── README.md
│   └── setup-stripe-products.ts
└── tsconfig.json
```

---

## Appendix B — Minimum viable env files

`apps/backend/.env.example`:

```
NODE_ENV=production
PORT=4000

DATABASE_URL=postgres://<app>:<password>@postgres:5432/<app>

GOTRUE_URL=https://auth.<root>
GOTRUE_JWT_SECRET=<at-least-32-chars>
GOTRUE_JWT_ISSUER=https://auth.<root>
GOTRUE_JWT_AUDIENCE=
GOTRUE_SERVICE_ROLE_KEY=

CENTRIFUGO_API_URL=http://centrifugo-<app>:8000/api
CENTRIFUGO_API_KEY=<hex>
CENTRIFUGO_PROXY_SECRET=<hex>

CORS_ORIGINS=https://app.<root>,https://<root>
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=300
TRUSTED_PROXY_HOPS=1

BACKEND_URL=https://api.<root>
WEB_PUBLIC_URL=https://app.<root>

SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=noreply@<root>
HELPDESK_TO=ops@<root>

CRON_SECRET=<hex>
TURNSTILE_SECRET_KEY=
TURNSTILE_FAIL_OPEN=false

OPENAI_API_KEY=

R2_ACCOUNT_ID=
R2_BUCKET=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=

STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_ID_MONTHLY=
STRIPE_PRICE_ID_ANNUAL=

REVENUECAT_WEBHOOK_AUTH=

SCHEDULER_ENABLED=true
```

`apps/mobile/.env.example`:

```
APP_ENV=development
OTA_CHANNEL=development

API_URL=http://localhost:4000
SUPABASE_URL=https://auth-staging.<root>
SUPABASE_ANON_KEY=<staging-anon-jwt>
CENTRIFUGO_URL=wss://ws-staging.<root>/connection/websocket

REVENUECAT_API_KEY_IOS=
REVENUECAT_API_KEY_ANDROID=

DEV_LOGIN_EMAIL=
DEV_LOGIN_PASSWORD=
```

`apps/web/.env.example`:

```
VITE_API_URL=http://localhost:4000
VITE_SUPABASE_URL=https://auth-staging.<root>
VITE_SUPABASE_ANON_KEY=<staging-anon-jwt>
VITE_CENTRIFUGO_URL=wss://ws-staging.<root>/connection/websocket
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA

# Dev-only proxy targets (used by vite.config.ts when present)
VITE_SUPABASE_PROXY_TARGET=
VITE_SUPABASE_URL_REAL=
VITE_CENTRIFUGO_PROXY_TARGET=
```

`/opt/infra/.env.example` (lives in the infra repo, but listed here for completeness):

```
POSTGRES_PASSWORD=<hex>
APP_PG_PASS=<hex>            # least-privilege role for Centrifugo

# Per-app JWT/HMAC secrets — paired with the app's docker-compose interpolation
<APP>_JWT_SECRET=<hex>
<APP>_STAGING_JWT_SECRET=<hex>
CENTRIFUGO_<APP>_HMAC_SECRET=<hex>
CENTRIFUGO_<APP>_API_KEY=<hex>
CENTRIFUGO_<APP>_STAGING_HMAC_SECRET=<hex>
CENTRIFUGO_<APP>_STAGING_API_KEY=<hex>

# OAuth providers (shared between prod and staging GoTrue)
<APP>_GOOGLE_ENABLED=true
<APP>_GOOGLE_CLIENT_ID=
<APP>_GOOGLE_SECRET=
<APP>_APPLE_ENABLED=true
<APP>_APPLE_CLIENT_ID=com.<org>.<app>.auth,com.<org>.<app>
<APP>_APPLE_SECRET=

# Captcha
<APP>_TURNSTILE_SECRET_KEY=

# SPA build args (read by docker-compose.yml args:)
<APP>_SUPABASE_ANON_KEY=
<APP>_TURNSTILE_SITE_KEY=
<APP>_STAGING_SUPABASE_ANON_KEY=
<APP>_STAGING_TURNSTILE_SITE_KEY=

# OTA server
EXPO_ACCESS_TOKEN=
OTA_JWT_SECRET=<hex>
OTA_ADMIN_PASSWORD=<hex>

# SMTP (shared)
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
```

— end of boilerplate —
