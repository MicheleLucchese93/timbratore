# sonoQui — Production Deploy

Targets the shared OVH VM at `57.131.52.5` (SSH port `2222`) where `/opt/infra` already runs Caddy + Postgres on the `gateway` + `infra_internal` docker networks.

DNS: point `api-sonoqui.xdevapp.it`, `auth-sonoqui.xdevapp.it`, `ws-sonoqui.xdevapp.it`, `app-sonoqui.xdevapp.it` (CNAME → `xdevapp.it` or A → `57.131.52.5`) in Cloudflare. Proxied (orange).

## 1. First-time bootstrap (one-shot)

```bash
ssh -p 2222 ubuntu@57.131.52.5
sudo -i

# 1.1 Clone repo (deploy key already on box for the xdevapp org).
git clone https://github.com/MicheleLucchese93/timbratore.git /opt/sonoqui
cd /opt/sonoqui

# 1.2 Pull secrets from /opt/infra/.env (POSTGRES_PASSWORD, APP_PG_PASS, GOTRUE_PG_PASS).
cp .env.example .env
cp apps/backend/.env.production.example apps/backend/.env.production
# Generate new secrets per env:
echo "SONOQUI_JWT_SECRET=$(openssl rand -hex 32)" >> .env
echo "CENTRIFUGO_SONOQUI_HMAC_SECRET=$(openssl rand -hex 32)" >> .env
echo "CENTRIFUGO_SONOQUI_API_KEY=$(openssl rand -hex 32)" >> .env
# Set the rest in both files by hand (see comments inline).

# 1.3 Bootstrap DB: creates sonoqui DB, sonoqui_owner role, auth schema, grants.
docker exec -i postgres psql -U penno -v ON_ERROR_STOP=1 \
  -v gotrue_pg_pass="'$(grep ^GOTRUE_PG_PASS /opt/infra/.env | cut -d= -f2)'" \
  -v sonoqui_owner_pass="'CHANGEME_strong_random'" \
  < /opt/sonoqui/infra/pg-init-sonoqui.sql

# 1.4 Merge Caddy stanzas.
cat /opt/sonoqui/infra/caddy-sonoqui.snippet >> /opt/infra/Caddyfile
docker exec gateway caddy reload --config /etc/caddy/Caddyfile

# 1.5 Build + start stack.
cd /opt/sonoqui
docker compose build
docker compose up -d

# 1.6 Apply app schema migrations (uses ADMIN_DATABASE_URL).
docker exec -i sonoqui-api npx tsx scripts/migrate.ts

# 1.7 Provision an initial tenant + first admin (optional). Sends the admin a
#     GoTrue invite email to set their password, so use a real mailbox. Requires
#     PROVISION_SECRET in apps/backend/.env.production (see env.ts).
curl -sS -X POST https://api-sonoqui.xdevapp.it/api/v1/_internal/provision/tenant \
  -H "Authorization: Bearer $PROVISION_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"ragione_sociale":"Demo Bar Centrale Srl","admin_email":"admin@example.com","max_admins":2,"max_users":20}'

# 1.8 Smoke test.
curl -sf https://api-sonoqui.xdevapp.it/health
```

## 2. Subsequent deploys

From your laptop (or any host with SSH access on 2222):

```bash
./deploy.sh
```

Pulls `main`, rebuilds, restarts, image-prunes, probes `/health`.

For schema changes ship the migration in `apps/backend/supabase/migrations/`, then on the server:

```bash
ssh -p 2222 ubuntu@57.131.52.5 \
  'cd /opt/sonoqui && git pull && docker exec -i sonoqui-api npx tsx scripts/migrate.ts'
```

Production migrations are **never** auto-applied by the API container — operator-triggered only.

