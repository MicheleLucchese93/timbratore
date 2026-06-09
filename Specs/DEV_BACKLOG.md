# SonoQui — Development Backlog (v1 MVP)

**Status:** v0.2, updated 2026-05-24 from [PRD.md](PRD.md) v0.2 + [BOILERPLATE_ARCHITECTURE.md](BOILERPLATE_ARCHITECTURE.md). Product name now locked: **SonoQui**.
**Owner:** Archiva Group product development.
**Target launch:** Q3 2026 (closed beta first; see Phase 9).

---

## How to read this document

This is the implementation backlog the dev team works from. It assumes the reader has read the PRD and the BOILERPLATE_ARCHITECTURE document at least once. Every task carries:

- **ID** — stable identifier (`TASK-<epic>-<n>`) for cross-reference in commits/PRs/issues.
- **Refs** — PRD section / boilerplate section / Q&A item it satisfies.
- **Depends on** — task IDs that must finish first.
- **DoD (Definition of Done)** — observable acceptance criteria, not just "code written".
- **Suggested owner** — role on the team (BE = backend, MOB = mobile, WEB = web, INFRA = devops/infra, QA, LEGAL, PM, DESIGN). Not a person; assign at sprint planning.
- **Estimate band** — S (≤1 day), M (1–3 days), L (3–7 days), XL (1–3 weeks). Bands are deliberately coarse; refine in sprint planning.

The phases are not strict gates: many run in parallel. The "depends on" graph is the actual ordering signal. Recommended parallelism per phase is called out at the start of each section.

**MVP scope absorbed from PRD edits (load-bearing — do not add scope without PRD update):**

- No public signup. Tenants created directly in DB by Archiva back-office (psql / admin scripts). The `tenants` table carries `max_admins` and `max_users` integer columns; admin dashboard surfaces a counter.
- No Stripe in MVP. Billing managed manually outside the product. No `subscription_tier`, no Checkout, no `requirePremium` middleware paths used in MVP. Stripe webhook routes from boilerplate stay mounted but inert.
- Mobile native only via Expo. **No PWA in MVP.** RN-Web target stays in the boilerplate but is not a v1 distribution channel.
- Web app is admin-only in MVP (the employee web flow is mobile-only).
- The "you are 230m from branch" live preview before tap is **out** — geofence check happens only on tap (server enforces; client may show last-known status on the button press itself).
- Admin can manually create / edit / delete any stamp from dashboard (FR-O-01..03).
- Anomaly thresholds (max shift length, max break length, paid/unpaid break cutoff) are tenant settings editable in admin dashboard; defaults: 14h shift, 4h break, 30min break paid/unpaid threshold.

---

## Pre-development checklist (Sprint 0 — must finish before any task starts)

| # | Task | Owner | DoD |
|---|---|---|---|
| P0-1 | Clone boilerplate repo into a new `sonoqui` repo. Run boilerplate's local-dev bootstrap. Confirm web/mobile/API/Astro all build clean. | INFRA + BE | All four workspaces build; `apps/backend/src/index.ts` boots; `apps/web` Vite dev server serves; `apps/mobile` Expo dev client runs on a physical Android + iOS device. |
| P0-2 | Provision staging OVH VM + Postgres + Caddy + Cloudflare DNS per boilerplate §infra. Deploy a hello-world API to confirm the deploy chain. | INFRA | `api-staging.<root>` returns `/health/ready` = 200; Caddy serves over the Cloudflare Origin Cert. |
| P0-3 | **Boilerplate onboarding sprint (2 weeks).** Each engineer builds one throwaway end-to-end feature on the boilerplate (e.g., a "notes" CRUD with RLS + a mobile screen + a web admin view) to surface friction with: `withRLS`, the DI container, the GoTrue/Centrifugo wiring, the migration policy. Output: a "Lessons learnt" page in the team wiki + a list of conventions to formalise. | All engineers | One PR per engineer merged; written-up lessons; no blockers raised against the boilerplate. (PRD Q61.) |
| P0-4 | **Product name locked: SonoQui** (PRD Q47, resolved 2026-05-24). Execute: (a) buy `sonoqui.app` at Cloudflare Registrar (~$14/yr) and `sonoqui.io` at Porkbun (~$35/yr); (b) backorder `sonoqui.com` via DropCatch (Chinese-registrar parked); (c) broker offer for `sonoqui.it` via Sedo to Domain Profit Srl / Puglia.com — walk-away at €2.5k, defer to post-traction if needed; (d) file UIBM word-mark application classes 9 (downloadable software) + 42 (SaaS) within 30 days of domain purchase (~€280); (e) create App Store Connect record `SonoQui`, Play Console record `SonoQui`, Expo project slug `sonoqui`. | PM | All four steps logged with receipts/IDs; domains resolve; UIBM filing receipt obtained; store records visible. |
| P0-5 | Legal engagement: retain an Italian internet lawyer for TOS / privacy notice / DPA / DPIA template review. Brief them on the no-continuous-tracking commitment and the Art. 4 templating goal. | PM + LEGAL | Engagement letter signed; first deliverables (TOS draft, privacy notice draft) targeted within 6 weeks. (PRD §8.5, Q32.) |
| P0-6 | Brevo paid tier (€19/mo, 20k emails/mo) provisioned. SPF/DKIM/DMARC configured on the chosen sending domain. Inbox-placement check via mail-tester.com. | INFRA | mail-tester.com score ≥9/10 from a test send. (PRD Q62.) |

---

## Phase 1 — Foundation (multi-tenant RLS + core schema)

Recommended parallelism: 1 BE engineer drives schema + RLS; can run in parallel with Phase 5 (admin dashboard scaffolding) and Phase 3 (mobile shell).

### TASK-FND-01 — Add `tenant_id` GUC + `auth.tenant_id()` + `auth.is_admin()` + `withTenantRLS`

- **Refs:** PRD §10.1, §10.5; Boilerplate §4.3.
- **Depends on:** P0-1, P0-2.
- **DoD:**
  - New migration `010_tenant_rls.sql` (idempotent) creates `auth.tenant_id()` and `auth.is_admin()` SQL functions.
  - New TypeScript helper `withTenantRLS(userId, tenantId, fn)` added to `apps/backend/src/lib/db.ts`. Existing `withRLS` is preserved (other code paths may still use it).
  - Unit test: `withTenantRLS` sets both GUCs inside the transaction and unsets them on commit/rollback. Verified via `SHOW app.current_tenant_id` inside the callback.
  - Integration test: a connection that bypasses `withTenantRLS` cannot see tenant-scoped rows (because RLS policies require the GUC to be set).
- **Owner:** BE.
- **Estimate:** M.

### TASK-FND-02 — Schema: `tenants`, `memberships`, `branches`, `branch_memberships`

- **Refs:** PRD §6.1, §6.3; PRD §10.1.
- **Depends on:** TASK-FND-01.
- **DoD:**
  - Migration `011_core_entities.sql` (idempotent) creates:
    - `tenants(id uuid PK, ragione_sociale text, country text DEFAULT 'IT', timezone text DEFAULT 'Europe/Rome', language text DEFAULT 'it-IT', ccnl text, retention_years int DEFAULT 5, max_admins int DEFAULT 2, max_users int DEFAULT 20, geofence_policy text DEFAULT 'lenient' CHECK (...), gps_accuracy_ceiling_m int DEFAULT 100, mock_location_action text DEFAULT 'flag', break_paid_threshold_min int DEFAULT 30, max_shift_hours int DEFAULT 14, max_break_hours int DEFAULT 4, disable_desktop_clock_in boolean DEFAULT true, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())`
    - `memberships(id uuid PK, tenant_id uuid NOT NULL REFERENCES tenants, user_id uuid NOT NULL, role text CHECK (role IN ('admin','user')), active boolean DEFAULT true, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id, user_id))`
    - `branches(id uuid PK, tenant_id uuid NOT NULL REFERENCES tenants, name text NOT NULL, address text, address_components jsonb, latitude double precision, longitude double precision, radius_m int DEFAULT 300 CHECK (radius_m BETWEEN 50 AND 1500), smart_working boolean DEFAULT false, timezone text, active boolean DEFAULT true, ordering int DEFAULT 0, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())`
    - `branch_memberships(branch_id uuid REFERENCES branches, user_id uuid, tenant_id uuid NOT NULL, PRIMARY KEY (branch_id, user_id))`
  - All tables: `ALTER TABLE … ENABLE ROW LEVEL SECURITY` + tenant-isolation policy using `auth.tenant_id()`.
  - All tables: index `(tenant_id, ...)` on every query path.
  - Re-running migration on a populated DB is a no-op (verified manually).
