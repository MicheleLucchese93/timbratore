import { test, expect, type Page } from '@playwright/test';
import { call, confirmSignup, devLogin, signupToken, uniqueEmail } from '../fixtures/signup';

/**
 * The website's registration page (apps/website, /it/registrazione/) — the
 * real Astro page against the real local backend, through the dev server's
 * /api proxy (WEBSITE_DEV_API_PROXY). Same LOCAL-only invocation as
 * self-service-signup.spec.ts, plus the website dev server:
 *
 *   E2E_WEBSITE_URL=http://localhost:4331   (default)
 *
 * Cloudflare Turnstile is replaced by a stub that hands out a dummy token, so
 * the spec needs no network; a backend without TURNSTILE_SECRET_KEY accepts it.
 */
test.skip(process.env.E2E_SIGNUP !== '1', 'self-service signup specs run against a local stack only (E2E_SIGNUP=1)');

const WEBSITE = (process.env.E2E_WEBSITE_URL ?? 'http://localhost:4331').replace(/\/$/, '');

const FAKE_TURNSTILE = `
  window.turnstile = {
    render: function (el, opts) {
      var id = 'stub-' + Math.random().toString(36).slice(2);
      setTimeout(function () { opts && opts.callback && opts.callback('XXXX.DUMMY.TOKEN.XXXX'); }, 30);
      return id;
    },
    reset: function () {},
    remove: function () {},
    execute: function () {},
    getResponse: function () { return 'XXXX.DUMMY.TOKEN.XXXX'; },
    isExpired: function () { return false; },
  };`;

async function openPage(page: Page, query = '') {
  await page.route('https://challenges.cloudflare.com/turnstile/**', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: FAKE_TURNSTILE })
  );
  await page.goto(`${WEBSITE}/it/registrazione/${query}`);
  // Most privacy-preserving choice on the cookie banner, which would otherwise
  // cover the lower part of the form on small viewports.
  const necessary = page.getByRole('button', { name: 'Solo necessari' });
  if (await necessary.isVisible().catch(() => false)) await necessary.click();
}

test.describe('website — registration page', () => {
  test.beforeAll(async () => {
    const up = await fetch(`${WEBSITE}/it/registrazione/`).then((r) => r.ok).catch(() => false);
    test.skip(!up, `website dev server not reachable at ${WEBSITE}`);
  });

  test('form → confirmation email → the web app: plan and campaign travel with the request', async ({ page }) => {
    const email = uniqueEmail('site');
    await openPage(page, '?piano=media&utm_source=e2e-site&utm_campaign=autunno');
    await expect(page.getByTestId('signup-form-view')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('signup-plan')).toContainText('Media');

    await page.locator('#signup-first-name').fill('Sara');
    await page.locator('#signup-last-name').fill('Neri');
    await page.locator('#signup-email').fill(email);
    await page.locator('#signup-tos').check();
    await page.locator('#signup-privacy').check();
    const sent = page.waitForResponse((r) => r.url().endsWith('/api/v1/signup') && r.request().method() === 'POST');
    await page.getByTestId('signup-submit').click();
    const res = await sent;
    expect(res.status()).toBe(202);
    const body = res.request().postDataJSON() as Record<string, unknown>;
    expect(body).toMatchObject({
      email,
      plan: 'media',
      language: 'it',
      accept_tos: true,
      accept_privacy: true,
      company_website: '',
      utm: { utm_source: 'e2e-site', utm_campaign: 'autunno' },
    });
    await expect(page.getByTestId('signup-success')).toBeVisible();
    await expect(page.getByTestId('signup-success')).toContainText(email);

    // The emailed link opens the web app's confirmation page for this address.
    const { token, mode } = await signupToken(email);
    expect(mode).toBe('new');
    await page.goto(`/registrazione/conferma#t=${encodeURIComponent(token)}`);
    await expect(page.getByTestId('signup-confirm')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(email)).toBeVisible();

    // …and the plan picked on the website is what the wizard will pre-select.
    await confirmSignup(token);
    const onboarding = await call(await devLogin(email), 'GET', '/api/v1/onboarding');
    expect(onboarding.body.data).toMatchObject({ step: 'company', plan_hint: 'media', first_name: 'Sara' });
  });

  test('closed signup (SIGNUP_ENABLED off) shows "coming soon" instead of the form', async ({ page }) => {
    await page.route('**/api/v1/signup/config', (route) =>
      route.fulfill({ json: { ok: true, data: { enabled: false } } })
    );
    await openPage(page);
    await expect(page.getByTestId('signup-unavailable')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('signup-form-view')).toBeHidden();
  });

  test('no API behind the page yet (Caddy route missing → HTML 404) also falls back', async ({ page }) => {
    await page.route('**/api/v1/signup/config', (route) =>
      route.fulfill({ status: 404, contentType: 'text/html', body: '<!doctype html><title>404</title>' })
    );
    await openPage(page);
    await expect(page.getByTestId('signup-unavailable')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('signup-form-view')).toBeHidden();
  });
});
