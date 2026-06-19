import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  deleteDocument,
  downloadDocument,
  downloadDocumentRaw,
  getDocumentOtpStatus,
  listDocumentsAdmin,
  listDocumentsAllRaw,
  loadHandleFromStorage,
  requestDocumentOtp,
  ensureDocumentOtp,
  setDocumentale,
  uploadDocument,
  verifyDocumentOtp,
  type ApiHandle,
  type DocumentRecord,
} from '../fixtures/api-client';

// Mutating tests are gated behind E2E_MUTATING=1. They exercise the post-
// hardening document model: documents are own-only for everyone, and managing /
// viewing all employees' documents requires the additive Documentale capability
// + an emailed OTP. Titles are 'e2e-'-prefixed so the globalTeardown purge sweeps
// any survivor of a mid-run crash. NOTE: requires the NEW backend (migration 042
// + the documents-route rewrite) deployed to the API under test.
const ENABLED = process.env.E2E_MUTATING === '1';
// OTP-gated assertions need the backend running with E2E_FIXED_OTP pinned to the
// test tenant (see apps/backend/src/routes/documents.ts generateOtp). Without it
// a Documentale cannot pass the gate, so those tests skip.
const FIXED_OTP = process.env.E2E_FIXED_OTP ?? '';
const OTP_ENABLED = ENABLED && /^\d{6}$/.test(FIXED_OTP);

test.describe.configure({ mode: 'serial' });

test.describe('web — Documenti: Documentale capability + OTP + access hardening', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  // test1 (admin) doubles as the Documentale actor via self-grant; test3 is the
  // base employee who OWNS the documents.
  let admin: ApiHandle;
  let user: ApiHandle;
  const created: DocumentRecord[] = [];

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
    // Clean slate on the shared tenant: nobody holds the capability yet.
    await setDocumentale(admin.token, user.userId, false).catch(() => {});
    await setDocumentale(admin.token, admin.userId, false).catch(() => {});
  });

  test.afterAll(async () => {
    // Delete needs Documentale + OTP; otherwise the 'e2e-'-titled rows are swept
    // by the purge teardown. Then return the tenant to baseline (no capability).
    if (OTP_ENABLED) {
      await setDocumentale(admin.token, admin.userId, true).catch(() => {});
      await ensureDocumentOtp(admin.token, FIXED_OTP).catch(() => {});
      for (const doc of created.splice(0)) {
        await deleteDocument(admin.token, doc.id).catch(() => {});
      }
    }
    await setDocumentale(admin.token, user.userId, false).catch(() => {});
    await setDocumentale(admin.token, admin.userId, false).catch(() => {});
  });

  test('plain admin (no capability) is locked out of the all-documents surface', async () => {
    // Hardening req #1: an admin WITHOUT the Documentale capability cannot list
    // other employees' documents — same as a base user.
    await setDocumentale(admin.token, admin.userId, false);
    const list = await listDocumentsAllRaw(admin.token);
    expect(list.status).toBe(403);
    expect(list.code).toBe('DOCUMENTALE_REQUIRED');
  });

  test('Documentale can upload a document (no OTP needed to upload)', async () => {
    const grant = await setDocumentale(admin.token, admin.userId, true);
    expect(grant.status).toBe(200);
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
    expect(new Date(doc.retention_until).getTime()).toBeGreaterThan(Date.now());
  });

  test('per-tenant Documentale cap (default 1) rejects a second grant', async () => {
    await setDocumentale(admin.token, admin.userId, true); // admin holds the single slot
    const second = await setDocumentale(admin.token, user.userId, true);
    expect(second.status).toBe(409);
    expect(second.code).toBe('LIMIT_REACHED');
    await setDocumentale(admin.token, user.userId, false).catch(() => {});
  });

  test("non-owner download of another user's doc is 404 without the capability", async () => {
    // Seed a doc as Documentale, then strip the capability and confirm a plain
    // admin gets 404 (not 403) — never even learns the document exists.
    await setDocumentale(admin.token, admin.userId, true);
    const marker = `e2e-doc-foreign-${Date.now()}`;
    const doc = await uploadDocument(admin.token, {
      userId: user.userId,
      category: 'altro',
      title: marker,
      filename: `${marker}.pdf`,
    });
    created.push(doc);
    await setDocumentale(admin.token, admin.userId, false);
    const dl = await downloadDocumentRaw(admin.token, doc.id);
    expect(dl.status).toBe(404);
    await setDocumentale(admin.token, admin.userId, true); // restore for later tests/cleanup
  });

  test('OTP gate blocks the document list until a code is verified', async () => {
    test.skip(!OTP_ENABLED, 'set E2E_FIXED_OTP (and deploy it) to enable OTP tests');
    await setDocumentale(admin.token, admin.userId, true);
    const status0 = await getDocumentOtpStatus(admin.token);
    if (!status0.verified) {
      const blocked = await listDocumentsAllRaw(admin.token);
      expect(blocked.status).toBe(403);
      expect(blocked.code).toBe('OTP_REQUIRED');
    }
    const req = await requestDocumentOtp(admin.token);
    expect(req.status).toBe(200);
    const wrong = FIXED_OTP === '000001' ? '999998' : '000001';
    const bad = await verifyDocumentOtp(admin.token, wrong);
    expect(bad.status).toBeGreaterThanOrEqual(400);
    const good = await verifyDocumentOtp(admin.token, FIXED_OTP);
    expect(good.status).toBe(200);
    expect(good.data?.verified).toBe(true);
    const ok = await listDocumentsAllRaw(admin.token);
    expect(ok.status).toBe(200);
  });

  test('Documentale view does NOT flip the read-receipt; only the owner does', async () => {
    test.skip(!OTP_ENABLED, 'set E2E_FIXED_OTP (and deploy it) to enable OTP tests');
    await setDocumentale(admin.token, admin.userId, true);
    await ensureDocumentOtp(admin.token, FIXED_OTP);

    const marker = `e2e-doc-receipt-${Date.now()}`;
    const doc = await uploadDocument(admin.token, {
      userId: user.userId,
      category: 'cedolino',
      title: marker,
      filename: `${marker}.pdf`,
    });
    created.push(doc);

    // Documentale opens the employee's doc → audit-logged, but NO receipt.
    const dlDoc = await downloadDocument(admin.token, doc.id);
    expect(dlDoc.url.length).toBeGreaterThan(0);
    let list = await listDocumentsAdmin(admin.token, user.userId);
    let row = list.find((d) => d.id === doc.id);
    expect(row?.viewed_at, 'Documentale view must not flip the receipt').toBeNull();
    expect(row?.view_count).toBe(0);

    // The OWNER opening it flips the receipt.
    await downloadDocument(user.token, doc.id);
    list = await listDocumentsAdmin(admin.token, user.userId);
    row = list.find((d) => d.id === doc.id);
    expect(row?.viewed_at, 'owner view flips the receipt').not.toBeNull();
    expect(row?.view_count).toBeGreaterThanOrEqual(1);
  });
});
