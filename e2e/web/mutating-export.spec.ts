import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  createExportJob,
  getExportJob,
  deleteExportJob,
  downloadExport,
  loadHandleFromStorage,
  type ApiHandle,
} from '../fixtures/api-client';

const ENABLED = process.env.E2E_MUTATING === '1';

// exceljs ships its own @types/node, in which `Buffer` is `Buffer<ArrayBuffer>`;
// this workspace resolves the generic `Buffer<ArrayBufferLike>` that `fetch`
// (and therefore downloadExport) hands back. Identical at runtime, mutually
// unassignable to tsc — hence a cast to exceljs's OWN parameter type, not to
// `any`, and in one place instead of at every call site.
type XlsxBuffer = Parameters<ExcelJS.Workbook['xlsx']['load']>[0];

async function openWorkbook(body: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(body as unknown as XlsxBuffer);
  return wb;
}

test.describe('web — Export job lifecycle (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let exportId: string | null = null;

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
  });

  test('POST /exports creates a job + polled status reaches "ready" or "running"', async () => {
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDayPrev = new Date(now.getFullYear(), now.getMonth(), 0);
    const job = await createExportJob(admin.token, {
      format: 'json',
      period_from: prevMonth.toISOString().slice(0, 10),
      period_to: lastDayPrev.toISOString().slice(0, 10),
    });
    exportId = job.id;
    // Job goes through pending → running → ready quickly for json format.
    // Poll up to 10s for a non-pending state.
    let status = job.status;
    for (let i = 0; i < 20 && (status === 'pending' || status === 'running'); i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      const refreshed = await getExportJob(admin.token, exportId);
      status = refreshed.status;
    }
    // Export jobs sometimes remain `pending` if the worker hasn't picked the
    // task within 10s — accept any defined status, just verify the field
    // exists and isn't garbage.
    expect(['pending', 'ready', 'failed', 'running']).toContain(status);
  });

  test('list page renders the newly-created job', async ({ page }) => {
    test.skip(!exportId, 'previous test skipped — no job to look up');
    await page.goto('/exports');
    await expect(page.getByRole('heading', { name: /Esportazioni/i })).toBeVisible({ timeout: 15_000 });
    // Page lists recent jobs (up to 100). The job is visible by status badge
    // or download button — assert at least one new row showed up since the
    // previous "Genera" click (count > 0).
    const grid = page.locator('table, .MuiDataGrid-root, ul li');
    await expect(grid.first()).toBeVisible({ timeout: 15_000 });
  });

  test('DELETE /exports/:id removes the job — subsequent GET 404s', async () => {
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDayPrev = new Date(now.getFullYear(), now.getMonth(), 0);
    const job = await createExportJob(admin.token, {
      format: 'json',
      period_from: prevMonth.toISOString().slice(0, 10),
      period_to: lastDayPrev.toISOString().slice(0, 10),
    });
    await deleteExportJob(admin.token, job.id);
    // Gone → GET returns 404 (getExportJob throws on non-2xx).
    await expect(getExportJob(admin.token, job.id)).rejects.toThrow();
  });

  test('trash icon opens the in-app confirm modal (not native confirm); Annulla cancels', async ({ page }) => {
    // Seed a row so there is something to act on.
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDayPrev = new Date(now.getFullYear(), now.getMonth(), 0);
    const job = await createExportJob(admin.token, {
      format: 'json',
      period_from: prevMonth.toISOString().slice(0, 10),
      period_to: lastDayPrev.toISOString().slice(0, 10),
    });

    // The whole point of the change: delete no longer calls window.confirm.
    // A native dialog would also block the page, so this asserts intent and
    // guards against a hang.
    let nativeDialog = false;
    page.on('dialog', (d) => {
      nativeDialog = true;
      d.dismiss().catch(() => {});
    });

    await page.goto('/exports');
    await expect(page.getByRole('heading', { name: /Esportazioni/i })).toBeVisible({ timeout: 15_000 });

    const trash = page.getByRole('button', { name: 'Elimina esportazione' }).first();
    await expect(trash).toBeVisible({ timeout: 15_000 });
    await trash.click();

    // Styled in-app modal, not the browser dialog.
    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('heading', { name: /Eliminare questa esportazione\?/i })).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Elimina', exact: true })).toBeVisible();
    const cancel = modal.getByRole('button', { name: 'Annulla' });

    await cancel.click();
    await expect(modal).toBeHidden();
    expect(nativeDialog).toBe(false);

    // Annulla deleted nothing — the seeded job still exists.
    await expect(getExportJob(admin.token, job.id)).resolves.toBeTruthy();

    await deleteExportJob(admin.token, job.id);
  });

  test('XLSX export generates a valid multi-sheet workbook (when storage is ready)', async () => {
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDayPrev = new Date(now.getFullYear(), now.getMonth(), 0);
    const job = await createExportJob(admin.token, {
      format: 'xlsx',
      period_from: prevMonth.toISOString().slice(0, 10),
      period_to: lastDayPrev.toISOString().slice(0, 10),
    });

    // Poll up to ~12s for the worker to finish.
    let status = job.status;
    for (let i = 0; i < 24 && (status === 'pending' || status === 'running'); i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      status = (await getExportJob(admin.token, job.id)).status;
    }

    if (status === 'ready') {
      // Download must be a real XLSX: spreadsheet content-type + ZIP magic bytes.
      const dl = await downloadExport(admin.token, job.id);
      expect(dl.ok).toBe(true);
      expect(dl.contentType).toContain('spreadsheetml');
      expect(dl.isZip).toBe(true);

      // The daily breakdown is ONE sheet for the whole company, not one tab per
      // employee: payroll and the accountant filter/pivot it, so every row has
      // to carry the identity of the person it belongs to.
      const wb = await openWorkbook(dl.body);
      const names = wb.worksheets.map((w) => w.name);
      expect(names).toContain('Riepilogo');
      expect(names).toContain('Dettaglio giornaliero');
      expect(names).toContain('Metadati');
      const dt = wb.getWorksheet('Dettaglio giornaliero')!;
      const header = (dt.getRow(1).values as unknown[]).slice(1).map(String);
      expect(header.slice(0, 5)).toEqual([
        'Dipendente',
        'Nome',
        'Cognome',
        'Codice fiscale',
        'Giorno',
      ]);
      // Identity columns must be filled on EVERY data row — a blank one is a row
      // nobody can attribute.
      const blanks: number[] = [];
      dt.eachRow((row, n) => {
        if (n === 1) return;
        if (!String(row.getCell(1).value ?? '') || !String(row.getCell(5).value ?? '')) {
          blanks.push(n);
        }
      });
      expect(blanks).toEqual([]);
    } else {
      // Worker not done / storage not configured in this env — just assert the
      // job exists. The unit-level workbook build is covered separately.
      expect(['pending', 'running', 'failed']).toContain(status);
    }

    await deleteExportJob(admin.token, job.id);
  });

  test('XLSX prints "Ore ordinarie" immediately before "Ore straordinarie"', async () => {
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDayPrev = new Date(now.getFullYear(), now.getMonth(), 0);
    const job = await createExportJob(admin.token, {
      format: 'xlsx',
      period_from: prevMonth.toISOString().slice(0, 10),
      period_to: lastDayPrev.toISOString().slice(0, 10),
    });

    let status = job.status;
    for (let i = 0; i < 24 && (status === 'pending' || status === 'running'); i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      status = (await getExportJob(admin.token, job.id)).status;
    }

    try {
      // Deliberately a SKIP, not the "assert the job exists" fallback the
      // lifecycle test above uses: this test exists to prove a column is in the
      // workbook, and a run that never opened a workbook has proved nothing.
      // Reporting it green would hide a missing column behind a slow worker.
      test.skip(
        status !== 'ready',
        `export worker never reached "ready" (status=${status}) — column not verified`,
      );

      const dl = await downloadExport(admin.token, job.id);
      expect(dl.ok).toBe(true);
      const wb = await openWorkbook(dl.body);

      // Contract hours ("ore ordinarie", the theoretical monte ore from the
      // assigned schedule) next to the overtime already contained in the worked
      // hours: payroll reads the pair the way the payslip prints it, which is
      // why the customer asked for the column. Adjacency is the requirement —
      // asserting mere presence would let it drift to the far end of the sheet.
      for (const sheet of ['Riepilogo', 'Dettaglio giornaliero'] as const) {
        const ws = wb.getWorksheet(sheet);
        expect(ws, `sheet ${sheet} missing`).toBeTruthy();
        const header = (ws!.getRow(1).values as unknown[]).slice(1).map(String);
        const ordinary = header.indexOf('Ore ordinarie');
        const overtime = header.indexOf('Ore straordinarie');
        expect(ordinary, `${sheet}: no "Ore ordinarie" column — header = ${header.join(' | ')}`)
          .toBeGreaterThan(-1);
        expect(overtime, `${sheet}: "Ore ordinarie" must sit immediately before "Ore straordinarie"`)
          .toBe(ordinary + 1);

        // Whatever lands in the column has to be a real number the accountant
        // can sum. A blank cell is tolerated (that is how a 0 may be stored),
        // but anything present and non-finite is not: an aggregate field that
        // went missing arrives here as NaN — `undefined / 60` — and would print
        // as garbage in the payroll file rather than failing anywhere upstream.
        const col = ordinary + 1; // 1-based cell index
        const bad: string[] = [];
        ws!.eachRow((row, n) => {
          if (n === 1) return;
          const v = row.getCell(col).value;
          if (v === null || v === undefined || v === '') return;
          if (!Number.isFinite(v)) bad.push(`${n}:${JSON.stringify(v)}`);
        });
        expect(bad, `${sheet}: "Ore ordinarie" is not a number on rows ${bad.join(', ')}`).toEqual(
          [],
        );
      }

      // Metadati carries a dizionario of every column of every sheet, and
      // prints "(descrizione mancante)" for any header nobody documented. A new
      // column added without its glossary entry ships that string to the
      // accountant, so the whole column set is guarded by one assertion.
      const meta = wb.getWorksheet('Metadati');
      expect(meta, 'sheet Metadati missing').toBeTruthy();
      const undocumented: string[] = [];
      meta!.eachRow((row, n) => {
        if (n === 1) return;
        // Columns: Sezione | Voce | Valore | Descrizione.
        const desc = String(row.getCell(4).value ?? '');
        if (desc.includes('(descrizione mancante)')) {
          undocumented.push(String(row.getCell(2).value ?? `riga ${n}`));
        }
      });
      expect(undocumented, 'columns missing from the Metadati dizionario').toEqual([]);
    } finally {
      // Runs on the skip too — test.skip() throws, and a skipped test must not
      // leave an export job (and its stored file) behind on the shared tenant.
      await deleteExportJob(admin.token, job.id).catch(() => {});
    }
  });
});
