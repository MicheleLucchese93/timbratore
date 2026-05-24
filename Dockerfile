# syntax=docker/dockerfile:1.6
# Backend (cisono-api) — node:24-alpine with tsx runtime.
# Reason: workspace shared/ exposes .ts directly; tsc build would need
# project refs or a pre-build step. tsx at runtime keeps the image build
# trivially correct (Penno uses tsc; revisit if startup time matters).

FROM node:24-alpine
WORKDIR /repo

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/backend ./apps/backend

# Install full deps for tsx + zod + pg + jose etc.
RUN npm ci --workspace=@cisono/backend --include-workspace-root

ENV NODE_ENV=production
EXPOSE 4000
USER node

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD wget --spider -q http://localhost:4000/health || exit 1

WORKDIR /repo/apps/backend
CMD ["npx", "tsx", "src/index.ts"]
