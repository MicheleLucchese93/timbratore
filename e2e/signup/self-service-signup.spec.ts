import { test, expect } from '@playwright/test';
import {
  API_BASE,
  call,
  confirmSignup,
  createSelfServiceCompany,
  devLogin,
  randomPartitaIva,
  registerSignup,
  signupToken,
  uniqueEmail,
} from '../fixtures/signup';

/**
 * Self-service registration (Specs/SELF_SERVICE_BILLING.md §3.2), end to end:
 * website form (API) → email link (UI) → company with P.IVA (UI) → plan (UI).
 *
 * LOCAL STACK ONLY — it creates real companies. Needs a backend with
 * DEV_AUTH_ENABLED, SIGNUP_ENABLED and the e2e router mounted, and the web app
 * proxied to it, e.g. (the billing worktree's launch configs):
 *
 *   E2E_SIGNUP=1 E2E_NO_WEBSERVER=1 \
 *   E2E_API_URL=http://localhost:4200 E2E_WEB_URL=http://localhost:5180 \
 *   E2E_PURGE_SECRET=<backend's> npx playwright test --project=signup
 *
 * Fixtures: e2e-*@e2e.local admins and 'e2e-…' companies, swept by the purge.
 */
test.skip(process.env.E2E_SIGNUP !== '1', 'self-service signup specs run against a local stack only (E2E_SIGNUP=1)');

