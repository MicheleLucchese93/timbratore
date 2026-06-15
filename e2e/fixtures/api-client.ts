/**
 * Thin API client for e2e mutation tests.
 *
 * Mutation tests are gated behind `process.env.E2E_MUTATING === '1'` —
 * they seed real rows on the test tenant via the prod API, exercise the
 * UI, then clean up.  Cleanup is best-effort: if a test fails before its
 * `afterAll` runs, the tenant accumulates a stale row.  That's acceptable
 * because the tenant has no real users yet.
 *
 * URLs default to the dev backend; override with env if you point e2e at
 * another stack.
 */

const AUTH_BASE = process.env.E2E_AUTH_URL ?? 'https://auth-sonoqui.xdevapp.it';
const API_BASE = process.env.E2E_API_URL ?? 'https://api-sonoqui.xdevapp.it';

export interface ApiHandle {
  token: string;
  userId: string;
  tenantId: string;
  branches: Array<{ id: string; name: string; smart_working: boolean }>;
}

export async function loginAs(email: string, password: string): Promise<ApiHandle> {
  const tok = await fetch(`${AUTH_BASE}/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!tok.ok) throw new Error(`GoTrue login failed for ${email}: ${tok.status}`);
  const { access_token } = (await tok.json()) as { access_token: string };
  return handleFromToken(access_token);
}

/**
 * Reuses the access token saved by the {web,mobile}{-user,}-setup project,
 * avoiding redundant GoTrue logins that trip rate limits when many
 * mutating specs run in a row. Falls back to `loginAs` if the storage
 * file is missing or the token is no longer valid.
 */
export async function loadHandleFromStorage(
  storagePath: string,
  fallback: { email: string; password: string },
): Promise<ApiHandle> {
  try {
    const { readFile } = await import('node:fs/promises');
    const text = await readFile(storagePath, 'utf8');
    const json = JSON.parse(text) as {
      origins?: Array<{ localStorage?: Array<{ name: string; value: string }> }>;
    };
    const items = json.origins?.[0]?.localStorage ?? [];
    const token = items.find((i) => i.name === 'sonoqui.access_token')?.value;
    if (token) {
      try {
        return await handleFromToken(token);
      } catch {
        /* token expired — fall through to fresh login */
      }
    }
  } catch {
    /* no file yet — fall through to fresh login */
  }
  return loginAs(fallback.email, fallback.password);
}

async function handleFromToken(token: string): Promise<ApiHandle> {
  const me = await apiGet<{
    user: { id: string };
    tenant: { id: string };
    branches: Array<{ id: string; name: string; smart_working: boolean }>;
  }>(token, '/api/v1/me');
  return {
    token,
    userId: me.user.id,
    tenantId: me.tenant.id,
    branches: me.branches ?? [],
  };
}

export async function apiGet<T>(token: string, path: string): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await r.json()) as { ok: boolean; data?: T; error?: { message?: string } };
  if (!r.ok || body.ok === false) {
    throw new Error(`GET ${path} → ${r.status}: ${body.error?.message ?? r.statusText}`);
  }
  return body.data as T;
}

export async function apiPost<T = unknown>(
  token: string,
  path: string,
  json: unknown,
): Promise<{ status: number; data: T | null; code?: string; message?: string }> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(json),
  });
  const text = await r.text();
  let parsed: { ok?: boolean; data?: T; error?: { code?: string; message?: string } } = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return {
    status: r.status,
    data: (parsed.data as T) ?? null,
    code: parsed.error?.code,
    message: parsed.error?.message,
  };
}

export async function apiPatch<T = unknown>(
  token: string,
  path: string,
  json: unknown,
): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(json),
  });
  const body = (await r.json()) as { ok: boolean; data?: T; error?: { message?: string } };
  if (!r.ok || body.ok === false) {
    throw new Error(`PATCH ${path} → ${r.status}: ${body.error?.message ?? r.statusText}`);
  }
  return body.data as T;
}

export async function apiDelete(token: string, path: string): Promise<void> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  // 404 on cleanup is fine — already gone.
  if (!r.ok && r.status !== 404) {
    const text = await r.text();
    throw new Error(`DELETE ${path} → ${r.status}: ${text}`);
  }
}

/* ---------------- Domain helpers ---------------- */

export interface CorrectionCreateBody {
  original_stamp_id: string | null;
  claimed_event_type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
  claimed_occurred_at: string;
  claimed_branch_id: string | null;
  justification: string;
}

export interface CorrectionRow {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'superseded';
}

export async function createCorrection(
  userToken: string,
  body: CorrectionCreateBody,
): Promise<CorrectionRow> {
  const r = await apiPost<CorrectionRow>(userToken, '/api/v1/correction-requests', body);
  if (r.status !== 201 || !r.data) {
    throw new Error(`createCorrection failed: ${r.status} ${r.code ?? ''}`);
  }
  return r.data;
}

export async function approveCorrection(
  adminToken: string,
  id: string,
): Promise<{ status: number; code?: string; data: { id?: string } | null }> {
  return apiPost(adminToken, `/api/v1/correction-requests/${id}/approve`, {});
}

export async function rejectCorrection(
  adminToken: string,
  id: string,
  resolutionNote?: string,
): Promise<{ status: number; code?: string; data: { id?: string } | null }> {
  return apiPost(adminToken, `/api/v1/correction-requests/${id}/reject`, {
    resolution_note: resolutionNote ?? 'e2e cleanup',
  });
}

export async function deleteStampAdmin(adminToken: string, stampId: string): Promise<void> {
  // The admin-stamps router accepts a deletion_reason in the body. The
  // route is DELETE /api/v1/admin/stamps/:id — we send a JSON body even
  // though DELETE bodies are unusual, because that's what the handler
  // expects.
  const r = await fetch(`${API_BASE}/api/v1/admin/stamps/${stampId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ deletion_reason: 'e2e cleanup' }),
  });
  if (!r.ok && r.status !== 404) {
    const text = await r.text();
    throw new Error(`deleteStampAdmin failed: ${r.status} ${text}`);
  }
}