**Migration 064 (API module) — the window is wider than 061's.** Same mechanic
(the API image has no source bind mount, so `migrate.ts` only sees a migration
once the image carrying it has been rebuilt: `./deploy.sh` FIRST, then migrate),
but a different blast radius. `middleware/auth.ts`, `routes/me.ts` and
`lib/support-session.ts` all SELECT `tenants.api_enabled`, so between `up -d` and
`migrate.ts` **every authenticated request 500s**, not just the new routes.

Keep the two steps back to back in one SSH session and skip the health probes in
between — the probes add ~10s to an outage that is otherwise a couple of seconds:

```bash
ssh -p 2222 ubuntu@57.131.52.5 '
  set -euo pipefail
  cd /opt/sonoqui
  git pull origin main
  docker compose build --no-cache sonoqui-api sonoqui-web sonoqui-web-pro \
    sonoqui-website sonoqui-partner sonoqui-mobile-web   # running containers untouched
  docker compose up -d                                   # window opens
  docker exec -i sonoqui-api npx tsx scripts/migrate.ts   # window closes
  docker image prune -f'
```

Then run the probe half of `deploy.sh` (or curl the four xdevapp endpoints).

If a future migration cannot tolerate any window at all, build first and run
`docker compose run --rm sonoqui-api npx tsx scripts/migrate.ts` — a throwaway
container from the NEW image, while the old one keeps serving — then `up -d`.

**Do not pipe `docker compose build` through `tail` under `set -e`.** The
pipeline's exit status is `tail`'s, so a failed build reports success and the
script sails on to `up -d` + migrate against unchanged images. That happened on
the 064 deploy: `sonoqui-mobile-web` died on a transient `npm ci`, nothing was
rebuilt, and migrate found only 063. Redirect to a file and test the exit code,
or set `-o pipefail`.

**Migration 061 (support tickets) — order.** The API image has no source bind
mount, so `scripts/migrate.ts` inside the container only knows about a migration
once the image carrying it has been rebuilt: run `./deploy.sh` FIRST, then the
migrate command above. Between the two the new `/api/v1/tickets` routes answer
500 (their tables do not exist yet) — nothing else is affected, because 061 only
adds tables and widens a CHECK. `deploy.sh` rebuilds the API and the partner
console in the same pass, so their relative order takes care of itself; a
hand-deploy of the console alone against an old API shows an error where the
Richieste queue should be. New env for this feature (both are defaulted in code,
so an existing `.env` keeps working):

| var | default | what it does |
| --- | --- | --- |
| `SUPPORT_TICKET_TO` | `michele.lucchese@outlook.it` | always receives the operator-side notice for a new ticket or a customer reply, on top of the assignee / managing partner |
| `PARTNER_PUBLIC_URL` | `https://partners.sonoqui.pro` | builds the "open in the console" link inside those notices |

**Migration 067 (self-service signup + Stripe billing) — migrate FIRST, from
the new image.** `routes/me.ts`, `routes/partnership.ts` and the auth path of
the new routes SELECT the new `tenants` columns (`plan`, `billing_mode`,
`signup_source`, …), so the 064 pattern (`up -d`, then migrate) would 500 every
authenticated request for the length of the window. 067 is purely additive and
the OLD image never reads what it adds, so run it from a throwaway container of
the NEW image while the old API keeps serving, then swap:

```bash
ssh -p 2222 ubuntu@57.131.52.5 '
  set -euo pipefail
  cd /opt/sonoqui
  git pull origin main
  docker compose build sonoqui-api sonoqui-web sonoqui-web-pro sonoqui-website sonoqui-partner
  docker compose run --rm sonoqui-api npx tsx scripts/migrate.ts   # old API still serving
  docker compose up -d
  docker image prune -f'
```

The migration ends with a verification block (guard trigger present, the
widened partner-audit CHECK round-trips a new and an old action) that aborts
the transaction if anything is off. The new
entitlement guard trigger (`tenants_guard_entitlements`) refuses writes to the
plan/limit/module/ownership columns of `tenants` from the `app` role or from any
transaction carrying `app.current_tenant_id` — the partner console and the
billing code write them through `adminPool` only.

