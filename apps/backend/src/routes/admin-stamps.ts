import { Router } from 'express';
import type { Request } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { stateFromLastEvent } from '@sonoqui/shared';
import type { StampEventType } from '@sonoqui/shared';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { tenantHandler } from '../lib/route-helpers.js';
import { TENANT_TZ_SQL } from '../lib/tz.js';
import { ok } from '../lib/api-response.js';
import { logAudit } from '../lib/audit.js';
import { notifyStampChanged } from '../lib/notifications.js';
import { createLogger } from '../lib/logger.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/index.js';
import { stampColumns } from '../lib/stamp-columns.js';

const logger = createLogger('admin-stamps');

export const adminStampsRouter = Router();
adminStampsRouter.use(authenticate);
adminStampsRouter.use(requireAdmin);

const AdminCreate = z.object({
  user_id: z.string().uuid(),
  event_type: z.enum(['clock_in', 'clock_out', 'break_start', 'break_end', 'lunch_start', 'lunch_end']),
  occurred_at: z.string().datetime({ offset: true }),
  branch_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(500).optional(),
  out_of_geofence: z.boolean().optional(),
  justification: z.string().min(3).max(500),
});

adminStampsRouter.post(
  '/stamps',
  tenantHandler(async (req, res, client) => {
    const parse = AdminCreate.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    const member = await client.query(
      `SELECT 1 FROM memberships
       WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
         AND user_id = $1 AND deleted_at IS NULL`,
      [b.user_id]
    );
    if (member.rowCount === 0) throw new NotFoundError('user not in tenant');
    await client.query(`SELECT set_config('app.change_reason', $1, true)`, [
      `admin_manual:${b.justification}`,
    ]);
    const ins = await client.query(
      `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source, branch_id, notes, out_of_geofence)
       VALUES (current_setting('app.current_tenant_id')::uuid, $1, $2, $3, 'admin_manual', $4, $5, $6)
       RETURNING ${stampColumns()}`,
      [b.user_id, b.event_type, b.occurred_at, b.branch_id ?? null, b.notes ?? null, b.out_of_geofence ?? false]
    );
    await emitAuditAndOutbox(client, req.user!.tenantId, 'stamp.admin_create', ins.rows[0].id, ins.rows[0].user_id, null, ins.rows[0], req);
    ok(res, ins.rows[0], 201);
  })
);

const AdminPatch = z.object({
  event_type: z.enum(['clock_in', 'clock_out', 'break_start', 'break_end', 'lunch_start', 'lunch_end']).optional(),
  occurred_at: z.string().datetime({ offset: true }).optional(),
  branch_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(500).optional(),
  justification: z.string().min(3).max(500),
});

adminStampsRouter.patch(
  '/stamps/:id',
  tenantHandler(async (req, res, client) => {
    const parse = AdminPatch.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const before = await client.query(`SELECT ${stampColumns()} FROM stamps WHERE id = $1`, [req.params.id]);
    if (before.rowCount === 0) throw new NotFoundError('stamp');
    const set: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(parse.data)) {
      if (k === 'justification') continue;
      if (v === undefined) continue;
      set.push(`${k} = $${i++}`);
      values.push(v);
    }
    if (set.length === 0) return ok(res, before.rows[0]);
    values.push(req.params.id);
    await client.query(`SELECT set_config('app.change_reason', $1, true)`, [
      `admin_edit:${parse.data.justification}`,
    ]);
    const r = await client.query(
      `UPDATE stamps SET ${set.join(', ')} WHERE id = $${i} RETURNING ${stampColumns()}`,
      values
    );
    await emitAuditAndOutbox(client, req.user!.tenantId, 'stamp.admin_update', String(req.params.id), before.rows[0].user_id, before.rows[0], r.rows[0], req);
    // Only when the punch itself moved — a note-only edit is not something the
    // employee needs to be told about, and the provenance trigger agrees
    // (migration 059 does not count it as an edit either).
    if (
      new Date(before.rows[0].occurred_at).getTime() !== new Date(r.rows[0].occurred_at).getTime() ||
      before.rows[0].event_type !== r.rows[0].event_type
    ) {
      // Fire-and-forget: this runs INSIDE tenantHandler's RLS transaction, so
      // awaiting it would let a notification failure roll back the correction
      // the admin just made. Same pattern as bulletins/documents.
      notifyStampChanged(req.user!.tenantId, {
        userId: r.rows[0].user_id,
        actorUserId: req.user!.id,
        action: 'edited',
        occurredAt: r.rows[0].occurred_at,
        originalOccurredAt: r.rows[0].original_occurred_at,
        eventType: r.rows[0].event_type,
        reason: parse.data.justification,
        stampId: String(req.params.id),
      }).catch((err) => logger.error({ err, stamp_id: req.params.id }, 'notify stamp edit failed'));
    }
    ok(res, r.rows[0]);
  })
);

