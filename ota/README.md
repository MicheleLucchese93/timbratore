# OTA (sonoQui)

Self-hosted OTA server for the sonoQui Expo app, deployed alongside
`sonoqui-api` in this stack. Uses
[expo-open-ota](https://github.com/axelmarciano/expo-open-ota)
(`ghcr.io/axelmarciano/expo-open-ota:v2.3.19`, pinned `linux/amd64`).

This file is the **operator manual** (server / keys / env). The developer
runbook — how to actually ship an update — is
[`../apps/mobile/OTA.md`](../apps/mobile/OTA.md).

## Domain

`ota.sonoqui.pro` → `ota-sonoqui:3000`, reverse-proxied by the shared Caddy
gateway (`/opt/infra/Caddyfile`). Cloudflare-proxied like the other sonoqui.pro
subdomains. Keep Bot Fight Mode / WAF challenges **off** this host — the mobile
client and the `eoas` publisher cannot solve a JS challenge.

## Client endpoints

- `GET /api/manifest` — what `expo-updates` hits on app launch
- `GET /api/assets` — bundle + static-asset fetches
- `GET /dashboard` — admin UI for rollbacks (gated by `OTA_ADMIN_PASSWORD`)

## Required env vars (in `/opt/sonoqui/.env`)

- `EXPO_ACCESS_TOKEN` — Expo personal access token, authorised for project
  `729f39a2-86a4-4bb6-ae03-21dad1922c34` (owner `micheel93-2`). Create at
  https://expo.dev/accounts/micheel93-2/settings/access-tokens
- `OTA_JWT_SECRET` — signs server-internal tokens (`openssl rand -hex 64`)
- `OTA_ADMIN_PASSWORD` — dashboard login (`openssl rand -base64 32`)

## Required files (not in git)

- `ota/keys/public-key.pem`
- `ota/keys/private-key.pem` (chmod 600)

Generate locally with `npx expo-updates codesigning:generate
--key-output-directory credentials --certificate-output-directory credentials
--certificate-validity-duration-years 10 --certificate-common-name "sonoQui OTA
Code Signing"` run from `apps/mobile/`. That emits
`apps/mobile/credentials/{certificate.pem,public-key.pem,private-key.pem}`.
`certificate.pem` IS committed (the app bundles it to verify signatures); the
two PEM keys are gitignored and live only here. SCP both PEM keys to the server
under `/opt/sonoqui/ota/keys/` (600 on the private one).

## Channels

The mobile binary sends an `expo-channel-name` header baked at build time
(see `apps/mobile/eas.json` + `app.config.ts`). The server maps that channel to
an EAS branch of the same name. Two channels are in use:

- `staging` — TestFlight / Play Internal builds
- `production` — App Store / Play Store production releases

(`development` uses the Metro dev server and never pulls OTA.)

## Bring-up

```bash
ssh -p 2222 ubuntu@57.131.52.5
cd /opt/sonoqui
# .env must contain EXPO_ACCESS_TOKEN / OTA_JWT_SECRET / OTA_ADMIN_PASSWORD
# ota/keys/{public,private}-key.pem must be present
docker compose up -d ota-sonoqui
docker compose ps ota-sonoqui
docker logs ota-sonoqui --tail 40
```

## Backups

Bundle archives live in the Docker named volume `sonoqui_ota_data`:

```bash
docker run --rm -v sonoqui_ota_data:/src -v /backups/ota:/dst alpine \
  tar czf /dst/ota-sonoqui-$(date +%Y%m%d).tgz -C /src .
```
