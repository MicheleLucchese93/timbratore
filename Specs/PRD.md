# SonoQui — Product Requirements Document

**Status:** Draft v0.2
**Date:** 2026-05-24
**Product name locked:** SonoQui ("ci sono" = "I'm here / I'm in"). Domains to grab: `sonoqui.app`, `sonoqui.io` (both free as of verification); `sonoqui.com` to backorder; `sonoqui.it` via broker post-traction. UIBM TM filing class 9+42 in flight.
**Companion documents:** [BOILERPLATE_ARCHITECTURE.md](BOILERPLATE_ARCHITECTURE.md) (pinned tech stack and platform conventions — non-negotiable; this PRD must respect it)

---

## 0. How to read this document

This PRD assumes the technical foundation defined in `BOILERPLATE_ARCHITECTURE.md` (Express 5 + Postgres with raw `pg` + RLS, React 19 + Vite SPA, Expo SDK 55 + React Native 0.83 mobile, Centrifugo realtime, Cloudflare R2 storage, GoTrue auth, Tailwind v4 with Material-3 tokens, Zustand state, no ORM, OVH/Docker deploy). Wherever a feature could be built two ways, this PRD picks the way that fits the boilerplate. Where a feature requires extending the boilerplate (e.g., geolocation, tenant-aware RLS, audit log), it is called out explicitly.

The last section (§14, Q&A) lists the questions the product owner needs to decide before development starts. Each question has a recommended default so silence-by-default produces a coherent product. The recommended defaults are what the implementation team should adopt unless the product owner explicitly changes them.

---

## 1. Vision and one-sentence pitch

**SonoQui is a mobile-first, GPS-verified attendance app for very small Italian and EU companies (under 20 employees) that ships with Italian labour-law compliance built in and costs no more than a few euros per active user per month, with no hardware required and no base fee. The name is the natural Italian roll-call answer — "ci sono" = "I'm here / I'm in" — uttered by the employee as the stamp is taken.**

The product replaces paper timesheets and Excel-based attendance tracking with a phone-only workflow: an employee opens the app at their workplace, the app confirms they are within a configurable geofence around an authorised branch (default tolerance 300m), and a stamp is recorded. Administrators provision branches and users from a web dashboard, fix forgotten stamps with an audit trail, and export monthly attendance data in commercialista-ready XLSX or in JSON.

---

## 2. Why now, why us

Three forces converge on this opportunity:

1. **The 2019 CJEU ruling (CCOO v. Deutsche Bank)** requires every employer in the EU to maintain an "objective, reliable and accessible" record of daily working hours. Paper logs technically satisfy this but are practically inadequate and evidentially weak; Italian SMEs are visibly migrating to digital tools.
2. **The Italian Garante per la Protezione dei Dati Personali** has fined multiple employers in 2024–2025 for over-broad employee monitoring (Time Relax: €50K, March 2025; multiple facial-recognition fines in 2024–2025). The market is hostile to international tools that capture continuous location, store selfies as biometric data, or fail to ship DPIA assets. A natively-Italian, privacy-by-design product has a clear opening.
3. **The "tiny team tax"** charged by Buddy Punch, QuickBooks Time, Connecteam Advanced ($19–$40 base fees plus $4–$11/user) makes most international tools uneconomic for 5–10-person Italian companies. The closest direct Italian competitor (NoBadge at €4.20–€5.04/user/mo) is beatable on price and on commercialista-integration depth.

The product is a focused timbratore tool (not a full HR suite), which keeps scope small, time-to-market short, and pricing genuinely sustainable at €2–€4/active-user/month.

---

## 3. Target market and positioning

### 3.1 Primary market

- **Geography:** Italy first (full Italian localisation, CCNL-aware defaults, commercialista exports). Expand to Spain and Portugal in v2 (similar SME structure, similar CJEU compliance pressure).
- **Company size:** 1–20 employees. Sweet spot: 5–12 employees with 1–2 branches.
- **Industries:** small retail, hospitality (bar, ristorante, B&B), professional services (studi legali, commercialisti, ingegneri), small construction crews, cleaning companies, healthcare practices (poliambulatori), distributed remote teams.
- **Buyer:** the owner-operator (titolare) or office manager. Not an HR professional. Time-poor, allergic to onboarding longer than 15 minutes, distrustful of "yet another SaaS".
- **Existing toolset:** Excel, WhatsApp-confirmed shifts, paper, sometimes a punch-card terminal from 2008. Their commercialista already handles payroll separately.

### 3.2 Out-of-scope markets (v1)

- Companies above 30 employees (handled better by Fluida, Factorial, Personio).
- Companies with shift planning needs (no scheduling in v1 — see §13 roadmap).
- Field-service / logistics teams requiring continuous route tracking (legally fraught in Italy; not our positioning).
- Public-sector employers (different procurement; not a v1 audience).
- Companies requiring biometric (fingerprint, face) attendance.

### 3.3 Positioning statement

> *Per piccole imprese italiane (1–20 dipendenti) che vogliono smettere di usare carta ed Excel per le timbrature, **SonoQui** è un'app mobile e web che verifica con il GPS che il dipendente sia in azienda al momento della timbratura, è conforme allo Statuto dei Lavoratori e al GDPR fin dalla prima installazione, e costa **pochi euro al mese per dipendente attivo, senza costi fissi**. A differenza di Jibble, Connecteam o Buddy Punch, SonoQui è pensato fin dall'inizio per il contesto italiano: CCNL pre-configurati, esportazioni XLSX pronte per il commercialista, modello DPIA scaricabile, hosting europeo. Apri l'app, sei al tuo posto di lavoro, tocca il pulsante: **ci sono**.*

### 3.4 Competitive landscape (summary; full analysis in §11)

| Competitor | Price for 10 users | Italian-native | Where we beat them |
|---|---|---|---|
| NoBadge | ~€42–50/mo | Yes | Commercialista exports depth, free tier for ≤5 users |
| Fluida (Zucchetti) | Free ≤10, then €60 base + €3/user | Yes | Lighter onboarding, no proprietary hardware |
| Jibble | Free (2 geofences); €39.90/mo Premium | Yes (UI) | Italian compliance assets, commercialista exports |
| Connecteam | Free ≤10 (no geofence), Advanced $49 base | Partial | Geofencing in free tier; native Italian product |
| Buddy Punch / QB Time | $19–$40 base + per-user | No | No base fee; native Italian |
| Factorial / Personio | €5.90–€20/user (full HR) | Yes | Lighter scope; faster onboarding; cheaper |

---

## 4. Personas

### 4.1 Persona A — Marco, Titolare di un bar a Bologna (Admin)

- **Age 47, runs a bar with 6 employees** (2 baristi, 2 camerieri, 1 cuoco, 1 lavapiatti part-time).
- Uses an iPhone 12, a Windows desktop in the back office, has a personal Gmail.
- Currently tracks attendance with a paper agenda. Calls his commercialista every 25th of the month and reads aloud the entry/exit times. Has been wanting "something digital" for two years but every tool he tried wanted €15/user/month and a half-day of setup.
- Stress points: forgotten stamps, disputes with employees over hours worked, the monthly call to the commercialista.
- Success for Marco: he sets up the app on a Sunday evening in 20 minutes; his employees clock in starting Monday; on the 25th of the next month he exports an XLSX and emails it to the commercialista, who reads it without question.

### 4.2 Persona B — Giulia, Cameriera (User / Employee)

- **Age 23, works at Marco's bar.** Has a Samsung A52 with a half-broken screen and prepaid data.
- Speaks Italian; her English is functional but not fluent.
- Doesn't want to install another app. Will install one if her boss requires it and it's small, fast, and doesn't drain her battery.
- Sometimes forgets to clock out. Cares that, when this happens, she can flag it to Marco from the app rather than texting him.
- Success for Giulia: she opens the app at the start of the shift, taps a big green button that says "Timbra ingresso", the app says "Sei al Bar Centrale – timbratura registrata alle 17:02", and she puts the phone away. At the end of the shift she does the same. Total interaction time: under 5 seconds per stamp.

### 4.3 Persona C — Sara, Office manager di uno studio legale a Milano (Admin)