const AdminDelete = z.object({ deletion_reason: z.string().min(3).max(500) });

adminStampsRouter.delete(
  '/stamps/:id',
  tenantHandler(async (req, res, client) => {
    const parse = AdminDelete.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    await client.query(`SELECT set_config('app.change_reason', $1, true)`, [
      `admin_delete:${parse.data.deletion_reason}`,
    ]);
    const r = await client.query(
      `UPDATE stamps SET deleted_at = now(), deleted_by_user_id = current_setting('app.current_user_id')::uuid,
                       deletion_reason = $1
       WHERE id = $2 AND deleted_at IS NULL
       RETURNING ${stampColumns()}`,
      [parse.data.deletion_reason, req.params.id]
    );
    if (r.rowCount === 0) throw new NotFoundError('stamp');
    await emitAuditAndOutbox(client, req.user!.tenantId, 'stamp.admin_delete', String(req.params.id), r.rows[0].user_id, r.rows[0], null, req);
    // Fire-and-forget — see the PATCH handler above.
    notifyStampChanged(req.user!.tenantId, {
      userId: r.rows[0].user_id,
      actorUserId: req.user!.id,
      action: 'deleted',
      occurredAt: r.rows[0].occurred_at,
      originalOccurredAt: r.rows[0].original_occurred_at,
      eventType: r.rows[0].event_type,
      reason: parse.data.deletion_reason,
      stampId: String(req.params.id),
    }).catch((err) => logger.error({ err, stamp_id: req.params.id }, 'notify stamp delete failed'));
    ok(res, { deleted: true });
  })
);

const BulkApply = z.object({
  user_id: z.string().uuid(),
  branch_id: z.string().uuid().nullable().optional(),
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(60),
  schedule: z.object({
    clock_in: z.string().regex(/^\d{2}:\d{2}$/),
    clock_out: z.string().regex(/^\d{2}:\d{2}$/),
    break_start: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    break_end: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    lunch_start: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    lunch_end: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  }),
});