The **backend** ships dark: `SIGNUP_ENABLED` and `BILLING_ENABLED` default to
`false`. While signup is off, the registration page shows a "coming soon" note
instead of the form, and the web login shows no "register" link. The partner
console gains its billing columns straight away.

**The website does not ship dark.** Its pricing, FAQ, `llms.txt`, header and T&C
all describe free self-registration as live. The footer of every page, the T&C,
the privacy page and the DPA also show the seller data placeholders
(`[P.IVA da inserire]`, …). `deploy.sh` ships `main` whole, so merging this
feature means shipping the website. Merge it only once:
- the `SELLER` constant in `apps/website/src/data/seo.ts` is filled with
  Idealcopy's P.IVA, C.F., REA, capitale sociale, PEC and CAP, and
  `Foro di [città da inserire]` in T&C art. 24 is filled too (every spot is
  marked `TODO(legal)`);
- a lawyer has reviewed T&C 2.0, privacy 2.0 and DPA 1.0 (`REVIEW(legal)`
  comments);
- step 1 (Caddy) and step 2 (signup on) below happen in the same window as
  that deploy.

Switch-on checklist, in this order:

1. **Caddy** — the website's registration form posts same-origin, like the
   helpdesk form: add `handle /api/v1/signup* { reverse_proxy sonoqui-api:4000 }`
   next to `/api/v1/helpdesk*` in BOTH website vhosts of the LIVE file
   `/opt/infra/caddy/sites.d/sonoqui.caddy` (the repo snippet is only the
   reference — `deploy.sh` never touches the live file), then
   `docker exec gateway caddy reload --config /etc/caddy/Caddyfile`.
2. **Signup** — in `apps/backend/.env.production`: `SIGNUP_ENABLED=true`
   (refuses to boot without `TURNSTILE_SECRET_KEY`), check that
   `WEB_PUBLIC_URL=https://app.sonoqui.pro` (confirmation links and the Stripe
   return URLs are built from it) and `WEBSITE_PUBLIC_URL=https://sonoqui.pro`.
   `docker compose up -d sonoqui-api`. Self-service companies now register on
   the Free plan; nothing can be bought yet.
3. **Stripe live account** — activated in the name of Idealcopy S.r.l. (legal
   entity, IBAN, public details: statement descriptor, support email, website,
   Terms `https://sonoqui.pro/it/termini-e-condizioni/`, Privacy
   `https://sonoqui.pro/it/privacy-policy/` — the setup script also writes both
   into the portal configuration). In
   *Settings → Customer emails* turn OFF "Successful payments" receipts and
   invoice emails (invoices are issued outside Stripe as fattura elettronica).
   Payment methods: cards + Link (SEPA Direct Debit is v2, spec D8).
4. **Catalog** — once per Stripe account, after the billing release is
   deployed, from inside the API container (it uses the key STRIPE_MODE
   selects): `docker exec -it sonoqui-api npx tsx scripts/setup-stripe-products.ts --dry-run`,
   then without `--dry-run`. The runtime key needs Write on Products, Prices,
   Tax rates and Customer portal for this one run — grant them, or pass a
   temporary key with `-e STRIPE_LIVE_SECRET_KEY=…` read from a file, then
   revoke it. The script prints the account settings that have no API.
   **Live: done 2026-09-18** (run from a trusted machine with the live key;
   state below). Re-running is idempotent.
