import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { v4 as uuidv4 } from 'uuid';
import { pool, withTenantRLS } from '../lib/db.js';
import { adminPool } from '../lib/admin-db.js';
import { evaluateStamp, type StampInputBody } from '../services/stamp-service.js';
import type { StampEventType } from '@sonoqui/shared';

// Geofence rules for employee stamping (apps/backend/src/services/stamp-service.ts).
//
// Only clock_in is gated by the position: it is the single point where being on
// site is verified. Breaks, lunch and the exit are accepted from anywhere and
// flagged `out_of_geofence` instead when the position can't be confirmed inside
// a branch radius — a worker who moves between sedi mid-shift, or closes a
// forgotten shift from home, must never be blocked.
//
// Runs against the DB like tenant-isolation.test.ts (RLS + real branch rows).

const OFFICE = { lat: 45.0, lng: 9.0 };
// ~13 km from OFFICE — outside every 100 m radius used here.
const OTHER_OFFICE = { lat: 45.1, lng: 9.1 };
// ~140 km from OFFICE — "at home".
const FAR_AWAY = { lat: 46.0, lng: 10.0 };

const tenants: string[] = [];
const users: string[] = [];

interface Ctx {
  tenantId: string;
  userId: string;
  branchA: string;
  branchB: string;
  smartId: string;
}

interface SeedOpts {
  /** Branches the user is assigned to. Default: A + B. */
  assign?: Array<'A' | 'B' | 'SMART'>;
  mockLocationAction?: 'allow' | 'flag' | 'block';
  /** Branch A geofence toggle — false means "no radius configured". */
  enforceRadiusA?: boolean;
}

async function seed(label: string, opts: SeedOpts = {}): Promise<Ctx> {
  const tenantId = uuidv4();
  const userId = uuidv4();
  await adminPool.query(
    `INSERT INTO tenants(id, ragione_sociale, language, mock_location_action)
     VALUES ($1, $2, 'it', $3)`,
    [tenantId, `T-geofence-${label}-${userId.slice(0, 8)}`, opts.mockLocationAction ?? 'flag']
  );
  await adminPool.query(`INSERT INTO auth_users(id, email) VALUES ($1, $2)`, [
    userId,
    `geofence-${label}-${userId.slice(0, 8)}@sonoqui.local`,
  ]);
  await adminPool.query(
    `INSERT INTO memberships(tenant_id, user_id, role, stamp_modes)
     VALUES ($1, $2, 'user', ARRAY['gps']::text[])`,
    [tenantId, userId]
  );
  const mk = async (
    name: string,
    lat: number | null,
    lng: number | null,
    smart: boolean,
    enforce = true
  ): Promise<string> => {
    const r = await adminPool.query(
      `INSERT INTO branches(tenant_id, name, latitude, longitude, radius_m, smart_working, enforce_radius)
       VALUES ($1, $2, $3, $4, 100, $5, $6) RETURNING id`,
      [tenantId, name, lat, lng, smart, enforce]
    );
    return r.rows[0].id as string;
  };
  const branchA = await mk('Sede A', OFFICE.lat, OFFICE.lng, false, opts.enforceRadiusA ?? true);
  const branchB = await mk('Sede B', OTHER_OFFICE.lat, OTHER_OFFICE.lng, false);
  const smartId = await mk('Smart working', null, null, true);

  const assign = opts.assign ?? ['A', 'B'];
  const byKey: Record<string, string> = { A: branchA, B: branchB, SMART: smartId };
  for (const key of assign) {
    await adminPool.query(
      `INSERT INTO branch_memberships(branch_id, user_id, tenant_id) VALUES ($1, $2, $3)`,
      [byKey[key], userId, tenantId]
    );
  }
  tenants.push(tenantId);
  users.push(userId);
  return { tenantId, userId, branchA, branchB, smartId };
}

/** Seed the open shift a break/lunch/exit needs to be a legal transition. */
async function openShift(ctx: Ctx, branchId: string | null): Promise<void> {
  await adminPool.query(
    `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source, branch_id)
     VALUES ($1, $2, 'clock_in', now() - interval '3 hours', 'employee_app', $3)`,
    [ctx.tenantId, ctx.userId, branchId]
  );
}

interface StampOpts {
  branchId?: string | null;
  at?: { lat: number; lng: number } | null;
  isMock?: boolean;
}

