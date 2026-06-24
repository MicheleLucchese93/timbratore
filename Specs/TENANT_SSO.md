# Per-tenant SSO (company SSO)

- **Status:** Draft / proposed (no code yet)
- **Author:** product + Claude analysis session
- **Date:** 2026-06-24
- **Scope:** Let each tenant bring its own enterprise identity provider (e.g. tenant A and tenant B both on Microsoft Entra, but different directories / app registrations) for login on **web and mobile**, while keeping email+password for tenants that don't use SSO.

---

## 1. Goal

Enterprise / larger customers want their employees to sign in with the company IdP (Microsoft Entra, Okta, Google Workspace) instead of a sonoQui-specific password. Requirements:

1. **Per-tenant IdP config.** Two tenants can both use Microsoft but with separate Entra directories / app registrations / certificates. Configurable per tenant, no redeploy.
2. **Mixed mode.** SSO and password tenants coexist. A tenant can mandate SSO (disable password) or allow both.
3. **No client rewrite of the tenant model.** Reuse the existing membership + tenant-chooser flow.
4. **Web and mobile.** Both clients support the SSO redirect flow.

---

## 2. Decision

**Use GoTrue's native SAML 2.0 multi-IdP support on the existing self-hosted GoTrue.** No new identity service.

Rationale: the auth stack is self-hosted Supabase GoTrue v2.188.1 (`docker-compose.yml`, `gotrue-sonoqui`). GoTrue OSS supports SAML 2.0 with **multiple identity providers registered at runtime** via the admin API, each carrying its own `sso_provider_id` in the issued JWT. Microsoft Entra, Okta, and Google Workspace all expose SAML. This covers the "different Microsoft per tenant" requirement with **no change to the JWT model** — GoTrue still mints the same HS256 token, same issuer, populated from the SAML assertion.

### Alternatives considered

| Option | Per-tenant Microsoft? | Verdict |
|---|---|---|
| GoTrue external OAuth (`GOTRUE_EXTERNAL_*`) | ✗ — one global client per provider type | Dead end. Can't have two Entra app registrations. |
| **GoTrue SAML multi-IdP (one instance)** | ✓ register N providers via admin API | **Chosen.** Smallest change; JWT model untouched. |
| One GoTrue instance per tenant | ✓ | Rejected. Per-tenant issuer → backend multi-issuer validation, gateway routing, container sprawl. High ops cost, no official support. |
| Keycloak (realms or Organizations) | ✓ + OIDC + self-service IdP mgmt | Deferred. Full auth migration (RS256/JWKS, provisioning API swap, all clients). Only if we outgrow GoTrue SAML. |

References:
- Self-hosted SAML config + admin API: https://supabase.com/docs/guides/self-hosting/self-hosted-saml-sso
- `sso_provider_id` + RLS scoping pattern: https://supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml
- SP- vs IdP-initiated routing limits: https://supabase.com/docs/guides/platform/sso/multiple-providers

---

## 3. Current auth (baseline)

- **Provider:** GoTrue v2.188.1, JWT issuer `https://auth-sonoqui.xdevapp.it` (also proxied at `app.sonoqui.pro/auth`, `partners.sonoqui.pro/auth`). HS256, shared secret, 1h expiry.
- **Login:** password grant. Web `apps/web/src/lib/api.ts` → `POST /token?grant_type=password`; mobile `apps/mobile/src/lib/api.ts:263`; partner `apps/partner/src/lib/api.ts`.
- **JWT validation:** `apps/backend/src/lib/jwt.ts` (`jose`), pinned issuer/audience.
- **Tenant resolution:** `apps/backend/src/middleware/auth.ts` — JWT `sub` → `memberships` (one user, 1+ tenants) → `req.user{ tenantId, role, isDocumentale }`. `X-Tenant-Id` header selects among memberships; suspended/revoked → 403 → auto-logout.
- **Tenant chooser:** `apps/web/src/store/session.ts` loads `/api/v1/me/tenants`; multiple → chooser, single → auto-select.
- **Mobile:** Expo, scheme `sonoqui` (`apps/mobile/app.json`), tokens in SecureStore, proactive refresh 60s before expiry. **No existing OAuth/SSO deep-link handler.**