adminStampsRouter.post(
  '/stamps/bulk-apply-standard',
  tenantHandler(async (req, res, client) => {
    const parse = BulkApply.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    const results: Array<{ date: string; status: 'created' | 'skipped' | 'error'; reason?: string }> = [];
    await client.query(`SELECT set_config('app.change_reason', $1, true)`, [
      'bulk_apply_standard',
    ]);
    // The schedule carries wall-clock times ('09:00') for a calendar day. Both
    // the duplicate check and the inserts resolve them in the tenant zone: a
    // bare ::timestamptz cast would read them against the server clock (UTC in
    // production) and file every punch 2h late in summer.
    for (const date of b.dates) {
      const existing = await client.query(
        `SELECT 1 FROM stamps
         WHERE user_id = $1 AND deleted_at IS NULL
           AND occurred_at >= ($2::timestamp AT TIME ZONE ${TENANT_TZ_SQL})
           AND occurred_at <  (($2::date + 1)::timestamp AT TIME ZONE ${TENANT_TZ_SQL})`,
        [b.user_id, date]
      );
      if (existing.rowCount && existing.rowCount > 0) {
        results.push({ date, status: 'skipped', reason: 'stamps_exist' });
        continue;
      }
      try {
        await client.query(
          `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source, branch_id, notes)
           VALUES (current_setting('app.current_tenant_id')::uuid, $1, 'clock_in',
                   ($2 || ' ' || $3 || ':00')::timestamp AT TIME ZONE ${TENANT_TZ_SQL}, 'admin_manual', $4, 'bulk_apply_standard')`,
          [b.user_id, date, b.schedule.clock_in, b.branch_id ?? null]
        );
        if (b.schedule.break_start && b.schedule.break_end) {
          await client.query(
            `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source, branch_id, notes)
             VALUES (current_setting('app.current_tenant_id')::uuid, $1, 'break_start',
                     ($2 || ' ' || $3 || ':00')::timestamp AT TIME ZONE ${TENANT_TZ_SQL}, 'admin_manual', $4, 'bulk_apply_standard')`,
            [b.user_id, date, b.schedule.break_start, b.branch_id ?? null]
          );
          await client.query(
            `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source, branch_id, notes)
             VALUES (current_setting('app.current_tenant_id')::uuid, $1, 'break_end',
                     ($2 || ' ' || $3 || ':00')::timestamp AT TIME ZONE ${TENANT_TZ_SQL}, 'admin_manual', $4, 'bulk_apply_standard')`,
            [b.user_id, date, b.schedule.break_end, b.branch_id ?? null]
          );
        }
        if (b.schedule.lunch_start && b.schedule.lunch_end) {
          await client.query(
            `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source, branch_id, notes)
             VALUES (current_setting('app.current_tenant_id')::uuid, $1, 'lunch_start',
                     ($2 || ' ' || $3 || ':00')::timestamp AT TIME ZONE ${TENANT_TZ_SQL}, 'admin_manual', $4, 'bulk_apply_standard')`,
            [b.user_id, date, b.schedule.lunch_start, b.branch_id ?? null]
          );
          await client.query(
            `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source, branch_id, notes)
             VALUES (current_setting('app.current_tenant_id')::uuid, $1, 'lunch_end',
                     ($2 || ' ' || $3 || ':00')::timestamp AT TIME ZONE ${TENANT_TZ_SQL}, 'admin_manual', $4, 'bulk_apply_standard')`,
            [b.user_id, date, b.schedule.lunch_end, b.branch_id ?? null]
          );
        }
        await client.query(
          `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source, branch_id, notes)
           VALUES (current_setting('app.current_tenant_id')::uuid, $1, 'clock_out',
                   ($2 || ' ' || $3 || ':00')::timestamp AT TIME ZONE ${TENANT_TZ_SQL}, 'admin_manual', $4, 'bulk_apply_standard')`,
          [b.user_id, date, b.schedule.clock_out, b.branch_id ?? null]
        );
        results.push({ date, status: 'created' });
      } catch (err) {
        results.push({ date, status: 'error', reason: (err as Error).message.slice(0, 200) });
      }
    }
    const createdDates = results.filter((x) => x.status === 'created').map((x) => x.date);
    // A failed per-date INSERT aborts the shared transaction (no savepoints):
    // any further statement would throw 25P02 and turn the partial-results
    // response into a 500. Nothing gets committed in that case anyway, so the
    // audit row is skipped together with the stamps it would have described.
    const anyError = results.some((x) => x.status === 'error');
    if (createdDates.length && !anyError) {
      await logAudit(client, {
        action: 'stamp.bulk_apply',
        resourceType: 'stamp',
        targetUserId: b.user_id,
        after: { dates: createdDates, schedule: b.schedule },
        req,
      });
    }
    ok(res, { results });
  })
);

/** One punch of a day, as stored (pg hands `occurred_at` back as a Date). */
export interface DayPunch {
  event_type: StampEventType;
  occurred_at: string | Date;
}

/**
 * Would `proposed` add nothing to a day that already holds `dayPunches` (that
 * calendar day's live punches, oldest first)?
 *
 * The question is answered AT THE PROPOSED PUNCH'S OWN INSTANT — never at the
 * end of the day — because a day can hold several sessions and the two mistakes
 * pull in opposite directions:
 *
 *  - lunch punched as clock_out/clock_in leaves a clock_out in the MIDDLE of
 *    the day (prod repro: Bruno Borroni, 2026-07-29 — in 09:00, out 12:30, in
 *    14:00 and no exit). The original "this type is already present today" rule
 *    read that day as closed and silently skipped the exit the admin had asked
 *    for, so `missing_clock_out` survived its own fix.
 *  - a day REOPENED after the real exit — called back in at 21:00, or a night
 *    shift whose closing punch lands in the next day's bucket: in 09:00, out
 *    17:00, in 21:00. presenceAnchors() in routes/shifts.ts anchors on the LAST
 *    presence punch, so lastOut is undefined and `missing_clock_out` fires here
 *    too; the fix it offers is a clock_out at the scheduled 17:00, right next to
 *    the real one. Judging the punch against the day's LAST event ('clock_in',
 *    session open) filed that duplicate exit — once per click, review catch,
 *    never shipped.
 *
 * So a closing punch is redundant when the session covering its instant is
 * already closed, which can happen on either side of it: the punches BEFORE it
 * end on a closed session, or the next entry/exit AFTER it is an exit (the
 * 21:00 re-entry day again, when the real exit sits at 17:05 and the proposal at
 * the scheduled 17:00). An entry is the mirror image, and that mirror is why
 * the old `dayEvents.includes(type)` had to go for clock_in as well: on a day whose
 * morning entry is missing but whose lunch was punched as clock_out/clock_in
 * (out 12:30, in 14:00, out 18:00) the day does hold a clock_in, yet the 09:00
 * entry is genuinely absent.
 *
 * `<=`, not `<`: re-running a correction proposes a punch at exactly the
 * occurred_at of the one the first run inserted, so that punch has to be part of
 * the state it is judged against — this comparison IS the endpoint's
 * idempotence (double-click, or the same row re-selected in the bulk bar).
 *
 * An empty prefix is not a closed session, it is one that never opened: a caller
 * that sends only the exit must still get it, and inside the loop below a
 * clock_out is judged after the clock_in of its own request has been inserted
 * (hence the chronological ordering there).
 *
 * break/lunch follow the same session lens even though no caller proposes them
 * today (the anomaly builder only ever sends the two presence punches): a second
 * break is legitimate, a second break_start inside one is not, and a break_end
 * with no break open closes nothing.
 */