export interface StampRow {
  id: string;
  user_id: string;
  event_type: string;
  occurred_at: string;
}

/** Admin list of stamps, filtered by user + date range (GET /stamps, admin-only). */
export async function listStampsAdmin(
  adminToken: string,
  query: { user_id: string; from?: string; to?: string; limit?: number },
): Promise<StampRow[]> {
  const p = new URLSearchParams({ user_id: query.user_id });
  if (query.from) p.set('from', query.from);
  if (query.to) p.set('to', query.to);
  if (query.limit != null) p.set('limit', String(query.limit));
  return apiGet<StampRow[]>(adminToken, `/api/v1/stamps?${p.toString()}`);
}

/**
 * Ensure an admin user has recent stamped days so the mobile Storico screen
 * renders its summary + per-day cards (e2e/mobile/storico.spec.ts:16). Storico
 * defaults to the last 30 days, so this is the window we keep populated.
 *
 * Idempotent: no-ops when the user already has any stamp inside the 30-day
 * window. Otherwise seeds the last 3 weekdays with a 09:00–17:00 Rome
 * (07:00–15:00Z = 8h) pair each via POST /admin/stamps. The e2e purge is scoped
 * to role='user', so these admin-baseline stamps survive teardown and only need
 * re-seeding when they age out of the window. Replaces the one-off manual prod
 * seed so the baseline is reproducible after a tenant reset. Returns the number
 * of day-pairs seeded (0 when already populated).
 */
