# syntax=docker/dockerfile:1.6
# Web SPA — Vite build + nginx 1.29-alpine runtime.

FROM node:24-alpine AS builder
WORKDIR /repo

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

RUN npm ci --workspace=@cisono/web --include-workspace-root

# Production env vars baked at build time. Override with --build-arg.
ARG VITE_API_URL=https://api-cisono.xdevapp.it
ARG VITE_AUTH_URL=https://auth-cisono.xdevapp.it
ARG VITE_CENTRIFUGO_URL=wss://ws-cisono.xdevapp.it/connection/websocket

ENV VITE_API_URL=$VITE_API_URL \
    VITE_AUTH_URL=$VITE_AUTH_URL \
    VITE_CENTRIFUGO_URL=$VITE_CENTRIFUGO_URL

RUN npm run build --workspace=@cisono/web

FROM nginx:1.29-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
