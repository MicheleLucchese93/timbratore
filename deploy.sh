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
  docker compose build --no-cache sonoqui-api sonoqui-web && \
  docker compose up -d && \
  docker image prune -f && \
  sleep 5 && \
  docker compose ps"

echo "==> Health probe…"
curl -sf https://api-sonoqui.xdevapp.it/health && echo "" || echo "Health check failed!"

echo "==> Done."
