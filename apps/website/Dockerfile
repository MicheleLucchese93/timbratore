# syntax=docker/dockerfile:1.6
# Marketing website — Astro static build + nginx 1.29-alpine runtime.
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

RUN npm ci --workspace=sonoqui-website --include-workspace-root
RUN npm run build --workspace=sonoqui-website

FROM nginx:1.29-alpine
COPY apps/website/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/website/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
