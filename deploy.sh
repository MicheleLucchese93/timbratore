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
  docker compose build --no-cache sonoqui-api sonoqui-web sonoqui-web-pro sonoqui-website sonoqui-partner sonoqui-mobile-web && \
  docker compose up -d && \
  docker image prune -f && \
  sleep 5 && \
  docker compose ps"

# Poll until the endpoint answers 2xx/3xx, or the budget runs out.
#
# The API takes several seconds after `up -d` to boot (tsx, then node, then its
# first DB connection). A single immediate probe therefore reports a failure
# that is really just a cold start — it did exactly that on both 2026-07-31
# deploys, printing "Health check failed!" while the container went healthy
# moments later. Retrying is what makes a reported failure worth believing.
wait_http() {
  local url="$1" label="$2" tries="${3:-30}" delay="${4:-2}" i code=""
  for ((i = 1; i <= tries; i++)); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" || true)
    case "$code" in
      2??|3??)
        printf '  %-28s %s (after %2ss)\n' "$label" "$code" "$(((i - 1) * delay))"
        return 0
        ;;
    esac
    sleep "$delay"
  done
  # 000 = no response at all: DNS, TLS or connection refused, not an HTTP status.
  printf '  %-28s FAILED after %ss (last: %s)\n' "$label" "$((tries * delay))" "${code:-000}"
  return 1
}

echo "==> Health probes…"
failed=0
wait_http https://api-sonoqui.xdevapp.it/health "api-sonoqui.xdevapp.it" || failed=1
wait_http https://sonoqui.xdevapp.it/it/        "sonoqui.xdevapp.it"     || failed=1
wait_http https://app-sonoqui.xdevapp.it/       "app-sonoqui.xdevapp.it" || failed=1
wait_http https://m-sonoqui.xdevapp.it/         "m-sonoqui.xdevapp.it"   || failed=1

# ADVISORY, never fatal: this script runs from a workstation, and a corporate
# network that intercepts TLS for *.sonoqui.pro (the office Fortinet does)
# makes every one of these read 000 while prod is perfectly healthy. Only the
# xdevapp probes above decide the exit code. To settle a .pro result, probe
# from the VPS itself:
#   ssh -p 2222 ubuntu@57.131.52.5 'curl -sf -o /dev/null -w "%{http_code}\n" https://app.sonoqui.pro/'
echo "==> sonoqui.pro (advisory — 000 here usually means the local network, not prod)"
pro_failed=0
for u in https://api.sonoqui.pro/health https://app.sonoqui.pro/ \
         https://sonoqui.pro/it/ https://partners.sonoqui.pro/; do
  wait_http "$u" "${u#https://}" 3 2 || pro_failed=1
done
[ "$pro_failed" -eq 0 ] || echo "  (advisory only — re-check from the VPS before treating as an outage)"

if [ "$failed" -ne 0 ]; then
  echo "==> FAILED: an xdevapp endpoint never came up. Check: ssh -p $SSH_PORT $SERVER 'cd $PROJECT_DIR && docker compose ps && docker compose logs --tail=50 sonoqui-api'"
  exit 1
fi

echo "==> Done."