---

## 4. Core principle: SSO proves IDENTITY, not tenant

Pre-auth the app knows only the **email/domain**, not the tenant. SSO answers "are you really `mario@acme.it`?". After auth (password **or** any SSO IdP), the backend does what it already does: resolve all memberships for that GoTrue user, then single→auto / multiple→chooser.

**SSO bolts onto the front of the existing flow.** Only the identity-proof step changes. Multi-tenant is unchanged — the same chooser.

### Login flow (web + mobile)

```
email → Proceed
   → backend discovery: domain → registered SAML provider?
        ├─ yes → redirect to that tenant's IdP (browser / system browser on mobile)
        │         → GoTrue ACS → mints JWT (+ sso_provider_id) → redirect to app
        └─ no  → show password field → GoTrue password grant
   → backend resolves all memberships (JWT sub) — tenant-agnostic
   → 1 tenant: auto-select | ≥2: existing tenant chooser
   → active session; if tenant mandates SSO, verify sso_provider_id else 403
```

---

## 5. Architecture

### 5.1 Enable SAML in GoTrue

Add to `gotrue-sonoqui` env (`docker-compose.yml` + `.env`):

```
GOTRUE_SAML_ENABLED=true
GOTRUE_SAML_PRIVATE_KEY=<base64 PKCS#1 RSA, >=2048-bit>
# optional: GOTRUE_SAML_EXTERNAL_URL, GOTRUE_SAML_RATE_LIMIT_ASSERTION
```

Not a Supabase-hosted feature gate — we self-host, so only the env vars are needed. Mobile/web/partner redirect targets must be in `GOTRUE_URI_ALLOW_LIST` (already includes `sonoqui://auth-callback`, `sonoqui://*`, the web/partner origins).

### 5.2 Provider lifecycle (admin API)

```
POST   /auth/v1/admin/sso/providers     → register IdP (metadata URL/XML, domains, attribute_mapping) → returns sso_provider_id (UUID)
PUT    /auth/v1/admin/sso/providers/{id}
DELETE /auth/v1/admin/sso/providers/{id}
GET    /auth/v1/admin/sso/providers
```

Runtime, no GoTrue restart. Each provider: SAML metadata (per-customer Entra), one or more verified email **domains**, and `attribute_mapping` (email, name, optionally role/group claims into `raw_user_meta_data`).

Who drives it: the **partner/reseller console** (`apps/partner`) is the natural admin surface — partners already provision tenants. Add an "SSO" panel that calls the backend, which proxies the GoTrue admin API (admin key stays server-side). Out of scope for v1: customer self-service IdP onboarding.

### 5.3 Mapping `sso_provider_id` → tenant

New table (additive migration, next number after 044):

```sql
create table sso_provider_tenant (
  sso_provider_id uuid primary key,   -- GoTrue provider UUID
  tenant_id       uuid not null references tenants(id),
  require_sso     boolean not null default false,  -- mandate: block password for this tenant
  created_by      uuid,
  created_at      timestamptz not null default now()
);
```

- One provider → one tenant (v1). If a tenant needs >1 IdP later, relax to provider-many / tenant-one.
- `require_sso` drives mandate enforcement (§5.6).

### 5.4 Discovery endpoint

```
GET /api/v1/auth/sso/discover?email=<addr>
  → { mode: "sso", providerId, tenantHint } | { mode: "password" }
```

Backend extracts the domain, looks up registered providers (cache like the 60s membership cache in `auth.ts`). Used by web and mobile to decide redirect-vs-password (identifier-first). Must not leak which tenants exist beyond the domain the caller already typed; rate-limit it.