export async function ensureRecentAdminStorico(adminToken: string, userId: string): Promise<number> {
  const today = new Date();
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - 29);
  const existing = await listStampsAdmin(adminToken, {
    user_id: userId,
    from: from.toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10),
    limit: 1,
  });
  if (existing.length > 0) return 0;

  const days: string[] = [];
  const d = new Date(today);
  while (days.length < 3) {
    d.setUTCDate(d.getUTCDate() - 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) days.push(d.toISOString().slice(0, 10));
  }

  let seeded = 0;
  for (const day of days) {
    const ci = await apiPost(adminToken, '/api/v1/admin/stamps', {
      user_id: userId,
      event_type: 'clock_in',
      occurred_at: `${day}T07:00:00.000Z`,
      justification: 'QA baseline storico',
    });
    const co = await apiPost(adminToken, '/api/v1/admin/stamps', {
      user_id: userId,
      event_type: 'clock_out',
      occurred_at: `${day}T15:00:00.000Z`,
      justification: 'QA baseline storico',
    });
    if (ci.status === 201 && co.status === 201) seeded += 1;
  }
  return seeded;
}

/* Leave quota helpers */

export interface QuotaTemplateBody {
  name: string;
  type: 'ferie' | 'permessi';
  hours_default: number;
  accrual_amount: number;
  accrual_frequency: 'monthly' | 'yearly';
  accrual_day_of_month: number;
  accrual_month?: number | null;
  active?: boolean;
}

export async function createQuotaTemplate(
  adminToken: string,
  body: QuotaTemplateBody,
): Promise<{ id: string }> {
  const r = await apiPost<{ id: string }>(adminToken, '/api/v1/leave-quotas/templates', body);
  if (r.status !== 201 || !r.data) throw new Error(`createQuotaTemplate failed: ${r.status}`);
  return r.data;
}

export async function deleteQuotaTemplate(adminToken: string, id: string): Promise<void> {
  await apiDelete(adminToken, `/api/v1/leave-quotas/templates/${id}`);
}

export async function assignQuota(
  adminToken: string,
  body: { user_id: string; template_id: string; initial_balance: number; started_on?: string },
): Promise<{ id: string }> {
  const r = await apiPost<{ id: string }>(adminToken, '/api/v1/leave-quotas/assignments', body);
  if (r.status !== 201 || !r.data) throw new Error(`assignQuota failed: ${r.status}`);
  return r.data;
}

export async function closeAssignment(adminToken: string, id: string): Promise<void> {
  await apiDelete(adminToken, `/api/v1/leave-quotas/assignments/${id}`);
}

export interface AccrualRow {
  id: number;
  type: 'ferie' | 'permessi';
  hours: number;
  accrued_on: string;
  source: 'cron' | 'manual' | 'adjustment';
  note: string | null;
  created_by_display_name: string | null;
  created_by_email: string | null;
}

/** Manual signed accrual: positive credits hours, negative debits them. */
export async function addManualAccrual(
  adminToken: string,
  assignmentId: string,
  body: { hours: number; note?: string; accrued_on?: string },
): Promise<AccrualRow> {
  const r = await apiPost<AccrualRow>(
    adminToken,
    `/api/v1/leave-quotas/assignments/${assignmentId}/accruals`,
    { source: 'manual', ...body },
  );
  if (r.status !== 201 || !r.data) {
    throw new Error(`addManualAccrual failed: ${r.status} ${r.code ?? ''} ${r.message ?? ''}`.trim());
  }
  return r.data;
}

export async function listUserAccruals(
  adminToken: string,
  userId: string,
): Promise<AccrualRow[]> {
  return apiGet<AccrualRow[]>(adminToken, `/api/v1/leave-quotas/users/${userId}/accruals`);
}

/* Leave-request helpers */

export interface LeaveCreateBody {
  type: 'ferie' | 'permessi' | 'malattia';
  from_ts: string;
  to_ts: string;
  /** All-day request — exempts permessi from the 15-min-multiple rule. */
  all_day?: boolean;
  inps_protocol?: string;
  user_note?: string;
}

export interface LeaveRow {
  id: string;
  status:
    | 'pending'
    | 'approved'
    | 'rejected'
    | 'cancelled'
    | 'cancellation_pending'
    | 'cancelled_post_approval'
    | 'superseded_by_malattia';
  type: 'ferie' | 'permessi' | 'malattia';
}

