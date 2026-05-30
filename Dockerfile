# syntax=docker/dockerfile:1.6
# Backend (sonoqui-api) — node:24-alpine with tsx runtime.
# Reason: workspace shared/ exposes .ts directly; tsc build would need
# project refs or a pre-build step. tsx at runtime keeps the image build
# trivially correct (Penno uses tsc; revisit if startup time matters).

FROM node:24-alpine
WORKDIR /repo

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/backend ./apps/backend
# Email templates fetched by GoTrue at http://sonoqui-api:4000/templates/*.html.
COPY gotrue-templates ./apps/backend/public/templates

# Install full deps for tsx + zod + pg + jose etc.
RUN npm ci --workspace=@sonoqui/backend --include-workspace-root

# Export storage mount point. Created + owned by `node` BEFORE dropping
# privileges so a fresh named volume mounted here inherits node:node
# ownership (Docker seeds an empty volume from the image dir, perms included).
# STORAGE_DISK_PATH defaults to /data via docker-compose.
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]

ENV NODE_ENV=production
ENV STORAGE_DISK_PATH=/data
EXPOSE 4000
USER node

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD wget --spider -q http://localhost:4000/health || exit 1

WORKDIR /repo/apps/backend
CMD ["npx", "tsx", "src/index.ts"]
