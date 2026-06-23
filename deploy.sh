#!/bin/bash
# Re-deploy sonoQui (rebuild + restart). Idempotent.
# Prereqs: /opt/sonoqui exists, .env + apps/backend/.env.production filled,
# Caddy stanzas merged into /opt/infra/Caddyfile, pg-init SQL applied.
set -e

SERVER="ubuntu@57.131.52.5"
SSH_PORT=2222
PROJECT_DIR="/opt/sonoqui"

echo "==> Pulling latest main + rebuilding sonoQui…"
ssh -p $SSH_PORT $SERVER "cd $PROJECT_DIR && \
  git pull origin main && \
  docker compose build --no-cache sonoqui-api sonoqui-web sonoqui-web-pro sonoqui-website sonoqui-partner && \
  docker compose up -d && \
  docker image prune -f && \
  sleep 5 && \
  docker compose ps"

echo "==> Health probe…"
curl -sf https://api-sonoqui.xdevapp.it/health && echo "" || echo "Health check failed!"
curl -sf -o /dev/null -w "website: %{http_code}\n" https://sonoqui.xdevapp.it/it/ || echo "Website check failed!"
# sonoqui.pro cutover probes (may fail until .pro→Cloudflare NS delegation propagates).
curl -sf https://api.sonoqui.pro/health && echo " (api.sonoqui.pro)" || echo "api.sonoqui.pro check failed (NS may still be propagating)"
curl -sf -o /dev/null -w "app.sonoqui.pro: %{http_code}\n" https://app.sonoqui.pro/ || echo "app.sonoqui.pro check failed"
curl -sf -o /dev/null -w "sonoqui.pro: %{http_code}\n" https://sonoqui.pro/it/ || echo "sonoqui.pro check failed"
curl -sf -o /dev/null -w "partners.sonoqui.pro: %{http_code}\n" https://partners.sonoqui.pro/ || echo "partners.sonoqui.pro check failed (DNS/Caddy may still be propagating)"

echo "==> Done."
