# syntax=docker/dockerfile:1.6
# Partner / reseller SPA — Vite build + nginx-unprivileged 1.29-alpine runtime.

FROM node:24-alpine AS builder
WORKDIR /repo

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/partner ./apps/partner

RUN npm ci --workspace=@sonoqui/partner --include-workspace-root

# Production env vars baked at build time. Same-origin pattern (mirrors
# sonoqui-web-pro): VITE_API_URL="" → relative /api paths, VITE_AUTH_URL points
# at the same host's /auth prefix. Caddy path-routes both to the backend.
ARG VITE_API_URL=""
ARG VITE_AUTH_URL=https://partners.sonoqui.pro/auth

ENV VITE_API_URL=$VITE_API_URL \
    VITE_AUTH_URL=$VITE_AUTH_URL

RUN npm run build --workspace=@sonoqui/partner

# nginx-unprivileged, not nginx: the plain image only runs its workers as the
# nginx user and keeps the master as root (Trivy DS-0002). This variant ships
# /var/cache/nginx and the /tmp pid path already writable by uid 101, which a
# bare `USER nginx` on the plain image would not.
FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY apps/partner/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/partner/dist /usr/share/nginx/html

# Restated even though the base image already ends on this user: Trivy reads the
# Dockerfile, not the base image's own USER, and DS-0002 wants the instruction here.
USER nginx

# 8080, not 80 — an unprivileged process cannot bind a privileged port. Caddy
# proxies to 8080 (infra/caddy-sonoqui.snippet); nginx.conf listens there.
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