- **Age 38, manages operations for 12 lawyers, 3 paralegals, 2 administrative staff.** Two offices (Milano centro + Milano Linate). One employee is fully remote (Torino).
- Uses a MacBook. Lives in Excel and Outlook.
- More tech-comfortable than Marco. Cares about ferie, ROL, permessi tracking (but those are v2 — she'll accept "just clock-in/out" for v1 if the price is right).
- Needs to handle the remote employee gracefully: no geofence for them, or a "remote work" branch.
- Success for Sara: she defines two branches with geofences, marks the remote lawyer as "smartworking — no geofence required", and exports two monthly XLSX (one per branch) plus a consolidated JSON for the studio's internal billing software.

### 4.4 Persona D — Antonio, Commercialista (indirect stakeholder)

- **Age 55, handles payroll for ~40 small clients.** Uses TeamSystem and Zucchetti Software paghe.
- Receives attendance data from clients in every imaginable format: WhatsApp photos of paper agendas, malformed Excel files, free-form emails ("Giulia ha lavorato 6 ore lunedì, 8 martedì...").
- Will recommend SonoQui to his clients if and only if the monthly export is clean, predictable, and reads correctly into his payroll software in one paste or one import.
- Antonio is not a buyer but he is a powerful evangelist. The XLSX format must satisfy him.

---

## 5. User flows (golden paths)

### 5.1 Admin onboarding (Marco, first hour)

1. Marco visits `sonoqui.app` from his desktop, clicks "Crea il tuo account aziendale gratis".
2. Form: ragione sociale, partita IVA (optional in v1), email, password, accept Terms + Privacy.
3. GoTrue creates the user, sends a confirmation email (Italian template). Marco confirms.
4. He logs in. The dashboard is empty. A wizard prompts:
   1. **Imposta la prima sede.** Address autocomplete (geocoded server-side via Nominatim or Mapbox), map shows a circle with a slider for radius (default 300m, range 50–1500m). Marco accepts the default.
   2. **Aggiungi il primo dipendente.** Form: name, email, role (default: dipendente). Send invitation email; the email contains a link to set their password.
   3. **Scarica il modello di informativa privacy e DPIA (PDF).** Optional but prominent. The PDF is pre-filled with the company's ragione sociale.
5. Marco repeats step 4.ii for the remaining 5 employees.
6. Dashboard now shows: 1 branch, 6 users, "Tutti pronti per timbrare".

**Target time-to-first-employee:** 5 minutes. **Target time-to-all-employees-invited:** 15 minutes.

--> personal note: do not manage auto-registration for new company. In MVP I will manage it in the DB. In the DB set also max number of admin and max number of users allowed for the tenant with a counter in the admin dashboard. DO not manage stripe for auto-payment, we will manage it manually in MVP

### 5.2 Employee first-time use (Giulia, first shift)

1. Giulia receives an email: "Marco ti ha invitato su SonoQui — Bar Centrale". Tap link.
2. Browser opens a landing page: "Installa l'app" (Android: Play Store link; iOS: App Store link; "Continua nel browser" PWA fallback).
3. She installs the native app (Expo-built RN, distributed through stores).
4. App opens to a login screen. She sets her password (the invite link contains a one-time GoTrue token).
5. Permissions wizard: geolocation ("Per timbrare dobbiamo verificare che tu sia in azienda — usiamo il GPS solo al momento della timbratura, mai prima, mai dopo"), notifications ("Per ricordarti di timbrare l'uscita se dimentichi"). Both optional in mechanics, but app surfaces a clear explanation of why.
6. Home screen: a single big green button "Timbra ingresso" with branch name "Bar Centrale" underneath. If she's outside the geofence, the button is grey: "Sei a 420m dal Bar Centrale — avvicinati per timbrare". --> do not feasible, to manage that you should always check localization, you can state the message only when the person clicks the button

--> personal note: do not manage PWA

### 5.3 Employee daily clock-in (Giulia, every day after first)

1. Open app. Cold start ≤2s.
2. App requests GPS in foreground. While acquiring (≤5s typical), shows a spinner: "Verifico la posizione…".
3. Once GPS resolves with `accuracy ≤ 50m`:
   - If inside any branch she belongs to: button turns green: "Sei al Bar Centrale – Timbra ingresso". She taps.
   - If outside all branches: button stays grey: "Sei a 230m dal Bar Centrale". She can ask the admin to fix later (see §5.6).
4. Tap → optimistic UI: "Timbratura registrata alle 17:02 ✓". Spinner persists until server confirms. On server confirmation, optimistic state hardens.
5. If offline at moment of tap: stamp is queued locally (IndexedDB on web, SQLite on RN), shown as "In sincronizzazione". When connectivity returns, queue drains; stamp confirmed.
6. App backgrounds. No further GPS use until next tap.

**Target interaction time:** ≤5 seconds in the typical case.

### 5.4 Employee break stamping (Giulia, coffee break)

1. While clocked in, the home button changes to "Timbra uscita". A secondary, smaller button appears: "Inizia pausa".
2. Giulia taps "Inizia pausa". The state changes to "In pausa dalle 10:00". The big button now reads "Termina pausa" (large) with "Timbra uscita" still available (small).
3. She taps "Termina pausa" 10 minutes later. State returns to "Al lavoro dalle 10:10".
4. Break is recorded with start/end. CCNL-aware classification: depending on length and tenant settings, break is paid or unpaid (default: <30 min = paid coffee break; ≥30 min = unpaid lunch break; admin can override per tenant or per CCNL preset).

### 5.5 Employee end-of-shift clock-out (Giulia)

1. Tap "Timbra uscita". Same GPS verification.
2. Recap screen: "Oggi: ingresso 17:02, uscita 23:08, pausa 10:00–10:10, ore lavorate 5h56m". Tap "Conferma" or "Hai dimenticato qualcosa?".
3. Done.

### 5.6 Forgotten-stamp self-service (Giulia)

1. She forgot to clock out last night.
2. Opening the app the next morning, a banner appears: "Sembra che tu non abbia timbrato l'uscita ieri sera. Vuoi segnalarlo a Marco?".
3. She taps "Sì". Form: "A che ora sei uscita davvero? (es. 23:30)" + optional note. Submits.
4. Marco receives a notification + an item in his "Da approvare" inbox.
5. Marco reviews: original stamp shown (clock-in at 17:02, no clock-out), Giulia's claim (23:30), one-tap "Approva" / "Modifica" / "Rifiuta".
6. On approve: a stamp edit is created, with audit log capturing original=null, edited=23:30, edited_by=marco, justification="dipendente segnala dimenticanza", source="employee_request".

### 5.7 Admin monthly export (Marco, 25th of the month)

1. Marco opens the dashboard, "Esportazioni" tab.
2. Selects month (default: previous month). Branch filter (default: all). User filter (default: all). Format: XLSX (default) or JSON.
3. Click "Genera esportazione". A background job kicks off (under 30s for ≤20 users × 31 days). Marco can navigate away; receives an email + in-app notification when ready.
4. Download: XLSX with one sheet per user (configurable to a single consolidated sheet). Format follows the [Commercialista Export Spec — §7.6](#76-export-formats). Columns: data, giorno_settimana, ingresso, pausa_inizio, pausa_fine, uscita, ore_lavorate, ore_pausa_non_retribuita, ore_straordinario, note. A summary sheet at the end aggregates by user (totali mensili).
5. Marco emails the XLSX to Antonio his commercialista. Done.

--> personal note: admin can change any stamp manually from the admin dashboard

---

## 6. Functional requirements

### 6.1 Tenant management

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| FR-T-01 | A tenant (= "azienda") is the top-level multi-tenancy unit. Created by self-service signup or by back-office. | Must | Database-direct creation flow for back-office use exists; signup is primary. |
| FR-T-02 | A tenant has: ragione sociale, country (ISO 3166-1 alpha-2, default IT), default timezone (IANA, default Europe/Rome), default language (default it-IT), default CCNL identifier (free-text in v1, picklist in v2), retention policy (default 5 years). | Must | All persisted in `tenants` table. |
| FR-T-03 | A tenant has 1..N branches, 1..N users, 1..N stamps. All rows in tenant-scoped tables carry `tenant_id` as the first column after `id`, with index `(tenant_id, ...)` on every query path. | Must | See §10.1 for RLS extension. |
| FR-T-04 | A tenant admin can soft-delete the tenant (logical deletion with grace period). Hard-delete after grace period purges all data. Data export must be possible before deletion. | Must | GDPR right to erasure. |
| FR-T-05 | A tenant cannot be moved between geographies (no v1 EU-to-US migration; data residency is sticky). | Must | EU-only hosting. |
| FR-T-06 | A user belongs to exactly one tenant in v1. (Multi-tenant users — e.g., a freelance bookkeeper serving multiple companies — deferred to v2.) | Should | Simplifies RLS dramatically. |

### 6.2 Authentication and roles

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| FR-A-01 | Auth via GoTrue (boilerplate-prescribed). Email/password is mandatory. Google OAuth and Apple Sign-In are optional v1 (recommended for mobile). | Must | No custom auth; no Auth0/Clerk. |
| FR-A-02 | Two roles in v1: **admin** and **user**. Admin can do everything within their tenant. User can clock in/out, view own stamps, submit fix requests. | Must | No middle "manager" role in v1; deferred. See §14 Q&A. |
| FR-A-03 | A tenant can have N admins (no minimum, no maximum) and N users. The signup-creator is automatically the first admin. Last-admin protection: an admin cannot demote themselves if no other admin exists. | Must | |
| FR-A-04 | Admin invites users by email. Invitation email sent via GoTrue's invite template (bilingual IT/EN). User clicks link → sets password. | Must | |
| FR-A-05 | Admin can deactivate a user (soft-delete: user can no longer clock in, but historical stamps remain). Admin can reactivate. | Must | |
| FR-A-06 | Admin can change a user's email (with re-confirmation flow) and role. | Should | |
| FR-A-07 | Captcha (Cloudflare Turnstile, boilerplate-prescribed) on signup, login, forgot-password — web only. Mobile login does not send a captcha token. | Must | |
| FR-A-08 | Password reset, email change, account deletion are GoTrue-native flows. | Must | |
| FR-A-09 | All API routes are tenant-scoped via RLS (see §10.1). A user authenticated via JWT carries their `tenant_id` resolved from the database (cached server-side per JWT lifetime, never trusted from the client). | Must | Critical for tenant isolation. |

### 6.3 Branches and geofences

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| FR-B-01 | A branch (= "sede") has: name, address (free-text + parsed components), latitude, longitude, geofence radius in meters (default 300m, configurable 50–1500m), active flag, optional timezone override, ordering index. | Must | |
| FR-B-02 | Admin creates a branch via a form with address autocomplete. Geocoding provider: see §10.2 (recommended: Nominatim/OSM for v1, swap to Mapbox if needed). Admin can drag a pin on a map (Leaflet + OSM tiles) to fine-tune position. Admin can adjust radius via slider; the geofence circle redraws live. | Must | |
| FR-B-03 | A branch can be marked **"sede smart-working / remoto"**: no geofence, clock-in allowed from anywhere. Used for fully-remote employees. | Must | Critical for Sara's persona. Tenant admin gets a clear warning that this branch is unverifiable. |
| FR-B-04 | A user is assigned to 1..N branches. By default, a user can clock in to any branch they are assigned to that contains their current location. If they are inside the geofence of multiple branches simultaneously (overlapping), the app picks the closest. | Must | |
| FR-B-05 | A branch can be deactivated (cannot clock in/out new stamps; existing stamps preserved). | Must | |
| FR-B-06 | Branch radius can be edited by the admin at any time. Existing stamps are not re-evaluated against the new radius. | Must | |
| FR-B-07 | A tenant in the free tier is capped at 2 branches. Paid tier: unlimited. | Should | Mirrors Jibble's pattern; soft moat. See §14 Q&A. |

### 6.4 Clock-in / clock-out / break flow

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| FR-C-01 | A stamp event has: `id` (UUID), `tenant_id`, `user_id`, `branch_id` (nullable for break events; never nullable for clock_in/out), `event_type` (`clock_in`, `clock_out`, `break_start`, `break_end`), `occurred_at` (TIMESTAMPTZ — UTC), `latitude`, `longitude`, `gps_accuracy_m` (meters), `device_platform` (`ios_native`, `android_native`, `web_pwa`, `web_browser`), `device_app_version`, `client_idempotency_key`, `source` (`employee_app`, `admin_manual`, `admin_correction`, `import`), `notes`, `created_at`, `created_by_user_id`. | Must | See §10.3 for schema. |
| FR-C-02 | Server enforces a "state machine" per user. Legal transitions: nothing → `clock_in`; `clock_in` → `clock_out` or `break_start`; `break_start` → `break_end`; `break_end` → `clock_out` or `break_start`. Illegal transitions return HTTP 409 with a clear error. | Must | "Already clocked in" guard; prevents corruption. |
| FR-C-03 | Server enforces geofence at insert time: distance between `(latitude, longitude)` and `branch.location` must satisfy `distance - gps_accuracy_m ≤ radius` (lenient policy — give the employee the benefit of GPS uncertainty). The policy (strict/lenient) is per-tenant configurable. | Must | See §10.4 for formula. |
| FR-C-04 | Server rejects stamps with `gps_accuracy_m > 100m` (uncertainty too high to be useful). The 100m ceiling is per-tenant configurable. Mobile clients enforce a tighter ceiling (50m) on the client side before allowing the button to be active. | Must | |
| FR-C-05 | Server rejects stamps with `occurred_at` more than ±5 minutes from server clock at receive time (replay protection; clock skew tolerance). | Must | |
| FR-C-06 | Client generates an `Idempotency-Key` UUID v4 per stamp attempt. Server stores keys in `idempotency_keys` table with 24h TTL. Replays return the cached response. | Must | See §10.6. |
| FR-C-07 | Mobile client implements UI debounce: the clock-in button is disabled for 1500ms after a tap, regardless of response. | Must | |
| FR-C-08 | A break is two stamps (`break_start` + `break_end`). The app's UI surfaces the abstraction of "una pausa" with a single timer view, but the database stores two events. | Must | |
| FR-C-09 | Breaks default to a single global tenant policy in v1 (e.g., "<30 min = retribuita, ≥30 min = non retribuita"). Per-CCNL templates deferred to v1.5. | Must | |
| FR-C-10 | The system handles overnight shifts: a `clock_in` at 22:00 and `clock_out` at 06:00 next day is one work session. The "day" attribution for reporting is the day of clock-in (tenant-configurable: clock-in date vs clock-out date vs midnight split — default: clock-in date). | Must | |
| FR-C-11 | DST handling: all storage in UTC; all reports computed from UTC deltas; display in Europe/Rome (or tenant TZ). A shift spanning a DST transition produces the correct worked-hours count (the UTC delta — not the wall-clock delta). | Must | |
| FR-C-12 | Mobile app supports offline clock-in: stamps are queued in local SQLite (RN) or IndexedDB (PWA). When connectivity returns, queue drains. Stamps queued more than 24h offline still sync but are flagged for admin review. | Must | |
| FR-C-13 | GPS is captured **only at the moment of a stamp event**, never in the background. No continuous location tracking. The app does not request `ACCESS_BACKGROUND_LOCATION` on Android or `NSLocationAlwaysAndWhenInUseUsageDescription` on iOS in v1. | Must | Italian Art. 4 compliance. Hard policy. |
| FR-C-14 | A stamp's GPS coordinates are stored in plaintext (lat/lng) for ≤90 days, then redacted to `branch_id only` (lat/lng cleared) for the remainder of the 5-year retention period. Stamp event metadata persists; raw location data is purged. | Should | Minimisation principle. See §14 Q&A. |
| FR-C-15 | Mock-location detection on mobile native: if `Location.isFromMockProvider()` returns true on Android, or iOS native detection signals spoofing, the stamp is recorded with a `suspicious_mock_location=true` flag and surfaced to the admin. Whether to block the stamp outright is tenant-configurable (default: allow + flag, not block). | Should | Native plugin required; see §10.7. |
| FR-C-16 | Multiple consecutive stamps of the same type within 60s are rejected with HTTP 409 (in addition to the state-machine check). Prevents network-retry double-stamps that idempotency keys don't cover (e.g., two genuinely separate taps with different keys). | Must | |

### 6.5 Admin override / edit forgotten stamps

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| FR-O-01 | Admin can create a stamp on behalf of a user, after the fact. Required fields: user, branch, event_type, occurred_at, justification (free text, mandatory). Source is recorded as `admin_manual`. GPS coordinates are null. | Must | |
| FR-O-02 | Admin can edit any field of an existing stamp (occurred_at, branch, event_type, notes). The original values are preserved in the audit log. Justification is mandatory. | Must | |
| FR-O-03 | Admin can delete a stamp. The row is not physically removed: soft-delete with `deleted_at` timestamp, `deleted_by_user_id`, `deletion_reason`. Audit log captures the snapshot. Deleted stamps are excluded from reports unless explicitly included. | Must | Evidentiary integrity. |
| FR-O-04 | A "Da approvare" inbox shows: forgotten-stamp requests from users, mock-location flags, anomalies (impossibly long shifts, missing clock-outs older than 24h). | Should | |
| FR-O-05 | Every admin action on a stamp emits an immutable `stamps_history` row (see §10.5). The history row is queryable and renderable in the UI as a timeline ("Modificato da Marco il 26/05/2026 alle 09:00 — motivo: dipendente ha dimenticato di timbrare l'uscita"). | Must | |
| FR-O-06 | Admin can bulk-edit stamps for one user across a day or week (e.g., "applica orario standard 9-18 con pausa 13-14 dal lunedì al venerdì della scorsa settimana"). v1 scope: yes — common SME need. | Should | |
| FR-O-07 | User can view their own stamp history. User cannot edit, but can request a correction (see FR-C-17 below / §5.6). | Must | |
| FR-O-08 | A user can submit a "correction request" for a missing or incorrect stamp. The request includes: claimed time, justification, optional photo. Lands in admin's "Da approvare" inbox. | Must | |

### 6.6 Reports and exports

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| FR-R-01 | Dashboard view (admin): current state per user (clocked in / on break / clocked out), with branch and timestamp. Updates in realtime via Centrifugo channel `tenant.<tenantId>.dashboard`. | Must | |
| FR-R-02 | Monthly view (admin): table of all users × all days in month, cells showing ingresso, uscita, totali. Filter by branch and by user. | Must | |
| FR-R-03 | Per-user history view (admin and self): list of all stamps for a user across a date range, with breaks and totals computed. | Must | |
| FR-R-04 | Export formats v1: **XLSX** (default) and **JSON**. CSV deferred (XLSX covers the use case). | Must | |
| FR-R-05 | XLSX export: see §7.6 Commercialista Export Spec. | Must | |
| FR-R-06 | JSON export: pretty-printed, well-typed, includes all stamp fields and computed daily/weekly/monthly totals. Schema versioned (`schema_version: "v1"`). | Must | |
| FR-R-07 | Export generation is asynchronous: enqueued on request, completed by a background worker (in-process via node-cron-triggered job runner; pulls from an `export_jobs` table). User receives an in-app notification + email when ready; the file is uploaded to R2 under `tenants/<tenantId>/exports/<exportId>.xlsx`, served via a 15-minute-TTL signed URL. | Must | Mirrors boilerplate's R2 exports prefix. |
| FR-R-08 | Export job retention: signed URLs valid 15 minutes; R2 objects retained for 30 days then auto-purged. | Should | |
| FR-R-09 | Exports respect the tenant's "deleted_stamps_visible" preference: by default, deleted stamps are excluded; an admin-visible toggle includes them with a clear "ELIMINATA" marker. | Should | |
| FR-R-10 | Exports can be scheduled (e.g., "send me the monthly XLSX on the 1st of every month"). Schedule entries trigger an export-generation job via node-cron at 03:00 in the tenant's timezone. | Could | v1.5; not v1. |

### 6.7 Notifications

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| FR-N-01 | Push notification (Expo Push, channel `reminders`): "Hai dimenticato di timbrare l'uscita ieri?" Fires for users with an open `clock_in` more than 14h old AND no further activity. Once per such event. | Must | |
| FR-N-02 | Push notification: "Sei vicino al Bar Centrale ma non hai timbrato l'ingresso" — **NOT in v1** (requires background geolocation, prohibited by Italian Art. 4 in our positioning). | Must (NOT) | Hard out-of-scope. |
| FR-N-03 | Email + in-app notification (admin): correction request submitted by user. | Must | |
| FR-N-04 | Email + in-app notification (admin): export ready. | Must | |
| FR-N-05 | Email (admin, opt-in): daily summary at 09:00 of the previous day's attendance — quick scan: "5/6 users clocked in, 1 missed clock-out (Giulia)". | Could | v1.5. |
| FR-N-06 | Email digest (user): weekly summary of own hours, sent Monday 08:00. | Could | v1.5. |
| FR-N-07 | All notifications are bilingual IT/EN, language driven by user preference. | Must | |

### 6.8 Settings and configuration

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| FR-S-01 | Tenant settings: name, country, timezone, language default, retention policy (years, default 5), geofence strictness (lenient/strict), GPS accuracy ceiling, mock-location action (allow/flag/block), break classification rules. | Must | |
| FR-S-02 | User settings: language, notification preferences (email/push toggle per channel). | Must | |
| FR-S-03 | Branch settings: name, address, lat/lng, radius, active, smart-working flag. | Must | |
| FR-S-04 | A "Compliance" section in admin settings exposes: privacy notice link (PDF generator), DPIA template (PDF generator with company data filled in), Art. 4 (Statuto dei Lavoratori) checklist. These are non-binding aids — SonoQui is not a legal service — but they materially reduce friction for the customer. | Must | Italian-market differentiator. |
| FR-S-05 | An "API & integrations" section: API key (per tenant, scoped to read/write), webhook URL for stamp events (v1.5). Used for integration with the tenant's own systems and for commercialista tools. | Should | v1 ships API key + read-only API; webhooks v1.5. |

---

## 7. Non-functional requirements

### 7.1 Performance

| Metric | Target | Notes |
|---|---|---|
| Cold start (mobile native) | ≤2s on a 2020-era mid-range Android | Hermes + RN New Arch; lazy-load non-essentials. |
| Stamp API p50 latency | ≤200ms | Server-side; excludes GPS acquisition time. |
| Stamp API p99 latency | ≤800ms | |
| GPS acquisition (mobile) | ≤5s on a typical clear-sky outdoor first fix | `enableHighAccuracy: true`, `watchPosition` until convergence. |
| GPS acquisition fallback | At 15s, show "Acquisizione lenta — sposta il dispositivo" | |
| Dashboard initial load | ≤1.5s p95 over 4G | |
| Monthly export (20 users × 31 days) | ≤30s wall-clock | Streaming XLSX via exceljs; uploaded to R2. |
| Real-time dashboard update | ≤2s from stamp creation | Centrifugo outbox pattern. |

### 7.2 Scale (v1 targets)

| Dimension | v1 target | Stretch |
|---|---|---|
| Tenants | 1,000 | 5,000 |
| Users per tenant | 20 (free + paid combined cap) | 50 (upper cap for v1 paid) |
| Total active users | 20,000 | 100,000 |
| Stamps per month (all tenants) | 4M (20k users × ~10 stamps/user/day × 20 working days) | 20M |
| Branches per tenant | 5 (default cap) | 20 |

These targets fit comfortably on the boilerplate's single Postgres + single Express container on one OVH VM. Vertical scaling (DB + API) is enough through v1.

### 7.3 Reliability

| Metric | Target | Notes |
|---|---|---|
| Uptime | 99.5% | One self-hosted VM; this is honest, not aspirational. Don't sell 99.9% in v1. |
| Backup | Daily Postgres dumps to R2 with 30-day retention | Boilerplate-prescribed. |
| Recovery Point Objective (RPO) | 24h | |
| Recovery Time Objective (RTO) | 4h | Manual restore from R2. |
| Stamp durability | Stamps are queued client-side if server unreachable; durable across app restarts on both web and mobile. No stamp loss permitted. | Critical; this is a legal record. |

### 7.4 Localisation

| Locale | v1 | Notes |
|---|---|---|
| it-IT | Yes (primary) | Native authoring. Reviewed by a payroll-aware speaker. |
| en-US / en-GB | Yes (functional baseline) | Machine translation acceptable for v1; refined v1.5. |
| es-ES | No | v2. |
| pt-PT | No | v2. |

All user-facing strings live in `packages/shared/src/locales/{it,en}.json`. Server-side templates (emails, exports) honour the recipient's locale. Dates and numbers formatted per locale (`12.345,67` in IT; `12,345.67` in EN). The CCNL/ROL/permesso vocabulary is Italian-only in v1.

### 7.5 Accessibility

WCAG 2.1 AA is the v1 floor. Concrete asks:

- All interactive controls keyboard-reachable on web.
- Colour contrast ratios ≥4.5:1 for body text, ≥3:1 for large text.
- Touch targets ≥44pt on mobile.
- Screen reader labels on the big clock-in button: "Timbra ingresso — sei al Bar Centrale".
- The clock-in button must be operable with one hand on a phone (large, central, easy to reach with the thumb).

### 7.6 Export formats

#### XLSX export — commercialista-ready

The XLSX is the most important customer-facing artifact after the clock-in button itself. Format:

- **Workbook structure:**
  - Sheet 1: `Riepilogo` — one row per user, columns: nome, cognome, codice_fiscale (optional), ore_totali, ore_ordinarie, ore_straordinarie, ore_pausa_retribuita, ore_pausa_non_retribuita, giorni_lavorati, giorni_assenza, note.
  - Sheets 2..N: one sheet per user, named `<cognome>_<nome>`. Each sheet has columns: data, giorno_settimana, sede, ingresso, pausa_inizio, pausa_fine, uscita, ore_lavorate, ore_pausa_non_retribuita, ore_straordinario, fonte (employee/admin), modifica (audit summary), note.
  - Last sheet: `Metadati` — tenant info, period, generation timestamp, schema version.
- **Formats:**
  - Date: `dd/mm/yyyy` (Italian convention).
  - Time: `hh:mm` (24h).
  - Duration: `hh:mm` (e.g., `8:30` not `8.5`).
- **Cell types:** times as `time` cells (not text), dates as `date` cells, durations as `[h]:mm` custom format (allows totals to exceed 24h without rollover).
- **Localization:** the same XLSX in EN substitutes English column headers; sheet names remain consistent.
- **No formulas, no merged cells, no images.** Commercialista tools paste-import; complex layouts break.
- **Stretch (v1.5):** a "preset" picker — "TeamSystem", "Zucchetti Software paghe", "Artel", "Passepartout", "INAZ" — that re-orders columns to match the import expectations of each. v1 ships only the "Generico Italia" layout above.

#### JSON export

```json
{
  "schema_version": "v1",
  "tenant": {
    "id": "uuid",
    "name": "Bar Centrale S.r.l.",
    "country": "IT",
    "timezone": "Europe/Rome"
  },
  "period": { "from": "2026-04-01", "to": "2026-04-30" },
  "generated_at": "2026-05-21T09:00:00Z",
  "users": [
    {
      "id": "uuid",
      "first_name": "Giulia",
      "last_name": "Rossi",
      "email": "giulia@bar.example",
      "totals": {
        "worked_minutes": 9420,
        "paid_break_minutes": 240,
        "unpaid_break_minutes": 1200,
        "overtime_minutes": 360,
        "working_days": 22,
        "absence_days": 0
      },
      "days": [
        {
          "date": "2026-04-01",
          "weekday": "Wednesday",
          "stamps": [
            {
              "id": "uuid",
              "event_type": "clock_in",
              "occurred_at": "2026-04-01T15:00:00Z",
              "branch_id": "uuid",
              "branch_name": "Bar Centrale",
              "source": "employee_app",
              "edited": false
            }
          ],
          "computed": { "worked_minutes": 480, "breaks_minutes": 60 }
        }
      ]
    }
  ]
}
```

JSON exports are the integration path for the tenant's own systems (commercialista import, internal billing).

---

## 8. Legal and compliance

This section defines what SonoQui commits to as a product. **It is not legal advice for the tenant.** Tenants remain responsible for their own compliance with applicable law.

### 8.1 GDPR posture

- **Lawful basis** for processing employee location data at the punch moment: Art. 6(1)(b) GDPR (necessary for the performance of the employment contract) and Art. 6(1)(f) (legitimate interest in verifying attendance), with the tenant as data controller and SonoQui as data processor. A standard Data Processing Agreement (DPA) is offered to every tenant, signable in-app at signup.
- **No special-category data** (Art. 9): no biometrics, no facial recognition, no fingerprints, no health data. Selfies are **not** stored in v1 (explicitly out of scope to avoid biometric-grey-zone risk).
- **Data minimisation:** GPS coordinates of stamps are minimised over time. Raw lat/lng kept ≤90 days; thereafter only `branch_id` retained (the lat/lng is removed by a scheduled job).
- **Right of access, rectification, erasure, portability:** all GDPR rights respected. Self-service in v1 for export (right of access + portability). Erasure requests honoured within 30 days, with the lawful exception of stamp records that the tenant must retain for labour-law purposes (in which case the stamp is anonymised, not deleted).
- **Data Protection Impact Assessment (DPIA):** SonoQui ships a pre-filled DPIA template that the tenant downloads from the dashboard, signed by their DPO if they have one or by the titolare otherwise. The template is reviewed by an Italian privacy lawyer (one-off engagement before launch). **This is a marketing asset, not legal advice.**
- **Sub-processors:** the boilerplate's external dependencies (Cloudflare R2, Brevo SMTP, Expo Push) are listed as sub-processors in the DPA. EU data residency where available (R2 in EU; Brevo IT/FR).

### 8.2 Italian-specific compliance

- **Art. 4 Statuto dei Lavoratori (Law 300/1970):** SonoQui is a tool from which monitoring can derive. The tenant must either (a) have a workplace union representation (RSA/RSU) and reach a written agreement on its use, or (b) request authorisation from the Ispettorato Nazionale del Lavoro (INL) before deploying. SonoQui ships a printable Art. 4 checklist + a sample union agreement + a sample INL request template, generated with the tenant's data pre-filled.
- **No continuous tracking:** the app never accesses location outside of an explicit user-initiated clock event. This is an architectural commitment, surfaced prominently in the privacy notice template and on the Trust page on `sonoqui.app`.
- **Retention:** stamps retained for 5 years by default (aligned with Libro Unico del Lavoro retention and the 5-year prescrizione for wage claims). Configurable up to 10 years (for tenants who want to retain longer in light of INPS contribution disputes). After retention period, stamps are hard-deleted by a scheduled job.
- **CCNL awareness:** v1 ships a single global break classification (configurable). v1.5 ships pre-configured templates for the most common CCNLs: turismo, commercio, metalmeccanici (artigianato + industria), edilizia, cooperative sociali, pubblici esercizi. The PRD does not commit to legal accuracy of these templates — they are convenience defaults that the tenant validates.
- **CJEU compliance (CCOO v. Deutsche Bank, 2019):** the stamping system is objective (GPS + timestamp + audit log), reliable (durable across app restarts, server-side validation), and accessible (employee can view own stamps anytime). Compliance is structural.

### 8.3 Data residency

All SonoQui data (Postgres, R2, backups, logs) is hosted in the European Economic Area:

- Postgres on OVH (Roubaix, France) or Aruba (Bergamo, Italy).
- Cloudflare R2 with EU jurisdiction binding.
- Brevo (Paris) for transactional email.

No data is transferred outside the EEA. Sub-processor list and current data flow diagram are published on the Trust page.

### 8.4 Security baseline

- **Encryption in transit:** TLS 1.3 everywhere, Cloudflare Origin Certificates, HSTS preload-eligible (boilerplate-prescribed).
- **Encryption at rest:** Postgres native disk encryption, R2 native server-side encryption.
- **Auth tokens:** GoTrue JWTs, 1h TTL, refresh tokens, secure HttpOnly cookies on web; SecureStore on mobile.
- **PII access logging:** every admin action that touches another user's data is logged in `audit_log`.
- **Vulnerability scanning:** Trivy filesystem + image scans in CI (boilerplate-prescribed).
- **Penetration test:** one external pentest before commercial launch (target Q4 2026). Annual thereafter.
- **Incident response:** documented runbook for data breach; 72h notification commitment to data subjects and Garante where required.

### 8.5 Terms of service and privacy notice

Drafted by an Italian internet lawyer specialising in SaaS + employment. Bilingual IT/EN. Versioned; users notified of changes via in-app banner and email; 30-day grace period before terms changes take effect.

---

## 9. Pricing and billing model (proposed)

### 9.1 Plans

| Plan | Price | Includes | Upper limits |
|---|---|---|---|
| **Gratis** | €0/mo | All core features; ≤5 active users/month; ≤2 branches; community support; basic export | Hard cap |
| **Professional** | €3/active user/month, no base fee | All core features; unlimited branches; email support; scheduled exports (v1.5); priority queue for jobs | Soft cap at 30 users — above 30, talk to sales |
| **Business** (v1.5) | €5/active user/month | Adds: API + webhooks, custom CCNL templates, priority support SLA, custom exports | — |


### 9.3 Sales-led upsells (deferred — v2)

Not in v1: no enterprise plan, no per-tenant custom contracts, no on-premise. We sell self-serve only.

---

## 10. Architecture alignment notes

This section documents the deltas between the boilerplate (`BOILERPLATE_ARCHITECTURE.md`) and what SonoQui needs.

### 10.1 Multi-tenant RLS extension

The boilerplate's `withRLS(userId, fn)` sets `app.current_user_id` per transaction. SonoQui adds a second GUC:

```sql
-- In apps/backend/src/lib/db.ts (extension to existing withRLS)
export async function withTenantRLS<T>(
  userId: string,
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL app.current_user_id = $1', [userId]);
    await client.query('SET LOCAL app.current_tenant_id = $1', [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
```

A new SQL function:

```sql
CREATE OR REPLACE FUNCTION auth.tenant_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
$$;
```

RLS policies are written against both `auth.uid()` (existing) and `auth.tenant_id()` (new):

```sql
CREATE POLICY tenant_isolation ON stamps
  USING (tenant_id = auth.tenant_id());

CREATE POLICY user_can_read_own_stamps ON stamps FOR SELECT
  USING (tenant_id = auth.tenant_id() AND
         (user_id = auth.uid() OR auth.is_admin()));
```

Where `auth.is_admin()` is a new function:

```sql
CREATE OR REPLACE FUNCTION auth.is_admin()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships
    WHERE user_id = auth.uid()
      AND tenant_id = auth.tenant_id()
      AND role = 'admin'
      AND deleted_at IS NULL
  )
$$;
```

The auth middleware resolves the request's tenant ID by looking up the user's membership (cached for the JWT's lifetime; first request after login does one DB lookup). All routes wrap their DB calls in `withTenantRLS(req.user.id, req.user.tenantId, ...)`.

**Discipline:** the test suite includes a `tenant-isolation.test.ts` that, for every endpoint, attempts to access tenant B's data while authenticated as tenant A. All must return 404 (not 403 — don't leak existence). CI fails on regression.

### 10.2 Geocoding provider

**v1 choice: Nominatim (OpenStreetMap)** for free-text address → lat/lng. Self-hosted Nominatim is overkill for v1 volume; use the public Nominatim instance with the polite-use policy (max 1 request/sec, identify with a User-Agent header). Fallback to MapTiler Geocoding (€0–€20/month range at our scale) if Nominatim rate-limits us.

**Map tiles for admin "draw branch" UI: OpenStreetMap tiles via Leaflet.** No API key; no cost. Free for our scale.

Mapbox and Google Maps explicitly **not chosen** for v1 — overkill and cost risk.

### 10.3 Stamps table schema

```sql
CREATE TABLE stamps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  user_id       uuid NOT NULL REFERENCES users(id),
  branch_id     uuid REFERENCES branches(id), -- nullable for break events; not null for clock_in/clock_out
  event_type    text NOT NULL CHECK (event_type IN ('clock_in','clock_out','break_start','break_end')),
  occurred_at   timestamptz NOT NULL,
  latitude      double precision,
  longitude     double precision,
  gps_accuracy_m double precision,
  device_platform text NOT NULL CHECK (device_platform IN ('ios_native','android_native','web_pwa','web_browser')),
  device_app_version text,
  client_idempotency_key uuid NOT NULL,
  source        text NOT NULL DEFAULT 'employee_app' CHECK (source IN ('employee_app','admin_manual','admin_correction','import','employee_correction')),
  notes         text,
  suspicious_mock_location boolean DEFAULT false,
  deleted_at    timestamptz,
  deleted_by_user_id uuid REFERENCES users(id),
  deletion_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  UNIQUE (tenant_id, user_id, client_idempotency_key)
);

CREATE INDEX idx_stamps_tenant_user_occurred
  ON stamps (tenant_id, user_id, occurred_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_stamps_tenant_occurred
  ON stamps (tenant_id, occurred_at DESC)
  WHERE deleted_at IS NULL;
```

The DATE/TIMESTAMPTZ distinction: TIMESTAMPTZ everywhere (the boilerplate's DATE-as-string custom parser is for DATE columns specifically; TIMESTAMPTZ comes back as an ISO string by default — fine).

### 10.4 Distance check (server-side, in the stamp insert path)

```typescript
function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const meanLat = ((lat1 + lat2) / 2) * toRad;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad * Math.cos(meanLat);
  return R * Math.sqrt(dLat * dLat + dLng * dLng);
}

function withinGeofence(
  branch: { latitude: number; longitude: number; radius_m: number; smart_working: boolean },
  stamp: { latitude: number; longitude: number; gps_accuracy_m: number },
  policy: 'strict' | 'lenient'
): { allowed: boolean; distance: number } {
  if (branch.smart_working) return { allowed: true, distance: 0 };
  const distance = distanceMeters(stamp.latitude, stamp.longitude, branch.latitude, branch.longitude);
  if (policy === 'strict') return { allowed: distance + stamp.gps_accuracy_m <= branch.radius_m, distance };
  return { allowed: distance - stamp.gps_accuracy_m <= branch.radius_m, distance };
}
```

No PostGIS in v1. Plain `double precision` lat/lng columns. If we later need spatial indexing (we won't at our scale), we add PostGIS then.

### 10.5 Audit log

Two tables:

```sql
-- Append-only event log for any audit-worthy action
CREATE TABLE audit_log (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  entity_type   text NOT NULL,
  entity_id     uuid NOT NULL,
  action        text NOT NULL,
  before        jsonb,
  after         jsonb,
  reason        text,
  ip            inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_log_tenant_entity ON audit_log (tenant_id, entity_type, entity_id, created_at DESC);
REVOKE UPDATE, DELETE ON audit_log FROM app_role; -- only INSERT for app

-- History table specifically for stamps (the audited entity that matters)
CREATE TABLE stamps_history (
  history_id    bigserial PRIMARY KEY,
  stamp_id      uuid NOT NULL,
  tenant_id     uuid NOT NULL,
  -- snapshot of all stamps columns at the moment of change
  user_id       uuid NOT NULL,
  branch_id     uuid,
  event_type    text NOT NULL,
  occurred_at   timestamptz NOT NULL,
  latitude      double precision,
  longitude     double precision,
  gps_accuracy_m double precision,
  notes         text,
  -- versioning metadata
  valid_from    timestamptz NOT NULL,
  valid_to      timestamptz,
  changed_by    uuid NOT NULL,
  change_reason text NOT NULL,
  change_action text NOT NULL CHECK (change_action IN ('create','update','delete'))
);
CREATE INDEX idx_stamps_history_stamp ON stamps_history (stamp_id, valid_from DESC);
REVOKE UPDATE, DELETE ON stamps_history FROM app_role;
```

A trigger on `stamps` populates `stamps_history` on INSERT/UPDATE/DELETE.

### 10.6 Idempotency keys

```sql
CREATE TABLE idempotency_keys (
  key                uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL,
  user_id            uuid NOT NULL,
  endpoint           text NOT NULL,
  status_code        int NOT NULL,
  response_body      jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL
);
CREATE INDEX idx_idempotency_expires ON idempotency_keys (expires_at);
```

A node-cron job sweeps expired keys nightly at 03:30 UTC (slot already used in boilerplate scheduler).

### 10.7 Geolocation on mobile (Expo additions)

Add `expo-location` to `apps/mobile/package.json` (boilerplate doesn't include it).

Permissions in `app.config.ts`:

- iOS: `infoPlist.NSLocationWhenInUseUsageDescription = "SonoQui usa il GPS al momento della timbratura per verificare che tu sia in azienda. Non tracciamo mai la tua posizione in background."`
- Android: `permissions: ["ACCESS_FINE_LOCATION"]` (do NOT add `ACCESS_BACKGROUND_LOCATION`).

Mock-location detection: candidate library is `react-native-turbo-mock-location-detector` (community-maintained, Expo-config-plugin-compatible). Vet during the v1 spike; if Expo SDK 55 compatibility is shaky, fall back to a minimal native module shipped via Expo prebuild.

GPS acquisition pattern:

```typescript
import * as Location from 'expo-location';

async function acquireLocation(timeoutMs = 15000): Promise<Location.LocationObject> {
  const subscription = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Highest });
  const deadline = Date.now() + timeoutMs;
  let best: Location.LocationObject | null = null;
  return new Promise((resolve, reject) => {
    subscription.remove; // pseudo — full impl uses callback + cleanup
    // Subscribe, keep the best (smallest accuracy) reading,
    // resolve as soon as accuracy <= 30m OR deadline reached.
    // Reject if no reading at all within deadline.
  });
}
```

(Real implementation is ~30 lines; this is a sketch.)

### 10.8 Web geolocation

```typescript
async function acquireLocationWeb(timeoutMs = 15000): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    let best: GeolocationPosition | null = null;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        if (!best || pos.coords.accuracy < best.coords.accuracy) best = pos;
        if (pos.coords.accuracy <= 30) {
          navigator.geolocation.clearWatch(id);
          resolve(pos);
        }
      },
      (err) => {
        navigator.geolocation.clearWatch(id);
        reject(err);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
    );
    setTimeout(() => {
      navigator.geolocation.clearWatch(id);
      if (best) resolve(best);
      else reject(new Error('Geolocation timeout'));
    }, timeoutMs);
  });
}
```

Desktop clock-in is disabled by default per tenant (set a `disable_desktop_clock_in` flag, default true). When disabled, the web app shows "Per timbrare usa l'app mobile" with App Store / Play Store links. This sidesteps the desktop-WiFi-accuracy-is-1km problem entirely.

### 10.9 Centrifugo channels

Channel naming extension to support tenant scope:

- `tenant.<tenantId>.dashboard` — admin live dashboard
- `tenant.<tenantId>.user.<userId>` — per-user updates (current state, notifications)

The boilerplate's `/api/v1/centrifugo/subscribe` proxy currently enforces `<ns>#<userId>` suffix matching. It needs a small extension to also accept `tenant.<tenantId>.dashboard` (granted only if the user is an admin of that tenant) and `tenant.<tenantId>.user.<userId>` (granted only if `userId === req.user.id`).

### 10.10 Background jobs

Two new node-cron jobs (slot into existing scheduler service):

- `process_export_jobs` — every minute, pulls `export_jobs` with `status='pending'`, generates XLSX via exceljs streaming, uploads to R2, marks `status='ready'`, notifies user.
- `cleanup_old_gps` — daily at 04:30 UTC, finds stamps older than 90 days with non-null lat/lng, nulls them out (FR-C-14). Idempotent.
- `cleanup_expired_idempotency` — nightly at 03:30, deletes from `idempotency_keys` where `expires_at < now()`.
- `forgotten_clockout_reminder` — every 15 minutes between 18:00–23:00 Europe/Rome local; identifies open clock-ins >14h old without further activity; sends one push notification per such case; marks the stamp as "reminder_sent" to avoid duplicates.

### 10.11 What we explicitly do NOT add to the boilerplate

- No PostGIS in v1 (plain lat/lng is enough).
- No Redis (in-process locks via Postgres advisory locks if ever needed).
- No background-fetch native modules.
- No facial-recognition or photo-storage stack.
- No SMS provider (push + email only for v1).
- No new state management library (Zustand only).

---

## 11. Detailed competitive analysis

(See market research §11 of the working draft for the full table. Summary of strategic positioning below.)

### 11.1 Three direct positioning angles

1. **Vs Italian incumbents (NoBadge, Fluida, Dipendenti in Cloud):** match Italian compliance and language depth, beat on price (€3/active vs €4.20–€5.04 fixed/user) and on the "active-user-only" billing model. Win Marco the bar owner with a clean DPIA download and "no setup tax".

2. **Vs international value-tier (Jibble, Connecteam, Clockify):** beat on Italian commercialista exports, on Italian Art. 4 compliance assets, and on the realisation that "geofencing is in Premium" (Connecteam) is unacceptable in our segment. We don't gate geofencing behind upgrades.

3. **Vs enterprise tier (Factorial, Personio, Sesame, Bizneo):** position as lighter, faster, cheaper. We are explicitly not a full HR suite. We do one thing well. Tenants who want ferie+ROL+permessi+payroll+e-signature should go to Factorial; we'd lose that customer profitably.

### 11.2 The Time Relax fine as a marketing artifact

The €50K fine issued by the Garante in March 2025 to Time Relax (Italian smart-working monitoring tool) for "unlawful surveillance" is recent, public, and visible to every Italian SME owner. Our Trust page leads with: "SonoQui registra la posizione **solo nell'istante della timbratura** — mai prima, mai dopo, mai in background. Lo abbiamo progettato così per non incorrere nelle sanzioni che hanno colpito altri strumenti di rilevazione presenze." Cite the Garante press release. This is a defensive positioning that becomes offensive.

### 11.3 The "active user" billing model as a marketing artifact

The market norm is "per-seat" billing — you pay for everyone you've invited, whether or not they use it. NoBadge already differentiates here. We adopt and amplify: "Paghi solo i dipendenti che hanno effettivamente timbrato questo mese. Estivo, stagionale, sostituzione? Non paghi niente per chi non c'è." The landing page math: a bar with 6 employees who clock in plus 4 seasonal workers active only in June–August. Pay €18/month for 9 months, €30/month for 3 months. Total annual: €252. Same setup on NoBadge at €4.20: €504. On Buddy Punch: $19 base + 10 × $4.49 × 12 = ~$768.

### 11.4 What we will lose visibility on

We will not appear in lists titled "Best HR Software for Italy 2026" — Factorial owns those. We aim for "Best app per timbrare presenze piccola impresa" lists and "alternativa a Fluida" comparison articles. Content strategy follows.

---

## 12. Out of scope for v1

Explicitly:

- Shift planning / scheduling (start-of-shift, end-of-shift expectations beyond clock-in data).
- Absence management (ferie, ROL, permessi, malattia, congedi). v1 doesn't model absence; admin tracks elsewhere or marks it in the notes field. v1.5 adds basic ferie/permesso tracking.
- Payroll computation. We export data; we do not compute net pay, taxes, contributi. The commercialista does that.
- Facial recognition, fingerprint, biometric.
- Selfie capture (deferred to v1.5, with biometric-zero positioning — selfies as visual evidence, not biometric matching).
- Continuous background location tracking (intentionally not built, ever, in Italian market).
- Multi-tenant users (a user belonging to multiple tenants).
- Hardware integrations (badge readers, NFC tags, beacons). We are a no-hardware product.
- White-label / reseller flow.
- On-premise / self-hosted deploy by the tenant.
- API webhooks (read-only API yes; webhooks v1.5).
- SMS notifications.
- Multi-language UI beyond IT/EN.
- Public mobile clock-in (kiosk mode where a tablet is mounted at the door and employees tap their name) — viable v2 feature.
- Integrations with specific payroll software beyond XLSX/JSON export.
- Mobile in-app purchase / mobile billing.
- Approval workflows beyond the admin "Da approvare" inbox (no multi-stage approval).
- Reporting beyond standard exports (no custom report builder, no dashboard widgets v1).
- Geofencing with shape other than a circle (no polygons v1).

---

## 14. Q&A — open questions for the product owner

This section is the most important part of the document. Each item is a question that needs an explicit answer before development starts. Each item carries a **recommended default** so silence-by-default produces a coherent product. The recommendation reflects my best read of the market research, the boilerplate's constraints, and what would make a small Italian company actually use the tool.

> **How to use this section:** read top-to-bottom; for each item either accept the recommended default (write "OK" in the margin) or write your alternative. Items marked **⚠ load-bearing** are decisions that change the product's character if reversed; items marked **○ small** can be revised later cheaply.

### Q&A — Product positioning and scope

**Q1 ⚠ load-bearing. Are we comfortable with the "tiny team only" positioning (≤20 employees) or do we want to leave room to grow to 50–100-person companies in v1?**
- do not put a block for more then 20 user, I will set it up in the DB

**Q2 ⚠ load-bearing. Italy-first vs EU-from-day-one?**
- *Recommendation:* Italy-first. Italian-language UI, Italian compliance assets, Italian commercialista exports. 

**Q3 ○ small. Do we want a free tier at all, and if so where do we cap it?**
- *Recommendation:* I will manage it, no auto-payment


### Q&A — Authentication and roles

**Q6 ⚠ load-bearing. Two roles (admin/user) only in v1, or do we add an intermediate "manager" role?**
- *Recommendation:* admin/user only in v1. 

**Q7 ○ small. Multi-tenant users (one user belonging to multiple companies, e.g., a freelance accountant)?**
- *Recommendation:* no in v1. One user → one tenant. 

**Q8 ○ small. Google OAuth and Apple Sign-In for v1, or email/password only?**
- *Recommendation:* both, on mobile (the boilerplate already wires them). On web, Google OAuth yes, Apple Sign-In can wait for v1.5. Email/password is mandatory in all cases.

**Q9 ⚠ load-bearing. Mandatory two-factor authentication for admins?**
- *Recommendation:* not mandatory in v1; offered as a setting. 

### Q&A — Geolocation and geofencing

**Q10 ⚠ load-bearing. Default geofence tolerance: 300m as specified, or a different default?**
- *Recommendation:* 300m as you specified. It's the right balance between "tight enough to verify presence" and "loose enough to absorb GPS uncertainty + parking-lot reality". A bar entrance and the building's back kitchen can be 30m apart; the worker might tap as they walk in. Permit tenant override 50m–1500m.
- *Tip:* in the admin UI, show a visual radius preview on the map with a "stress test" feature: "your geofence covers X buildings and Y parking spaces. Click to confirm."

**Q11 ⚠ load-bearing. GPS accuracy ceiling: reject above 50m on client, 100m on server?**
- *Recommendation:* client-side 50m, server-side 100m. The asymmetry is intentional: the client refuses to attempt a stamp unless GPS is converged; the server accepts somewhat looser readings to absorb edge cases (e.g., a stamp queued offline and synced later, where the GPS reading is from the moment of the tap but the network sync is hours later). Server still rejects above 100m as protection against the desktop-WiFi-positioning-is-a-kilometer-off failure mode.

**Q12 ⚠ load-bearing. Strict vs lenient geofence policy default?**
- *Recommendation:* lenient (`distance - accuracy ≤ radius`) as default. This gives the employee the benefit of GPS uncertainty. The market consensus is lenient. Tenant can switch to strict in settings.
- *Tip:* expose both as named options in the UI ("Tollerante — pensata per ridurre rifiuti errati" vs "Severa — pensata per ridurre frodi"). The admin chooses; we don't unilaterally pick.

**Q13 ⚠ load-bearing. Desktop web clock-in: allowed, allowed-but-discouraged, or disabled by default?**
- *Recommendation:* disabled by default. The desktop WiFi positioning accuracy problem (1km+ in many cases) is unsolvable, and we cannot reliably distinguish "employee at their desk" from "employee at home WFH" via the browser. Tenant can opt-in to allow desktop stamps with a clear "less accurate, use only if you trust your employees on the honor system" warning. Default off.
- *Alternative considered:* allow but require the admin to have explicitly enabled it. This is what we'll do — the setting exists, defaults to off, admin can flip.

**Q14 ○ small. What happens if the user denies GPS permission?**
- *Recommendation:* show a clear screen: "Per timbrare con verifica GPS, l'app deve poter leggere la tua posizione al momento della timbratura. Puoi attivare il permesso ora." 

**Q16 ⚠ load-bearing. GPS coordinate retention: full lat/lng for 90 days, then redacted?**
- *Recommendation:* yes, redact lat/lng after 90 days; keep `branch_id` (which carries "this stamp was at this branch" without coordinate precision). This is the data-minimisation play that lets us answer Garante's "do you really need to keep this" question with "no". The 90-day window covers any reasonable dispute period.

### Q&A — Stamp model

**Q17 ⚠ load-bearing. Day attribution for overnight shifts: clock-in date, clock-out date, or split at midnight?**
- *Recommendation:* clock-in date. A shift starting Friday 22:00 and ending Saturday 06:00 attributes to Friday. This matches Italian payroll convention. Tenant-configurable.

**Q18 ○ small. Maximum allowed shift length before flagging as anomaly?**
- *Recommendation:* 14 hours. Above 14h continuous clocked-in time without a clock-out, the system flags it for admin review and sends a "did you forget to clock out?" push to the user. Below 14h, no flag. --> ok for the flag, put in admin dashboard as default so admin can change or delete the reminder

**Q19 ○ small. Maximum allowed break length before flagging as anomaly?**
- *Recommendation:* 4 hours. A "break" longer than 4 hours is more likely a missed clock-out + missed clock-in than a real pause. Flag for admin review. --> ok for the flag, put in admin dashboard as default so admin can change or delete the reminder

**Q20 ⚠ load-bearing. Break paid/unpaid rule v1: single global setting or per-CCNL?**
- *Recommendation:* single global setting per tenant in v1 with the default "<30 min = retribuita, ≥30 min = non retribuita". Per-CCNL templates ship in v1.5. This is acceptable because the export sheet has a separate column for `ore_pausa_non_retribuita`, so the commercialista can override. --> ok for the flag, put in admin dashboard as default so admin can change or delete it

**Q21 ○ small. Overtime calculation v1: tracked or just hours-worked?**
- *Recommendation:* track hours-worked only in v1, no overtime classification. Overtime is CCNL-dependent and the export can list all hours; the commercialista classifies. v1.5 adds a "ore standard per giorno" tenant setting (default 8h) that drives an `ore_straordinario` column. Simple.

**Q22 ○ small. Can a stamp be in the future?**
- *Recommendation:* no. Reject `occurred_at > server_now + 5 minutes`. Combined with the ±5 minute server-clock-skew tolerance, this means a stamp can be at most 5 minutes in the future. This is a server-side validation in addition to the replay-protection check.

**Q23 ○ small. Can a stamp be backdated by an admin to a date before the tenant existed?**
- *Recommendation:* no for v1; backdate is allowed only within the tenant's existence window. Importing historical data from another system is a v2 feature with its own import flow.

### Q&A — Exports

**Q24 ⚠ load-bearing. XLSX format: one sheet per user + a riepilogo sheet, or a single sheet?**
- *Recommendation:* one sheet per user, plus `Riepilogo` and `Metadati` sheets. The commercialista's import tools (TeamSystem, Zucchetti) expect per-employee data; a single sheet with all employees mashed together is harder to consume. The cost is a slightly larger file — irrelevant.

**Q25 ○ small. Include CSV in v1?**
- *Recommendation:* no. CSV's character-encoding-and-quoting hell is more pain than it's worth; XLSX + JSON covers every realistic use case. v1.5 if customers ask.

**Q26 ○ small. Auto-email the monthly export to the commercialista?**
- *Recommendation:* in v1, the tenant can add the commercialista's email address as a "ricevente esterno" who receives a copy of every monthly export when generated. Set-and-forget for Marco. Auto-scheduled exports themselves (v1.5).

**Q27 ⚠ load-bearing. Are exports tenant-scoped only, or can a multi-tenant user (v2) generate a combined export across tenants?**
- *Recommendation:* tenant-scoped only in v1 (no multi-tenant users in v1 anyway). v2 introduces a per-tenant view; cross-tenant exports are out of scope.

### Q&A — Compliance, data, and privacy

**Q28 ⚠ load-bearing. Hosting: OVH France or Aruba Italy?**
- *Recommendation:* start with OVH (boilerplate-default). Aruba's Italian-jurisdiction marketing angle is real but not critical at launch; OVH-France is EEA and EU-jurisdiction-compliant. If we land enterprise-ish tenants who want Italian-jurisdiction-specifically, we move to Aruba — but that's a v1.5+ migration, not blocking.

**Q29 ○ small. Selfie at clock-in in v1?**
- *Recommendation:* no in v1. Shipped in v1.5 as an opt-in per-tenant feature, with strict positioning: "selfie come prova visiva di presenza, MAI come riconoscimento facciale". Stored encrypted, accessible only to the tenant's admins, deleted after 90 days. We never train any model on these images. This positioning protects us from Art. 9 GDPR / Garante facial-recognition penalties.

**Q30 ⚠ load-bearing. Data retention default: 5 years or 10?**
- *Recommendation:* 5 years default, configurable up to 10. This matches LUL and prescrizione for wage claims. Some commercialisti will want 10 years; offer it as a setting.

**Q31 ○ small. Right-to-erasure handling for a user who leaves the company.**
- *Recommendation:* the user's profile is soft-deleted (cannot log in, cannot create new stamps). Existing stamps are retained for the tenant's legal-retention period (5 or 10 years). Personally identifying information (email, name) is replaced with `<dipendente cessato>` placeholder after the retention period. The user can request access (export their stamps) at any time during retention. They can't request full erasure of stamps during retention — labour-law retention overrides the right to erasure (Art. 17(3)(b) GDPR — legal obligation).

**Q32 ⚠ load-bearing. Sub-processor list and DPA: ship at launch or wait until first paid customer?**
- *Recommendation:* ship at launch. The DPA is on the website, signable in-app at signup (click-to-accept; we keep a signed PDF on file). The sub-processor list is public on the Trust page and version-controlled. This costs us €1.5k for a lawyer review pre-launch and earns us 2× more sign-ups from buyers who actually read these things.

### Q&A — Notifications and UX

**Q33 ⚠ load-bearing. Push notification strategy: just "forgot to clock out", or richer (entry/exit confirmation, weekly summary)?**
- *Recommendation:* v1 ships only the "forgot to clock out" reminder. Stamp-confirmation pushes are visually distracting and unnecessary (the in-app confirmation suffices). Weekly summary push is v1.5. This minimises push permission friction at install time.

**Q34 ○ small. Email vs push for the admin's "Da approvare" notifications?**
- *Recommendation:* both, with per-channel toggles. Email is the default-on; push is opt-in. Admins are often at a desktop, not a phone.

**Q35 ⚠ load-bearing. Should the employee app show their own historical stamps and computed hours?**
- *Recommendation:* yes. Transparency reduces disputes and support tickets. Show: last 30 days by default, longer history on demand. Show computed totals (weekly hours, monthly hours). This is also a CCOO-compliance posture ("accessible" to the worker).

**Q36 ○ small. Confirmation step before tap-to-clock-in: yes/no?**
- *Recommendation:* no confirmation dialog. One tap = one stamp. The combination of UI debounce (1500ms), button visual change on tap, optimistic confirmation, and audit-trail-with-easy-reversal means a confirmation is friction without benefit. If a user mis-taps, they can submit a correction request immediately.

**Q37 ○ small. Allow the employee to undo a stamp within X seconds?**
- *Recommendation:* yes, 60-second window. A small "annulla" toast appears for 60s after a stamp. Tap → stamp is soft-deleted (audit-logged). After 60s, the toast disappears and only a correction request is available.

### Q&A — Mobile platform choices

**Q38 ⚠ load-bearing. Mobile: native (Expo / React Native — boilerplate-prescribed) vs PWA-first?**
- *Recommendation:* native (Expo/RN, per the boilerplate). The boilerplate already wires Expo SDK 55, React Native 0.83, RN-Web, self-hosted OTA, biometric auth, push notifications. Pure PWA on iOS has too many landmines (push only when home-screen-installed, no mock-location detection, 7-day storage limit, geolocation permission quirks). The boilerplate's RN-Web target also delivers a PWA-equivalent experience to tenants who refuse store-distribution.

**Q39 ⚠ load-bearing. iOS App Store distribution and the App Store review risk.**
- *Recommendation:* full App Store distribution from v1. We meet App Store guidelines (no continuous tracking, clear permission justification, in-app deletion of account). App Store reviewers occasionally reject GPS-attendance apps citing 5.1.2 (employee monitoring); the safe path is a clear privacy notice + transparent permission usage + employer-of-employee TOS clause. We budget 2–3 review rounds at launch.

**Q40 ○ small. Android distribution: Play Store only, or also APK direct download for tenants who prefer it?**
- *Recommendation:* Play Store only in v1. APK sideloading is a support nightmare and a security risk. Play Store coverage is universal in our market.

**Q41 ○ small. Mobile app version management: hard-require upgrades after N weeks?**
- *Recommendation:* yes, force-upgrade on critical security fixes only; soft-warn for feature updates. Pattern: client sends version to server on launch; server returns a flag if forced upgrade required.

### Q&A — Operations and go-to-market

**Q42 ⚠ load-bearing. Launch geography: Italy national or one city/region first?**
- *Recommendation:* national from day one. Italy is small enough that regional segmentation adds no value; SEO and content cover the whole country at the same cost.

**Q43 ⚠ load-bearing. Pricing in EUR only, or also USD/GBP for diaspora customers?**
- *Recommendation:* EUR only.

**Q44 ○ small. Customer support model.**
- *Recommendation:* email-only support in v1 (Brevo for inbox; Helpscout or Crisp as the inbox-management tool if Brevo's UI is insufficient — boilerplate already wires Brevo SMTP). Office hours weekdays 9–18 CET. Auto-responder commits to response within 24 business hours. Live chat is v1.5.

**Q45 ⚠ load-bearing. Beta program before public launch?**
- *Recommendation:* yes. Target: 10 design-partner tenants. 60-day closed beta with weekly check-ins. Free during beta. Pricing kicks in for them at GA with a "founding member" 50% lifetime discount as gratitude.

**Q46 ○ small. Affiliate / partner program for commercialisti?**
- *Recommendation:* yes, but v1.5. Antonio the commercialista is our most powerful evangelist. 20% recurring commission on tenants he refers. Build the program after we have a polished product to refer.

**Q47 ⚠ load-bearing. Branding: product name.**
- *Decision (2026-05-24):* **SonoQui** ("ci sono" = "I'm here / I'm in"). Picked from a 24-candidate brand audit covering domain availability across `.app/.it/.io/.com`, Apple App Store + Google Play exact-name and category-collision searches, Italian trademark quick checks, and Italian-SME-owner comprehension test. SonoQui won because it is (a) an everyday Italian roll-call answer that requires zero explanation to the Marco-the-bar-owner persona, (b) the only finalist where both `.app` and `.io` are unregistered at standard-registrar pricing as of verification, and (c) had zero same-vertical app-store collisions and no Italian trademark conflict in software classes 9 + 42. Disqualified alternatives: Eccomi (live competitor on eccomi.io — EFFEFFE SRL Foggia + Gruppo VéGé TM), Presente (Smart Time / Bunker360 collision), Pronto (ProntoPro Italian brand giant), Subito (Subito.it top-3 Italian consumer brand), Appello (ApPello EU fintech + Skello adjacency), Meridiana (HR-Meridiana direct competitor + meridianatime.ch), Klepsi (clean sweep but coined Greek-root word fails the "instantly understandable" brief). Domains to lock in P0-4 (see DEV_BACKLOG): `sonoqui.app` at Cloudflare Registrar (~$14/yr), `sonoqui.io` at Porkbun (~$35/yr), backorder on `sonoqui.com` (Chinese parking), broker offer on `sonoqui.it` (held by Puglia.com flipper — expect €1.5k–5k ask; skip for v1, pursue post-traction). UIBM word-mark filing in classes 9 (software product) + 42 (SaaS) within 30 days of domain registration to lock Italian priority (~€280).

**Q48 ○ small. Visual brand: bold/playful (Connecteam-style) or sober/professional (Personio-style)?**
- *Recommendation:* sober/professional with a single warm accent colour. Marco the bar owner is more responsive to "looks like serious software" than to playful illustrations. The brand should feel like Stripe or Notion, not like Slack. Mobile end-user UI can be slightly playful (it's a one-button app). Admin UI is sober.

### Q&A — Technical decisions worth confirming

**Q49 ○ small. PostGIS for geo queries, or plain lat/lng?**
- *Recommendation:* plain lat/lng. v1 scale doesn't justify PostGIS dependency. We compute distance in TypeScript at insert time; we don't run "find all stamps within a polygon" queries in v1. Add PostGIS later if v2 needs it.

**Q50 ○ small. Geocoding provider: Nominatim/OSM or paid (MapTiler/Mapbox)?**
- *Recommendation:* Nominatim with the polite-use User-Agent and 1 req/sec self-imposed limit. At our scale (≤1000 tenants, each creating ≤5 branches over a year — so <100 geocoding requests per day), Nominatim is comfortably within fair-use. Fallback to MapTiler if Nominatim hits limits.

**Q51 ⚠ load-bearing. ORM exception. The boilerplate forbids ORMs. Does SonoQui have any code path that wants one?**
- *Recommendation:* no — comply with the boilerplate. Raw SQL via `pg.PoolClient` everywhere. The repository pattern (`apps/backend/src/repositories/pg/`) is fine for our model. If the team finds itself writing repetitive CRUD, the answer is shared helper functions in `lib/db.ts`, not Prisma.

**Q52 ○ small. Database migrations: any non-idempotent migration needed?**
- *Recommendation:* no — all migrations must be idempotent per boilerplate convention. The complex v1 migrations (RLS policies, history triggers) are all expressible with `CREATE OR REPLACE FUNCTION` and `CREATE POLICY ... IF NOT EXISTS` (note: Postgres doesn't natively have `CREATE POLICY IF NOT EXISTS` — wrap in a `DO $$ BEGIN ... END $$` block with an existence check).

**Q53 ○ small. Centrifugo namespace strategy.**
- *Recommendation:* one namespace `tenant` with two channel-name patterns: `tenant.<tenantId>.dashboard` and `tenant.<tenantId>.user.<userId>`. The `/subscribe` proxy needs a small change to also accept the `tenant.<tenantId>.*` pattern with the admin-role check.

**Q54 ⚠ load-bearing. Self-hosted OTA: do we use it for v1?**
- *Recommendation:* yes. The boilerplate's self-hosted Expo Open OTA is set up; not using it would be a waste. OTA enables fast bug fixes without App Store / Play Store review delays. Reserve OTA for JS-only fixes (boilerplate's `.native-fingerprint.json` flow enforces this).

**Q55 ○ small. Initial Postgres instance sizing.**
- *Recommendation:* 4 vCPU, 16 GB RAM, 200 GB SSD on the OVH VM. Comfortable for v1 targets. Vertical scale to 8 vCPU / 32 GB at 5,000 tenants. Beyond that we revisit (read replicas, possibly Aurora-equivalent if we move to managed).

### Q&A — Risks I want to surface

**Q56 ⚠ load-bearing risk.** **Italian Art. 4 compliance is a tenant obligation, not ours, but tenants who deploy us without doing the union/INL step are exposed.** We ship templates, but we cannot guarantee tenants use them. The risk to SonoQui is reputational ("Garante fined a SonoQui customer"). Mitigation: prominent in-product warnings, the DPIA/Art. 4 template flow, a publicly-readable "Customer Compliance Guide" on the website. We are not the lawyer; we are the tool. Surface this expectation clearly in the TOS. *Recommend: legal review before launch confirms our liability stops at "tool provider" status.*

**Q57 ⚠ load-bearing risk.** **App Store review may reject employee-monitoring apps.** Mitigation: rigorous privacy posture (no continuous tracking, clear permission justification, easy account deletion). Budget 2–3 review rounds. If rejected, we have a fallback PWA path via the RN-Web target.

**Q58 ⚠ load-bearing risk.** **The "active user" billing model could be gamed by tenants who delete users mid-month and re-create them next month.** Mitigation: count distinct user IDs that stamped during the billing month at the database level; soft-deletes + re-creates count as one user. If a tenant repeatedly creates/deletes the same user, that's a gameable signal but operationally annoying — they'll stop. Monitor; address in v1.5 with abuse detection if needed.

**Q59 ⚠ load-bearing risk.** **Self-hosted single-VM deployment has a true uptime ceiling around 99.5%.** Mitigation: be honest in marketing (don't sell 99.9%). If a tenant requests a higher SLA, talk to them about enterprise tier (v2). For Marco the bar owner, 99.5% is fine.

**Q60 ⚠ load-bearing risk.** **GPS spoofing on rooted Android can defeat the geofence.** Mitigation: we ship mock-location detection (native plugin), but it is best-effort. For v1, we are honest in marketing: "SonoQui non è progettato per prevenire frodi sofisticate. Per chi richiede anti-frode di livello enterprise, vedere v2 con verifica fotografica e cross-check sensori." Selfie at clock-in (v1.5) materially changes the spoofing equation. Pricing implication: don't market this as a fraud-prevention product; market it as a digitalisation product. Fraud detection is upsell territory.

**Q61 ⚠ load-bearing risk.** **The boilerplate is brand new to the team; the velocity assumption (v1 in Q3 2026 = ~4 months from PRD approval) is contingent on the team being comfortable with the boilerplate's specific shape (Express 5 raw pg, custom DI container, self-hosted GoTrue, Centrifugo outbox, etc.).** Mitigation: 2-week "boilerplate onboarding" sprint where the team builds a throwaway feature on the boilerplate before we start v1 work. If the team finds friction, adjust the timeline.

**Q62 ○ small.** **Email deliverability for tenant emails (invitations, password resets, exports) is critical and Brevo's free tier limits are tight.** Mitigation: Brevo paid tier (€19/month for 20k emails/month) from launch. Cost is negligible; risk of emails landing in spam during onboarding is high.

---

## 15. Appendix

### 15.1 Glossary

- **Timbratura** — stamp event (clock-in, clock-out, break-start, break-end).
- **Sede** — branch / workplace location with a geofence.
- **Tenant / Azienda** — the company customer; the multi-tenancy unit.
- **CCNL** — Contratto Collettivo Nazionale di Lavoro; the sector-wide collective agreement that sets break rules, overtime, holidays per industry in Italy.
- **Commercialista** — Italian payroll/accounting professional, typically external to the SME.
- **LUL** — Libro Unico del Lavoro; the legally-required employee register in Italy.
- **Art. 4** — Article 4 of the Statuto dei Lavoratori (Law 300/1970), the Italian statute regulating remote monitoring of workers.
- **DPIA** — Data Protection Impact Assessment, required under Art. 35 GDPR for high-risk processing.
- **Garante** — Garante per la Protezione dei Dati Personali, the Italian data protection authority.
- **INL** — Ispettorato Nazionale del Lavoro, the Italian labour inspection authority.
- **CJEU** — Court of Justice of the European Union; the CCOO v. Deutsche Bank ruling (2019) mandates objective working-time records.
- **Geofence** — a virtual perimeter around a branch's coordinates, with a tolerance radius.
- **Idempotency key** — a client-generated UUID per stamp attempt, used to deduplicate retries server-side.
- **Stamp event** — one row in the `stamps` table representing one clock-in / clock-out / break-start / break-end.

### 15.2 Reference documents

- `Specs/BOILERPLATE_ARCHITECTURE.md` — pinned tech stack; this PRD respects it.
- (To be created) `Specs/TECHNICAL_SPEC.md` — derived from this PRD plus the architecture.
- (To be created) `Specs/COMPLIANCE_PACK.md` — DPA template, DPIA template, Art. 4 checklist; written by external lawyer.
- (To be created) `Specs/COMMERCIALISTA_EXPORT_SPEC.md` — exact column layouts for TeamSystem, Zucchetti, etc. (v1.5).
- (External) Garante decisions on Time Relax, ARSAC, and the various facial-recognition fines — referenced in §8.2 and §11.2.
- (External) CJEU C-55/18 (CCOO v. Deutsche Bank) — referenced in §8.2.

### 15.3 Change log

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1 | 2026-05-21 | Claude | Initial draft. |
| 0.2 | 2026-05-24 | Claude | Product name locked: SonoQui. Q47 resolved with brand-audit decision rationale. All "Timbratore" brand references replaced; `timbratore.app` → `sonoqui.app`. Italian iOS permission string updated. PRD-level domain/TM acquisition plan added in header. |

---

*End of document.*