test.describe('self-service signup', () => {
  test('the public config says the form is open, and the login page links to it', async ({ page }) => {
    const r = await fetch(`${API_BASE}/api/v1/signup/config`);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { data: unknown }).data).toEqual({ enabled: true });
    await page.goto('/');
    await expect(page.getByTestId('login-signup-link')).toBeVisible({ timeout: 15_000 });
  });

  test('the form always answers 202, whatever the address', async () => {
    const email = uniqueEmail('enum');
    const first = await registerSignup({ email });
    expect(first.status).toBe(202);
    // Same address again (now pending) and an address that already has an
    // account: identical answers — nothing is revealed to the form submitter.
    const again = await registerSignup({ email });
    expect(again.status).toBe(202);
    const existing = await createSelfServiceCompany('enumexisting');
    const known = await registerSignup({ email: existing.email });
    expect(known.status).toBe(202);
    expect(known.body).toEqual(first.body);
    // …but the email it would send is the "you already have an account" one.
    const { mode } = await signupToken(existing.email);
    expect(mode).toBe('existing');
  });

  test('confirm link → password → wizard → company (VIES soft) → free plan → dashboard', async ({ page }) => {
    const email = uniqueEmail('ui');
    const reg = await registerSignup({ email, first_name: 'Giulia', last_name: 'Verdi', plan: 'piccola' });
    expect(reg.status).toBe(202);
    const { token } = await signupToken(email);

    // Step 2 — the page reads the token from the fragment and wipes it.
    await page.goto(`/registrazione/conferma#t=${encodeURIComponent(token)}`);
    await expect(page.getByTestId('signup-confirm')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(email)).toBeVisible();
    expect(page.url()).not.toContain('#t=');
    await page.getByTestId('signup-password').fill('E2e#Signup1');
    await page.getByTestId('signup-password-repeat').fill('E2e#Signup1');
    await page.getByTestId('signup-confirm-submit').click();

    // Step 3 — the wizard.
    await expect(page.getByTestId('welcome-wizard')).toBeVisible({ timeout: 15_000 });
    const piva = randomPartitaIva();
    await page.getByTestId('wz-piva').fill(piva);
    await page.getByTestId('wz-verify').click();
    // A random valid-checksum number is not on VIES (or VIES is down): either
    // way the registration goes on (D2).
    await expect(page.locator('[data-testid="vat-not_in_vies"], [data-testid="vat-unavailable"]')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('wz-ragione').fill(`e2e-ui-${Date.now()} Srl`);
    await page.getByTestId('wz-address').fill('Via Roma 1');
    await page.getByTestId('wz-cap').fill('37121');
    await page.getByTestId('wz-city').fill('Verona');
    await page.getByTestId('wz-province').fill('vr');
    await page.locator('label.chip-radio', { hasText: '4–10' }).click();
    await page.getByTestId('wz-dpa').check();
    await page.getByTestId('wz-art1341').check();
    await page.getByTestId('wz-powers').check();
    await page.getByTestId('wz-create').click();

    // Step 4 — plan; the one picked on the website is pre-selected.
    await expect(page.getByTestId('plan-step')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('plan-card-piccola')).toHaveClass(/plan-card-selected/);
    await page.getByTestId('plan-free-cta').click();

    // In the app: Free plan, badge under the logo, first-run checklist.
    await expect(page.getByTestId('premium-badge')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('onboarding-checklist')).toBeVisible();
    // "Continua gratis" dismissed the plan picked on the website.
    await expect(page.getByTestId('pending-plan-banner')).toHaveCount(0);

    const apiToken = await devLogin(email);
    const me = await call(apiToken, 'GET', '/api/v1/me');
    expect(me.status).toBe(200);
    expect(me.body.data.tenant).toMatchObject({
      plan: 'free',
      billing_mode: 'stripe',
      signup_source: 'self_service',
      max_users: 3,
      max_branches: 1,
      pending_plan: null,
    });
  });

  test('an expired or unknown link lands on the "link non valido" screen', async ({ page }) => {
    await page.goto('/registrazione/conferma#t=this-token-does-not-exist-1234567890');
    await expect(page.getByTestId('signup-invalid')).toBeVisible({ timeout: 15_000 });
  });

  test('a used link says the email is already confirmed', async ({ page }) => {
    const email = uniqueEmail('used');
    await registerSignup({ email });
    const { token } = await signupToken(email);
    await confirmSignup(token);
    await page.goto(`/registrazione/conferma#t=${encodeURIComponent(token)}`);
    await expect(page.getByTestId('signup-used')).toBeVisible({ timeout: 15_000 });
  });

  test('a P.IVA already registered cannot create a second company', async () => {
    const first = await createSelfServiceCompany('dupa');
    const email = uniqueEmail('dupb');
    await registerSignup({ email });
    const { token } = await signupToken(email);
    await confirmSignup(token);
    const t = await devLogin(email);
    const r = await call(t, 'POST', '/api/v1/onboarding/company', {
      partita_iva: first.partitaIva,
      ragione_sociale: `e2e-dupb-${Date.now()} Srl`,
      address: 'Via Roma 2',
      cap: '37121',
      city: 'Verona',
      province: 'VR',
      headcount_band: '1-3',
      accept_dpa: true,
      accept_art1341: true,
      accept_powers: true,
    });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('VAT_ALREADY_REGISTERED');
  });

  test('a wrong check digit is refused, VIES is never asked', async () => {
    const email = uniqueEmail('badvat');
    await registerSignup({ email });
    const { token } = await signupToken(email);
    await confirmSignup(token);
    const t = await devLogin(email);
    const good = randomPartitaIva();
    const bad = good.slice(0, 10) + String((Number(good[10]) + 1) % 10);
    const r = await call(t, 'POST', '/api/v1/onboarding/vat-check', { partita_iva: bad });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('INVALID_VAT');
  });

  test('Free plan caps: the 4th user is refused with LIMIT_REACHED', async () => {
    const c = await createSelfServiceCompany('caps');
    for (let i = 1; i <= 2; i++) {
      const ok = await call(
        c.token,
        'POST',
        '/api/v1/users/invite',
        { email: uniqueEmail(`capsuser${i}`), role: 'user', send_reset_email: false },
        c.tenantId
      );
      expect(ok.status, JSON.stringify(ok.body)).toBeLessThan(300);
    }
    const over = await call(
      c.token,
      'POST',
      '/api/v1/users/invite',
      { email: uniqueEmail('capsuser3'), role: 'user', send_reset_email: false },
      c.tenantId
    );
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('LIMIT_REACHED');
    expect(over.body.error.details).toMatchObject({ kind: 'users', limit: 3 });
  });

  test('Settings writes still pass the entitlement guard, and /billing reports the Free plan', async () => {
    const c = await createSelfServiceCompany('guard');
    // The DB trigger refuses plan/caps/module writes from a tenant request
    // (covered in apps/backend self-service-billing-db.test.ts); the columns the
    // Settings page owns must keep going through.
    const r = await call(c.token, 'PATCH', '/api/v1/settings', { timezone: 'Europe/Rome' }, c.tenantId);
    expect(r.status).toBe(200);
    const b = await call(c.token, 'GET', '/api/v1/billing', undefined, c.tenantId);
    expect(b.status).toBe(200);
    expect(b.body.data).toMatchObject({ plan: 'free', billing_mode: 'stripe', profile_gaps: ['recipient'] });
    expect(API_BASE).toMatch(/localhost|127\.0\.0\.1/);
  });
});