export async function createLeave(token: string, body: LeaveCreateBody): Promise<LeaveRow> {
  const r = await apiPost<LeaveRow>(token, '/api/v1/leaves', body);
  if (r.status !== 201 || !r.data) {
    throw new Error(
      `createLeave failed: ${r.status} ${r.code ?? ''} ${r.message ?? ''}`.trim()
    );
  }
  return r.data;
}

export interface BulkEventBody {
  title: string;
  from_ts: string;
  to_ts: string;
  deduct_ferie?: boolean;
  user_ids?: string[];
  user_note?: string;
}

export async function createBulkEvent(
  adminToken: string,
  body: BulkEventBody,
): Promise<{ batch_id: string; created_count: number; user_ids: string[] }> {
  const r = await apiPost<{ batch_id: string; created_count: number; user_ids: string[] }>(
    adminToken,
    '/api/v1/leaves/bulk',
    body,
  );
  if (r.status !== 201 || !r.data) {
    throw new Error(`createBulkEvent failed: ${r.status} ${r.code ?? ''} ${r.message ?? ''}`.trim());
  }
  return r.data;
}

export async function revokeBulkEvent(adminToken: string, batchId: string): Promise<void> {
  await apiPost(adminToken, `/api/v1/leaves/bulk/${batchId}/revoke`, {});
}

export async function approveLeave(adminToken: string, id: string): Promise<LeaveRow> {
  const r = await apiPost<LeaveRow>(adminToken, `/api/v1/leaves/${id}/approve`, {});
  if (r.status !== 200 || !r.data) throw new Error(`approveLeave failed: ${r.status}`);
  return r.data;
}

export async function adminRevokeLeave(adminToken: string, id: string, reason: string): Promise<void> {
  await apiPost(adminToken, `/api/v1/leaves/${id}/admin-revoke`, { reason });
}

/** Admin inserts an already-approved ferie/permesso on behalf of an employee. */
export async function adminCreateLeave(
  adminToken: string,
  body: {
    user_id: string;
    type: 'ferie' | 'permessi';
    from_ts: string;
    to_ts: string;
    user_note?: string;
  },
): Promise<LeaveRow> {
  const r = await apiPost<LeaveRow>(adminToken, '/api/v1/leaves/admin-create', body);
  if (!r.data?.id) {
    throw new Error(`adminCreateLeave failed: ${r.status} ${r.code ?? ''} ${r.message ?? ''}`.trim());
  }
  return r.data;
}

export interface LeaveListRow {
  id: string;
  user_id: string;
  status: string;
  type: string;
  from_ts: string;
  to_ts: string;
}

/** Admin list of leaves; server filters by user/status and date overlap (from/to). */
export async function listLeaves(
  adminToken: string,
  query: { scope?: string; status?: string; user_id?: string; from?: string; to?: string } = {},
): Promise<LeaveListRow[]> {
  const qs = new URLSearchParams(query as Record<string, string>).toString();
  return apiGet<LeaveListRow[]>(adminToken, `/api/v1/leaves${qs ? `?${qs}` : ''}`);
}

export async function requestLeaveCancellation(
  userToken: string,
  id: string,
  reason: string,
): Promise<LeaveRow> {
  const r = await apiPost<LeaveRow>(userToken, `/api/v1/leaves/${id}/request-cancellation`, {
    cancellation_reason: reason,
  });
  if (r.status !== 200 || !r.data) throw new Error(`requestCancellation failed: ${r.status}`);
  return r.data;
}

/* Branches helpers */

export interface BranchCreateBody {
  name: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  radius_m: number;
  enforce_radius?: boolean;
  smart_working: boolean;
}

export async function createBranch(
  adminToken: string,
  body: BranchCreateBody,
): Promise<{ id: string; name: string }> {
  const r = await apiPost<{ id: string; name: string }>(adminToken, '/api/v1/branches', body);
  if (r.status !== 201 || !r.data) throw new Error(`createBranch failed: ${r.status}`);
  return r.data;
}

export async function deleteBranch(adminToken: string, id: string): Promise<void> {
  await apiDelete(adminToken, `/api/v1/branches/${id}`);
}

/* User invite/deactivate helpers */

