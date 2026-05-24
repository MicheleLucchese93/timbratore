# Cisono

Mobile-first GPS attendance app for small Italian SMEs (≤20 employees).

Built from the boilerplate at [Specs/BOILERPLATE_ARCHITECTURE.md](../Specs/BOILERPLATE_ARCHITECTURE.md) following [Specs/PRD.md](../Specs/PRD.md) and [Specs/DEV_BACKLOG.md](../Specs/DEV_BACKLOG.md).

## Stack (non-negotiable per PRD)

- TypeScript everywhere
- Backend: Express 5 + raw `pg` (no ORM), Postgres with RLS via `withTenantRLS`
- Web: React 19 + Vite SPA, Tailwind v4 + Material-3 tokens
- Mobile: Expo SDK 55 + RN 0.83
- Auth: GoTrue self-hosted (HS256 JWT) — dev mode stub included
- Realtime: Centrifugo + Postgres outbox — dev mode short-polling fallback
- Storage: Cloudflare R2 (S3-compatible) — dev mode disk fallback
- State: Zustand

## Local dev (this scaffold)

Prereqs: Node 22+, Postgres 16+ (running locally on 5432).

```
npm install
createdb cisono_dev
npm run migrate
npm run seed
npm run dev:backend   # http://localhost:4000
npm run dev:web       # http://localhost:5173
```

## Deviations from boilerplate for local dev

- **No Docker required.** Local Postgres via `brew services start postgresql@16`.
- **No GoTrue container.** API mints HS256 JWTs directly using the boilerplate's verification format (same `GOTRUE_JWT_SECRET` / `GOTRUE_JWT_ISSUER`); when GoTrue is provisioned in prod, swap the `/api/v1/auth/dev-token` route off.
- **No Centrifugo container.** Outbox table written; web admin polls `/api/v1/realtime/since` every 3s. Production wires the real Centrifugo consumer to the same table.
- **No R2.** Exports written to `apps/backend/storage/`. Production uses R2.
- **No Caddy.** API + web served directly.

These stubs are clearly labeled in code with `// DEV-STUB: …` and have a single switch point so prod cutover is a config change, not a rewrite.

## Working directory layout

```
apps/backend     Express 5 + pg
apps/web         Vite + React 19 SPA (admin only — MVP)
apps/mobile      Expo SDK 55 (code only in this scaffold)
apps/website     Astro static (placeholder)
packages/shared  Cross-app: types, locales, design tokens, API client
```
