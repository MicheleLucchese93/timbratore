# Modulo API — tenant-scoped public REST API

**Status:** ✅ BUILT. Backend + web + partner console + website. Not deployed at the time of writing.
**Migration:** `064_api_module.sql`
**Depends on:** the billable-module machinery from Cantieri (migration 054) — a tenant flag, a partner capability, a partner-console toggle.
**Mobile:** deliberately untouched. `api_enabled` arrives in the `/me` tenant payload and the phone app ignores it.

---

## 1. What it is, and who asked

Everything in sonoQui is reachable from the web app, the phone app, or an export
file — all three of which need a person. The customers who ask for this one do
not have a person to spare:

- a gestionale that already holds the staff register wants to push it in, rather
  than have somebody retype it;
- a turnstile or badge reader at the gate wants to file punches;
- a BI dashboard or the accountant's tooling wants last month's hours, every
  night at three.

So: a credential that belongs to the **company** rather than to an employee, and
that a machine can hold.

## 2. The credential

The token handed to the customer is `sq_live_<key_id>_<secret>`.

| Part | Length | Stored? |
|---|---|---|
| `sq_live_` | fixed | prefix, so a leaked token is greppable by secret scanners and by our own log review |
| `key_id` | 16 hex | yes, `api_keys.key_id`, UNIQUE — the lookup handle |
| `secret` | 43 chars base64url (32 CSPRNG bytes) | **no** — only `sha256(secret)` and its last four characters |

There is no path back from a stored row to a working token, and no endpoint that
can re-show one. A customer who loses theirs creates another. That is deliberate:
a "show me the key again" button is a permanent copy of a live credential sitting
in a database we back up.

The load-bearing half of that promise is not the code, it is the **column
grants** in §5 of the migration: the `app` role (every web request) may INSERT
`secret_hash` and may never SELECT it, so nothing in `routes/api-keys.ts` can put
it on the wire — including a future `SELECT *`. Migration §6 asserts the property
rather than assuming it, because the LOCAL dev database's default ACL names a
different role, so a missing `REVOKE` passes on a laptop and fails on production.

## 3. Who manages keys

Tenant **admins**, and only while `tenants.api_enabled` is true.

No per-user module role, unlike Cantieri: a key is company infrastructure, and
the people who configure the company configure it. `requireApiModule`
(`middleware/auth.ts`) enforces both halves.

The surface is **Impostazioni → API**, an ordinary `SettingsRow` — buttons and a
dialog, not switches, because a credential is not a preference. The dialog is
**portalled to `document.body`**: the section renders inside the Settings page's
own `<form>`, and an HTML form cannot contain another one, so an in-place dialog
would have had its submit button submit the settings form instead.

## 4. Authentication and tenancy

`Authorization: Bearer <token>` or `X-Api-Key: <token>`. Both, because
integrators arrive with both. **Never** a query-string parameter — those end up
in access logs, browser history and `Referer` headers.

There is no company id to pass: the tenant comes from the key.

### Why the API runs under RLS

The obvious shortcut for a machine surface is the service role plus a
hand-written `tenant_id = $1` on every query. That works right up until the one
query that forgets, and there is nothing behind it.

Instead the public API connects as the ordinary `app` role with
`app.current_tenant_id` set, exactly like a web request (`withApiRLS`,
`lib/db.ts`). What stands in for the missing membership is one GUC:

```
app.api_tenant  →  makes auth.is_admin() true for THIS tenant only
```

Mirroring what migration 058 already does for read-only support sessions, with
the same two safety properties: it is set only inside the transaction, and only
to the tenant the presented key belongs to; and it must equal
`auth.tenant_id()`, so it can never widen the tenant scope.