### 5.5 JIT provisioning

SSO users won't pre-exist in `memberships`. On first successful SSO login:

1. GoTrue creates/links the user by email (unique-email identity linking) → `auth.users` + mirror `auth_users` (`ensureAuthUser`).
2. Backend: if no active membership for `(user, tenant)` where tenant = map(`sso_provider_id`), create one. Role from attribute mapping/group claim, default `user`. Respect tenant caps (`max_users`, partnership caps in migration 044).
3. Audit the JIT create (reuse `audit_log` / `partnership_audit_log`).

**Email-alignment gotcha:** memberships must key on the email the SAML assertion emits. If a membership was provisioned under a different address (e.g. a personal gmail), the SSO identity won't see it → different `sub`. Provisioning UI must warn/align.

### 5.6 Per-tenant SSO mandate

Cannot enforce at the password step (tenant unknown there). Enforce **after** auth in `auth.middleware`:

- JWT carries `sso_provider_id` (and `amr`) when authenticated via SSO.
- When resolving a membership whose tenant has `require_sso = true`: if the token's `sso_provider_id` ≠ the tenant's mapped provider → **403 for that tenant** (other tenants in the chooser stay reachable).
- Client-side hiding of the password box is UX only, not enforcement.

---

## 6. Login UX

Identifier-first. Two discovery behaviours:

- **Auto-redirect** (recommended for `require_sso` tenants): domain has SSO → skip straight to IdP, password never shown. Downside: blocked if IdP down.
- **Show both** (default otherwise): password field + "Continue with SSO" button.

Recommendation: auto-redirect when the discovered provider's tenant mandates SSO; otherwise show both.

### 6.1 Web (`apps/web`)

- `Login.tsx`: add email-first step → call discovery → branch. SSO branch: `window.location` to GoTrue SSO authorize (`/auth/v1/sso?domain=` or `?provider_id=`), `redirect_to` = app callback.
- New `/auth/callback` route: parse `access_token`/`refresh_token` from URL fragment, store under existing `sonoqui.*` keys, then run the normal post-login (`/me/tenants` → chooser). Reuse refresh logic in `api.ts`.

### 6.2 Mobile (`apps/mobile`) — must-have, currently absent

Mobile has **no** SSO/deep-link auth today (password+refresh only). Add:

- `expo-auth-session` + `expo-web-browser` (already a dep) to open the GoTrue SSO authorize URL in the system browser / `WebBrowser.openAuthSessionAsync`.
- Redirect URI `sonoqui://auth-callback` (scheme already set in `app.json`; already in `GOTRUE_URI_ALLOW_LIST`).
- Deep-link handler: parse tokens from the returned URL, write to SecureStore (same keys as password flow in `api.ts`), then existing tenant-chooser path.
- Discovery call before opening the browser (same endpoint). Keep proactive refresh unchanged.
- iOS: SSO via system browser/ASWebAuthenticationSession is App-Store-safe (no native Entra SDK needed).

### 6.3 Partner console (`apps/partner`)

No SSO for partner login itself in v1 (platform admins use password). Partner app gains the **SSO management** UI (§5.2) to register/edit a tenant's IdP.

---

## 7. Security considerations

- **SAML signature & encryption:** require signed assertions; consider `GOTRUE_SAML_ALLOW_ENCRYPTED_ASSERTIONS`. Validate entity IDs unique per provider; metadata over HTTPS only.
- **Domain ownership:** only register a domain after the customer proves control (DNS/verified). Otherwise a tenant could claim another's domain and capture logins. Manual verification step in the partner SSO UI.
- **Shared-domain / first-match:** SP-initiated routing picks the first provider for a domain. Don't register the same domain on two providers. For tenants without an exclusive domain, use IdP-initiated (app tile) instead.
- **Admin API key:** GoTrue admin key never leaves the backend; partner UI calls backend, backend proxies.
- **JIT abuse:** JIT only creates memberships for the exact `sso_provider_id`→tenant map; never infers tenant from email domain alone. Respect tenant caps.
- **Mandate bypass:** enforce `require_sso` server-side (§5.6), not in the client.
- **Discovery enumeration:** rate-limit `/sso/discover`; return only sso/password, no tenant identifiers.

