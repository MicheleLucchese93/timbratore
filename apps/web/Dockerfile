# syntax=docker/dockerfile:1.6
# Web SPA — Vite build + nginx 1.29-alpine runtime.

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

FROM nginx:1.29-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
