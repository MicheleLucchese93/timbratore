# @sonoqui/partner — reseller / tenant-management console

Standalone SPA for **resellers of sonoQui** (lives at `partners.sonoqui.pro`,
separate from the webapp and mobile app). It lets the platform create and
manage customer tenants without the manual `POST /_internal/provision/tenant`
call.

## Roles (platform-level, outside per-tenant membership)

- **admin** — sees/manages **every** tenant, and creates/manages **partners**.
- **partner** (reseller) — sees/manages **only the tenants they created**,
  bounded by admin-granted caps: how many tenants they may create, and the max
  users / admins / documentali / branches they may set per tenant.

Roles live in `partnership_members` (migration 044), keyed on the existing
GoTrue user (`auth_users`). A user can be a partnership member independently of
any tenant membership.

## What it does

- Create a tenant (sets per-tenant limits, invites the first admin via GoTrue) —
  reuses `lib/provision-tenant.ts`, shared with the internal provisioning route.
- Edit a tenant's limits (never below current usage; partners bounded by caps).
- Suspend / resume a tenant (suspended → its users can't sign in; enforced in the
  auth middleware via `tenants.suspended_at`, default NULL = no change).
- Re-invite a tenant's first admin.
- (admin only) Create / invite partners, edit their caps, (de)activate them.
- **Activity log** — every mutating operation is written to
  `partnership_audit_log` and shown under *Registro attività*.

## Backend surface

`/api/v1/partnership/*` on the shared `sonoqui-api`, guarded by
`middleware/partnership-auth.ts` (`authenticatePartner` + `requirePartnershipAdmin`).
Fully isolated from the per-tenant routes; uses `adminPool` (cross-tenant, no RLS).

## Local dev

```bash
# 1. local backend (dev-token auth, no GoTrue needed)
npm run dev:backend
# 2. partner SPA on http://localhost:5175 (Vite proxies /api + /auth → :4000)
npm run dev:partner
```

`.env.development` leaves `VITE_AUTH_URL` empty → the app logs in via the backend
dev-token shim (`DEV_AUTH_ENABLED=true`). Add a partnership member locally with
the bearer-guarded `POST /api/v1/_internal/e2e/grant-partnership`.

## e2e

```bash
# local backend + partner SPA started automatically (E2E_PARTNER=1)
E2E_PARTNER=1 E2E_MUTATING=1 \
  E2E_PURGE_SECRET=<32+ chars> E2E_TEST_TENANT_ID=<a local tenant uuid> \
  E2E_API_URL=http://localhost:4000 \
  npm run e2e:partner
```

Specs in `e2e/partner/` (admin) and `e2e/partner/user/` (partner role). Fixtures
use the `e2e-*@e2e.local` namespace and are purged at globalTeardown.
