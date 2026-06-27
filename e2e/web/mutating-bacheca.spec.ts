import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  loadHandleFromStorage,
  createBulletin,
  updateBulletin,
  listBulletinsAdmin,
  listMyBulletins,
  markBulletinRead,
  getBulletinReads,
  deleteBulletin,
  type ApiHandle,
} from '../fixtures/api-client';

// Mutating tests are gated behind E2E_MUTATING=1. They seed real Bacheca rows on
// the shared test tenant via the prod API (notifications OFF so no email/push is
// sent), assert the publish → read-receipt → targeting → scheduling behaviour,
// then delete what they created. Titles are 'e2e-'-prefixed by convention.
// NOTE: requires the NEW backend (migration 051 + the bulletins route) deployed.
const ENABLED = process.env.E2E_MUTATING === '1';

test.describe.configure({ mode: 'serial' });

test.describe('web — Bacheca: publish, read receipts, targeting, scheduling', () => {
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let user: ApiHandle;
  const created: string[] = [];

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    user = await loadHandleFromStorage(STORAGE.webUserAuth, CREDS.user);
  });

  test.afterAll(async () => {
    for (const id of created.splice(0)) {
      await deleteBulletin(admin.token, id).catch(() => {});
    }
  });

  test('admin publishes a message to all → recipient sees it unread', async () => {
    const marker = `e2e-bacheca-${Date.now()}`;
    const b = await createBulletin(admin.token, {
      title: marker,
      body_html: '<p>Hello <strong>team</strong>. <a href="https://sonoqui.app">link</a></p>',
      target_all: true,
    });
    created.push(b.id);
    expect(b.target_all).toBe(true);

    // Admin management list: counts present, nobody has read yet.
    const adminList = await listBulletinsAdmin(admin.token);
    const adminRow = adminList.find((x) => x.id === b.id);
    expect(adminRow, 'created bulletin in admin list').toBeTruthy();
    expect(adminRow!.recipient_count).toBeGreaterThanOrEqual(2); // admin + user (at least)
    expect(adminRow!.read_count).toBe(0);

    // Recipient feed: present, unread, body sanitized (link survives, script-free).
    const feed = await listMyBulletins(user.token);
    const item = feed.find((x) => x.id === b.id);
    expect(item, 'bulletin in recipient feed').toBeTruthy();
    expect(item!.read).toBe(false);
    expect(item!.body_html).toContain('href="https://sonoqui.app"');
  });

  test('recipient marks read → admin who-read reflects it', async () => {
    const marker = `e2e-bacheca-read-${Date.now()}`;
    const b = await createBulletin(admin.token, {
      title: marker,
      body_html: '<p>Please confirm.</p>',
      target_all: true,
    });
    created.push(b.id);

    await markBulletinRead(user.token, b.id);

    // Recipient sees it read now.
    const feed = await listMyBulletins(user.token);
    expect(feed.find((x) => x.id === b.id)?.read).toBe(true);

    // Admin who-read: the user has a read_at; count went up.
    const readers = await getBulletinReads(admin.token, b.id);
    const userReader = readers.find((r) => r.user_id === user.userId);
    expect(userReader, 'user appears in recipient list').toBeTruthy();
    expect(userReader!.read_at, 'user read_at is set').toBeTruthy();

    const adminRow = (await listBulletinsAdmin(admin.token)).find((x) => x.id === b.id);
    expect(adminRow!.read_count).toBeGreaterThanOrEqual(1);
  });

  test('targeted message reaches only its recipients', async () => {
    const marker = `e2e-bacheca-targeted-${Date.now()}`;
    const b = await createBulletin(admin.token, {
      title: marker,
      body_html: '<p>For the user only.</p>',
      target_all: false,
      user_ids: [user.userId],
    });
    created.push(b.id);
    expect(b.target_all).toBe(false);

    // The user (targeted) sees it; the admin (not targeted) does not.
    const userFeed = await listMyBulletins(user.token);
    expect(userFeed.some((x) => x.id === b.id), 'targeted user sees it').toBe(true);

    const adminFeed = await listMyBulletins(admin.token);
    expect(adminFeed.some((x) => x.id === b.id), 'non-targeted admin does not see it').toBe(false);
  });

  test('future-scheduled message is hidden until its start passes', async () => {
    const marker = `e2e-bacheca-scheduled-${Date.now()}`;
    const startAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // +1h
    const b = await createBulletin(admin.token, {
      title: marker,
      body_html: '<p>Not yet.</p>',
      target_all: true,
      start_at: startAt,
    });
    created.push(b.id);

    // Hidden from the recipient feed while scheduled…
    const feed = await listMyBulletins(user.token);
    expect(feed.some((x) => x.id === b.id), 'scheduled message hidden before start').toBe(false);

    // …but the admin still manages it (drafts/scheduled appear in the admin list).
    const adminRow = (await listBulletinsAdmin(admin.token)).find((x) => x.id === b.id);
    expect(adminRow, 'scheduled bulletin visible to admin management').toBeTruthy();
  });

  test('editing keeps read receipts', async () => {
    const marker = `e2e-bacheca-edit-${Date.now()}`;
    const b = await createBulletin(admin.token, {
      title: marker,
      body_html: '<p>Original.</p>',
      target_all: true,
    });
    created.push(b.id);
    await markBulletinRead(user.token, b.id);

    await updateBulletin(admin.token, b.id, {
      title: `${marker}-edited`,
      body_html: '<p>Edited body.</p>',
      target_all: true,
      user_ids: [],
      notify_email: false,
      notify_push: false,
    });

    const adminRow = (await listBulletinsAdmin(admin.token)).find((x) => x.id === b.id);
    expect(adminRow!.title).toContain('-edited');
    expect(adminRow!.read_count, 'read receipts preserved across edit').toBeGreaterThanOrEqual(1);
  });
});