function evaluate(ctx: Ctx, event: StampEventType, opts: StampOpts = {}) {
  const now = new Date();
  const body: StampInputBody = {
    event_type: event,
    occurred_at: now.toISOString(),
    device_platform: 'ios',
    ...(opts.branchId ? { branch_id: opts.branchId } : {}),
    ...(opts.at === null || opts.at === undefined
      ? {}
      : { latitude: opts.at.lat, longitude: opts.at.lng }),
    ...(opts.isMock ? { is_mock_location: true } : {}),
  };
  return withTenantRLS(ctx.userId, ctx.tenantId, (client) =>
    evaluateStamp(client, {
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      body,
      source: 'employee_app',
      now,
    })
  );
}

after(async () => {
  if (users.length) {
    await adminPool.query(`DELETE FROM stamps WHERE user_id = ANY($1::uuid[])`, [users]);
    await adminPool.query(`DELETE FROM branch_memberships WHERE user_id = ANY($1::uuid[])`, [users]);
    await adminPool.query(`DELETE FROM memberships WHERE user_id = ANY($1::uuid[])`, [users]);
  }
  if (tenants.length) {
    await adminPool.query(`DELETE FROM branches WHERE tenant_id = ANY($1::uuid[])`, [tenants]);
    await adminPool.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [tenants]);
  }
  if (users.length) {
    await adminPool.query(`DELETE FROM auth_users WHERE id = ANY($1::uuid[])`, [users]);
  }
  await pool.end();
  await adminPool.end();
});

// ---------------------------------------------------------------- clock_in --

test('clock_in inside the declared branch radius is accepted', async () => {
  const ctx = await seed('in-ok');
  const r = await evaluate(ctx, 'clock_in', { branchId: ctx.branchA, at: OFFICE });
  assert.equal(r.branchId, ctx.branchA);
  assert.equal(r.outOfGeofence, false);
});

test('clock_in outside the declared branch radius is BLOCKED', async () => {
  const ctx = await seed('in-block');
  await assert.rejects(
    () => evaluate(ctx, 'clock_in', { branchId: ctx.branchA, at: FAR_AWAY }),
    (e: { code?: string }) => e.code === 'OUT_OF_GEOFENCE'
  );
});

test('clock_in with no declared branch resolves the branch from the position', async () => {
  const ctx = await seed('in-auto');
  const r = await evaluate(ctx, 'clock_in', { at: OTHER_OFFICE });
  assert.equal(r.branchId, ctx.branchB, 'stamped on the branch the worker is standing in');
  assert.equal(r.outOfGeofence, false);
});

test('clock_in away from every assigned branch is BLOCKED', async () => {
  const ctx = await seed('in-auto-block');
  await assert.rejects(
    () => evaluate(ctx, 'clock_in', { at: FAR_AWAY }),
    (e: { code?: string }) => e.code === 'OUT_OF_GEOFENCE'
  );
});

test('clock_in without GPS is BLOCKED', async () => {
  const ctx = await seed('in-nogps');
  await assert.rejects(
    () => evaluate(ctx, 'clock_in', { branchId: ctx.branchA }),
    // GPS_REQUIRED is a ValidationError detail, not the top-level error code.
    (e: { code?: string; details?: { code?: string } }) => e.details?.code === 'GPS_REQUIRED'
  );
});

// ------------------------------------------- moving between sedi mid-shift --

test('clock_out inside another assigned branch is re-attributed to it, not flagged', async () => {
  // The whole point of the relaxed rule: entered at A, left from B. The picker
  // may still say A (old app versions always send the shift branch) — the
  // position wins and no out-of-area anomaly is raised.
  const ctx = await seed('out-move');
  await openShift(ctx, ctx.branchA);
  const r = await evaluate(ctx, 'clock_out', { branchId: ctx.branchA, at: OTHER_OFFICE });
  assert.equal(r.branchId, ctx.branchB);
  assert.equal(r.outOfGeofence, false);
});

test('break_end at another assigned branch is accepted (never blocked mid-shift)', async () => {
  const ctx = await seed('break-move');
  await openShift(ctx, ctx.branchA);
  await adminPool.query(
    `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source, branch_id)
     VALUES ($1, $2, 'break_start', now() - interval '30 minutes', 'employee_app', $3)`,
    [ctx.tenantId, ctx.userId, ctx.branchA]
  );
  const r = await evaluate(ctx, 'break_end', { branchId: ctx.branchA, at: OTHER_OFFICE });
  assert.equal(r.branchId, ctx.branchB);
  assert.equal(r.outOfGeofence, false);
});

