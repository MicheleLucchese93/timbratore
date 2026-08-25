import { test, expect } from '@playwright/test';
import { createFixtureUser, devLogin, partnerApi, tenantApi } from '../fixtures/partner-client';
import { PARTNER_CREDS } from '../fixtures/test-data';
import { toast } from '../fixtures/toast';

// Richieste: the support queue from the operator's side. Runs against a LOCAL
// backend (dev-token) like the rest of the partner suite, and is mutating — it
// raises a real ticket as a fixture tenant admin, then works it in the console.
const ENABLED = process.env.E2E_MUTATING === '1';
const TENANT_ID = process.env.E2E_TEST_TENANT_ID ?? '';

interface TicketRow {
  id: string;
  ref: string;
  subject: string;
  handling_status: string;
  assigned_to: string | null;
  internal_note: string | null;
  unread_count: number;
  first_message_id?: string;
}

test.describe.configure({ mode: 'serial' });

test.describe('partner · Richieste (support queue)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 (runs against a local backend)');
  test.skip(!TENANT_ID, 'set E2E_TEST_TENANT_ID to the pinned local tenant');

  const customerEmail = 'e2e-tkadmin@e2e.local';
  const marker = `e2e-console-${Date.now()}`;
  let customerToken = '';
  let ticket: TicketRow;

  test.beforeAll(async () => {
    await createFixtureUser(customerEmail, 'admin');
    customerToken = await devLogin(customerEmail);
    const created = await tenantApi<TicketRow>(customerToken, TENANT_ID, '/api/v1/tickets', {
      method: 'POST',
      json: {
        subject: marker,
        body: 'Richiesta aperta dalla suite e2e per la console partner.',
        category: 'problema',
        priority: 'alta',
      },
    });
    expect(created.status, `create ticket: ${created.code ?? ''}`).toBe(201);
    ticket = created.data!;
    expect(ticket.ref).toMatch(/^SQ-\d{8}-\d{4}$/);
  });

  test('a new request lands in the queue unread, with the customer named', async () => {
    const token = await devLogin(PARTNER_CREDS.admin.email);
    const list = await partnerApi<{ items: TicketRow[]; total: number }>(
      token,
      `/api/v1/partnership/tickets?handling=aperti&q=${encodeURIComponent(marker)}`
    );
    expect(list.ok).toBe(true);
    const row = list.data!.items.find((i) => i.ref === ticket.ref);
    expect(row, 'the raised ticket is in the console queue').toBeTruthy();
    expect(row!.handling_status).toBe('nuovo');
    // The opening request is message #1, and the team has not read it yet.
    expect(row!.unread_count).toBe(1);
  });

  test('the console claims it, notes it, answers it — and the customer sees the answer', async ({
    page,
  }) => {
    await page.goto('/tickets');
    await expect(page.getByRole('heading', { name: 'Richieste' })).toBeVisible();

    await page.getByTestId('ticket-search').fill(marker);
    const opened = page.waitForResponse(
      (r) => r.url().includes('/api/v1/partnership/tickets/') && r.ok()
    );
    await page.getByText(ticket.ref).click();
    await opened;
    const detail = page.getByTestId('ticket-detail');
    await expect(detail).toBeVisible();
    await expect(detail.getByText(marker)).toBeVisible();
    // The whole request is here — that is the disclosure this page exists for.
    await expect(
      detail.getByText('Richiesta aperta dalla suite e2e per la console partner.')
    ).toBeVisible();

    // Taking it also moves `nuovo` on to `in_lavorazione`: one click.
    const claimed = page.waitForResponse(
      (r) => r.request().method() === 'PATCH' && r.url().includes('/partnership/tickets/') && r.ok()
    );
    await page.getByTestId('ticket-claim').click();
    await claimed;
    await expect(toast(page, /^Richiesta presa in carico/)).toBeVisible();
    await expect(page.getByTestId('ticket-status')).toHaveValue('in_lavorazione');

    // Answer, and park it on the customer.
    await page.getByTestId('ticket-reply').fill('Ti rispondiamo dalla console e2e.');
    await page.getByTestId('ticket-next-status').selectOption('in_attesa_cliente');
    const replied = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/messages') && r.ok()
    );
    await page.getByTestId('ticket-send').click();
    await replied;
    await expect(toast(page, /^Risposta inviata/)).toBeVisible();

    // The customer's own surface now shows the reply, and the operator who wrote
    // it is deliberately anonymous there.
    const detailApi = await tenantApi<{
      ticket: { handling_status: string; unread_count: number };
      messages: Array<{ author: string; body: string; author_label?: string }>;
    }>(customerToken, TENANT_ID, `/api/v1/tickets/${ticket.id}`);
    expect(detailApi.ok).toBe(true);
    expect(detailApi.data!.ticket.handling_status).toBe('in_attesa_cliente');
    const answer = detailApi.data!.messages.find((m) => m.author === 'operator');
    expect(answer, 'the operator reply reached the customer').toBeTruthy();
    expect(answer!.body).toBe('Ti rispondiamo dalla console e2e.');
    expect(answer!.author_label).toBeUndefined();
  });

  test('every console write is in the Registro attività', async () => {
    const token = await devLogin(PARTNER_CREDS.admin.email);
    const audit = await partnerApi<{
      entries: Array<{ action: string; target_label: string | null; target_type: string | null }>;
    }>(token, '/api/v1/partnership/audit');
    expect(audit.ok).toBe(true);
    const mine = audit.data!.entries.filter((e) => e.target_label === ticket.ref);
    expect(mine.map((e) => e.action).sort()).toEqual(
      expect.arrayContaining(['ticket.assign', 'ticket.reply'])
    );
    expect(mine.every((e) => e.target_type === 'ticket')).toBe(true);
  });

  test('a customer reply puts it back on the team', async () => {
    const sent = await tenantApi<{ handling_status: string }>(
      customerToken,
      TENANT_ID,
      `/api/v1/tickets/${ticket.id}/messages`,
      { method: 'POST', json: { body: 'Ecco le informazioni che chiedevate.' } }
    );
    expect(sent.ok).toBe(true);
    expect(sent.data!.handling_status).toBe('in_lavorazione');

    const token = await devLogin(PARTNER_CREDS.admin.email);
    const detail = await partnerApi<{ ticket: TicketRow }>(
      token,
      `/api/v1/partnership/tickets/${ticket.id}`
    );
    expect(detail.data!.ticket.unread_count).toBe(1);
    // The note stays operator-side; the customer's payload never carries it.
    expect(detail.data!.ticket.internal_note ?? null).not.toBeUndefined();
  });

  test('a request the customer resolves leaves the work queue', async () => {
    const token = await devLogin(PARTNER_CREDS.admin.email);
    const inQueue = async (): Promise<boolean> => {
      const r = await partnerApi<{ items: TicketRow[] }>(
        token,
        `/api/v1/partnership/tickets?handling=aperti&q=${encodeURIComponent(marker)}`
      );
      return (r.data?.items ?? []).some((i) => i.ref === ticket.ref);
    };
    expect(await inQueue(), 'in the queue before the customer settles it').toBe(true);

    // The customer's own flag — the console has no control that touches it.
    await tenantApi(customerToken, TENANT_ID, `/api/v1/tickets/${ticket.id}`, {
      method: 'PATCH',
      json: { status: 'resolved' },
    });
    expect(await inQueue(), 'gone once the customer says they need nothing').toBe(false);

    // It is a filter, not a state change: the ticket is still there under
    // «Tutti gli stati», carrying whatever the team had last said about it.
    const all = await partnerApi<{ items: TicketRow[] }>(
      token,
      `/api/v1/partnership/tickets?handling=tutti&q=${encodeURIComponent(marker)}`
    );
    expect(all.data!.items.some((i) => i.ref === ticket.ref)).toBe(true);

    // And a reopen puts it straight back on the queue.
    await tenantApi(customerToken, TENANT_ID, `/api/v1/tickets/${ticket.id}`, {
      method: 'PATCH',
      json: { status: 'open' },
    });
    expect(await inQueue(), 'back in the queue after the customer reopens').toBe(true);
  });

  test('a request the console closes is still reopenable by the customer', async () => {
    const token = await devLogin(PARTNER_CREDS.admin.email);
    const closed = await partnerApi<TicketRow>(
      token,
      `/api/v1/partnership/tickets/${ticket.id}`,
      { method: 'PATCH', json: { handling_status: 'chiuso' } }
    );
    expect(closed.data!.handling_status).toBe('chiuso');

    const reply = await tenantApi<{ handling_status: string }>(
      customerToken,
      TENANT_ID,
      `/api/v1/tickets/${ticket.id}/messages`,
      { method: 'POST', json: { body: 'Purtroppo il problema si ripresenta.' } }
    );
    // A closed request that swallowed a reply would be worse than a reopened one.
    expect(reply.data!.handling_status).toBe('in_lavorazione');
  });
});
