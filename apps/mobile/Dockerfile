# syntax=docker/dockerfile:1.6
# Mobile RN-Web → static SPA, served by nginx.
# Web-only target — for full native build use `npm run prebuild` + Xcode/Studio.

FROM node:24-alpine AS builder
WORKDIR /repo

RUN apk add --no-cache git

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/mobile ./apps/mobile

RUN npm ci --workspace=@cisono/mobile --include-workspace-root

# Expo web export → static bundle in /repo/apps/mobile/dist.
RUN npx --workspace=@cisono/mobile expo export --platform web --output-dir dist

FROM nginx:1.29-alpine
COPY apps/mobile/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/mobile/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