- **Owner:** BE.
- **Estimate:** M.

### TASK-FND-03 — Auth middleware: resolve `tenant_id` for the request, cache per-JWT

- **Refs:** PRD §6.2 FR-A-09; PRD §10.1; Boilerplate auth middleware.
- **Depends on:** TASK-FND-02.
- **DoD:**
  - `apps/backend/src/middleware/auth.ts` extended: after JWT verification, looks up the user's active `memberships` row (most-recent if multiple exist — should be one in MVP per FR-T-06). Caches the `tenant_id` keyed by `(user_id, jti)` for the JWT's TTL.
  - `req.user` carries `{ id, tenantId, role }`.
  - If no active membership exists → 403 with code `NO_ACTIVE_TENANT`.
  - Unit tests for: happy path, no-membership case, deactivated-membership case, soft-deleted-tenant case.
- **Owner:** BE.
- **Estimate:** S.

### TASK-FND-04 — Route wrapper helper: every authenticated DB call runs inside `withTenantRLS`

- **Refs:** PRD §10.1.
- **Depends on:** TASK-FND-03.
- **DoD:**
  - Add `apps/backend/src/lib/route-helpers.ts` exporting a `tenantHandler(fn)` wrapper that resolves `req.user.tenantId` and supplies a `PoolClient` to `fn` already inside `withTenantRLS`.
  - Document the convention in `apps/backend/README.md`: "every route that touches tenant data uses `tenantHandler` — code review rejects PRs that call `pool.query` directly from a request handler."
  - Lint rule (ESLint custom rule or grep-based CI check) catches `pool.query(` outside `lib/`.
- **Owner:** BE.
- **Estimate:** S.

### TASK-FND-05 — Tenant-isolation integration test suite (CI gate)

- **Refs:** PRD §10.1 "Discipline" paragraph.
- **Depends on:** TASK-FND-02, TASK-FND-04, plus one route to test against (can be a placeholder `/api/v1/branches` from TASK-EPIC-02).
- **DoD:**
  - New test file `apps/backend/__tests__/integration/tenant-isolation.test.ts` that, for every authenticated route, seeds two tenants (A, B) with one user each, attempts to access tenant B's data with tenant A's JWT, and asserts HTTP 404 (NOT 403 — do not leak existence).
  - Test runs on `git push` via the existing `deploy.yml` CI job; failing test blocks merge.
  - Coverage is enforced via a "route inventory" file that lists every authenticated route; CI fails if a new route is added without a corresponding isolation test entry. (Inventory check is a small script in `scripts/check-route-inventory.ts`.)
- **Owner:** BE + QA.
- **Estimate:** L.

### TASK-FND-06 — Back-office tenant creation script

- **Refs:** PRD §5.1 personal note ("do not manage auto-registration").
- **Depends on:** TASK-FND-02.
- **DoD:**
  - **Superseded (2026-06-09):** the throwaway `scripts/create-tenant.ts` was removed — it inserted only an `auth_users` mirror row with a random uuid (no GoTrue user/password), so the admin could never log in. Replaced by `POST /api/v1/_internal/provision/tenant` (`apps/backend/src/routes/internal-provision.ts`, bearer `PROVISION_SECRET`): inserts the `tenants` row, invites the first admin via GoTrue `/invite` (email → set own password), mirrors `auth_users`, inserts the `admin` membership. Idempotent on an existing email. Emits the new tenant + user IDs.
  - Idempotent: re-running with the same email finds the existing user instead of erroring.
  - Documented in `scripts/README.md` with example invocations for staging + prod.
- **Owner:** BE.
- **Estimate:** S.

---

## Phase 2 — Stamp engine (core domain logic)

Recommended parallelism: Phase 2 is the critical path. Run sequentially within the phase; no other phase blocks on the back half (TASK-STM-04..07).

### TASK-STM-01 — Schema: `stamps`, `stamps_history`, `idempotency_keys`, `audit_log`

- **Refs:** PRD §10.3, §10.5, §10.6.
- **Depends on:** TASK-FND-02.
- **DoD:**
  - Migration `012_stamps.sql` (idempotent) creates the four tables exactly as specified in PRD §10.3, §10.5, §10.6 (copy schemas verbatim from PRD, do not paraphrase).
  - Trigger on `stamps` INSERT/UPDATE/DELETE that writes to `stamps_history`. Trigger function captures `current_setting('app.current_user_id')` and a `change_reason` taken from a session GUC `app.change_reason` (set by the application before performing the write).
  - `REVOKE UPDATE, DELETE` on `stamps_history` and `audit_log` from the application role; only INSERT.
  - RLS policies on all four tables: tenant isolation; users can only SELECT their own stamps + admin can SELECT all tenant stamps.
  - Tests: a non-admin user query returns only own rows; an admin returns all tenant rows; cross-tenant returns nothing.
- **Owner:** BE.
- **Estimate:** L.

### TASK-STM-02 — Distance + geofence helpers (server-side)