Two of the module tables needed more than that, and finding out late would have
been expensive: **Cantieri and Bacheca address a PERSON**. Their SELECT policies
ask "is this row assigned to / targeted at `auth.uid()`", because the surfaces
that read them company-wide are served on the service role instead. A key's uid
matches nobody, so those reads returned an empty array with a 200 — the worst
failure shape an integration can have. Migration §3d adds an `auth.api_reads()`
branch to exactly those policies: tenant-bounded, invisible to every existing
caller (a person and a support session both leave `app.api_tenant` unset), and
narrower than widening them to `auth.is_admin()`, which would also have handed
every read-only support session the whole company's site activity and bulletin
readership.

`api_keys` itself is **tenant-scoped for SELECT, admin-scoped for writes**, and
the asymmetry is deliberate. An admin-only read looked right and broke what the
module owes an employee: when an integration edits or strikes somebody's punch,
every surface that names the author — the Timbrature list, the day dossier and
its PDF, the `stamps_history` trail, the payroll export's Rettifiche sheet —
resolves the actor with a LEFT JOIN onto that table, so the one person entitled
to ask "who moved my clock-out?" saw a blank. What is actually confidential is
the secret, and that is defended by the column grants, not by the policy.

`app.current_user_id` is set to the **key's** id, not a person's. Consequences,
all intended:

- `auth.uid()` matches no membership, so own-scoped policies ("my own leave
  requests") return nothing for a key — correct, a key is not an employee;
- every audit row a key writes carries the key id as its actor, which the
  Registro renders as **`API · <key name>`** (`routes/audit.ts`, and the same
  join in `lib/stamp-history.ts` and `routes/stamps.ts` so a contested punch
  names the integration that moved it);
- `stamps.source = 'api'` is its own value, and the contestation trail has its
  own three kinds (`api_create` / `api_edit` / `api_delete`) rather than reusing
  `admin_*` — "an administrator changed your punch" and "the badge reader
  changed your punch" are different sentences to read on a disputed timesheet.

### Caching, and what a revoke means

Resolved keys are cached in-process for 60s, like memberships. Every path that
can invalidate one evicts it explicitly:

- `PATCH /api/v1/api-keys/:id` (scopes, ceiling, expiry) and `POST …/revoke`;
- the partner toggle `PATCH /api/v1/partnership/tenants/:id/api`, which also
  evicts every member's membership cache.

So a revoke takes effect on the very next request — which matters, because
revoking is the tool for a leaked credential.

## 5. Scopes

`<resource>:<read|write>`. Two levels, not more: the question an integrator needs
answered is "may this credential change our data". `resource:write` implies
`resource:read` (`apiScopeSatisfied`), because most integrations create something
and read it back and the alternative is a support call.

The vocabulary lives in `packages/shared/src/api/index.ts` — one definition,
consumed by the API, the Settings UI and the OpenAPI document.

| Resource | read | write |
|---|---|---|
| `users` | ✅ | ✅ create / update / deactivate / reactivate |
| `branches` | ✅ | ✅ CRUD + roster |
| `stamps` | ✅ | ✅ create / correct / strike |
| `anomalies` | ✅ | ✅ justify |
| `shifts` | ✅ | ✅ assign |
| `exports` | ✅ | ✅ enqueue |
| `corrections` | ✅ | — |
| `leaves` | ✅ | — |
| `quotas` | ✅ | — |
| `bulletins` | ✅ | — |
| `cantieri` | ✅ | — |
| `reports` | ✅ | — |
| `audit` | ✅ | — |

### The read-only column is the interesting one

Every entry there is a deliberate refusal, not unfinished work:

- **leaves, corrections** — granting an absence or settling a disputed punch is a
  DECISION, and `leave_requests.decided_by` exists to name the person who made
  it. A key has no name. The guards behind those writes (per-day capacity cap,
  same-type overlap, the quota ledger, an advisory-lock ordering that exists
  because getting it wrong once double-booked a company's ferie in Aug 2026) are
  also one implementation for a reason.
- **quotas** — an accrual is a ledger entry and the residual everyone reads is
  derived from it. Machine-written ledger entries with no author are how a
  balance stops being reconcilable.
- **bulletins** — an announcement comes FROM somebody and mails every employee.
  Read access answers the useful question ("who has opened the safety notice").
- **cantieri** — by construction: migration 054's INSERT policy re-checks that
  the author is assigned to the site. A key is assigned to nothing.
- **reports, audit** — derived surfaces. A log an integration can write is not a
  log.

### Not on the surface at any scope

- **HR documents.** Gated behind the Documentale capability and a one-time code
  emailed to a human. A machine credential is, by construction, a way around a
  code sent to a human. `/documents` returns 404 on this API and the e2e suite
  asserts it.
- **Auth, password changes, push-token storage.** Same reasoning.
- **Employee GPS coordinates.** Not exposed because they are not stored
  (migration 060); `stampColumns()` is reused rather than a hand-written column
  list, so a future column is whitelisted once.

## 6. Endpoints

`/api/public/v1`, deliberately a separate version prefix from `/api/v1`: an
integration's contract must survive our internal refactors. The routers are
purpose-written (`routes/public/*`) rather than the internal ones mounted twice,
for the same reason.

Envelope: `{ ok, data }`, plus `page: { limit, offset, total }` on lists, where
`total` counts the FILTERED set. The one exception is
`GET /exports/:id/download`, which is the file.

`GET /openapi.json` is **unauthenticated** — an integrator needs the endpoint
list before the customer has minted them a key, and the document contains no
tenant data. It is generated from the same shared scope constants the API
enforces, so it cannot drift from them.

`GET /me` reports the key's name, its scopes and the company. It is the call that
turns "403 somewhere" into "we never ticked stamps:write".

## 7. Rate limiting

Two limiters, in this order, answering two different questions:

1. **IP-keyed, unauthenticated requests only.** The app-wide limiter in `app.ts`
   skips `/api/public/` — it keys on IP, the wrong unit once a request is
   attributable to a key — so without this the auth path would be an unbounded
   oracle for probing `key_id`s. It has to run *before* authentication, which is
   the difficulty: a plain IP ceiling there also caps every authenticated caller
   at 60/min, silently overriding the ceiling the customer was sold (verified: a
   120/min key was throttled at 60).

   The fix is `requestWasSuccessful: (req) => req.apiKey !== undefined`. The
   library's default reads "success" as `status < 400`, which is the wrong
   question here — 4xx is a normal answer on this API (409 when a sync re-adds
   an existing employee, 404 when it asks about a leaver), so an ordinary
   nightly job would still have accumulated against the IP bucket. What matters
   is whether the request *proved itself*. Verified: 100 authenticated 404s from
   one IP pass untouched, while 80 bad-key attempts are cut off at 60.

   Residual trade-off, inherent to any pre-auth IP ceiling: once an IP's bucket
   is full, authenticated traffic from that same IP is blocked too. An attacker
   sharing a NAT with a customer's integration server can therefore deny it
   service for up to a minute. 60 failures/min is generous enough that this is
   the better end of the trade against leaving the auth path unbounded.
2. **Per key**, from `api_keys.rate_limit_per_min` (default 120, 1..6000). One
   customer behind one NAT cannot spend another's budget, and two integrations on
   one host get two budgets. Standard `RateLimit-*` headers.

The store is in-memory and therefore per-process: fine with one `sonoqui-api`
container, but horizontal scaling would silently multiply every published limit
by the instance count.

## 7b. Idempotency

`POST /stamps` honours an optional `Idempotency-Key` header (8–128 chars,
`[a-zA-Z0-9-]`). Repeating a request with the same key replays the first
response instead of filing a second punch; a repeat while the first is still
running answers `409 IDEMPOTENCY_IN_FLIGHT`. Keys are remembered for 24 hours.

It is the only endpoint that takes it, because it is the only one whose
double-execution is invisible to the person it affects — a badge reader whose
request times out cannot tell whether the punch landed, and a duplicate clock-in
is not something the employee can see or undo.

Two things differ from the tenant-side `idempotencyMiddleware`:

- **Namespace.** That one keys on `(tenant, user, client-key)` and falls back to
  the literal `anon` when there is no `req.user` — which a key request never
  has. On a globally-readable `idempotency_keys` table that would have put every
  machine client in every company into one `anon:anon` namespace, where one
  customer's retry could replay another's created punch. `apiIdempotency`
  namespaces on the key's own id instead.
- **Optional, not required.** A public API cannot make a header mandatory
  without breaking every client that has not heard of it, and the guarantee is
  the caller's to want.

## 8. Errors

`{ ok: false, error: { code, message } }`. Codes a client should handle:

| Code | Status | Meaning |
|---|---|---|
| `API_KEY_MISSING` | 401 | no key presented |
| `API_KEY_INVALID` | 401 | unknown key, wrong secret, revoked, or expired — **one** code for all four, so key_ids cannot be enumerated |
| `API_MODULE_DISABLED` | 403 | the module is off for the company (the one refusal reported separately: their own admin can see it in Settings, and it is by far the likeliest cause of an integration stopping overnight) |
| `API_SCOPE_MISSING` | 403 | names the scope that was needed |
| `CANTIERI_REQUIRED` | 403 | the Cantieri module is off |
| `API_RATE_LIMITED` | 429 | either ceiling |
| `NOT_FOUND` | 404 | including any path this API does not serve — a typo must not look like "no rows" |

The public router has its **own terminal error handler**: the shared one ends
with `fail(res, 500, 'INTERNAL', err.message)`, which for an unexpected throw is
a raw pg/driver/GoTrue string. Acceptable for our own clients; not on a surface a
third party calls. Deliberate `AppError` codes still pass through verbatim — they
are the contract — and a 500 returns the request id so a support ticket can name
the exact request.

## 9. Commercial model

A billable add-on, like Cantieri: base subscription + the module, pay-per-month,
price on request. Two-level flag:

- `partnership_members.may_enable_api` — may this partner offer it at all
  (super-admin sets it; platform admins are unlimited);
- `tenants.api_enabled` — is it on for this company.

Both the create-tenant call and `PATCH /tenants/:id/api` check the capability,
and every toggle lands in `partnership_audit_log` as
`tenant.api_enable` / `tenant.api_disable` — switching it on hands a company the
ability to mint credentials over its whole dataset, which is exactly as worth
recording as suspending them.

The partner console is registry-driven (`apps/partner/src/lib/modules.ts`), so
the module needed one entry there plus the flags. Note that `ModuleDef.tenantField`
doubles as the create-tenant request field, so the zod key must be exactly
`api_enabled` or activation-at-create silently no-ops.

## 10. Deploy order

Load-bearing, and the 058 lesson:

1. apply migration **064** via the container's `migrate.ts` (as `sonoqui_owner`,
   never by hand as `penno`);
2. deploy `sonoqui-api`;
3. deploy the partner console;
4. deploy the web app.

`middleware/auth.ts`, `routes/me.ts` and `lib/support-session.ts` all SELECT
`t.api_enabled`, so an API deployed before the migration 500s on every request —
not just on the new surface.

## 11. Known limits / possible next steps

- **`express.json({ limit: '1mb' })` is global**, so a future bulk-import
  endpoint cannot raise its own limit.
- **No usage counters.** `last_used_at` / `last_used_ip` are written at most once
  a minute per key, which answers "is this still in use" but not "how much".
- **`/reports/worked-minutes` pairs punches within one tenant-local day.** A
  shift that crosses local midnight is therefore not attributed across the
  boundary. The payroll figure comes from the export, which does handle it; this
  endpoint is a dashboard aggregate and says so.
- **`?updated_since` reads `stamps_history`** so it catches note-only and branch
  edits, which `edited_at` alone does not record (migration 059 counts only a
  moved punch as an edit).
- **No sandbox environment.** The `sq_live_` prefix leaves room for `sq_test_`.
- **Machine-booked absence** (INPS certificates arriving as malattia) is the one
  read-only refusal with a real customer case behind it. It should be a
  deliberate next step with its own guard review, not a `:write` scope quietly
  added to `leaves`.
