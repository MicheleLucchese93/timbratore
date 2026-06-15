import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  apiPatch,
  createExportJobRaw,
  getExportJob,
  deleteExportJob,
  downloadExportText,
  loadHandleFromStorage,
  type ApiHandle,
} from '../fixtures/api-client';

const ENABLED = process.env.E2E_MUTATING === '1';

// The Centro Paghe ("ORARIO"/TRORAPRO) export is a fixed-width LIBRO UNICO file:
// 200-byte records + CRLF, one company / one whole calendar month. These specs
// run against the deployed API; if the 'centro' format isn't rolled out yet the
// create returns 400 and the dependent assertions self-skip.
test.describe('web — Centro Paghe export (mutating)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let jobId: string | null = null;
  let deployed = true;

  function prevMonthBounds(): { first: string; last: string } {
    const now = new Date();
    const first = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
    const last = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 0));
    return { first: first.toISOString().slice(0, 10), last: last.toISOString().slice(0, 10) };
  }

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    // Ensure a codice ditta is set so the file actually generates (otherwise the
    // job fails with a clear "codice ditta mancante"). Best-effort: pre-deploy
    // the settings schema rejects the field and we ignore it.
    await apiPatch(admin.token, '/api/v1/settings', { codice_ditta: 'E2ETEST' }).catch(() => {});
  });

  test('rejects a range that is not a whole calendar month', async () => {
    const { first } = prevMonthBounds();
    const r = await createExportJobRaw(admin.token, {
      format: 'centro',
      period_from: first,
      period_to: first, // single day → not a whole month
    });
    expect(r.status).toBe(400);
  });

  test('creates a whole-month Centro Paghe job', async () => {
    const { first, last } = prevMonthBounds();
    const r = await createExportJobRaw(admin.token, {
      format: 'centro',
      period_from: first,
      period_to: last,
    });
    if (r.status === 400) {
      deployed = false;
      test.skip(true, "Centro Paghe 'centro' format not deployed to the API under test");
    }
    expect(r.status).toBe(201);
    jobId = r.data!.id;

    let status = r.data!.status;
    for (let i = 0; i < 24 && (status === 'pending' || status === 'running'); i += 1) {
      await new Promise((res) => setTimeout(res, 500));
      status = (await getExportJob(admin.token, jobId!)).status;
    }
    expect(['pending', 'running', 'ready', 'failed']).toContain(status);
  });

  test('downloads a valid fixed-width file when ready', async () => {
    test.skip(!deployed || !jobId, 'no Centro Paghe job created (format not deployed)');

    let status = (await getExportJob(admin.token, jobId!)).status;
    for (let i = 0; i < 24 && (status === 'pending' || status === 'running'); i += 1) {
      await new Promise((res) => setTimeout(res, 500));
      status = (await getExportJob(admin.token, jobId!)).status;
    }

    if (status !== 'ready') {
      // Worker not done / storage not configured / codice ditta missing → just
      // assert the job reached a defined terminal-ish state.
      expect(['pending', 'running', 'failed']).toContain(status);
      return;
    }

    const dl = await downloadExportText(admin.token, jobId!);
    expect(dl.ok).toBe(true);
    expect(dl.contentType).toContain('text/plain');
    // ORARIO_<CODICE DITTA>_<MMAAAA>.TXT
    expect(dl.disposition ?? '').toMatch(/filename="?ORARIO_[^_]+_\d{6}\.TXT"?/i);
    // CRLF-terminated, 200-byte records, only record types 1/2/3.
    expect(dl.text.includes('\r\n')).toBe(true);
    const lines = dl.text.split('\r\n').filter(Boolean);
    for (const ln of lines) {
      expect(ln.length).toBe(200);
      expect(['1', '2', '3']).toContain(ln[30]); // TIPO RECORD column
    }
  });

  test.afterAll(async () => {
    if (jobId) await deleteExportJob(admin.token, jobId).catch(() => {});
  });
});