---

## 8. Edge cases

| Case | Behaviour |
|---|---|
| User in 2 SSO tenants, same email identity | one SSO login → chooser shows both |
| Tenant A via SSO, tenant B via password, same email | either method → same GoTrue user → chooser shows both |
| Membership under a different email than the assertion | SSO sees only matching-email tenants; align at provisioning |
| Tenant mandates SSO, user tries password | password may authenticate, but 403 for that tenant; other tenants OK |
| IdP down, tenant mandates SSO | no fallback by design; document break-glass (temporary `require_sso=false` by partner) |
| Domain not registered | discovery → password |

---

## 9. Work breakdown

**Backend (`apps/backend`)**
- Migration: `sso_provider_tenant` table (+ RLS: service-role only, like partnership tables).
- `GET /api/v1/auth/sso/discover`.
- Admin proxy routes for GoTrue `/admin/sso/providers` CRUD (partner-role gated).
- `auth.middleware`: read `sso_provider_id` from JWT; mandate enforcement; JIT membership create.
- Wire SAML env into `docker-compose.yml` + `.env.example`; generate `GOTRUE_SAML_PRIVATE_KEY`.

**Web (`apps/web`)**
- `Login.tsx` identifier-first; `/auth/callback` route + token parse; reuse session/chooser.

**Mobile (`apps/mobile`)**
- `expo-auth-session`/`WebBrowser` SSO flow; `sonoqui://auth-callback` handler; SecureStore write; discovery call.

**Partner (`apps/partner`)**
- SSO provider management panel (register/edit/delete, domain verification, `require_sso` toggle).

**Cross-cutting (project convention)**
- Update in-app manual `apps/web/src/pages/Manual.tsx` (+ `Manual.en.ts`) — user-facing change.
- Add Playwright e2e (mutating tier) for SSO discovery + callback; mock or test IdP. See `Specs` e2e notes.
- i18n strings (it default + en) for the new login UI.

---

## 10. Phased rollout

1. **Spike:** enable `GOTRUE_SAML_ENABLED` on a non-prod GoTrue; register one test Entra as SAML; confirm JWT carries `sso_provider_id`. No app changes.
2. **Backend:** migration + discovery + admin proxy + middleware (mandate, JIT). Test with one tenant.
3. **Web:** identifier-first login + callback. One pilot tenant, `require_sso=false`.
4. **Mobile:** deep-link SSO flow. Pilot.
5. **Partner UI:** self-managed provider registration + domain verification.
6. **Enable mandate** per tenant on request; document break-glass.

---

## 11. Out of scope / future

- OIDC-per-tenant (Entra OIDC instead of SAML) — would need a generic OIDC slot GoTrue OSS lacks; revisit with Keycloak.
- Customer self-service IdP onboarding portal.
- SCIM provisioning / deprovisioning (auto-disable on employee offboarding).
- Keycloak migration (Organizations / realm-per-tenant) — only if GoTrue SAML proves limiting.

---

## 12. Open decisions

1. Discovery default: auto-redirect everywhere vs show-both-except-mandated? (proposed: latter)
2. Who registers IdPs in v1 — partner console only, or also tenant admins? (proposed: partner only)
3. Default role for JIT users — always `user`, or map from a group claim? (proposed: `user`, optional claim mapping)
4. One IdP per tenant in v1, or allow multiple from day one? (proposed: one)
5. Break-glass for IdP outage under mandate — partner toggles `require_sso=false`, audited. Acceptable?