export function isRedundantFixEvent(dayPunches: readonly DayPunch[], proposed: DayPunch): boolean {
  const at = new Date(proposed.occurred_at).getTime();
  const ms = (p: DayPunch): number => new Date(p.occurred_at).getTime();
  const before = dayPunches.filter((p) => ms(p) <= at);
  const state = stateFromLastEvent(before.length > 0 ? before[before.length - 1]!.event_type : null);
  // The first entry/exit after the proposed instant: what closes — or reopens —
  // the session the punch would land in. Break/lunch punches say nothing about
  // that, so they are not candidates here.
  const nextPresence = dayPunches.find(
    (p) => ms(p) > at && (p.event_type === 'clock_in' || p.event_type === 'clock_out')
  )?.event_type;

  switch (proposed.event_type) {
    case 'clock_out':
      // `before.length` is load-bearing: stateFromLastEvent(null) is 'nothing'
      // as well, and an empty prefix must not read as a closed session.
      if (before.length > 0 && state === 'nothing') return true;
      return nextPresence === 'clock_out';
    case 'clock_in':
      if (state !== 'nothing') return true;
      return nextPresence === 'clock_in';
    case 'break_start':
      return state === 'on_break';
    case 'break_end':
      return state !== 'on_break';
    case 'lunch_start':
      return state === 'on_lunch';
    case 'lunch_end':
      return state !== 'on_lunch';
  }
}

// Resolve an anomaly by inserting the clock events that are missing for a day,
// at the times taken from the assigned shift ("orario standard del giorno").
// Additive only: an event is skipped when the day's own punches already cover
// the moment it would fill (see isRedundantFixEvent), so real punches are never
// overwritten and no correction can be applied twice.
const FixAnomaly = z.object({
  user_id: z.string().uuid(),
  branch_id: z.string().uuid().nullable().optional(),
  events: z
    .array(
      z.object({
        event_type: z.enum(['clock_in', 'clock_out', 'break_start', 'break_end', 'lunch_start', 'lunch_end']),
        occurred_at: z.string().datetime({ offset: true }),
      })
    )
    .min(1)
    .max(6),
  justification: z.string().min(3).max(500),
});

/**
 * Serialize corrections of the same employee. Deciding what to insert is a
 * read-modify-write (read the day, then insert what it lacks), the same shape
 * the per-day leave cap had when Time System S.a.s tripped it in August 2026:
 * two callers read the pre-insert state, both saw a session still open, both
 * filed a closing punch — and a duplicate exit reaches the payroll export. The
 * web bulk bar no longer fires twice for one giornata (it collapses the
 * selection to one intervention per user+day), but a double-click or a second
 * admin still can. Same idiom as lib/leave-quota.ts: an xact lock, released by
 * the COMMIT in withTenantRLS, keyed per (tenant, user) so two employees never
 * queue behind each other, with its own prefix in the database-wide id space.
 *
 * Both halves of the key go through ::uuid before ::text, exactly as
 * lockLeaveUser does, and for exactly the same reason: hashtextextended hashes
 * BYTES, so 'AAAAAAAA-…' and 'aaaaaaaa-…' hash to two different lock ids —
 * while the membership check and the day query above compare `user_id = $1`
 * against a uuid COLUMN, where Postgres parses the parameter and matches both
 * spellings as the same person. FixAnomaly validates with zod's .uuid(), whose
 * regex is case-insensitive and which normalises nothing, so an upper-cased id
 * is a body the API accepts. With the raw string in the key, two concurrent
 * corrections of one employee took two different locks, neither waited, both
 * read the day before either INSERT landed, both passed isRedundantFixEvent —
 * and two clock_out rows landed at the same instant. uuid::text always renders
 * canonical lowercase, so every spelling collapses onto one key. NULLIF covers
 * the empty string a placeholder GUC is left with after a rolled-back SET
 * LOCAL, which ''::uuid would turn into a 22P02 instead of the '-' fallback.
 */
