# syntax=docker/dockerfile:1.6
# Mobile RN-Web → static SPA, served by nginx-unprivileged.
# Web-only target — for full native build use `npm run prebuild` + Xcode/Studio.

FROM node:24-alpine AS builder
WORKDIR /repo

RUN apk add --no-cache git

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/mobile ./apps/mobile

RUN npm ci --workspace=@sonoqui/mobile --include-workspace-root

# Expo web export → static bundle in /repo/apps/mobile/dist.
RUN npx --workspace=@sonoqui/mobile expo export --platform web --output-dir dist

# nginx-unprivileged, not nginx: the plain image only runs its workers as the
# nginx user and keeps the master as root (Trivy DS-0002). This variant ships
# /var/cache/nginx and the /tmp pid path already writable by uid 101, which a
# bare `USER nginx` on the plain image would not.
FROM nginxinc/nginx-unprivileged:1.31-alpine
COPY apps/mobile/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/mobile/dist /usr/share/nginx/html

# Restated even though the base image already ends on this user: Trivy reads the
# Dockerfile, not the base image's own USER, and DS-0002 wants the instruction here.
USER nginx

# 8080, not 80 — an unprivileged process cannot bind a privileged port. Caddy
# proxies to 8080 (infra/caddy-sonoqui.snippet); nginx.conf listens there.
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
