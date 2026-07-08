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

import { romeWallClockISO } from './time';

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
 * window. Otherwise seeds the last 3 weekdays with a 09:00–17:00 Rome-local
 * (= 8h, DST-correct) pair each via POST /admin/stamps. The e2e purge is scoped
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
    const base = new Date(`${day}T12:00:00.000Z`); // noon UTC → unambiguous day
    const ci = await apiPost(adminToken, '/api/v1/admin/stamps', {
      user_id: userId,
      event_type: 'clock_in',
      occurred_at: romeWallClockISO(base, 9).iso, // 09:00 Rome
      justification: 'QA baseline storico',
    });
    const co = await apiPost(adminToken, '/api/v1/admin/stamps', {
      user_id: userId,
      event_type: 'clock_out',
      occurred_at: romeWallClockISO(base, 17).iso, // 17:00 Rome (8h)
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
  body: {
    email: string;
    role?: 'admin' | 'user';
    language?: 'it' | 'en';
    first_name?: string;
    last_name?: string;
    branch_ids?: string[];
    external_id?: string;
    codice_fiscale?: string;
    matricola?: string;
    inail?: string;
    qualifica?: string;
    qualifica2?: string;
    // The /invite endpoint defaults this to true (sends the access email — an
    // invitation for a brand-new member, a reset for a confirmed one). e2e seeds
    // throw-away @e2e.local users in bulk, so default it OFF here to avoid firing
    // real emails for every fixture — tests that want to exercise the email path
    // pass send_reset_email: true explicitly.
    send_reset_email?: boolean;
  },
): Promise<{
  user_id: string;
  email: string;
  email_sent?: boolean;
  email_type?: 'invite' | 'recovery' | 'membership' | 'none';
}> {
  const r = await apiPost<{
    user_id: string;
    email: string;
    email_sent?: boolean;
    email_type?: 'invite' | 'recovery' | 'none';
  }>(
    adminToken,
    '/api/v1/users/invite',
    { send_reset_email: false, ...body },
  );
  if (r.status !== 201 || !r.data) throw new Error(`inviteUser failed: ${r.status} ${r.code ?? ''}`);
  return r.data;
}

export async function deleteUser(adminToken: string, userId: string): Promise<void> {
  await apiDelete(adminToken, `/api/v1/users/${userId}`);
}

// Provision a CONFIRMED GoTrue account (password set → email_confirmed) enrolled
// in the test tenant, via the e2e-only /create-fixture-user endpoint. Returns the
// user_id so callers can manipulate the membership (e.g. deactivate then re-invite
// to exercise the "existing confirmed user" branch). Requires E2E_PURGE_SECRET
// (prod-mutating tier only). Email must match the e2e-*@e2e.local pattern.
export async function createConfirmedFixtureUser(
  email: string,
  role: 'admin' | 'user' = 'user',
): Promise<{ user_id: string; email: string }> {
  const secret = process.env.E2E_PURGE_SECRET;
  if (!secret) throw new Error('E2E_PURGE_SECRET is required to create a confirmed fixture user');
  const r = await fetch(`${API_BASE}/api/v1/_internal/e2e/create-fixture-user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ email, password: 'Test123@!', role }),
  });
  if (!r.ok) throw new Error(`create-fixture-user ${r.status}: ${await r.text()}`);
  const body = (await r.json()) as { data?: { user_id: string; email: string } };
  if (!body.data?.user_id) throw new Error('create-fixture-user returned no user_id');
  return body.data;
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
 * Documentale uploads one PDF for a target employee. The body is the raw binary;
 * metadata travels in the query string. Titles MUST stay 'e2e-'-prefixed so
 * /api/v1/_internal/e2e/purge-fixtures sweeps them.
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
  const qs = new URLSearchParams({
    user_id: opts.userId,
    category: opts.category,
    title: opts.title,
    filename: opts.filename,
  });
  const r = await fetch(`${API_BASE}/api/v1/documents?${qs.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/pdf',
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

/** Documentale soft-deletes a document (row deleted_at + R2 object removed). */
export async function deleteDocument(token: string, id: string): Promise<void> {
  await apiDelete(token, `/api/v1/documents/${id}`);
}

/* ---------------- Documentale capability + OTP helpers ---------------- */

/** Grant/revoke the additive Documentale capability on a member (admin action).
 *  Returns status/code so the limit (409) path can be asserted. */
export async function setDocumentale(
  adminToken: string,
  userId: string,
  value: boolean,
): Promise<{ status: number; code?: string; message?: string }> {
  const r = await fetch(`${API_BASE}/api/v1/users/${userId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_documentale: value }),
  });
  let parsed: { error?: { code?: string; message?: string } } = {};
  try {
    parsed = JSON.parse(await r.text());
  } catch {
    /* non-JSON */
  }
  return { status: r.status, code: parsed.error?.code, message: parsed.error?.message };
}

export async function requestDocumentOtp(
  token: string,
): Promise<{ status: number; data: { sent: boolean } | null; code?: string }> {
  return apiPost<{ sent: boolean }>(token, '/api/v1/documents/otp/request', {});
}

export async function verifyDocumentOtp(
  token: string,
  code: string,
): Promise<{ status: number; data: { verified: boolean } | null; code?: string }> {
  return apiPost<{ verified: boolean }>(token, '/api/v1/documents/otp/verify', { code });
}

export async function getDocumentOtpStatus(
  token: string,
): Promise<{ verified: boolean; verified_until: string | null }> {
  return apiGet<{ verified: boolean; verified_until: string | null }>(
    token,
    '/api/v1/documents/otp/status',
  );
}

/** Request + verify a code so the caller holds a live OTP session. Idempotent —
 *  no-ops when a session is already active. Requires the backend to run with
 *  E2E_FIXED_OTP set to `fixedCode` for the pinned test tenant. */
export async function ensureDocumentOtp(token: string, fixedCode: string): Promise<void> {
  const status = await getDocumentOtpStatus(token);
  if (status.verified) return;
  const req = await requestDocumentOtp(token);
  if (req.status !== 200) throw new Error(`requestDocumentOtp failed: ${req.status} ${req.code ?? ''}`);
  const v = await verifyDocumentOtp(token, fixedCode);
  if (v.status !== 200 || !v.data?.verified) {
    throw new Error(`verifyDocumentOtp failed: ${v.status} ${v.code ?? ''}`);
  }
}

export async function listDocumentRecipients(
  token: string,
): Promise<Array<{ user_id: string; email: string; display_name: string | null; codice_fiscale: string | null; matricola: string | null; active: boolean }>> {
  return apiGet(token, '/api/v1/documents/recipients');
}

/** Raw GET of the all-docs list returning status/code (OTP/role negative paths). */
export async function listDocumentsAllRaw(
  token: string,
  userId?: string,
): Promise<{ status: number; code?: string; data: DocumentAdminItem[] | null }> {
  const qs = userId ? `?user_id=${encodeURIComponent(userId)}` : '';
  const r = await fetch(`${API_BASE}/api/v1/documents${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  let parsed: { data?: DocumentAdminItem[]; error?: { code?: string } } = {};
  try {
    parsed = JSON.parse(await r.text());
  } catch {
    /* non-JSON */
  }
  return { status: r.status, code: parsed.error?.code, data: parsed.data ?? null };
}

/** Raw GET of a download returning status/code (owner / documentale / 404 paths). */
export async function downloadDocumentRaw(
  token: string,
  id: string,
): Promise<{ status: number; code?: string; url?: string }> {
  const r = await fetch(`${API_BASE}/api/v1/documents/${id}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  let parsed: { data?: { url?: string }; error?: { code?: string } } = {};
  try {
    parsed = JSON.parse(await r.text());
  } catch {
    /* non-JSON */
  }
  return { status: r.status, code: parsed.error?.code, url: parsed.data?.url };
}

/* ---------------- Bacheca (bulletin) helpers ---------------- */

export interface BulletinRecord {
  id: string;
  tenant_id: string;
  title: string;
  body_html: string;
  target_all: boolean;
  start_at: string | null;
  end_at: string | null;
  notify_email: boolean;
  notify_push: boolean;
  created_at: string;
}

export interface BulletinAdminItem extends BulletinRecord {
  recipient_count: number;
  read_count: number;
}

export interface BulletinFeedItem {
  id: string;
  title: string;
  body_html: string;
  start_at: string | null;
  end_at: string | null;
  created_at: string;
  read: boolean;
  read_at: string | null;
}

export interface BulletinReader {
  user_id: string;
  email: string | null;
  display_name: string | null;
  read_at: string | null;
}

/**
 * Admin publishes a Bacheca message. Notifications default OFF here so the e2e
 * suite never fires real emails/pushes at the test tenant's members. Titles MUST
 * stay 'e2e-'-prefixed and callers must delete what they create (bulletins are
 * not swept by the fixture purge).
 */
export async function createBulletin(
  adminToken: string,
  body: {
    title: string;
    body_html: string;
    target_all?: boolean;
    user_ids?: string[];
    start_at?: string | null;
    end_at?: string | null;
    notify_email?: boolean;
    notify_push?: boolean;
  },
): Promise<BulletinRecord> {
  const r = await apiPost<BulletinRecord>(adminToken, '/api/v1/bulletins', {
    notify_email: false,
    notify_push: false,
    ...body,
  });
  if (r.status !== 201 || !r.data) {
    throw new Error(`createBulletin failed: ${r.status} ${r.code ?? ''} ${r.message ?? ''}`.trim());
  }
  return r.data;
}

export async function updateBulletin(
  adminToken: string,
  id: string,
  body: Record<string, unknown>,
): Promise<BulletinRecord> {
  return apiPatch<BulletinRecord>(adminToken, `/api/v1/bulletins/${id}`, body);
}

export async function listBulletinsAdmin(adminToken: string): Promise<BulletinAdminItem[]> {
  return apiGet<BulletinAdminItem[]>(adminToken, '/api/v1/bulletins');
}

export async function listMyBulletins(token: string): Promise<BulletinFeedItem[]> {
  return apiGet<BulletinFeedItem[]>(token, '/api/v1/bulletins/me');
}

export async function markBulletinRead(token: string, id: string): Promise<void> {
  const r = await apiPost(token, `/api/v1/bulletins/${id}/read`, {});
  if (r.status !== 200) throw new Error(`markBulletinRead failed: ${r.status} ${r.code ?? ''}`);
}

export async function getBulletinReads(adminToken: string, id: string): Promise<BulletinReader[]> {
  return apiGet<BulletinReader[]>(adminToken, `/api/v1/bulletins/${id}/reads`);
}

export async function deleteBulletin(token: string, id: string): Promise<void> {
  await apiDelete(token, `/api/v1/bulletins/${id}`);
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

/* Display-name resolvers ----------------------------------------------------
 * The shared test tenant's display names drift (manual edits during product
 * testing), so name-rendering assertions must not pin a literal like
 * "Mario Rossi". These resolve the live display_name from the API instead, and
 * fall back to the email prefix when it is unset. */

/** Resolve a teammate's display_name as an admin sees it (GET /users). */
export async function resolveDisplayName(adminToken: string, email: string): Promise<string> {
  const users = await apiGet<Array<{ email: string; display_name: string | null }>>(
    adminToken,
    '/api/v1/users',
  );
  return users.find((u) => u.email === email)?.display_name?.trim() || email.split('@')[0] || email;
}

/** Resolve the logged-in user's own display_name (GET /me) — for employee
 *  specs that have no admin token. */
export async function selfDisplayName(userToken: string, email: string): Promise<string> {
  const me = await apiGet<{ user: { display_name: string | null } }>(userToken, '/api/v1/me');
  return me.user.display_name?.trim() || email.split('@')[0] || email;
}

/* ---------------- Cantieri helpers ---------------- */

export interface CantiereSiteRecord {
  id: string;
  name: string;
  address: string | null;
  status: 'open' | 'closed';
}

export interface CantieriFieldDefRecord {
  id: string;
  scope: 'entry' | 'mezzo';
  key: string;
  label: string;
  field_type: 'text' | 'number' | 'date' | 'time' | 'boolean' | 'select';
  options: string[] | null;
  required: boolean;
  position: number;
  cantiere_ids: string[];
}

export interface CantiereMezzoRecord {
  id: string;
  name: string;
  custom_values: Record<string, unknown>;
}

export interface CantiereEntryApiRecord {
  id: string;
  cantiere_id: string;
  entry_date: string;
  travel_start: string | null;
  travel_end: string | null;
  activity_start: string | null;
  activity_end: string | null;
  activity_text: string | null;
  mezzo_id: string | null;
  custom_values: Record<string, unknown>;
}

/** Cantieri module state for the calling user, from /me. */
export async function cantieriMe(
  token: string,
): Promise<{ enabled: boolean; role: 'admin' | 'user' | null }> {
  const me = await apiGet<{
    user: { cantieri_role?: 'admin' | 'user' | null };
    tenant: { cantieri_enabled?: boolean };
  }>(token, '/api/v1/me');
  return {
    enabled: me.tenant.cantieri_enabled === true,
    role: me.user.cantieri_role ?? null,
  };
}

/** Seed a site. Names stay 'e2e-'-prefixed (purge matches the prefix). */
export async function createCantiereSite(
  adminToken: string,
  body: { name: string; address?: string | null; status?: 'open' | 'closed' },
): Promise<CantiereSiteRecord> {
  const r = await apiPost<CantiereSiteRecord>(adminToken, '/api/v1/cantieri/sites', body);
  if (r.status !== 201 || !r.data) {
    throw new Error(`createCantiereSite failed: ${r.status} ${r.code ?? ''} ${r.message ?? ''}`.trim());
  }
  return r.data;
}

export async function deleteCantiereSite(adminToken: string, id: string): Promise<void> {
  await apiDelete(adminToken, `/api/v1/cantieri/sites/${id}`);
}

async function putAssignments(
  adminToken: string,
  path: string,
  userIds: string[],
): Promise<void> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ user_ids: userIds }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`PUT ${path} → ${r.status}: ${text}`);
  }
}

export async function setCantiereAssignments(
  adminToken: string,
  siteId: string,
  userIds: string[],
): Promise<void> {
  await putAssignments(adminToken, `/api/v1/cantieri/sites/${siteId}/assignments`, userIds);
}

export async function createCantiereMezzo(
  adminToken: string,
  body: { name: string; custom_values?: Record<string, unknown> },
): Promise<CantiereMezzoRecord> {
  const r = await apiPost<CantiereMezzoRecord>(adminToken, '/api/v1/cantieri/mezzi', body);
  if (r.status !== 201 || !r.data) {
    throw new Error(`createCantiereMezzo failed: ${r.status} ${r.code ?? ''} ${r.message ?? ''}`.trim());
  }
  return r.data;
}

export async function deleteCantiereMezzo(adminToken: string, id: string): Promise<void> {
  await apiDelete(adminToken, `/api/v1/cantieri/mezzi/${id}`);
}

export async function setMezzoAssignments(
  adminToken: string,
  mezzoId: string,
  userIds: string[],
): Promise<void> {
  await putAssignments(adminToken, `/api/v1/cantieri/mezzi/${mezzoId}/assignments`, userIds);
}

/** Seed a custom field def. Labels stay 'e2e-'-prefixed (purge matches). */
export async function createCantieriField(
  adminToken: string,
  body: {
    scope: 'entry' | 'mezzo';
    label: string;
    field_type: CantieriFieldDefRecord['field_type'];
    options?: string[];
    required?: boolean;
    position?: number;
    cantiere_ids?: string[];
  },
): Promise<CantieriFieldDefRecord> {
  const r = await apiPost<CantieriFieldDefRecord>(adminToken, '/api/v1/cantieri/fields', body);
  if (r.status !== 201 || !r.data) {
    throw new Error(`createCantieriField failed: ${r.status} ${r.code ?? ''} ${r.message ?? ''}`.trim());
  }
  return r.data;
}

export async function deleteCantieriField(adminToken: string, id: string): Promise<void> {
  await apiDelete(adminToken, `/api/v1/cantieri/fields/${id}`);
}

/** List entry/mezzo field defs (each with its cantiere_ids association set). */
export async function getCantieriFields(
  adminToken: string,
  scope: 'entry' | 'mezzo',
): Promise<{ fields: CantieriFieldDefRecord[] }> {
  return apiGet(adminToken, `/api/v1/cantieri/fields?scope=${scope}`);
}

/** POST an entry and return the raw status/code (for negative-path assertions). */
export async function tryCreateCantiereEntry(
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; code?: string }> {
  const r = await apiPost(token, '/api/v1/cantieri/entries', body);
  return { status: r.status, code: r.code };
}

/** Send the monthly report by email (To/CC/BCC + optional HTML note). */
export async function sendCantiereReportEmail(
  adminToken: string,
  siteId: string,
  body: { month: string; to: string[]; cc?: string[]; bcc?: string[]; note?: string },
): Promise<{ status: number; sent?: boolean }> {
  const r = await apiPost<{ sent: boolean }>(
    adminToken,
    `/api/v1/cantieri/sites/${siteId}/report/email`,
    body,
  );
  return { status: r.status, sent: r.data?.sent };
}

/** Member surface: log an activity entry (caller needs a cantieri role +
 *  assignment to the site). */
export async function createCantiereEntry(
  token: string,
  body: {
    cantiere_id: string;
    entry_date: string;
    travel_start?: string | null;
    travel_end?: string | null;
    activity_start?: string | null;
    activity_end?: string | null;
    activity_text?: string | null;
    mezzo_id?: string | null;
    custom_values?: Record<string, unknown>;
  },
): Promise<CantiereEntryApiRecord> {
  const r = await apiPost<CantiereEntryApiRecord>(token, '/api/v1/cantieri/entries', body);
  if (r.status !== 201 || !r.data) {
    throw new Error(`createCantiereEntry failed: ${r.status} ${r.code ?? ''} ${r.message ?? ''}`.trim());
  }
  return r.data;
}

export async function deleteCantiereEntry(token: string, id: string): Promise<void> {
  await apiDelete(token, `/api/v1/cantieri/entries/${id}`);
}

export async function getCantieriDashboard(
  adminToken: string,
  month: string,
): Promise<{
  month: string;
  sites: Array<{
    id: string;
    name: string;
    entries_count: number;
    users_count: number;
    travel_minutes: number;
    activity_minutes: number;
    last_entry_date: string | null;
  }>;
}> {
  return apiGet(adminToken, `/api/v1/cantieri/dashboard?month=${month}`);
}

/** Fetch the per-site monthly PDF report; returns status + sniffed header. */
export async function getCantiereReportPdf(
  adminToken: string,
  siteId: string,
  month: string,
): Promise<{ status: number; contentType: string | null; magic: string }> {
  const r = await fetch(`${API_BASE}/api/v1/cantieri/sites/${siteId}/report?month=${month}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const buf = Buffer.from(await r.arrayBuffer());
  return {
    status: r.status,
    contentType: r.headers.get('content-type'),
    magic: buf.subarray(0, 5).toString('latin1'),
  };
}
