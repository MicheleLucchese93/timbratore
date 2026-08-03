# syntax=docker/dockerfile:1.6
# Web SPA — Vite build + nginx-unprivileged 1.29-alpine runtime.

FROM node:24-alpine AS builder
WORKDIR /repo

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

RUN npm ci --workspace=@sonoqui/web --include-workspace-root

# Production env vars baked at build time. Override with --build-arg.
ARG VITE_API_URL=https://api-sonoqui.xdevapp.it
ARG VITE_AUTH_URL=https://auth-sonoqui.xdevapp.it
ARG VITE_CENTRIFUGO_URL=wss://ws-sonoqui.xdevapp.it/connection/websocket
ARG VITE_GOOGLE_MAPS_API_KEY=

ENV VITE_API_URL=$VITE_API_URL \
    VITE_AUTH_URL=$VITE_AUTH_URL \
    VITE_CENTRIFUGO_URL=$VITE_CENTRIFUGO_URL \
    VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY

RUN npm run build --workspace=@sonoqui/web

# nginx-unprivileged, not nginx: the plain image only runs its workers as the
# nginx user and keeps the master as root (Trivy DS-0002). This variant ships
# /var/cache/nginx and the /tmp pid path already writable by uid 101, which a
# bare `USER nginx` on the plain image would not.
FROM nginxinc/nginx-unprivileged:1.30-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html

# Restated even though the base image already ends on this user: Trivy reads the
# Dockerfile, not the base image's own USER, and DS-0002 wants the instruction here.
USER nginx

# 8080, not 80 — an unprivileged process cannot bind a privileged port. Caddy
# proxies to 8080 (infra/caddy-sonoqui.snippet); nginx.conf listens there.
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
