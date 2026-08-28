# syntax=docker/dockerfile:1.6
# Marketing website — Astro static build + nginx-unprivileged 1.29-alpine runtime.
# Built as a workspace member so it resolves against the root lockfile's
# vite 6.4.2 (the version the app workspaces pin). Astro's own newer
# rolldown-vite is buggy with @tailwindcss/vite; the hoisted vite 6.4.2
# is what builds cleanly, so we reproduce the full workspace manifest
# graph here to get the same resolution npm uses locally.

FROM node:24-alpine AS builder
WORKDIR /repo

# Root + every workspace manifest so `npm ci` sees the whole graph and
# resolves the same hoisted versions as a local install.
COPY package.json package-lock.json ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/web/package.json ./apps/web/
COPY apps/mobile/package.json ./apps/mobile/
COPY packages/shared/package.json ./packages/shared/
COPY apps/website ./apps/website

# The website's global.css imports the brand palette via a cross-package
# relative path (apps/website/src/styles/global.css ->
# ../../../../packages/shared/src/design/tokens.css). Copy that single file so
# the @import resolves inside the build context — keeps tokens.ts the one source.
COPY packages/shared/src/design/tokens.css ./packages/shared/src/design/tokens.css

RUN npm ci --workspace=sonoqui-website --include-workspace-root

# Astro inlines PUBLIC_* at BUILD time, so the PostHog key has to exist in this
# stage — docker-compose passes it through as a build arg. Declared after
# `npm ci` on purpose: rotating the key then re-uses the cached install layer.
# An empty key is a valid, deliberate state — the site ships with no analytics.
ARG PUBLIC_POSTHOG_KEY=""
ARG PUBLIC_POSTHOG_HOST="https://eu.i.posthog.com"
ENV PUBLIC_POSTHOG_KEY=$PUBLIC_POSTHOG_KEY
ENV PUBLIC_POSTHOG_HOST=$PUBLIC_POSTHOG_HOST

RUN npm run build --workspace=sonoqui-website

# nginx-unprivileged, not nginx: the plain image only runs its workers as the
# nginx user and keeps the master as root (Trivy DS-0002). This variant ships
# /var/cache/nginx and the /tmp pid path already writable by uid 101, which a
# bare `USER nginx` on the plain image would not.
FROM nginxinc/nginx-unprivileged:1.31-alpine
COPY apps/website/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/website/dist /usr/share/nginx/html

# Restated even though the base image already ends on this user: Trivy reads the
# Dockerfile, not the base image's own USER, and DS-0002 wants the instruction here.
USER nginx

# 8080, not 80 — an unprivileged process cannot bind a privileged port. Caddy
# proxies to 8080 (infra/caddy-sonoqui.snippet); nginx.conf listens there.
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
