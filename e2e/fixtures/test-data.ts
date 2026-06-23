// Single source of truth for credentials + base URLs used across e2e specs.
// Real values live in env vars when CI runs; defaults match the dev test tenant
// documented in apps/web/.env.development.

export const CREDS = {
  admin: {
    email: process.env.E2E_ADMIN_EMAIL ?? 'test1@test.it',
    password: process.env.E2E_ADMIN_PASSWORD ?? 'Test123@!',
  },
  // test3 is the only non-admin on the test tenant. test1 & test2 are both
  // admins, so always use test3 for employee-role coverage. Mobile-user specs
  // assert test3-specific seeded data (pre-seeded ferie/permessi quotas,
  // configured approvers), so the actor must stay stable across runs. Its
  // display_name drifts (manual product testing renames users), so
  // name-rendering specs resolve the live value via
  // resolveDisplayName/selfDisplayName rather than pinning `displayName` below.
  // Residue from web mutating specs is handled by the text-marker purge in
  // /api/v1/_internal/e2e/purge-fixtures — leave_requests and correction_requests
  // whose text fields match the e2e seed prefix get wiped at globalTeardown.
  user: {
    email: process.env.E2E_USER_EMAIL ?? 'test3@test.it',
    password: process.env.E2E_USER_PASSWORD ?? 'Test123@!',
    // Canonical seed name; may be stale on the shared tenant — resolve the live
    // value for assertions (see comment above). Kept for reference/back-compat.
    displayName: 'Mario Rossi',
  },
} as const;

// Partner-app fixtures. These run ONLY against a LOCAL backend (dev-token login,
// DEV_AUTH_ENABLED) so the reseller flows never touch the production DB. Emails
// use the e2e-*@e2e.local namespace so the purge endpoint can clean them.
export const PARTNER_CREDS = {
  // Platform admin (partnership role = admin): sees/manages all tenants + partners.
  admin: {
    email: process.env.E2E_PARTNER_ADMIN_EMAIL ?? 'e2e-padmin@e2e.local',
    password: process.env.E2E_PARTNER_ADMIN_PASSWORD ?? 'Test123@!',
  },
  // Reseller (partnership role = partner) with finite caps (seeded by setup).
  partner: {
    email: process.env.E2E_PARTNER_EMAIL ?? 'e2e-ppartner@e2e.local',
    password: process.env.E2E_PARTNER_PASSWORD ?? 'Test123@!',
  },
} as const;

// Caps granted to the fixture partner — small on purpose so cap-enforcement
// specs can hit the ceilings.
export const PARTNER_CAPS = {
  cap_tenants: 2,
  cap_users_per_tenant: 10,
  cap_admins_per_tenant: 2,
  cap_documentali_per_tenant: 1,
  cap_branches_per_tenant: 3,
} as const;

export const URLS = {
  web: process.env.E2E_WEB_URL ?? 'http://localhost:5173',
  mobile: process.env.E2E_MOBILE_URL ?? 'http://localhost:8082',
  partner: process.env.E2E_PARTNER_URL ?? 'http://localhost:5175',
} as const;

export const STORAGE = {
  webAuth: 'e2e/.auth/web.json',
  webUserAuth: 'e2e/.auth/web.user.json',
  mobileAuth: 'e2e/.auth/mobile.json',
  mobileUserAuth: 'e2e/.auth/mobile.user.json',
  partnerAuth: 'e2e/.auth/partner.json',
  partnerUserAuth: 'e2e/.auth/partner.user.json',
} as const;
