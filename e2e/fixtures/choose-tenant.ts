/**
 * "Scegli l'azienda" handling for the auth setup projects.
 *
 * An account that belongs to more than one company lands on the chooser after
 * login instead of going straight to its home screen — test1 (the admin
 * fixture) is in that situation on the shared prod tenant. Single-company
 * accounts never see the screen, so this races the chooser against the
 * expected landing element and only clicks when the chooser actually won.
 *
 * Same helper for web and mobile: the web chooser renders the title in an <h1>
 * and the mobile one in a react-native-web <div>, so match on text rather than
 * the heading role; both expose one button per company whose accessible name
 * carries the ragione sociale.
 */

import { expect, type Locator, type Page } from '@playwright/test';
import { TENANT } from './test-data';

const CHOOSER_TITLE = "Scegli l'azienda";

export async function chooseTenantIfPrompted(
  page: Page,
  landed: Locator,
  timeout = 30_000,
): Promise<void> {
  const chooser = page.getByText(CHOOSER_TITLE).first();
  await expect(chooser.or(landed).first()).toBeVisible({ timeout });
  if (!(await chooser.isVisible())) return;
  // Substring match on purpose: the web button's accessible name also carries
  // the role badge ("ACME Srl Amministratore"), the mobile one is the bare name.
  await page.getByRole('button', { name: TENANT.name }).first().click();
}