- **Refs:** PRD §10.4.
- **Depends on:** none (pure function module).
- **DoD:**
  - `apps/backend/src/lib/geo.ts` exports `distanceMeters` and `withinGeofence` exactly as PRD §10.4.
  - Unit tests with golden cases: 0m distance, 50m, 300m, 1000m, antimeridian crossing (won't matter for IT but tested), smart-working branch returns `allowed=true` regardless.
  - Property-test (fast-check or hand-rolled) confirming `distanceMeters(a, b) === distanceMeters(b, a)` over random IT-region coords.
- **Owner:** BE.
- **Estimate:** S.

### TASK-STM-03 — State machine validator

- **Refs:** PRD §6.4 FR-C-02; PRD §6.4 FR-C-16.
- **Depends on:** TASK-STM-01.
- **DoD:**
  - `apps/backend/src/services/stampStateMachine.ts` exports `validateTransition(currentState, requestedEvent)` returning either `{ ok: true, nextState }` or `{ ok: false, code: 'INVALID_TRANSITION', message: <localised> }`.
  - The "current state" computation reads the user's latest non-deleted stamp; service exposes `getCurrentUserState(tx, userId)` helper.
  - Tests cover every transition in the matrix:
    - nothing → clock_in (OK)
    - nothing → break_start (NOT OK)
    - clock_in → clock_out (OK)
    - clock_in → break_start (OK)
    - clock_in → clock_in (NOT OK — already clocked in)
    - break_start → break_end (OK)
    - break_start → clock_out (NOT OK — must end break first)
    - break_end → clock_in (NOT OK — second clock-in)
    - break_end → break_start (OK — another break)
    - break_end → clock_out (OK)
    - any → same event within 60s (NOT OK — TASK-STM-debounce — return code DUPLICATE_TOO_FAST)
- **Owner:** BE.
- **Estimate:** M.

### TASK-STM-04 — Idempotency middleware

- **Refs:** PRD §6.4 FR-C-06; PRD §10.6.
- **Depends on:** TASK-STM-01.
- **DoD:**
  - `apps/backend/src/middleware/idempotency.ts` reads `Idempotency-Key` header; if missing on stamp endpoints, rejects with 400 `MISSING_IDEMPOTENCY_KEY`.
  - On first request with a new key: claims it via `INSERT ... ON CONFLICT (key) DO NOTHING RETURNING *`; if claim succeeds, proceeds; on completion, stores response status + body in the row.
  - On replay (same key): returns the cached response (status + body).
  - Key TTL: 24h. The `cleanup_expired_idempotency` cron job (see TASK-CRON-01) sweeps nightly.
  - Tests: same key returns same response on retry; different key creates a second stamp; key bound to tenant + user (a different user using the same UUID gets a fresh slot — keys are `PRIMARY KEY (key)` so this is rejected; document the trade-off: clients SHOULD generate v4 UUIDs and collision is astronomically unlikely).
- **Owner:** BE.
- **Estimate:** M.

### TASK-STM-05 — POST `/api/v1/stamps` — create stamp endpoint

- **Refs:** PRD §6.4 FR-C-01..16; PRD §10.3, §10.4.
- **Depends on:** TASK-STM-01, TASK-STM-02, TASK-STM-03, TASK-STM-04, TASK-FND-04.
- **DoD:**
  - Route mounted at `/api/v1/stamps` (POST).
  - zod validator (`apps/backend/src/validators/stamps.ts`): `{ event_type, occurred_at (ISO 8601), latitude?, longitude?, gps_accuracy_m?, device_platform, device_app_version, branch_id?, notes? }`. `latitude/longitude/gps_accuracy_m` mandatory unless the branch is smart_working OR `source='admin_manual'` (admin path uses a different endpoint — see TASK-ADM-01).
  - Flow inside a single `withTenantRLS` transaction:
    1. Validate `occurred_at` within server now ± 5 minutes (FR-C-05).
    2. Validate `gps_accuracy_m <= tenant.gps_accuracy_ceiling_m` (default 100m) (FR-C-04).
    3. Resolve effective branch:
       - If `branch_id` provided: confirm user has membership in that branch.
       - Else: pick the closest branch the user is a member of that contains `(lat, lng)` per `withinGeofence` with tenant's policy. If none → 422 `OUT_OF_GEOFENCE`.
    4. Run state-machine validator (TASK-STM-03). 409 on failure with code `INVALID_TRANSITION` or `DUPLICATE_TOO_FAST`.
    5. Run mock-location action per tenant setting: `block` → 403, `flag` → set `suspicious_mock_location=true`, `allow` → ignore.
    6. Set `app.change_reason` GUC to `'employee_stamp'`.
    7. INSERT into `stamps`. The trigger writes `stamps_history`.
    8. Emit Centrifugo realtime event on channel `tenant.<tenantId>.dashboard` via the boilerplate's outbox table.
    9. Return 201 with the created stamp.
  - All error responses use the boilerplate's `apiResponse` envelope + localised messages.
  - Integration tests: happy path; out-of-geofence; smart_working branch; invalid transition; idempotency replay; mock-location block; mock-location flag; future timestamp rejected.
- **Owner:** BE.
- **Estimate:** L.

### TASK-STM-06 — GET `/api/v1/stamps` — list endpoints (self + admin)

- **Refs:** PRD §6.6 FR-R-03, FR-O-07; PRD §6.5.
- **Depends on:** TASK-STM-01, TASK-FND-04.
- **DoD:**
  - `GET /api/v1/stamps?from=&to=&user_id=&branch_id=&include_deleted=` — paginated, default 200 per page, max 1000.
  - Non-admin: `user_id` filter forced to self; cannot list other users' stamps.
  - Admin: all filters honoured.
  - Response includes computed fields per day: worked_minutes, paid_break_minutes, unpaid_break_minutes (FR-C-09 logic — uses tenant break threshold).
  - `GET /api/v1/stamps/:id/history` — returns the `stamps_history` rows for that stamp (admin only).
  - Integration tests: pagination; filters; non-admin scoping; history visibility.
- **Owner:** BE.
- **Estimate:** M.

### TASK-STM-07 — Undo within 60s endpoint

- **Refs:** PRD Q&A Q37.
- **Depends on:** TASK-STM-05.
- **DoD:**
  - `DELETE /api/v1/stamps/:id` from the stamp owner only, only if `now() - stamps.created_at <= 60 seconds` and the stamp is the most-recent non-deleted stamp for that user.
  - Sets `deleted_at`, `deleted_by_user_id`, `deletion_reason='user_undo_within_60s'`. Trigger writes a history row.
  - Beyond 60s → 410 `UNDO_WINDOW_EXPIRED` with a hint to use the correction-request flow.
  - Tests: undo within window, outside window, non-owner, not-most-recent.
- **Owner:** BE.
- **Estimate:** S.

---

## Phase 3 — Branches & geocoding

Runs in parallel with Phase 2 once Phase 1 done.

### TASK-BR-01 — Branch CRUD endpoints (admin)

- **Refs:** PRD §6.3 FR-B-01..06.
- **Depends on:** TASK-FND-04.
- **DoD:**
  - `POST /api/v1/branches` (admin) — create. Validates radius 50–1500.
  - `GET /api/v1/branches` — list all active.
  - `GET /api/v1/branches/:id` — detail.
  - `PATCH /api/v1/branches/:id` — update (name, address, lat, lng, radius_m, smart_working, active, ordering, timezone).
  - `DELETE /api/v1/branches/:id` — soft delete (sets `deleted_at`).
  - All write actions emit `audit_log` rows with `before`/`after` JSONB.
  - Tests: create, update radius bounds, soft-delete, RLS isolation.
- **Owner:** BE.
- **Estimate:** M.

### TASK-BR-02 — Branch ↔ user assignment

- **Refs:** PRD §6.3 FR-B-04.
- **Depends on:** TASK-BR-01.
- **DoD:**
  - `POST /api/v1/branches/:id/members` — admin assigns a user.
  - `DELETE /api/v1/branches/:id/members/:userId` — admin removes.
  - `GET /api/v1/branches/:id/members` — list.
  - Reciprocal `GET /api/v1/users/:id/branches` for the user's own view.
  - Tests cover all four.
- **Owner:** BE.
- **Estimate:** S.

### TASK-BR-03 — Geocoding service (Nominatim with fallback hook)

- **Refs:** PRD §10.2; PRD Q50.
- **Depends on:** none.
- **DoD:**
  - `apps/backend/src/services/geocoding.ts` exposes `forwardGeocode(address) -> { lat, lng, components }`.
  - Uses Nominatim public endpoint with a respectful User-Agent (`SonoQui/1.0 (https://sonoqui.app)`), 1 req/sec rate limit (token-bucket in-process), 5s timeout.
  - Result cached in Postgres `geocode_cache(address_hash, result jsonb, created_at)` for 90 days.
  - Provider abstraction allows swapping to MapTiler later: env var `GEOCODER=nominatim|maptiler`.
  - Falls back gracefully (returns 503 with `GEOCODING_UNAVAILABLE` on Nominatim failure; the admin UI then allows manual lat/lng entry).
  - Tests: cache hit, cache miss, rate-limit behaviour, fallback to manual entry.
- **Owner:** BE.
- **Estimate:** M.

---

## Phase 4 — Users, memberships, invitations

### TASK-USR-01 — Invitation flow

- **Refs:** PRD §6.2 FR-A-04, FR-A-05, FR-A-06; PRD §5.1 (back-office tenant flow).
- **Depends on:** TASK-FND-06 (tenant creation), TASK-FND-02.
- **DoD:**
  - `POST /api/v1/users/invite` (admin) — body: `{ email, role: 'admin'|'user', branch_ids?: uuid[] }`. Validates against `tenants.max_admins` and `tenants.max_users` counters (returns 422 `LIMIT_REACHED` with the current/limit values).
  - Calls GoTrue admin API to create the user invitation (uses GoTrue's invite email template, IT or EN per tenant default language).
  - Inserts `memberships` row pre-emptively (so the user is tenant-scoped from the moment they confirm).
  - Optional `branch_ids` populates `branch_memberships`.
  - Returns the membership row + invitation status.
  - `POST /api/v1/users/:id/deactivate` (admin) — sets `memberships.active=false`. User can no longer authenticate (validated in TASK-FND-03 auth middleware).
  - `POST /api/v1/users/:id/reactivate` (admin) — inverse.
  - `PATCH /api/v1/users/:id` (admin) — change role / email (email change triggers re-confirmation via GoTrue).
  - Last-admin protection (FR-A-03): cannot demote self if no other active admin exists; returns 422 `LAST_ADMIN`.
  - All admin actions emit `audit_log`.
  - Tests: invite, limit-reached, deactivate, reactivate, change role, last-admin protection.
- **Owner:** BE.
- **Estimate:** L.

### TASK-USR-02 — Self profile endpoint

- **Refs:** PRD §6.8 FR-S-02.
- **Depends on:** TASK-FND-03.
- **DoD:**
  - `GET /api/v1/me` returns `{ user, tenant, memberships, branches, settings }`.
  - `PATCH /api/v1/me` updates `{ language, notification_preferences }`.
  - Tests cover both.
- **Owner:** BE.
- **Estimate:** S.

---

## Phase 5 — Mobile app (Expo)

Recommended parallelism: 1 MOB engineer drives the shell + auth + clock-in screen; can run in parallel with backend Phase 2.

### TASK-MOB-01 — Mobile shell + auth + bootstrap order

- **Refs:** PRD §5.2; Boilerplate mobile section + bootstrap ordering.
- **Depends on:** P0-1.
- **DoD:**
  - `apps/mobile` boots into a login screen using GoTrue email/password.
  - Bootstrap order respected per boilerplate (pre-bootstrap registers SecureStore; bootstrap registers config → Supabase-style client → API client).
  - Apple Sign-In + Google OAuth flows wired (PRD Q8).
  - Post-login, the app fetches `/api/v1/me`, stores tenant context in Zustand (`useAccountStore` adapted to "tenant" semantics — keep the existing name to minimise boilerplate divergence, or rename via a shim).
  - Force-upgrade gate: on app launch, calls `/api/v1/app-version` (TASK-OPS-04); if response says `force_upgrade=true`, shows blocking screen with store links.
  - Tested on a physical iOS + Android device.
- **Owner:** MOB.
- **Estimate:** L.

### TASK-MOB-02 — Add `expo-location` + permission strings + acquisition helper

- **Refs:** PRD §10.7; PRD Q14.
- **Depends on:** TASK-MOB-01.
- **DoD:**
  - `expo-location` added to `apps/mobile/package.json`.
  - `app.config.ts` adds:
    - `ios.infoPlist.NSLocationWhenInUseUsageDescription` (IT + EN copy per PRD §10.7, language picked at install time via system locale — Expo handles localisation via `infoPlist`).
    - `android.permissions = [..., "ACCESS_FINE_LOCATION"]`. **Do not add `ACCESS_BACKGROUND_LOCATION`** (PRD FR-C-13 hard policy).
  - `packages/shared/src/utils/acquireLocation.ts` (a real implementation of the PRD §10.7 sketch): wraps `Location.watchPositionAsync`, returns the best reading once accuracy ≤30m, or the best reading at 15s deadline, or rejects with `ACQUISITION_TIMEOUT` if no reading at all.
  - Permission-denied flow per PRD Q14: clear screen explaining why, settings deep-link, fallback "Richiedi correzione all'amministratore" path.
  - Tested on a physical iOS + Android device outdoors (real GPS) and indoors (degraded GPS).
- **Owner:** MOB.
- **Estimate:** M.

### TASK-MOB-03 — Mock-location detection plugin

- **Refs:** PRD §6.4 FR-C-15, §10.7; PRD Q15.
- **Depends on:** TASK-MOB-02.
- **DoD:**
  - Vet `react-native-turbo-mock-location-detector`. If Expo SDK 55 + RN 0.83 compatible (likely needs an Expo config plugin shim), use it. Else write a minimal native module (Kotlin: `Location.isFromMockProvider()`; Swift: stub returning false for v1).
  - Expose `isMockLocation(location): boolean` from `packages/shared`.
  - Field included in stamp payload to backend.
  - Document the limitation in `apps/mobile/README.md`: iOS detection is best-effort (no public API).
- **Owner:** MOB.
- **Estimate:** M.

### TASK-MOB-04 — Clock-in / clock-out / break UI

- **Refs:** PRD §5.3, §5.4, §5.5; PRD §6.4; PRD §5.2 user-edit ("only check on click").
- **Depends on:** TASK-MOB-01, TASK-MOB-02, TASK-STM-05.
- **DoD:**
  - Home screen layout:
    - Big primary button: state-aware label (`Timbra ingresso` / `Timbra uscita` / `Termina pausa`).
    - Below: tenant's branch name(s) the user belongs to.
    - When clocked in: secondary button `Inizia pausa`.
    - When on break: secondary button `Termina pausa`.
  - **No live geofence preview** (per user edit in PRD §5.2). The button is always enabled if the user is in a stamp-able state; geofence enforcement happens on tap, with the error surfaced as an inline message ("Sembri essere a 420m dal Bar Centrale — avvicinati e riprova").
  - Tap flow:
    1. UI debounces 1500ms (FR-C-07).
    2. Generate `Idempotency-Key` UUID v4.
    3. Acquire location (TASK-MOB-02 helper). If permission denied, show the fallback screen.
    4. POST to `/api/v1/stamps` with full payload.
    5. Optimistic UI: button changes to "Timbratura registrata alle HH:MM ✓" with a spinner until server confirms.
    6. On server 201: harden the optimistic state; show 60s "Annulla" toast (TASK-STM-07).
    7. On 422 OUT_OF_GEOFENCE: show distance error.
    8. On 409 INVALID_TRANSITION: show the relevant error.
    9. On network error: enqueue in SQLite offline queue (TASK-MOB-05).
  - Recap screen on clock-out (PRD §5.5): shows the day's summary; "Hai dimenticato qualcosa?" deep-links to correction request.
  - Tested manually on iOS + Android outdoors (real GPS), indoors, with airplane mode (queued), with mock-location app (Android, action=flag).
- **Owner:** MOB + DESIGN.
- **Estimate:** L.

### TASK-MOB-05 — Offline queue (SQLite)

- **Refs:** PRD §6.4 FR-C-12.
- **Depends on:** TASK-MOB-04.
- **DoD:**
  - `expo-sqlite` storage of pending stamps with full payload + idempotency key.
  - Queue drains on connectivity-restored event AND on app foreground.
  - Stamps queued >24h are flagged on submit with header `X-Queued-Hours: <n>`; server records this on the stamp (add `queued_hours` column in TASK-STM-01).
  - UI surface: "In sincronizzazione" badge on queued stamps; explicit "Sincronizza ora" button.
  - Tests: simulate airplane mode → tap → restore connectivity → confirm sync.
- **Owner:** MOB.
- **Estimate:** M.

### TASK-MOB-06 — Stamp history view (self)

- **Refs:** PRD §6.6 FR-R-03; PRD Q35.
- **Depends on:** TASK-STM-06, TASK-MOB-01.
- **DoD:**
  - "Le mie timbrature" tab: last 30 days by default, infinite scroll back.
  - Per-day summary: ingresso, uscita, ore lavorate, pause.
  - Per-stamp detail expand: shows raw event, source, edited indicator.
  - Weekly + monthly totals header.
- **Owner:** MOB.
- **Estimate:** M.

### TASK-MOB-07 — Correction request flow

- **Refs:** PRD §5.6; PRD §6.5 FR-O-08.
- **Depends on:** TASK-MOB-06, TASK-ADM-02 (correction-request backend).
- **DoD:**
  - On the recap or history screen: "Richiedi correzione" button.
  - Form: claimed time (datetime picker, defaults to nearest hour), event type, branch, justification (free text mandatory).
  - POST to `/api/v1/correction-requests` (TASK-ADM-02).
  - Confirmation: "Richiesta inviata — attendi conferma da Marco".
  - Forgotten-clockout banner: shown on app open when the user has an open clock-in >12h old; one-tap → pre-populated correction request.
- **Owner:** MOB.
- **Estimate:** M.

### TASK-MOB-08 — Push notifications wiring (Expo Push)

- **Refs:** PRD §6.7 FR-N-01; Boilerplate push section.
- **Depends on:** TASK-MOB-01.
- **DoD:**
  - On first app open after login, request push permission (with explanation copy per PRD §5.2).
  - Persist Expo Push token via `PATCH /api/v1/profiles/me/push-token` (this endpoint already exists in boilerplate; verify and reuse).
  - Notification channels (Android): `default`, `reminders` (channel name from boilerplate). The `reminders` channel is what `forgotten_clockout_reminder` cron posts to.
  - Foreground notifications surface as in-app toast.
- **Owner:** MOB.
- **Estimate:** S.

### TASK-MOB-09 — App Store + Play Store submission package

- **Refs:** PRD Q39, Q40; PRD §8 compliance posture.
- **Depends on:** TASK-MOB-04, TASK-MOB-08, P0-4.
- **DoD:**
  - App Store Connect: screenshots, app description (IT + EN), privacy nutrition labels (location: "used to verify attendance at clock-in only"), data deletion link (`/account/delete` on the web), App Review notes including the Art. 4 / Garante posture.
  - Play Console: equivalent assets + Data safety form.
  - First TestFlight + Internal Testing builds submitted.
  - Budget for 2–3 review rounds (PRD Q39).
- **Owner:** MOB + PM + DESIGN.
- **Estimate:** L (calendar; review delays dominate).

---

## Phase 6 — Admin web dashboard

Recommended parallelism: 1 WEB engineer; can run in parallel with mobile (Phase 5) once Phase 1 done.

### TASK-WEB-01 — Web shell + auth + layout

- **Refs:** PRD §5.7, §6.6, §6.8.
- **Depends on:** P0-1.
- **DoD:**
  - Vite + React SPA; routes: `/login`, `/dashboard`, `/branches`, `/users`, `/stamps`, `/exports`, `/settings`, `/compliance`, `/account`.
  - GoTrue email/password login + Google OAuth + Turnstile on auth forms.
  - Layout uses Tailwind v4 + Material-3 tokens per boilerplate (`bg-surface`, `text-on-surface`, etc.); a single warm accent colour per PRD Q48.
  - Auth guard: non-admin users redirected with a notice "Il pannello web è riservato agli amministratori — usa l'app mobile per timbrare" (PRD edit: web is admin-only in MVP).
  - i18n IT/EN.
- **Owner:** WEB + DESIGN.
- **Estimate:** L.

### TASK-WEB-02 — Live dashboard (current state per user)

- **Refs:** PRD §6.6 FR-R-01.
- **Depends on:** TASK-WEB-01, TASK-STM-05, TASK-WEB-CENTRIFUGO.
- **DoD:**
  - `/dashboard` shows a card grid: one card per active user with current state badge (Al lavoro / In pausa / Fuori servizio), branch, last-stamp time.
  - Subscribes to Centrifugo channel `tenant.<tenantId>.dashboard`; updates within 2s of a stamp.
  - Includes a "Da approvare" panel showing pending correction requests + anomaly flags (forgotten clockouts, mock-location flags, long shifts).
  - Counter widget: `X / max_users` and `Y / max_admins` (PRD §5.1 edit).
- **Owner:** WEB.
- **Estimate:** L.

### TASK-WEB-CENTRIFUGO — Centrifugo client + subscribe-proxy extension

- **Refs:** PRD §10.9.
- **Depends on:** TASK-WEB-01.
- **DoD:**
  - Backend: extend `/api/v1/centrifugo/subscribe` proxy in `apps/backend/src/routes/centrifugo.ts` to accept channel patterns:
    - `tenant.<tenantId>.dashboard` — granted only if `req.user.role === 'admin'` AND `req.user.tenantId === tenantId`.
    - `tenant.<tenantId>.user.<userId>` — granted only if `req.user.id === userId` AND `req.user.tenantId === tenantId`.
  - Outbox writer helper `apps/backend/src/lib/realtime.ts`: `publishStampEvent(tenantId, payload)` inserts into `centrifugo_outbox`.
  - Web Centrifuge client (`packages/shared/src/realtime`) connects on app load; resubscribes on token refresh.
  - Tests: cross-tenant subscribe denied; non-admin subscribe to `.dashboard` denied; correct subscribe accepted.
- **Owner:** BE + WEB.
- **Estimate:** M.

### TASK-WEB-03 — Branches admin UI

- **Refs:** PRD §6.3.
- **Depends on:** TASK-WEB-01, TASK-BR-01, TASK-BR-03.
- **DoD:**
  - `/branches` list + create + edit forms.
  - Map view: Leaflet + OSM tiles. Address autocomplete via TASK-BR-03 geocoding. Drag-pin to fine-tune. Radius slider (50–1500m); circle redraws live.
  - Smart-working toggle with a clear warning copy.
  - "Stress test" preview (PRD Q10 tip): shows how many addresses / parking lots the geofence covers (uses Nominatim reverse-geocode at radius edges as a rough proxy; if too complex for v1, defer the stress-test to v1.5 and ship just the circle preview).
  - Tests: create/edit/delete branch happy path.
- **Owner:** WEB + DESIGN.
- **Estimate:** L.

### TASK-WEB-04 — Users admin UI

- **Refs:** PRD §6.2 + §5.1 (counter), Q35 (employee history accessible to admin).
- **Depends on:** TASK-WEB-01, TASK-USR-01.
- **DoD:**
  - `/users` list with role badges, active flag, branch assignments, last-stamp time.
  - Counter header: `Utenti attivi: X / max_users` and `Amministratori: Y / max_admins`. If at limit, "Invita" button is disabled with tooltip "Limite raggiunto — contatta supporto per aumentarlo".
  - Invite form (email + role + branches).
  - Edit user (role, email, branch assignments, active flag).
  - User detail page: shows all the user's stamps with pagination.
- **Owner:** WEB.
- **Estimate:** L.

### TASK-WEB-05 — Stamps admin UI (manual stamp management — load-bearing)

- **Refs:** PRD §5.7 user edit ("admin can change any stamp manually"); FR-O-01..06.
- **Depends on:** TASK-WEB-01, TASK-ADM-01.
- **DoD:**
  - `/stamps` table view: filterable by user, branch, date range, source, event_type. Default view: this week.
  - Per-row actions:
    - "Modifica" — opens a form to edit `occurred_at`, `event_type`, `branch_id`, `notes`. Justification mandatory.
    - "Elimina" — soft-delete with mandatory `deletion_reason`.
    - "Storia" — opens a side panel showing `stamps_history` timeline.
  - "Nuova timbratura" button: full form to create on behalf of a user. Source recorded as `admin_manual`. GPS fields left null.
  - Bulk edit (FR-O-06): "Applica orario standard" multi-day selection, then a form (start, end, optional break window). Backend gets a separate endpoint `POST /api/v1/stamps/bulk-apply-standard` (TASK-ADM-03).
- **Owner:** WEB + DESIGN.
- **Estimate:** XL.

### TASK-WEB-06 — Correction requests inbox

- **Refs:** PRD §5.6, §6.5 FR-O-04, FR-O-08.
- **Depends on:** TASK-WEB-01, TASK-ADM-02.
- **DoD:**
  - `/dashboard?panel=da-approvare` (or a separate `/inbox` route): list of `correction_requests` with status `pending`.
  - Per-row: original stamp vs claimed stamp diff view; "Approva" / "Modifica e approva" / "Rifiuta" buttons.
  - Approve → creates/edits stamp with source `employee_correction`, audit-logged.
  - Reject → marks the request as rejected, optional admin note.
  - Email + push notification to the user on resolution.
- **Owner:** WEB.
- **Estimate:** L.

### TASK-WEB-07 — Exports UI

- **Refs:** PRD §5.7, §6.6 FR-R-04..09.
- **Depends on:** TASK-WEB-01, TASK-EXP-01..03.
- **DoD:**
  - `/exports` page: month picker (default previous month), branch filter, user filter, format (XLSX / JSON), include_deleted toggle.
  - "Genera esportazione" enqueues a job; user sees job in a list (status: in_coda / in_elaborazione / pronto / fallito) with auto-refresh via Centrifugo.
  - Ready job → "Scarica" button → fetches signed R2 URL.
  - "Aggiungi destinatario" (PRD Q26): add commercialista email; future exports auto-emailed there.
- **Owner:** WEB.
- **Estimate:** M.

### TASK-WEB-08 — Settings UI

- **Refs:** PRD §6.8.
- **Depends on:** TASK-WEB-01, TASK-FND-02.
- **DoD:**
  - `/settings` tabs: Generali, Timbrature, Privacy & Conformità, Notifiche, Esportazioni, Account.
  - Generali: ragione sociale, country (read-only after creation per FR-T-05), timezone, default language, retention years.
  - Timbrature: geofence policy (lenient/strict — PRD Q12), GPS accuracy ceiling, mock-location action (allow/flag/block — Q15), break paid threshold minutes (default 30 — Q20), max shift hours (default 14 — Q18), max break hours (default 4 — Q19), disable_desktop_clock_in toggle (Q13), overnight-shift attribution.
  - Privacy & Conformità: links to DPIA PDF generator, privacy notice PDF generator, Art. 4 checklist PDF (TASK-CMP-01..03).
  - Account: soft-delete tenant button with grace period warning.
- **Owner:** WEB.
- **Estimate:** L.

---

## Phase 7 — Admin stamp endpoints (back-end mate to Phase 6)

### TASK-ADM-01 — POST / PATCH / DELETE stamps (admin path)

- **Refs:** PRD §6.5 FR-O-01..03.
- **Depends on:** TASK-STM-01, TASK-FND-04.
- **DoD:**
  - `POST /api/v1/admin/stamps` — admin-only. Body identical to user POST but accepts null lat/lng, requires `justification` and `user_id`. Source set to `admin_manual`. Skips geofence + state-machine checks (admin overrides). Sets `app.change_reason` to the justification.
  - `PATCH /api/v1/admin/stamps/:id` — admin edits any field; mandatory justification; trigger writes `stamps_history`.
  - `DELETE /api/v1/admin/stamps/:id` — soft-delete with mandatory `deletion_reason`.
  - Tests: cannot be hit by non-admin; full audit chain present after operation.
- **Owner:** BE.
- **Estimate:** M.

### TASK-ADM-02 — Correction requests endpoints

- **Refs:** PRD §6.5 FR-O-04, FR-O-08; PRD §5.6.
- **Depends on:** TASK-STM-01, TASK-FND-04.
- **DoD:**
  - Migration `013_correction_requests.sql` (idempotent):
    ```sql
    CREATE TABLE correction_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id),
      user_id uuid NOT NULL,
      original_stamp_id uuid REFERENCES stamps(id),
      claimed_event_type text NOT NULL,
      claimed_occurred_at timestamptz NOT NULL,
      claimed_branch_id uuid REFERENCES branches(id),
      justification text NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','superseded')),
      resolved_by uuid,
      resolved_at timestamptz,
      resolution_note text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    ```
  - RLS: tenant isolation + user-can-see-own + admin-can-see-all.
  - Endpoints:
    - `POST /api/v1/correction-requests` (user) — create.
    - `GET /api/v1/correction-requests?status=pending` (admin or self) — list.
    - `POST /api/v1/correction-requests/:id/approve` (admin) — approves; either edits the original stamp or creates a new stamp with source `employee_correction`.
    - `POST /api/v1/correction-requests/:id/reject` (admin) — rejects.
  - Email + push notification on creation (to admins) and on resolution (to user).
  - Tests: full happy path; non-admin cannot approve.
- **Owner:** BE.
- **Estimate:** L.

### TASK-ADM-03 — Bulk standard-schedule apply endpoint

- **Refs:** PRD §6.5 FR-O-06.
- **Depends on:** TASK-ADM-01.
- **DoD:**
  - `POST /api/v1/admin/stamps/bulk-apply-standard` — body: `{ user_id, branch_id, dates: ['YYYY-MM-DD'], schedule: { clock_in: 'HH:MM', clock_out: 'HH:MM', break_start?: 'HH:MM', break_end?: 'HH:MM' } }`.
  - For each date: creates the requested stamps with source `admin_manual` and a synthesised justification "Applicato orario standard via bulk".
  - Skips dates that already have stamps for that user (returns a per-date result list with `created` / `skipped` / `error`).
  - Tests: 5-day work week happy path; partial-skip; invalid times.
- **Owner:** BE.
- **Estimate:** M.

---

## Phase 8 — Exports + jobs + cron

### TASK-EXP-01 — `export_jobs` table + enqueue endpoint

- **Refs:** PRD §6.6 FR-R-07.
- **Depends on:** TASK-FND-02.
- **DoD:**
  - Migration `014_export_jobs.sql` (idempotent):
    ```sql
    CREATE TABLE export_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id),
      requested_by uuid NOT NULL,
      format text NOT NULL CHECK (format IN ('xlsx','json')),
      period_from date NOT NULL,
      period_to date NOT NULL,
      filters jsonb NOT NULL DEFAULT '{}',
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','ready','failed')),
      r2_key text,
      signed_url_expires_at timestamptz,
      error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      finished_at timestamptz
    );
    ```
  - `POST /api/v1/exports` enqueues a job.
  - `GET /api/v1/exports` lists tenant jobs.
  - `GET /api/v1/exports/:id/download` returns a fresh 15-minute signed R2 URL.
- **Owner:** BE.
- **Estimate:** M.

### TASK-EXP-02 — XLSX generator (commercialista format)

- **Refs:** PRD §7.6.
- **Depends on:** TASK-EXP-01, TASK-STM-06.
- **DoD:**
  - `apps/backend/src/services/xlsxExportService.ts` uses `exceljs` `WorkbookWriter` with `useSharedStrings: false`, streaming.
  - Workbook structure exactly per PRD §7.6:
    - Sheet 1 `Riepilogo`: one row per user, columns nome, cognome, codice_fiscale (nullable), ore_totali, ore_ordinarie, ore_straordinarie, ore_pausa_retribuita, ore_pausa_non_retribuita, giorni_lavorati, giorni_assenza, note.
    - Sheets 2..N: one per user, named `<cognome>_<nome>` (truncated to 31 chars per XLSX spec, de-duped with numeric suffix).
    - Last sheet `Metadati`: tenant info, period, generated_at, schema_version="v1".
  - Cell types: `date`, `time`, durations as `[h]:mm`.
  - Dates `dd/mm/yyyy`. Locale-aware headers (IT/EN).
  - No formulas, no merged cells, no images.
  - Output streamed to a temp file then uploaded to R2 at `tenants/<tenantId>/exports/<exportId>.xlsx`.
  - Tests: 20 users × 31 days fixture; opened in LibreOffice + Excel + Numbers without warnings; column totals match a hand-computed reference.
- **Owner:** BE.
- **Estimate:** L.

### TASK-EXP-03 — JSON generator

- **Refs:** PRD §7.6 JSON spec.
- **Depends on:** TASK-EXP-01, TASK-STM-06.
- **DoD:**
  - `apps/backend/src/services/jsonExportService.ts` produces JSON exactly per PRD §7.6 example. Schema versioned (`schema_version: "v1"`).
  - Uploaded to R2 at `tenants/<tenantId>/exports/<exportId>.json`.
  - JSON Schema file checked in at `apps/backend/src/services/export-v1.schema.json` for downstream consumers.
  - Tests: same fixture as XLSX; round-trip validates against the schema.
- **Owner:** BE.
- **Estimate:** M.

### TASK-EXP-04 — External recipients ("ricevente esterno")

- **Refs:** PRD Q26.
- **Depends on:** TASK-EXP-01, TASK-EXP-02.
- **DoD:**
  - `tenant_export_recipients(tenant_id, email, label, active, created_at)` table.
  - Settings UI to add/remove (TASK-WEB-08 hooks).
  - On `export_jobs.status = 'ready'`, send an email to all active recipients with the signed URL (note 15-minute TTL — include a "Re-download via dashboard" link too).
- **Owner:** BE.
- **Estimate:** S.

### TASK-CRON-01 — Cron jobs (4 new)

- **Refs:** PRD §10.10.
- **Depends on:** TASK-STM-01, TASK-EXP-01.
- **DoD:**
  - Extend `apps/backend/src/services/schedulerService.ts` with four jobs:
    - `process_export_jobs` — every minute; pulls `export_jobs WHERE status='pending'`, sets `status='running'` via `UPDATE ... RETURNING` (atomic claim), invokes generator, sets `status='ready'` or `status='failed'`, publishes Centrifugo event on the tenant dashboard channel.
    - `cleanup_old_gps` — daily 04:30 UTC; `UPDATE stamps SET latitude=NULL, longitude=NULL, gps_accuracy_m=NULL WHERE created_at < now() - interval '90 days' AND latitude IS NOT NULL`. Logged.
    - `cleanup_expired_idempotency` — nightly 03:30 UTC; deletes from `idempotency_keys WHERE expires_at < now()`.
    - `forgotten_clockout_reminder` — every 15 minutes, but enabled only between 18:00–23:00 Europe/Rome (use `node-cron` with `timezone: 'Europe/Rome'`; guard at start of handler for hours in [18,22]); identifies users with an open clock-in older than 14h (configurable via tenant `max_shift_hours`); sends one Expo Push to channel `reminders`; marks the stamp with `reminder_sent_at` (add column in TASK-STM-01).
  - `SCHEDULER_ENABLED` env var respected (boilerplate convention; OFF on environments sharing a DB).
  - Tests: each job idempotent on re-run; logged outcomes.
- **Owner:** BE.
- **Estimate:** L.

---

## Phase 9 — Notifications (email + push)

### TASK-NOT-01 — Email templates (transactional)

- **Refs:** PRD §6.7; PRD §7.4.
- **Depends on:** P0-6 (Brevo).
- **DoD:**
  - Templates in `apps/backend/src/templates/` (or a similar boilerplate path):
    - `invitation` — user invited.
    - `password_reset` — GoTrue handles, but ensure IT/EN copy via GoTrue's Go-template branching (boilerplate pattern §4).
    - `correction_request_submitted` — to admins.
    - `correction_request_resolved` — to user.
    - `export_ready` — to requester + external recipients.
  - All bilingual IT/EN with branching by `user.language`.
  - Visible "from" address from a real mailbox monitored by Archiva support.
  - Tested via mail-tester.com; spam score ≥9.
- **Owner:** BE + DESIGN.
- **Estimate:** M.

### TASK-NOT-02 — Push notification dispatcher

- **Refs:** PRD §6.7 FR-N-01; PRD §10.10 forgotten-clockout job.
- **Depends on:** TASK-CRON-01.
- **DoD:**
  - `apps/backend/src/services/pushService.ts` wraps `expo-server-sdk`. Batches up to 100 tokens per request. Handles invalid-token cleanup (deletes the token on `DeviceNotRegistered`).
  - Used by `forgotten_clockout_reminder`, `correction_request_submitted` (to admin push opt-in), `correction_request_resolved` (to user).
  - Tests: token batching; invalid token cleanup.
- **Owner:** BE.
- **Estimate:** S.

---

## Phase 10 — Compliance assets (Italian-market differentiator)

### TASK-CMP-01 — DPIA PDF generator (pre-filled)

- **Refs:** PRD §6.8 FR-S-04; PRD §8.1.
- **Depends on:** TASK-FND-02, P0-5 (lawyer-reviewed template).
- **DoD:**
  - Template document (`apps/backend/src/templates/dpia.html`) authored with the Italian lawyer (P0-5). Bilingual IT/EN.
  - Backend endpoint `GET /api/v1/compliance/dpia.pdf` (admin only) generates the PDF on-the-fly using `puppeteer` or `playwright-chromium` (decide during implementation — boilerplate already runs on alpine; add the chromium dependency to the Dockerfile).
  - Variables filled in: ragione sociale, partita IVA (if provided), address, sub-processor list, retention years.
  - Cached for 24h per tenant (regenerate on settings change).
  - Test: PDF opens in Acrobat + Preview; all variables resolved; no `{{ var }}` left in output.
- **Owner:** BE + LEGAL.
- **Estimate:** L.

### TASK-CMP-02 — Privacy notice PDF generator

- **Refs:** PRD §8.1; PRD §6.8 FR-S-04.
- **Depends on:** P0-5.
- **DoD:**
  - Same pattern as TASK-CMP-01. Template at `templates/privacy-notice.html`.
  - Endpoint `GET /api/v1/compliance/privacy-notice.pdf`.
- **Owner:** BE + LEGAL.
- **Estimate:** M.

### TASK-CMP-03 — Art. 4 checklist + sample union agreement + INL request template

- **Refs:** PRD §8.2.
- **Depends on:** P0-5.
- **DoD:**
  - Three PDFs generated from templates with tenant data pre-filled:
    - `art4-checklist.pdf` — interactive checkboxes for the steps the tenant must take.
    - `sample-union-agreement.pdf` — accordo aziendale template.
    - `sample-inl-request.pdf` — istanza all'Ispettorato.
  - All endpoints under `/api/v1/compliance/*`.
- **Owner:** BE + LEGAL.
- **Estimate:** M.

### TASK-CMP-04 — DPA click-to-accept at signup (or onboarding)

- **Refs:** PRD §8.1, §8.5; PRD Q32.
- **Depends on:** P0-5.
- **DoD:**
  - On first admin login post-tenant-creation, modal: "Accetta il DPA per attivare la tua azienda" — opens the DPA PDF inline, requires checkbox + click "Accetto".
  - Persisted in `tenants.dpa_accepted_at`, `dpa_accepted_by`, `dpa_version`.
  - Re-prompt on DPA version change.
- **Owner:** WEB + BE.
- **Estimate:** S.

### TASK-CMP-05 — Public Trust page on the marketing site

- **Refs:** PRD §8.2, §11.2.
- **Depends on:** P0-5.
- **DoD:**
  - Astro page at `apps/website/src/pages/{lang}/trust.astro`. Bilingual.
  - Content: no continuous tracking commitment, sub-processor list (version-controlled), data residency map, Time Relax / Garante reference, "Customer Compliance Guide" link, security baseline summary, contact for security@.
- **Owner:** WEB + PM.
- **Estimate:** M.

---

## Phase 11 — Account deletion + retention enforcement

### TASK-RET-01 — Account deletion (user-initiated)

- **Refs:** PRD §8.1 right-to-erasure; PRD §3 App Store compliance.
- **Depends on:** TASK-FND-02.
- **DoD:**
  - `DELETE /api/v1/me` flow:
    - Web: `/account/delete` page with a confirmation field ("scrivi ELIMINA per confermare").
    - Mobile: equivalent screen.
  - Server soft-deletes the membership; the user can no longer authenticate.
  - Stamps retained per tenant retention policy (PRD Q31). PII (`email`, `display_name` on `auth.users` mirror) replaced with `<dipendente cessato>` after retention period via a scheduled job (TASK-RET-02).
  - User receives an email confirmation of deletion.
- **Owner:** BE + MOB + WEB.
- **Estimate:** M.

### TASK-RET-02 — Retention enforcement cron

- **Refs:** PRD §8.2.
- **Depends on:** TASK-STM-01, TASK-RET-01.
- **DoD:**
  - Cron job (weekly Sunday 02:00 Europe/Rome): for each tenant, hard-deletes stamps older than `retention_years`, anonymises deleted users whose retention period has elapsed.
  - Logged with row counts.
  - Test: fixture tenant with `retention_years=1` and a 2-year-old stamp → after job, stamp gone; audit_log entry "retention_purge: N rows" present.
- **Owner:** BE.
- **Estimate:** S.

### TASK-RET-03 — Tenant soft-delete + hard-delete grace period

- **Refs:** PRD §6.1 FR-T-04.
- **Depends on:** TASK-FND-02.
- **DoD:**
  - Admin can soft-delete the tenant from settings (TASK-WEB-08). Grace period: 30 days.
  - During grace: read-only; no stamps accepted; admin can re-activate.
  - Weekly cron purges tenants with `deleted_at < now() - interval '30 days'`. Hard purge cascades to all tenant-scoped tables.
  - Pre-purge: an export of all tenant data is generated automatically and emailed to the soft-delete-initiator.
  - Tests: cover grace, reactivation, purge.
- **Owner:** BE.
- **Estimate:** M.

---

## Phase 12 — Operations, observability, app-version, force-upgrade

### TASK-OPS-01 — Healthchecks + readiness + logs

- **Refs:** Boilerplate observability section.
- **Depends on:** P0-2.
- **DoD:**
  - Confirm `/health`, `/health/live`, `/health/ready` work in the new product (boilerplate-prescribed). `/health/ready` runs a `SELECT 1` plus the four cron jobs' last-success timestamps (stored in a `system_status` table).
  - Dozzle deployed on `logs.<root>` for log inspection.
  - Document the alerting plan in `docs/runbook.md`: log-monitoring via Dozzle; weekly dashboard review until automated alerts wired in v1.5.
- **Owner:** INFRA.
- **Estimate:** S.

### TASK-OPS-02 — Backups + restore drill

- **Refs:** PRD §7.3.
- **Depends on:** P0-2.
- **DoD:**
  - Boilerplate backup script verified: daily `pg_dump` to R2, 30-day retention.
  - **Restore drill** before launch: provision a fresh staging DB, restore yesterday's dump, confirm latest stamps present. Document the steps in `docs/disaster-recovery.md`.
- **Owner:** INFRA.
- **Estimate:** M.

### TASK-OPS-03 — Trivy + Gitleaks + security scan baseline

- **Refs:** Boilerplate security-scan workflow.
- **Depends on:** P0-1.
- **DoD:**
  - `.github/workflows/security-scan.yml` from boilerplate copied; runs on every push.
  - First scan green (no HIGH/CRITICAL; allowlist any accepted findings in `.trivyignore`).
- **Owner:** INFRA.
- **Estimate:** S.

### TASK-OPS-04 — App-version + force-upgrade endpoint

- **Refs:** PRD Q41.
- **Depends on:** none.
- **DoD:**
  - `GET /api/v1/app-version` returns `{ ios: { min_version, latest_version, force_upgrade }, android: {…} }`. Backed by a config table or env var.
  - Mobile clients (TASK-MOB-01) hit this on launch.
- **Owner:** BE.
- **Estimate:** S.

### TASK-OPS-05 — Tenant counter rollup

- **Refs:** PRD §5.1 user edit.
- **Depends on:** TASK-FND-02.
- **DoD:**
  - `GET /api/v1/admin/tenant/usage` returns `{ active_users_this_month, active_admins, max_users, max_admins, branches_count }`.
  - Surfaced in TASK-WEB-02 (dashboard) and TASK-WEB-04 (users page).
- **Owner:** BE.
- **Estimate:** S.

---

## Phase 13 — Testing & QA

### TASK-QA-01 — Test plan (functional + edge + load)

- **Refs:** PRD §6, §7.1, §7.2.
- **Depends on:** All preceding phases.
- **DoD:**
  - `docs/qa-plan.md` lists every PRD requirement with a corresponding test artifact (unit / integration / E2E / manual).
  - Manual test runs documented per phase milestone.
- **Owner:** QA.
- **Estimate:** M.

### TASK-QA-02 — Load test for stamp endpoint

- **Refs:** PRD §7.1, §7.2.
- **Depends on:** TASK-STM-05.
- **DoD:**
  - k6 or autocannon script simulates 4M stamps/month evenly distributed: 100 RPS sustained for 10 minutes.
  - p50 latency ≤200ms, p99 ≤800ms, error rate <0.1% on the staging VM.
- **Owner:** QA + BE.
- **Estimate:** M.

### TASK-QA-03 — Manual mobile field test

- **Refs:** PRD §5.3, §10.7.
- **Depends on:** TASK-MOB-04, TASK-MOB-05.
- **DoD:**
  - Each of: iOS 17+, iOS 18+, Android 12, Android 14 — tested in:
    - Real outdoor GPS (city centre).
    - Indoor GPS (basement, lift).
    - Airplane mode (offline queue).
    - Permission-denied path.
    - Mock-location app installed (Android only).
  - Findings tracked in a spreadsheet linked from `docs/qa-mobile-matrix.md`.
- **Owner:** QA + MOB.
- **Estimate:** M.

### TASK-QA-04 — Localisation review

- **Refs:** PRD §7.4.
- **Depends on:** Web + mobile + email work done.
- **DoD:**
  - Italian native speaker (preferably with payroll context) reviews every IT string in `packages/shared/src/locales/it.json` + email templates + PDF templates.
  - English fluent reviewer does the same for `en.json` + EN templates.
  - Errata logged and fixed.
- **Owner:** PM + native reviewers.
- **Estimate:** M.

### TASK-QA-05 — Accessibility audit (WCAG 2.1 AA)

- **Refs:** PRD §7.5.
- **Depends on:** TASK-WEB-04, TASK-MOB-04.
- **DoD:**
  - `axe-core` automated scan of admin web routes; all violations resolved or accepted with justification.
  - Manual screen-reader test of the mobile clock-in flow (VoiceOver iOS + TalkBack Android).
  - Keyboard navigation pass on web.
- **Owner:** QA + WEB + MOB.
- **Estimate:** M.

---

## Phase 14 — Pre-launch checklist

### TASK-LCH-01 — Penetration test (external)

- **Refs:** PRD §8.4.
- **Depends on:** All preceding phases.
- **DoD:**
  - One reputable pentest firm engaged (Italian or EU). Scope: API + web + mobile.
  - Critical + high findings remediated before launch. Medium/low tracked with fix dates.
  - Pentest report archived (private).
- **Owner:** PM + INFRA.
- **Estimate:** L (calendar).

### TASK-LCH-02 — Legal review final pass

- **Refs:** PRD §8.5; Q32, Q56.
- **Depends on:** TASK-CMP-01..05, TASK-RET-01..03.
- **DoD:**
  - TOS, privacy notice, DPA, sub-processor list, compliance PDFs reviewed and signed off by the engaged Italian lawyer.
  - Liability clause limits SonoQui to "tool provider" per Q56.
- **Owner:** PM + LEGAL.
- **Estimate:** M.

### TASK-LCH-03 — Closed beta

- **Refs:** PRD Q45.
- **Depends on:** All preceding phases.
- **DoD:**
  - 10 design-partner tenants onboarded via TASK-FND-06 script.
  - Weekly 30-minute check-ins for 60 days.
  - Bug + UX feedback triage cadence: bugs SLA 48h, UX feedback bucketed into post-GA backlog.
  - "Founding member" 50% lifetime discount applied to their billing record (manual MVP) on conversion to GA.
- **Owner:** PM.
- **Estimate:** XL (calendar; 60 days).

### TASK-LCH-04 — Marketing site v1

- **Refs:** PRD §11, §3.3.
- **Depends on:** P0-4.
- **DoD:**
  - Astro site live at the chosen domain (IT + EN).
  - Pages: home, prezzi, sicurezza & privacy (TASK-CMP-05), funzionalità, contatti.
  - Lead-capture form posts to Brevo list.
- **Owner:** WEB + PM + DESIGN.
- **Estimate:** L.

### TASK-LCH-05 — Launch runbook

- **Refs:** PRD §7.3, §8.4.
- **Depends on:** TASK-OPS-01..03, TASK-LCH-01..02.
- **DoD:**
  - `docs/launch-runbook.md` lists: pre-flight checks, deploy sequence, rollback procedure, incident contact list, data breach 72h notification flow.
  - Dry-run executed on staging.
- **Owner:** INFRA + PM.
- **Estimate:** M.

---

## Cross-cutting reminders (every PR must respect)

1. **No ORM.** Raw SQL via `pg.PoolClient`. Repository pattern under `apps/backend/src/repositories/pg/`.
2. **Every authenticated DB call inside `withTenantRLS`.** Lint rule + code review enforces.
3. **All migrations idempotent**, sequentially numbered 3-digit prefix, `CREATE … IF NOT EXISTS`, policies wrapped in `DO $$` blocks for existence check.
4. **Prod migrations NOT auto-applied.** Add to `.prod-bootstrap-migrations` or apply manually via psql. Staging auto-applies new files only.
5. **Tenant-isolation test added for every new authenticated route** (TASK-FND-05).
6. **GPS only at the stamp moment.** No background location, ever. Code review rejects any commit adding `ACCESS_BACKGROUND_LOCATION` or `NSLocationAlwaysAndWhenInUseUsageDescription`.
7. **All admin actions emit `audit_log`** with before/after snapshots and a reason.
8. **`SET LOCAL app.change_reason`** before any `stamps` mutation so the history trigger captures the reason.
9. **No new external auth provider, no Redis, no PostGIS, no facial recognition, no SMS, no Stripe in MVP.**
10. **Bilingual IT/EN** for every user-facing string, email, PDF, error message.
11. **Web is admin-only** in MVP — the user-facing employee flow is mobile-only. Don't add employee UI to the web app without explicit PRD update.
12. **Tenants created in DB by Archiva back-office** (TASK-FND-06). No public signup endpoint in MVP.
13. **`max_admins` + `max_users` are soft limits enforced at invite time**, surfaced in dashboard counter. They are not enforced at signup (no signup), and they do not retroactively deactivate existing users.

---

## Suggested sprint sequencing (rough — adjust at planning)

| Sprint (2w) | Focus | Key tasks done |
|---|---|---|
| 0 | Boilerplate onboarding | P0-1..6 |
| 1 | Foundation | FND-01..06; OPS-03 |
| 2 | Stamp engine core | STM-01..05; BR-01..03 |
| 3 | Stamp endpoints + mobile shell | STM-06..07; ADM-01..02; MOB-01..03 |
| 4 | Mobile clock-in | MOB-04..06; USR-01..02 |
| 5 | Admin web foundation | WEB-01..04; WEB-CENTRIFUGO |
| 6 | Admin web full | WEB-05..08; ADM-03 |
| 7 | Exports + cron | EXP-01..04; CRON-01; NOT-01..02 |
| 8 | Compliance + retention | CMP-01..05; RET-01..03 |
| 9 | Ops + QA + mobile correction | MOB-07..08; OPS-01..02, OPS-04..05; QA-01..05 |
| 10 | App Store submission + beta prep | MOB-09; LCH-04 |
| 11 | Pentest + legal final | LCH-01..02; LCH-05 |
| 12+ | Closed beta | LCH-03 (60 days, runs into GA) |

This is ~12 sprints (24 weeks ≈ 6 months) of focused work for a team of ~4 engineers (1 BE, 1 MOB, 1 WEB, 1 INFRA/QA) plus PM + LEGAL part-time. The PRD's Q3 2026 target is achievable if the boilerplate onboarding sprint (P0-3) doesn't surface major friction; if it does, sprints 1–2 may slip and the launch moves to Q4 2026.

---

*End of backlog v0.1. Update changelog when revised.*

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1 | 2026-05-24 | Claude (derived from PRD v0.1) | Initial backlog. |
| 0.2 | 2026-05-24 | Claude | Product name locked to SonoQui. P0-1 repo name → `sonoqui`. P0-4 fully expanded with concrete domain + UIBM + store-record actions. Nominatim User-Agent updated. Title + status reflect new name. |
