import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../../fixtures/test-data';
import {
  deleteDocument,
  downloadDocument,
  listMyDocuments,
  loadHandleFromStorage,
  uploadDocument,
  type ApiHandle,
  type DocumentRecord,
} from '../../fixtures/api-client';

// Employee-side documents lifecycle. Gated behind E2E_MUTATING=1: an admin
// handle (loaded via GoTrue, independent of the web-user storageState) seeds a
// PDF for test3, then we assert the employee can see + download ONLY their own
// doc and that the first download flips viewed_at. Titles are 'e2e-'-prefixed
// for the teardown purge.
const ENABLED = process.env.E2E_MUTATING === '1';

test.describe('web — I miei documenti (employee)', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let user: ApiHandle;
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

  test('GET /documents/me returns the employee\'s own doc; first download sets viewed_at', async () => {
    const marker = `e2e-mydoc-${Date.now()}`;
    const doc = await uploadDocument(admin.token, {
      userId: user.userId,
      category: 'cu',
      title: marker,
      filename: `${marker}.pdf`,
    });
    created.push(doc);

    // The employee sees it, and every row in /me is owned by them.
    const mineBefore = await listMyDocuments(user.token);
    for (const row of mineBefore) {
      expect(row.user_id, '/documents/me must only return the caller\'s own docs').toBe(user.userId);
    }
    const mineRowBefore = mineBefore.find((d) => d.id === doc.id);
    expect(mineRowBefore, `employee should see ${marker} in /me`).toBeDefined();
    expect(mineRowBefore!.viewed_at, 'not viewed until first download').toBeNull();

    // Download returns a presigned URL with a 60s TTL (contract shape).
    const dl = await downloadDocument(user.token, doc.id);
    expect(typeof dl.url).toBe('string');
    expect(dl.url.length).toBeGreaterThan(0);
    expect(dl.expires_in).toBe(60);

    // After the owning employee downloads, viewed_at is set.
    const mineAfter = await listMyDocuments(user.token);
    const mineRowAfter = mineAfter.find((d) => d.id === doc.id);
    expect(mineRowAfter, `employee should still see ${marker}`).toBeDefined();
    expect(mineRowAfter!.viewed_at, 'first download records the view').not.toBeNull();
  });

  test('a doc uploaded for another user does NOT appear in this employee\'s /me list', async () => {
    // Upload targeting the admin (test1) instead of test3, then confirm test3's
    // /me list never surfaces it — the RLS ownership scope, exercised end-to-end.
    const marker = `e2e-othersdoc-${Date.now()}`;
    const doc = await uploadDocument(admin.token, {
      userId: admin.userId,
      category: 'contratto',
      title: marker,
      filename: `${marker}.pdf`,
    });
    created.push(doc);

    const mine = await listMyDocuments(user.token);
    expect(
      mine.some((d) => d.id === doc.id),
      "another user's document must not leak into /documents/me",
    ).toBe(false);
  });
});
