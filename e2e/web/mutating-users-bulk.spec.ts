import { test, expect } from '@playwright/test';
import { CREDS, STORAGE } from '../fixtures/test-data';
import {
  apiGet,
  bulkAssignShift,
  bulkResetPassword,
  bulkSetApprovers,
  bulkSetStampModes,
  createShiftTemplate,
  deleteShiftTemplate,
  deleteUser,
  inviteUser,
  loadHandleFromStorage,
  type ApiHandle,
} from '../fixtures/api-client';

// Bulk user operations: reset-password / stamp-modes / approvers / shift.
// Seeds two throwaway members + one shift template, exercises each bulk
// endpoint at the API level, and asserts the effect via GET. Mutating-gated.
const ENABLED = process.env.E2E_MUTATING === '1';

interface UserRow {
  user_id: string;
  stamp_modes: string[];
}

interface AssignmentRow {
  user_id: string;
  shift_template_id: string;
  valid_to: string | null;
}

test.describe('web — Utenti bulk operations (mutating)', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!ENABLED, 'set E2E_MUTATING=1 to enable mutating specs');

  let admin: ApiHandle;
  let u1: string;
  let u2: string;
  let templateId: string;

  test.beforeAll(async () => {
    admin = await loadHandleFromStorage(STORAGE.webAuth, CREDS.admin);
    const a = await inviteUser(admin.token, { email: `e2e-bulk-a-${Date.now()}@e2e.local` });
    const b = await inviteUser(admin.token, { email: `e2e-bulk-b-${Date.now()}@e2e.local` });
    u1 = a.user_id;
    u2 = b.user_id;
    const tpl = await createShiftTemplate(admin.token, {
      name: `e2e-bulk-shift-${Date.now()}`,
      slots: [{ day_of_week: 1, start_time: '09:00', end_time: '17:00' }],
    });
    templateId = tpl.id;
  });

  test.afterAll(async () => {
    await Promise.allSettled([
      u1 ? deleteUser(admin.token, u1) : Promise.resolve(),
      u2 ? deleteUser(admin.token, u2) : Promise.resolve(),
      templateId ? deleteShiftTemplate(admin.token, templateId) : Promise.resolve(),
    ]);
  });

  test('bulk reset-password emails every selected member', async () => {
    const r = await bulkResetPassword(admin.token, [u1, u2]);
    expect(r.status).toBe(200);
    expect(r.data?.sent).toBe(2);
  });

  test('bulk stamp-modes overwrites modes on all selected', async () => {
    const r = await bulkSetStampModes(admin.token, [u1, u2], ['remote']);
    expect(r.status).toBe(200);
    const list = await apiGet<UserRow[]>(admin.token, '/api/v1/users');
    for (const id of [u1, u2]) {
      const row = list.find((u) => u.user_id === id);
      expect(row?.stamp_modes ?? []).toEqual(['remote']);
    }
  });

  test('bulk approvers (leave) replaces approver list on all selected', async () => {
    const r = await bulkSetApprovers(admin.token, {
      user_ids: [u1, u2],
      kind: 'leave',
      approver_user_ids: [admin.userId],
    });
    expect(r.status).toBe(200);
    for (const id of [u1, u2]) {
      const rows = await apiGet<Array<{ user_id: string }>>(
        admin.token,
        `/api/v1/users/${id}/approvers`,
      );
      expect(rows.map((x) => x.user_id)).toContain(admin.userId);
    }
  });

  test('bulk shift assigns the same template to all selected', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = await bulkAssignShift(admin.token, {
      user_ids: [u1, u2],
      shift_template_id: templateId,
      valid_from: today,
    });
    expect(r.status).toBe(201);
    const assignments = await apiGet<AssignmentRow[]>(admin.token, '/api/v1/shifts/assignments');
    for (const id of [u1, u2]) {
      const active = assignments.find((a) => a.user_id === id && a.valid_to === null);
      expect(active?.shift_template_id).toBe(templateId);
    }
  });
});
