import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  deleteDocument,
  downloadDocument,
  listDocumentsAdmin,
  loadHandleFromStorage,
  uploadDocument,
  type ApiHandle,
  type DocumentRecord,
} from '../fixtures/api-client';

// Mutating tests are gated behind E2E_MUTATING=1 — they upload real PDF rows
// (+ an R2 object) for the test tenant via the API, assert the
// admin/employee/view lifecycle, then clean up. Titles are 'e2e-'-prefixed so
// the globalTeardown purge sweeps any survivor of a mid-run crash.
// See e2e/summary.md "Mutating specs" for the cleanup policy.
const ENABLED = process.env.E2E_MUTATING === '1';

test.describe('web — Documenti HR upload/view lifecycle (admin)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let user: ApiHandle;
  // Docs created across the suite — cleaned up regardless of which assertion fails.
  const created: DocumentRecord[] = [];

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
  });

  test.afterAll(async () => {
    for (const doc of created.splice(0)) {
      await deleteDocument(admin.token, doc.id).catch(() => {
        /* best-effort — teardown purge is the safety net */
      });
    }
  });

  test('admin upload → appears in admin list with viewed_at null; employee view sets viewed_at', async () => {
    const marker = `e2e-doc-${Date.now()}`;
    const doc = await uploadDocument(admin.token, {
      userId: user.userId,
      category: 'cedolino',
      title: marker,
      filename: `${marker}.pdf`,
    });
    created.push(doc);

    expect(doc.user_id).toBe(user.userId);
    expect(doc.category).toBe('cedolino');
    expect(doc.title).toBe(marker);
    // retention_until is created_at + 36 months → strictly in the future.
    expect(new Date(doc.retention_until).getTime()).toBeGreaterThan(Date.now());

    // Admin list (filtered by the target user) shows it, not yet viewed.
    const beforeView = await listDocumentsAdmin(admin.token, user.userId);
    const adminRowBefore = beforeView.find((d) => d.id === doc.id);
    expect(adminRowBefore, `admin list should contain ${marker}`).toBeDefined();
    expect(adminRowBefore!.viewed_at).toBeNull();
    expect(adminRowBefore!.view_count).toBe(0);

    // Simulate the employee opening the document (download as the USER handle
    // records a view). The presigned URL shape is asserted in the user spec;
    // here we only care about the view side effect.
    const dl = await downloadDocument(user.token, doc.id);
    expect(typeof dl.url).toBe('string');
    expect(dl.url.length).toBeGreaterThan(0);
    expect(dl.expires_in).toBe(60);

    // Admin list now reflects the view.
    const afterView = await listDocumentsAdmin(admin.token, user.userId);
    const adminRowAfter = afterView.find((d) => d.id === doc.id);
    expect(adminRowAfter, `admin list should still contain ${marker}`).toBeDefined();
    expect(adminRowAfter!.viewed_at).not.toBeNull();
    expect(adminRowAfter!.view_count).toBeGreaterThanOrEqual(1);
  });

  test('admin download does NOT record a view (viewed_at stays null)', async () => {
    const marker = `e2e-doc-adminview-${Date.now()}`;
    const doc = await uploadDocument(admin.token, {
      userId: user.userId,
      category: 'comunicazione',
      title: marker,
      filename: `${marker}.pdf`,
    });
    created.push(doc);

    // Admin downloads the doc — by contract this must NOT insert a view row.
    const dl = await downloadDocument(admin.token, doc.id);
    expect(typeof dl.url).toBe('string');
    expect(dl.url.length).toBeGreaterThan(0);

    const list = await listDocumentsAdmin(admin.token, user.userId);
    const row = list.find((d) => d.id === doc.id);
    expect(row, `admin list should contain ${marker}`).toBeDefined();
    expect(row!.viewed_at, 'admin download must not count as a view').toBeNull();
    expect(row!.view_count).toBe(0);
  });

  test('admin DELETE removes the doc from the admin list', async () => {
    const marker = `e2e-doc-delete-${Date.now()}`;
    const doc = await uploadDocument(admin.token, {
      userId: user.userId,
      category: 'altro',
      title: marker,
      filename: `${marker}.pdf`,
    });
    // Not pushed to `created`: we delete it inline here and assert it's gone.

    const before = await listDocumentsAdmin(admin.token, user.userId);
    expect(before.some((d) => d.id === doc.id)).toBe(true);

    await deleteDocument(admin.token, doc.id);

    const after = await listDocumentsAdmin(admin.token, user.userId);
    expect(after.some((d) => d.id === doc.id), 'soft-deleted doc must drop from the list').toBe(false);
  });
});