5. **Webhook destinations** — Workbench → Webhooks, one per mode, both on
   `https://api.sonoqui.pro/api/v1/webhooks/stripe`, API version
   `2026-08-26.dahlia` (the SDK's pin), events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `customer.subscription.{created,updated,deleted,paused,resumed,pending_update_applied,pending_update_expired}`,
   `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`,
   `charge.refunded`, `charge.dispute.created`. The live one's signing secret
   goes in `STRIPE_LIVE_WEBHOOK_SECRET`, the sandbox one's in
   `STRIPE_SANDBOX_WEBHOOK_SECRET` (only needed to run production on the
   sandbox). **Both done 2026-09-18**: live `we_1UH1WoRkGOs820EXcQmgD0j9` and
   sandbox `we_1UH1c9DbaczI8pnX5w59pyNS`, secrets in `.env.production`.
6. **Runtime keys** — the live one is a RESTRICTED key (`rk_live_…`), never
   the full one. Write: Customers, Checkout Sessions, Subscriptions, Customer
   portal. Read: Prices, Products, Tax rates, Invoices, PaymentIntents,
   Charges, Balance transactions.
7. `BILLING_ENABLED=true`, `docker compose up -d sonoqui-api` (the API refuses
   to boot if the ACTIVE pair lacks its key or webhook secret). Smoke test with
   a real company and a real card, then refund it from the dashboard: the
   payment appears in the partner console's *Pagamenti* (refund included),
   the plan activates within seconds of the redirect.

New env for this feature (all defaulted, so an existing `.env.production`
keeps booting): see the "Self-service signup + Stripe billing" block in
`apps/backend/.env.production.example`. Three scheduler jobs come with it
(`signup_maintenance` hourly, `billing_reconcile` 03:50, `billing_over_limit`
09:00 Europe/Rome). They find nothing to do until self-service companies exist.
`billing_reconcile` re-syncs the active mode's customers, records any paid
invoice of the last 35 days the ledger lacks, and re-derives every
Stripe-billed company's entitlements.

### Stripe mode (sandbox ↔ live)

`.env.production` carries both key pairs; `STRIPE_MODE` picks the one the API
uses. To switch: edit `STRIPE_MODE=sandbox|live` in
`/opt/sonoqui/apps/backend/.env.production`, then
`docker compose up -d sonoqui-api` (compose recreates the container because the
env file changed). What a switch does:

- **Boot check.** Each key must sit in its own slot (`sk_/rk_test_` vs
  `sk_/rk_live_`), or the API does not start. With `BILLING_ENABLED=true`, the
  active pair must be complete (key + webhook secret).
- **Data stays apart.** Every customer, subscription and payment row carries
  Stripe's `livemode`. Only the active mode's rows grant a plan or a module, or
  show up in *Pagamenti* (on the sandbox the console says so in a banner, so a
  test charge is never invoiced).
- **Entitlements follow.** At start the scheduler re-derives every
  Stripe-billed company from the active mode's subscriptions. Companies that
  only paid in the other mode fall back to their Free caps, and their admins
  get the usual "abbonamento terminato" email.
- **Webhooks.** Both destinations can stay enabled. The inactive one's events
  are never applied: a sandbox event while live is acknowledged and dropped. A
  LIVE event while the API runs the sandbox is answered 503, so Stripe retries
  it for up to 3 days and nothing real is lost. The nightly invoice catch-up
  repairs the ledger beyond that.
- **Production on the sandbox protects paying customers.** Only the companies
  listed in `STRIPE_SANDBOX_TENANTS` (tenant ids, comma-separated) use
  sandbox rows and may open Checkout. Every other company keeps the plan its
  LIVE subscriptions give it, and sees "pagamenti online non attivi" instead of
  a checkout any test card could pay.

State of production as of 2026-09-18. Nothing is deployed yet: the running
image predates billing and ignores all of this.

- **`.env.production`.**
  - `STRIPE_MODE=live`.
  - `STRIPE_LIVE_SECRET_KEY`: the restricted key "sonoQui - integrazione" of account
    `acct_1UGIMGRkGOs820EX` (SONOQUI / Idealcopy Srl, activated, charges and payouts
    enabled).
  - `STRIPE_LIVE_WEBHOOK_SECRET`, `STRIPE_SANDBOX_SECRET_KEY` and
    `STRIPE_SANDBOX_WEBHOOK_SECRET` are set, so both pairs are complete and a flip is
    a one-line edit plus a restart.
  - Still unset: `BILLING_ENABLED` and `SIGNUP_ENABLED` (= false), and
    `STRIPE_SANDBOX_TENANTS`.
  - Backups: `.env.production.bak-20260918-124009`, `-130846` and `-131415`.
- **Live catalog, created by the setup script.**
  - 4 products and 6 prices (lookup keys as in the code, IVA-exclusive).
  - IVA 22% rate `txr_1UH1WIRkGOs820EXXc2x00lC`.
  - Portal configuration `bpc_1UH1WJRkGOs820EXraQJuJDG`: invoice history off,
    cancel at period end, Piccola ↔ Media switching.
- **Webhook destinations**, both on `https://api.sonoqui.pro/api/v1/webhooks/stripe`,
  enabled, with the 14 events above and API `2026-08-26.dahlia`:
  - live `we_1UH1WoRkGOs820EXcQmgD0j9`;
  - sandbox `we_1UH1c9DbaczI8pnX5w59pyNS` (account `acct_1UGIMoDbaczI8pnX`).

  Until the billing release is live, deliveries get a 404 from the old API. None
  are expected on live. On the sandbox, only a completed test purchase (for
  instance from local development) would send one. If Stripe reports that
  destination as failing, or disables it, re-enable it after the deploy. Once
  deployed with `STRIPE_MODE=live`, sandbox events are acknowledged and ignored.
- **Dashboard settings (via the browser).**
  - Subscription reminder and dunning emails were already off; "send finalized
    invoices and credit notes" is now off, and payment/refund receipts were
    already off.
  - Failed renewals end in "annulla l'abbonamento" (already so).
  - Public details now carry the Terms and Privacy URLs (Checkout's
    mandatory Terms consent needs them).
  - Statement descriptor `SONOQUI` (it was "STRIPE").
  - Branding: colours `#15569e` / `#00696e` and the app icon.
  - The public website is still `https://www.idealpaper.it`: it is the
    verified business site and was left alone.
- **Payment methods.** The account has 15 dynamic methods on (Klarna, Amazon
  Pay, Satispay, …). Checkout pins `card` + `link` in code (spec D8), so the
  account setting doesn't matter.
- **Before or at go-live, by a person.**
  - The runtime key carries 98 write scopes (Secrets, Webhook endpoints,
    Account credentials, Apps, …). Duplicate it with only the scopes listed in
    step 6, put it in `STRIPE_LIVE_SECRET_KEY` directly on the server, then expire
    the broad one.
  - Both the live and the sandbox keys were pasted in a chat: roll them.

## 3. Rolling back

```bash
ssh -p 2222 ubuntu@57.131.52.5
cd /opt/sonoqui
git log --oneline -10            # pick SHA
git checkout <sha>
docker compose build sonoqui-api sonoqui-web && docker compose up -d
```

Rolling the static apps back **across the unprivileged-nginx change** also means
reverting the Caddy upstreams: those images listen on 8080, and a pre-change SHA
listens on 80. Rebuild to a SHA on the wrong side of it and every static vhost
502s until `/opt/infra/Caddyfile` is put back to `:80` and Caddy reloaded.

## 4. Tearing down (full)

```bash
cd /opt/sonoqui
docker compose down
docker exec postgres dropdb -U penno sonoqui
# Remove sonoqui stanzas from /opt/infra/Caddyfile, reload Caddy.
```

## 5. What's NOT in this scaffold

- Brevo SMTP credentials — must populate `.env`.
- Apple Sign-In `.p8` private key + Service ID + Apple secret JWT rotation (monthly systemd timer per boilerplate §16).
- Google OAuth client credentials.
- OTA server for Expo updates (boilerplate ships one as `ota-sonoqui`; add when first OTA release is needed).
- Backup verification drill — `pg_dump sonoqui` should land in the existing R2 bucket via the infra cron; verify before launch.
