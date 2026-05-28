import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Minimal a11y audit per main page. We do NOT fail on every WCAG violation
// — the goal is to catch regressions, not to demand zero issues from a
// codebase that hasn't been audited before.
//
// Rule IDs the codebase fails today are listed in KNOWN_VIOLATIONS. These
// are tracked as follow-up product work, not regressions. Remove an entry
// from the set when the app ships a fix — the test will start flagging if
// the issue gets reintroduced.
const KNOWN_VIOLATIONS = new Set([
  'select-name', // bare <select> tags missing aria-label
  'aria-input-field-name', // MUI DataGrid filter inputs
  'aria-allowed-role', // MUI legacy roles
  'color-contrast', // Tailwind muted text on light bg
  'label', // unwrapped <input> in BranchForm
  'button-name', // icon-only buttons missing aria-label
]);

async function audit(page: import('@playwright/test').Page, url: string) {
  await page.goto(url);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  for (const v of results.violations) {
    // eslint-disable-next-line no-console
    console.log(`[a11y ${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} nodes)`);
  }
  return results.violations.filter(
    (v) => v.impact === 'critical' && !KNOWN_VIOLATIONS.has(v.id),
  );
}

test.describe('web — Accessibility audits', () => {
  test('Dashboard has no NEW critical violations', async ({ page }) => {
    const blocking = await audit(page, '/');
    expect(blocking, JSON.stringify(blocking, null, 2)).toHaveLength(0);
  });

  test('Utenti has no NEW critical violations', async ({ page }) => {
    const blocking = await audit(page, '/users');
    expect(blocking, JSON.stringify(blocking, null, 2)).toHaveLength(0);
  });

  test('Leaves has no NEW critical violations', async ({ page }) => {
    const blocking = await audit(page, '/leaves');
    expect(blocking, JSON.stringify(blocking, null, 2)).toHaveLength(0);
  });

  test('Settings has no NEW critical violations', async ({ page }) => {
    const blocking = await audit(page, '/settings');
    expect(blocking, JSON.stringify(blocking, null, 2)).toHaveLength(0);
  });
});

test.describe('web — Login page accessibility', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('login form has no NEW critical violations', async ({ page }) => {
    const blocking = await audit(page, '/login');
    expect(blocking, JSON.stringify(blocking, null, 2)).toHaveLength(0);
  });
});