test('break_end far from every branch is flagged, not blocked', async () => {
  const ctx = await seed('break-far');
  await openShift(ctx, ctx.branchA);
  await adminPool.query(
    `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source, branch_id)
     VALUES ($1, $2, 'break_start', now() - interval '30 minutes', 'employee_app', $3)`,
    [ctx.tenantId, ctx.userId, ctx.branchA]
  );
  const r = await evaluate(ctx, 'break_end', { at: FAR_AWAY });
  assert.equal(r.outOfGeofence, true);
  assert.equal(r.branchId, ctx.branchA, 'attributed to the sede the shift was opened on');
});

// --------------------------------------------------------------- clock_out --

test('clock_out far from every branch is flagged with the distance to its sede', async () => {
  const ctx = await seed('out-far');
  await openShift(ctx, ctx.branchA);
  const r = await evaluate(ctx, 'clock_out', { branchId: ctx.branchA, at: FAR_AWAY });
  assert.equal(r.branchId, ctx.branchA);
  assert.equal(r.outOfGeofence, true);
  assert.ok((r.geofenceDistanceM ?? 0) > 1000, 'distance to the sede is reported');
});

test('clock_out with no branch and no GPS inherits the open shift sede and is flagged', async () => {
  const ctx = await seed('out-nogps');
  await openShift(ctx, ctx.branchA);
  const r = await evaluate(ctx, 'clock_out', {});
  assert.equal(r.branchId, ctx.branchA);
  assert.equal(r.outOfGeofence, true);
  assert.equal(r.geofenceDistanceM, null);
});

// ---------------------------------------------------------- smart working --

test('a smart-working branch never blocks and is never flagged', async () => {
  const ctx = await seed('smart-only', { assign: ['SMART'] });
  const entry = await evaluate(ctx, 'clock_in', { branchId: ctx.smartId, at: FAR_AWAY });
  assert.equal(entry.branchId, ctx.smartId);
  assert.equal(entry.outOfGeofence, false);
  await openShift(ctx, ctx.smartId);
  const exit = await evaluate(ctx, 'clock_out', { branchId: ctx.smartId, at: FAR_AWAY });
  assert.equal(exit.outOfGeofence, false);
});

test('a smart-working assignment does not swallow a physical branch match', async () => {
  // Regression guard: resolution used to short-circuit on the first
  // smart-working branch, so `out_of_geofence` could never fire — and a worker
  // physically at a sede was attributed to "smart working" instead.
  const ctx = await seed('smart-mixed', { assign: ['SMART', 'A'] });
  await openShift(ctx, ctx.branchA);
  const atSede = await evaluate(ctx, 'clock_out', { at: OFFICE });
  assert.equal(atSede.branchId, ctx.branchA, 'the physical sede wins over smart working');
  assert.equal(atSede.outOfGeofence, false);
});

test('a smart-working assignment absorbs a position matching no sede', async () => {
  const ctx = await seed('smart-fallback', { assign: ['SMART', 'A'] });
  await openShift(ctx, ctx.branchA);
  const home = await evaluate(ctx, 'clock_out', { at: FAR_AWAY });
  assert.equal(home.branchId, ctx.smartId);
  assert.equal(home.outOfGeofence, false, 'smart working is always in area');
});

test('a branch with no radius configured is never flagged', async () => {
  const ctx = await seed('no-radius', { assign: ['A'], enforceRadiusA: false });
  const entry = await evaluate(ctx, 'clock_in', { branchId: ctx.branchA, at: FAR_AWAY });
  assert.equal(entry.outOfGeofence, false);
  await openShift(ctx, ctx.branchA);
  const exit = await evaluate(ctx, 'clock_out', { branchId: ctx.branchA, at: FAR_AWAY });
  assert.equal(exit.outOfGeofence, false);
});

// ------------------------------------------------------- access + spoofing --

test('a branch the worker is not assigned to is rejected', async () => {
  const ctx = await seed('not-assigned', { assign: ['A'] });
  await assert.rejects(
    () => evaluate(ctx, 'clock_in', { branchId: ctx.branchB, at: OTHER_OFFICE }),
    (e: { code?: string }) => e.code === 'FORBIDDEN'
  );
});

test("mock_location_action='block' refuses the entry but never traps an open shift", async () => {
  const ctx = await seed('mock-block', { mockLocationAction: 'block' });
  await assert.rejects(
    () => evaluate(ctx, 'clock_in', { branchId: ctx.branchA, at: OFFICE, isMock: true }),
    (e: { code?: string }) => e.code === 'MOCK_LOCATION_BLOCKED'
  );
  await openShift(ctx, ctx.branchA);
  const exit = await evaluate(ctx, 'clock_out', { branchId: ctx.branchA, at: OFFICE, isMock: true });
  assert.equal(exit.suspiciousMockLocation, true, 'recorded and flagged instead of blocked');
});
