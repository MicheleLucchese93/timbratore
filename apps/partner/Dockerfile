# syntax=docker/dockerfile:1.6
# Partner / reseller SPA — Vite build + nginx 1.29-alpine runtime.

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

FROM nginx:1.29-alpine
COPY apps/partner/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/partner/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