export async function inviteUser(
  adminToken: string,
  body: { email: string; role?: 'admin' | 'user'; first_name?: string; last_name?: string; branch_ids?: string[] },
): Promise<{ user_id: string; email: string }> {
  const r = await apiPost<{ user_id: string; email: string }>(adminToken, '/api/v1/users/invite', body);
  if (r.status !== 201 || !r.data) throw new Error(`inviteUser failed: ${r.status} ${r.code ?? ''}`);
  return r.data;
}

export async function deleteUser(adminToken: string, userId: string): Promise<void> {
  await apiDelete(adminToken, `/api/v1/users/${userId}`);
}

/* Bulk user-attribute helpers */

export async function bulkResetPassword(
  adminToken: string,
  userIds: string[],
): Promise<{ status: number; data: { sent: number } | null }> {
  return apiPost<{ sent: number }>(adminToken, '/api/v1/users/reset-password/bulk', {
    user_ids: userIds,
  });
}

export async function bulkSetStampModes(
  adminToken: string,
  userIds: string[],
  stampModes: Array<'gps' | 'remote'>,
): Promise<{ status: number; data: { updated: number } | null }> {
  return apiPost<{ updated: number }>(adminToken, '/api/v1/users/stamp-modes/bulk', {
    user_ids: userIds,
    stamp_modes: stampModes,
  });
}

export async function bulkSetApprovers(
  adminToken: string,
  body: { user_ids: string[]; kind: 'leave' | 'correction'; approver_user_ids: string[] },
): Promise<{ status: number }> {
  return apiPost(adminToken, '/api/v1/users/approvers/bulk', body);
}

export async function bulkAssignShift(
  adminToken: string,
  body: { user_ids: string[]; shift_template_id: string | null; valid_from: string },
): Promise<{ status: number }> {
  return apiPost(adminToken, '/api/v1/shifts/assignments/bulk', body);
}

/* Quota summary helper */

export interface QuotaSummary {
  type: 'ferie' | 'permessi';
  residual_strict: number;
  residual_with_pending: number;
}

export async function getMyQuotaSummary(userToken: string): Promise<QuotaSummary[]> {
  return apiGet<QuotaSummary[]>(userToken, '/api/v1/leave-quotas/me/summary');
}

/* Cancellation-decide helper */

export async function decideLeaveCancellation(
  approverToken: string,
  id: string,
  approve: boolean,
  reason?: string,
): Promise<LeaveRow> {
  const r = await apiPost<LeaveRow>(approverToken, `/api/v1/leaves/${id}/decide-cancellation`, {
    approve,
    reason: reason ?? '',
  });
  if (r.status !== 200 || !r.data) throw new Error(`decideLeaveCancellation failed: ${r.status}`);
  return r.data;
}

/* Realtime poll helper */

export async function pollRealtime(
  token: string,
  since: string | null,
): Promise<{ events: Array<{ id: string; channel: string; payload: unknown }>; last_id: string | null }> {
  const path = since ? `/api/v1/realtime/since?since=${encodeURIComponent(since)}` : '/api/v1/realtime/since';
  return apiGet(token, path);
}

/* Export job helpers */

export async function createExportJob(
  adminToken: string,
  body: { format: 'xlsx' | 'json' | 'centro'; period_from: string; period_to: string },
): Promise<{ id: string; status: string }> {
  const r = await apiPost<{ id: string; status: string }>(adminToken, '/api/v1/exports', body);
  if (r.status !== 201 || !r.data) throw new Error(`createExportJob failed: ${r.status}`);
  return r.data;
}

/** Raw create — returns the HTTP status so callers can detect a pre-deploy 400
 *  (e.g. the 'centro' format not yet rolled out to the API under test). */
export async function createExportJobRaw(
  adminToken: string,
  body: { format: 'xlsx' | 'json' | 'centro'; period_from: string; period_to: string },
): Promise<{ status: number; data: { id: string; status: string } | null; message?: string }> {
  return apiPost<{ id: string; status: string }>(adminToken, '/api/v1/exports', body);
}

/** Download a text/fixed-width export (Centro Paghe). Returns body as latin1
 *  text plus the headers needed to assert content-type + filename. */