export async function lockFixAnomalyUser(client: PoolClient, userId: string): Promise<void> {
  await client.query(
    `SELECT pg_advisory_xact_lock(
              hashtextextended(
                'stamp:fix-anomaly:'
                  || COALESCE(
                       NULLIF(current_setting('app.current_tenant_id', true), '')::uuid::text,
                       '-'
                     )
                  || ':' || $1::uuid::text,
                0
              )
            )`,
    [userId]
  );
}

adminStampsRouter.post(
  '/stamps/fix-anomaly',
  tenantHandler(async (req, res, client) => {
    const parse = FixAnomaly.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    const member = await client.query(
      `SELECT 1 FROM memberships
       WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
         AND user_id = $1 AND deleted_at IS NULL`,
      [b.user_id]
    );
    if (member.rowCount === 0) throw new NotFoundError('user not in tenant');
    await client.query(`SELECT set_config('app.change_reason', $1, true)`, [
      `anomaly_standard:${b.justification}`,
    ]);
    const results: Array<{
      event_type: string;
      occurred_at: string;
      status: 'created' | 'skipped';
      id?: string;
    }> = [];
    await lockFixAnomalyUser(client, b.user_id);
    // Apply the requested events in chronological order: the day's session
    // state below is read from the punches stored so far, so an insert must see
    // the ones that precede it (a day missing both ends needs its clock_in in
    // place before the clock_out is judged redundant).
    const events = [...b.events].sort(
      (x, y) => new Date(x.occurred_at).getTime() - new Date(y.occurred_at).getTime()
    );
    for (const ev of events) {
      // occurred_at travels with the type: the redundancy rule places the
      // proposed punch among the day's own punches instead of after the last of
      // them (see isRedundantFixEvent), so the ORDER BY here is its contract.
      const day = await client.query<DayPunch>(
        `SELECT event_type, occurred_at FROM stamps
         WHERE user_id = $1 AND deleted_at IS NULL
           AND (occurred_at AT TIME ZONE ${TENANT_TZ_SQL})::date
             = ($2::timestamptz AT TIME ZONE ${TENANT_TZ_SQL})::date
         ORDER BY occurred_at ASC, created_at ASC`,
        [b.user_id, ev.occurred_at]
      );
      if (isRedundantFixEvent(day.rows, ev)) {
        results.push({ event_type: ev.event_type, occurred_at: ev.occurred_at, status: 'skipped' });
        continue;
      }
      const ins = await client.query(
        `INSERT INTO stamps(tenant_id, user_id, event_type, occurred_at, source, branch_id, notes)
         VALUES (current_setting('app.current_tenant_id')::uuid, $1, $2, $3, 'admin_manual', $4, $5)
         RETURNING ${stampColumns()}`,
        [b.user_id, ev.event_type, ev.occurred_at, b.branch_id ?? null, `Orario standard (anomalia): ${b.justification}`]
      );
      await emitAuditAndOutbox(client, req.user!.tenantId, 'stamp.admin_create', ins.rows[0].id, ins.rows[0].user_id, null, ins.rows[0], req);
      results.push({
        event_type: ev.event_type,
        occurred_at: ev.occurred_at,
        status: 'created',
        id: ins.rows[0].id,
      });
    }
    ok(res, { results });
  })
);

/**
 * One audit row plus one realtime nudge for an admin-side punch write.
 *
 * Exported because the API module performs the SAME three writes from
 * routes/public/stamps.ts — a punch filed by a badge reader has to reach the
 * Registro and the live dashboard exactly like one an admin typed, and two
 * copies of that would diverge the first time either changes.
 */
export async function emitAuditAndOutbox(
  client: import('pg').PoolClient,
  tenantId: string,
  action: 'stamp.admin_create' | 'stamp.admin_update' | 'stamp.admin_delete',
  resourceId: string,
  targetUserId: string,
  before: unknown,
  after: unknown,
  req: Request
): Promise<void> {
  await logAudit(client, {
    action,
    resourceType: 'stamp',
    resourceId,
    targetUserId,
    before,
    after,
    req,
  });
  await client.query(
    `INSERT INTO centrifugo_outbox(method, payload)
     VALUES ('publish', jsonb_build_object(
       'channel', 'tenant.' || $1::text || '.dashboard',
       'data', jsonb_build_object('type','stamp_admin', 'action', $2::text, 'stamp_id', $3::text)
     ))`,
    [tenantId, action, resourceId]
  );
}

export { adminStampsRouter as default };
