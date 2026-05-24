#!/bin/bash
# Re-deploy ciSono (rebuild + restart). Idempotent.
# Prereqs: /opt/cisono exists, .env + apps/backend/.env.production filled,
# Caddy stanzas merged into /opt/infra/Caddyfile, pg-init SQL applied.
set -e

SERVER="ubuntu@57.131.52.5"
SSH_PORT=2222
PROJECT_DIR="/opt/cisono"

echo "==> Pulling latest main + rebuilding ciSono…"
ssh -p $SSH_PORT $SERVER "cd $PROJECT_DIR && \
  git pull origin main && \
  docker compose build --no-cache cisono-api cisono-web && \
  docker compose up -d && \
  docker image prune -f && \
  sleep 5 && \
  docker compose ps"

echo "==> Health probe…"
curl -sf https://api-cisono.xdevapp.it/health && echo "" || echo "Health check failed!"

echo "==> Done."
