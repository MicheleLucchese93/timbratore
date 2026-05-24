# ciSono — Production Deploy

Targets the shared OVH VM at `57.131.52.5` (SSH port `2222`) where `/opt/infra` already runs Caddy + Postgres on the `gateway` + `infra_internal` docker networks.

DNS: point `api-cisono.xdevapp.it`, `auth-cisono.xdevapp.it`, `ws-cisono.xdevapp.it`, `app-cisono.xdevapp.it` (CNAME → `xdevapp.it` or A → `57.131.52.5`) in Cloudflare. Proxied (orange).

## 1. First-time bootstrap (one-shot)

```bash
ssh -p 2222 ubuntu@57.131.52.5
sudo -i

# 1.1 Clone repo (deploy key already on box for the xdevapp org).
git clone https://github.com/MicheleLucchese93/timbratore.git /opt/cisono
cd /opt/cisono

# 1.2 Pull secrets from /opt/infra/.env (POSTGRES_PASSWORD, APP_PG_PASS, GOTRUE_PG_PASS).
cp .env.example .env
cp apps/backend/.env.production.example apps/backend/.env.production
# Generate new secrets per env:
echo "CISONO_JWT_SECRET=$(openssl rand -hex 32)" >> .env
echo "CENTRIFUGO_CISONO_HMAC_SECRET=$(openssl rand -hex 32)" >> .env
echo "CENTRIFUGO_CISONO_API_KEY=$(openssl rand -hex 32)" >> .env
# Set the rest in both files by hand (see comments inline).

# 1.3 Bootstrap DB: creates cisono DB, cisono_owner role, auth schema, grants.
docker exec -i postgres psql -U penno -v ON_ERROR_STOP=1 \
  -v gotrue_pg_pass="'$(grep ^GOTRUE_PG_PASS /opt/infra/.env | cut -d= -f2)'" \
  -v cisono_owner_pass="'CHANGEME_strong_random'" \
  < /opt/cisono/infra/pg-init-cisono.sql

# 1.4 Merge Caddy stanzas.
cat /opt/cisono/infra/caddy-cisono.snippet >> /opt/infra/Caddyfile
docker exec gateway caddy reload --config /etc/caddy/Caddyfile

# 1.5 Build + start stack.
cd /opt/cisono
docker compose build
docker compose up -d

# 1.6 Apply app schema migrations (uses ADMIN_DATABASE_URL).
docker exec -i cisono-api npx tsx scripts/migrate.ts

# 1.7 Seed an initial tenant + admin user (optional — replace email).
docker exec -i cisono-api npx tsx scripts/create-tenant.ts \
  --ragione_sociale="Demo Bar Centrale Srl" \
  --email=admin@demo.cisono.local \
  --max_admins=2 --max_users=20

# 1.8 Smoke test.
curl -sf https://api-cisono.xdevapp.it/health
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
  'cd /opt/cisono && git pull && docker exec -i cisono-api npx tsx scripts/migrate.ts'
```

Production migrations are **never** auto-applied by the API container — operator-triggered only.

## 3. Rolling back

```bash
ssh -p 2222 ubuntu@57.131.52.5
cd /opt/cisono
git log --oneline -10            # pick SHA
git checkout <sha>
docker compose build cisono-api cisono-web && docker compose up -d
```

## 4. Tearing down (full)

```bash
cd /opt/cisono
docker compose down
docker exec postgres dropdb -U penno cisono
# Remove cisono stanzas from /opt/infra/Caddyfile, reload Caddy.
```

## 5. What's NOT in this scaffold

- Brevo SMTP credentials — must populate `.env`.
- Apple Sign-In `.p8` private key + Service ID + Apple secret JWT rotation (monthly systemd timer per boilerplate §16).
- Google OAuth client credentials.
- OTA server for Expo updates (boilerplate ships one as `ota-cisono`; add when first OTA release is needed).
- Backup verification drill — `pg_dump cisono` should land in the existing R2 bucket via the infra cron; verify before launch.