export async function downloadExportText(
  adminToken: string,
  id: string,
): Promise<{ ok: boolean; status: number; contentType: string | null; disposition: string | null; text: string }> {
  const r = await fetch(`${API_BASE}/api/v1/exports/${id}/download`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const text = r.ok ? Buffer.from(await r.arrayBuffer()).toString('latin1') : '';
  return {
    ok: r.ok,
    status: r.status,
    contentType: r.headers.get('content-type'),
    disposition: r.headers.get('content-disposition'),
    text,
  };
}

export async function getExportJob(adminToken: string, id: string): Promise<{ id: string; status: string; r2_key?: string | null }> {
  return apiGet(adminToken, `/api/v1/exports/${id}`);
}

export async function deleteExportJob(adminToken: string, id: string): Promise<void> {
  return apiDelete(adminToken, `/api/v1/exports/${id}`);
}

export async function downloadExport(
  adminToken: string,
  id: string,
): Promise<{ ok: boolean; status: number; contentType: string | null; isZip: boolean }> {
  const r = await fetch(`${API_BASE}/api/v1/exports/${id}/download`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  let isZip = false;
  if (r.ok) {
    const buf = Buffer.from(await r.arrayBuffer());
    // XLSX is a ZIP container — first two bytes are 'PK'.
    isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
  }
  return { ok: r.ok, status: r.status, contentType: r.headers.get('content-type'), isZip };
}

export interface ExportDay {
  day: string;
  worked_minutes: number;
  overtime_minutes: number;
}
export interface ExportUser {
  user_id: string;
  email: string;
  days: ExportDay[];
}
export interface ExportJson {
  users: ExportUser[];
}

/** Download a JSON-format export and parse its body (the per-user/day aggregate). */
export async function downloadExportJson(adminToken: string, id: string): Promise<ExportJson> {
  const r = await fetch(`${API_BASE}/api/v1/exports/${id}/download`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!r.ok) throw new Error(`downloadExportJson failed: ${r.status}`);
  return JSON.parse(await r.text()) as ExportJson;
}

/* Shift template + assignment helpers */

export interface ShiftSlot {
  day_of_week: number; // ISO 1..7 (Mon..Sun)
  start_time: string; // HH:MM
  end_time: string; // HH:MM
}

export async function createShiftTemplate(
  adminToken: string,
  body: {
    name: string;
    slots: ShiftSlot[];
    description?: string;
    tolerance_in_min?: number;
    tolerance_out_min?: number;
    tolerance_in_breach_deduct_min?: number;
    tolerance_out_breach_deduct_min?: number;
    count_extraordinary?: boolean;
    // Orario flessibile (flextime) + per-weekday auto-deduct lunch.
    flexible_enabled?: boolean;
    flex_in_before_min?: number;
    flex_in_after_min?: number;
    flex_out_before_min?: number;
    flex_out_after_min?: number;
    flex_lunch_before_min?: number;
    flex_lunch_after_min?: number;
    day_lunch?: Array<{ day_of_week: number; lunch_min: number }>;
  },
): Promise<{ id: string }> {
  const r = await apiPost<{ id: string }>(adminToken, '/api/v1/shifts/templates', body);
  if (r.status !== 201 || !r.data) throw new Error(`createShiftTemplate failed: ${r.status}`);
  return r.data;
}

export async function deleteShiftTemplate(adminToken: string, id: string): Promise<void> {
  await apiDelete(adminToken, `/api/v1/shifts/templates/${id}`);
}

export async function assignShift(
  adminToken: string,
  body: { user_id: string; shift_template_id: string | null; valid_from: string },
): Promise<void> {
  await apiPost(adminToken, '/api/v1/shifts/assignments', body);
}

/* ---------------- HR documents helpers ---------------- */

export type DocumentCategory = 'cedolino' | 'cu' | 'contratto' | 'comunicazione' | 'altro';

/** Mirrors the `documents` table row (packages/shared documents/index.ts). */
export interface DocumentRecord {
  id: string;
  tenant_id: string;
  user_id: string;
  uploaded_by: string;
  category: DocumentCategory;
  title: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  r2_key: string;
  retention_until: string;
  created_at: string;
  deleted_at: string | null;
}

/** Employee view: record + first-open timestamp (null until first download). */
export interface DocumentListItem extends DocumentRecord {
  viewed_at: string | null;
}

/** Admin view: adds view_count + target display name. */
export interface DocumentAdminItem extends DocumentListItem {
  view_count: number;
  user_display_name?: string;
}

/**
 * Smallest buffer the upload endpoint accepts: it only validates the leading
 * `%PDF` magic bytes (and a <=15MB size cap), so a one-line PDF header is a
 * valid in-memory fixture — no need to ship a real PDF file.
 */
export function minimalPdfBuffer(): Buffer {
  return Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'utf8');
}

/**
 * Admin uploads one PDF for a target employee. The body is the raw binary;
 * metadata travels in X-Doc-* headers (title/filename URI-encoded). Titles
 * MUST stay 'e2e-'-prefixed so /api/v1/_internal/e2e/purge-fixtures sweeps them.
 */
export async function uploadDocument(
  adminToken: string,
  opts: {
    userId: string;
    category: DocumentCategory;
    title: string;
    filename: string;
    pdfBuffer?: Buffer;
  },
): Promise<DocumentRecord> {
  const buf = opts.pdfBuffer ?? minimalPdfBuffer();
  const r = await fetch(`${API_BASE}/api/v1/documents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/pdf',
      'X-Doc-User-Id': opts.userId,
      'X-Doc-Category': opts.category,
      'X-Doc-Title': encodeURIComponent(opts.title),
      'X-Doc-Filename': encodeURIComponent(opts.filename),
    },
    // Uint8Array view keeps fetch's BodyInit type happy for a Node Buffer.
    body: new Uint8Array(buf),
  });
  const text = await r.text();
  let parsed: { ok?: boolean; data?: DocumentRecord; error?: { message?: string } } = {};
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    /* non-JSON */
  }
  if (!r.ok || parsed.ok === false || !parsed.data) {
    throw new Error(`uploadDocument failed: ${r.status} ${parsed.error?.message ?? text.slice(0, 200)}`);
  }
  return parsed.data;
}

/** Admin document list, optionally filtered by target user. NEVER records a view. */
export async function listDocumentsAdmin(
  adminToken: string,
  userId?: string,
): Promise<DocumentAdminItem[]> {
  const qs = userId ? `?user_id=${encodeURIComponent(userId)}` : '';
  return apiGet<DocumentAdminItem[]>(adminToken, `/api/v1/documents${qs}`);
}

/** Employee's own documents (GET /documents/me). NEVER records a view. */
export async function listMyDocuments(userToken: string): Promise<DocumentListItem[]> {
  return apiGet<DocumentListItem[]>(userToken, '/api/v1/documents/me');
}

/**
 * Fetch a presigned download URL. Side effect: when the caller is the OWNING
 * employee, the backend records a view (ON CONFLICT DO NOTHING). Admin
 * downloads MUST NOT record a view — that asymmetry is what the specs assert,
 * so callers pass whichever handle's token they want to exercise.
 */
export async function downloadDocument(
  token: string,
  id: string,
): Promise<{ url: string; expires_in: number }> {
  return apiGet<{ url: string; expires_in: number }>(token, `/api/v1/documents/${id}/download`);
}

/** Admin soft-deletes a document (row deleted_at + R2 object removed). */
export async function deleteDocument(adminToken: string, id: string): Promise<void> {
  await apiDelete(adminToken, `/api/v1/documents/${id}`);
}

/* Approver-assignment helpers */

export async function setLeaveApprovers(
  adminToken: string,
  userId: string,
  approverUserIds: string[],
): Promise<void> {
  const r = await fetch(`${API_BASE}/api/v1/users/${userId}/approvers`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ approver_user_ids: approverUserIds }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`setLeaveApprovers failed: ${r.status} ${text}`);
  }
}
