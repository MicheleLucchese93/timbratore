import type { Locator, Page } from '@playwright/test';

/**
 * Toast assertions.
 *
 * Toasts stack and linger for a few seconds, so several are on screen at once
 * during a multi-step flow. A bare `page.getByText(/…/)` therefore fails in two
 * different ways, and the partner suite hit both:
 *
 *  - strict-mode violation, when two live toasts match the same substring
 *    ("Azienda creata. Nessuna email inviata." + "Amministratore aggiunto.
 *    Nessuna email inviata.");
 *  - a FALSE PASS, when a leftover toast from an earlier step matches, so the
 *    assertion never actually waits for the action under test. That is how the
 *    resend step in partners.spec appeared to pass while its confirm dialog was
 *    still open — the next click then timed out on the modal backdrop.
 *
 * Both go away by scoping to the toast element and anchoring the pattern at the
 * START of its text: the create-time toasts embed the same sentence, but only
 * after a prefix ("Azienda creata. …"), so an anchored pattern separates them.
 */
export function toast(page: Page, text: RegExp): Locator {
  return page.locator('.toast').filter({ hasText: text });
}

/**
 * Outcome of a re-invite / resend action, in either language. The backend
 * decides which of the three it is (invite for an unconfirmed account, recovery
 * for a confirmed one, none when DEV sends no mail at all), so a spec that only
 * cares that the action landed accepts any.
 *
 * Anchored: the create-time toasts end with the same "Nessuna email inviata."
 * and must NOT satisfy this.
 */
export const ACCESS_EMAIL_SENT =
  /^(Invito inviato a|Invite sent to|Email di reset password inviata|Password reset email sent|Nessuna email inviata|No email sent)/;
