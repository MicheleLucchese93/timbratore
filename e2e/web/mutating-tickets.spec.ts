import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  attachToTicketMessage,
  createTicket,
  downloadTicketAttachment,
  getTicket,
  listTickets,
  loadHandleFromStorage,
  replyToTicket,
  setTicketStatus,
  type ApiHandle,
} from '../fixtures/api-client';

// Assistenza (support tickets, migration 061). Mutating: real rows on the shared
// test tenant, raised through the prod API and driven through the UI. Subjects
// carry the 'e2e-' marker by convention; the purge endpoint wipes
// support_tickets for the pinned tenant at globalTeardown, so nothing is left
// behind even when a spec fails mid-way.
//
// NOTE: requires the NEW backend (migration 061 + the tickets routes) deployed.
const ENABLED = process.env.E2E_MUTATING === '1';

test.describe.configure({ mode: 'serial' });

test.describe('web — Assistenza: raise, reply, resolve', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let employee: ApiHandle;

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    employee = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
  });

  test('API: raise → thread → attachment → resolve/reopen, and employees are refused', async () => {
    const marker = `e2e-ticket-${Date.now()}`;
    const created = await createTicket(admin.token, {
      subject: marker,
      body: 'Aperta dalla suite e2e: descrizione abbastanza lunga per passare la validazione.',
      category: 'problema',
      priority: 'media',
    });
    expect(created.ref).toMatch(/^SQ-\d{8}-\d{4}$/);
    expect(created.status).toBe('open');
    expect(created.handling_status).toBe('nuovo');
    // The opening request is also message #1, which is what an attachment hangs
    // off. Without it a bug report could not carry its screenshot.
    expect(created.first_message_id).toBeTruthy();

    const png = Buffer.from('89504e470d0a1a0a6532652d73686f74', 'hex');
    const attached = await attachToTicketMessage(admin.token, created.id, created.first_message_id!, {
      name: 'schermata.png',
      mime: 'image/png',
      bytes: png,
    });
    expect(attached.size_bytes).toBe(png.byteLength);

    const detail = await getTicket(admin.token, created.id);
    expect(detail.messages).toHaveLength(1);
    expect(detail.messages[0]!.author).toBe('user');
    expect(detail.messages[0]!.attachments.map((a) => a.filename)).toContain('schermata.png');
    // The customer payload must never carry the team's fields.
    expect(Object.keys(detail.ticket)).not.toContain('internal_note');
    expect(Object.keys(detail.ticket)).not.toContain('assigned_to');

    const bytes = await downloadTicketAttachment(admin.token, created.id, attached.id);
    expect(bytes.equals(png)).toBe(true);

    const replied = await replyToTicket(admin.token, created.id, 'Aggiungo un dettaglio.');
    expect(replied.message.author).toBe('user');
    // Nobody has picked it up yet, so a reply leaves it `nuovo` rather than
    // claiming the team is working on it.
    expect(replied.handling_status).toBe('nuovo');

    const resolved = await setTicketStatus(admin.token, created.id, 'resolved');
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolved_at).toBeTruthy();
    const reopened = await setTicketStatus(admin.token, created.id, 'open');
    expect(reopened.status).toBe('open');
    expect(reopened.resolved_at).toBeNull();

    // An employee has no business on this surface: refused, not filtered.
    const refused = await fetch(
      `${process.env.E2E_API_URL ?? 'https://api-sonoqui.xdevapp.it'}/api/v1/tickets`,
      { headers: { Authorization: `Bearer ${employee.token}`, 'X-Tenant-Id': employee.tenantId } },
    );
    expect(refused.status).toBe(403);
  });

  test('UI: the form raises a request and the thread shows the reply', async ({ page }) => {
    const marker = `e2e-ticket-ui-${Date.now()}`;

    await page.goto('/tickets');
    await expect(page.getByRole('heading', { name: 'Assistenza' })).toBeVisible();

    await page.getByRole('button', { name: 'Nuova richiesta' }).click();
    await page.getByTestId('ticket-subject').fill(marker);
    await page
      .getByTestId('ticket-body')
      .fill('Segnalazione creata dalla suite e2e attraverso il form.');
    // Gate on the POST rather than on a toast: the modal closes on success and a
    // toast would race the re-render.
    const posted = page.waitForResponse(
      (r) => r.url().includes('/api/v1/tickets') && r.request().method() === 'POST' && r.ok(),
    );
    await page.getByTestId('ticket-send').click();
    await posted;

    // Creating one opens it: the detail dialog is up with the request in it.
    const detail = page.getByTestId('ticket-detail');
    await expect(detail).toBeVisible();
    await expect(detail.getByText(marker)).toBeVisible();
    await expect(detail.getByText('Ricevuta')).toBeVisible();

    await page.getByTestId('ticket-reply').fill('Risposta del cliente dalla UI e2e.');
    const replied = page.waitForResponse(
      (r) => r.url().includes('/messages') && r.request().method() === 'POST' && r.ok(),
    );
    await page.getByTestId('ticket-reply-send').click();
    await replied;
    await expect(detail.getByText('Risposta del cliente dalla UI e2e.')).toBeVisible();

    await page.getByRole('button', { name: 'Chiudi' }).click();
    // Back on the list, the new request is there with its reference.
    const row = page.getByTestId('ticket-row').filter({ hasText: marker });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(/SQ-\d{8}-\d{4}/);

    // And the API agrees about what the UI just did.
    const rows = await listTickets(admin.token);
    const mine = rows.find((r) => r.subject === marker);
    expect(mine, 'the UI-raised ticket is in the API list').toBeTruthy();
    expect(mine!.status).toBe('open');
  });

  test('UI: marking a request resolved and reopening it is the customer’s own flag', async ({ page }) => {
    const marker = `e2e-ticket-flag-${Date.now()}`;
    await createTicket(admin.token, {
      subject: marker,
      body: 'Richiesta creata per verificare la spunta del cliente.',
    });

    await page.goto('/tickets');
    await page.getByTestId('ticket-row').filter({ hasText: marker }).click();
    const detail = page.getByTestId('ticket-detail');
    await expect(detail).toBeVisible();

    // «Risolto» flags it AND dismisses the panel: the click means "I am done
    // with this", so being left parked on it — on a list filtered to «Aperte»,
    // where the row has just gone — would read as the button doing nothing.
    const patched = page.waitForResponse(
      (r) => r.request().method() === 'PATCH' && r.url().includes('/api/v1/tickets/') && r.ok(),
    );
    await detail.getByTestId('ticket-resolve').click();
    await patched;
    await expect(detail).toHaveCount(0);

    // It is gone from «Aperte» and back under «Tutte», carrying the customer's
    // own badge — which is NOT the team's «Risolta dall'assistenza».
    await expect(page.getByTestId('ticket-row').filter({ hasText: marker })).toHaveCount(0);
    // The tab's accessible name now carries its count ("Tutte 3"), so the testid
    // is the stable handle.
    await page.getByTestId('ticket-filter-tutte').click();
    const row = page.getByTestId('ticket-row').filter({ hasText: marker });
    await expect(row).toContainText('Risolta da te');

    // …and it is exactly what the «Chiuse» view is for.
    await page.getByTestId('ticket-filter-chiuse').click();
    await expect(page.getByTestId('ticket-row').filter({ hasText: marker })).toHaveCount(1);
    await page.getByTestId('ticket-filter-tutte').click();

    // A closed request shows ONE badge — the outcome — and not the team state it
    // happened to be frozen in.
    await expect(row).not.toContainText('In attesa di una tua risposta');

    // Reopening is the opposite click, so it keeps the panel open.
    await row.click();
    const reopened = page.waitForResponse(
      (r) => r.request().method() === 'PATCH' && r.url().includes('/api/v1/tickets/') && r.ok(),
    );
    await page.getByTestId('ticket-resolve').click();
    await reopened;
    await expect(page.getByTestId('ticket-detail')).toBeVisible();
    await expect(page.getByTestId('ticket-detail').getByText('Risolta da te')).toHaveCount(0);
  });

  test('UI: the history lists every state change, and the backdrop dismisses', async ({ page }) => {
    const marker = `e2e-ticket-hist-${Date.now()}`;
    const created = await createTicket(admin.token, {
      subject: marker,
      body: 'Richiesta creata per verificare lo storico degli stati.',
    });
    // A second transition to have something beyond "aperta": the customer's own
    // flag is the only one this side can drive.
    await setTicketStatus(admin.token, created.id, 'resolved');
    await setTicketStatus(admin.token, created.id, 'open');

    await page.goto('/tickets');
    await page.getByTestId('ticket-row').filter({ hasText: marker }).click();
    const detail = page.getByTestId('ticket-detail');
    await expect(detail).toBeVisible();

    await page.getByTestId('ticket-history-toggle').click();
    const history = page.getByTestId('ticket-history');
    await expect(history).toBeVisible();
    // Written by the migration-063 trigger, not by any call site — so it is
    // there whichever path moved the state.
    await expect(history).toContainText('Richiesta aperta');
    await expect(history).toContainText('Segnata come risolta da te');
    await expect(history).toContainText('Riaperta da te');

    // Clicking outside the panel closes it, like every other dialog in the app.
    await page.getByTestId('ticket-backdrop').click({ position: { x: 5, y: 5 } });
    await expect(detail).toHaveCount(0);
  });
});
