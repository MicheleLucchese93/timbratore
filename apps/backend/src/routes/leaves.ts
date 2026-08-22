import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { tenantHandler, type AfterCommit } from '../lib/route-helpers.js';
import { ok } from '../lib/api-response.js';
import { logAudit } from '../lib/audit.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors/index.js';
import {
  computeDurationHours,
  applyMalattiaOverlap,
  assertPerDayCap,
  assertPerDayCapForWindows,
  describeOverlap,
  lockLeaveUser,
  resolveMalattiaWindow,
  splitClosureAroundOverlaps,
  type StoredLeaveType,
} from '../lib/leave-quota.js';
import { TENANT_TZ_SQL } from '../lib/tz.js';
import {
  loadLeaveApproverIds,
  notifyLeaveSubmitted,
  notifyLeaveDecided,
  notifyLeaveAddedByAdmin,
  notifyCancellationRequested,
  notifyCancellationDecided,
  notifyBulkEvent,
} from '../lib/notifications.js';

export const leavesRouter = Router();
leavesRouter.use(authenticate);

const TypeEnum = z.enum(['ferie', 'permessi', 'malattia', 'assenza']);

const ASSENZA_SUBTYPES = [
  'lutto',
  'donazione_sangue',
  'permesso_studio',
  'permesso_elettorale',
  'matrimonio',
  'allattamento',
  'congedo_parentale',
  'legge_104',
  'assemblea_sindacale',
  'visita_medica',
  'motivi_personali',
] as const;
const AssenzaSubtypeEnum = z.enum(ASSENZA_SUBTYPES);

const CreateBody = z.object({
  type: TypeEnum,
  from_ts: z.string().datetime({ offset: true }),
  to_ts: z.string().datetime({ offset: true }),
  // All-day request (full scheduled day) vs a specific-time permesso. Only
  // gates the 15-minute-multiple rule below; the duration itself always comes
  // from the shift template / clip in computeDurationHours. Defaults to false
  // so specific-time requests keep the strict validation.
  all_day: z.boolean().optional(),
  inps_protocol: z.string().min(1).max(100).optional(),
  user_note: z.string().max(1000).optional(),
  assenza_subtype: AssenzaSubtypeEnum.optional(),
  is_paid: z.boolean().optional(),
});

function quarterMs(): number {
  return 15 * 60 * 1000;
}

async function loadRequest(client: PoolClient, id: string) {
  const r = await client.query(`SELECT * FROM leave_requests WHERE id = $1`, [id]);
  if (r.rowCount === 0) throw new NotFoundError('leave_request');
  return r.rows[0];
}

/**
 * The only sanctioned way for a /leaves/:id/* handler to get a row it intends
 * to mutate.
 *
 * It enforces the lock order documented in lib/leave-quota.ts — advisory user
 * lock FIRST, leave_requests row lock second. These routes have a chicken/egg
 * problem: the lock is keyed by employee and the employee is only known once
 * the row is read. Doing the obvious thing (SELECT … FOR UPDATE, then
 * assertPerDayCap) is what put the row lock first and opened the 40P01 deadlock
 * against the malattia path, which takes the advisory lock and then updates the
 * very same rows.
 *
 * So: read user_id with a plain, *unlocked* SELECT, take the advisory lock, and
 * only then re-read FOR UPDATE. The unlocked peek can go stale in exactly one
 * harmless way — the row could be deleted between the two reads (nothing in the
 * app deletes leave rows; they are status-transitioned), which the second read
 * catches. user_id itself is never updated, so the lock we took is always the
 * right one, and every status/state check the caller makes runs on the re-read
 * row.
 */
export async function lockRequestForUpdate(client: PoolClient, id: string) {
  const peek = await client.query(`SELECT user_id FROM leave_requests WHERE id = $1`, [id]);
  if (peek.rowCount === 0) throw new NotFoundError('leave_request');
  await lockLeaveUser(client, peek.rows[0].user_id as string);
  const r = await client.query(`SELECT * FROM leave_requests WHERE id = $1 FOR UPDATE`, [id]);
  if (r.rowCount === 0) throw new NotFoundError('leave_request');
  return r.rows[0];
}

async function logEvent(
  client: PoolClient,
  requestId: string,
  action: string,
  payload: Record<string, unknown> | null = null
): Promise<void> {
  await client.query(
    `INSERT INTO leave_audit_log(tenant_id, request_id, actor_user_id, action, payload)
     VALUES (current_setting('app.current_tenant_id')::uuid,
             $1,
             current_setting('app.current_user_id')::uuid,
             $2, $3::jsonb)`,
    [requestId, action, payload ? JSON.stringify(payload) : null]
  );
}

async function hasAnyApprover(client: PoolClient, requesterId: string): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM leave_approvers WHERE user_id = $1 LIMIT 1`,
    [requesterId]
  );
  return (r.rowCount ?? 0) > 0;
}

async function isApprover(
  client: PoolClient,
  approverId: string,
  requesterId: string
): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM leave_approvers WHERE user_id = $1 AND approver_user_id = $2`,
    [requesterId, approverId]
  );
  return (r.rowCount ?? 0) > 0;
}

async function assertCanDecide(
  client: PoolClient,
  approverId: string,
  approverRole: 'admin' | 'user',
  requesterId: string
): Promise<void> {
  const configured = await hasAnyApprover(client, requesterId);
  if (configured) {
    if (!(await isApprover(client, approverId, requesterId))) {
      throw new ForbiddenError('non sei un approvatore di questo utente');
    }
    return;
  }
  if (approverRole !== 'admin') {
    throw new ForbiddenError('nessun approvatore configurato; solo gli admin possono decidere');
  }
}

leavesRouter.post(
  '/',
  tenantHandler(async (req, res, client, afterCommit) => {
    const parse = CreateBody.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;

    const from = new Date(b.from_ts);
    const to = new Date(b.to_ts);
    if (to.getTime() <= from.getTime()) {
      throw new ValidationError('to_ts deve essere maggiore di from_ts');
    }
    // Specific-time permessi must be clean 15-minute slots. An all-day permesso
    // is exempt — its span is the whole calendar day and its duration comes from
    // the shift template, not the raw start/end.
    if (b.type === 'permessi' && !b.all_day) {
      const span = to.getTime() - from.getTime();
      if (span % quarterMs() !== 0) {
        throw new ValidationError('il permesso deve essere multiplo di 15 minuti');
      }
      if (span < quarterMs()) {
        throw new ValidationError('durata minima del permesso: 15 minuti');
      }
    }
    if (b.type === 'malattia' && !b.inps_protocol) {
      throw new ValidationError('numero protocollo INPS obbligatorio per malattia');
    }
    if (b.type === 'assenza') {
      if (!b.assenza_subtype) {
        throw new ValidationError('tipologia di assenza obbligatoria');
      }
      if (b.is_paid === undefined) {
        throw new ValidationError('specifica se l\'assenza è retribuita');
      }
    }

    const userId = req.user!.id;
    // Step 1 of the lock order (lib/leave-quota.ts): claim this employee before
    // touching any leave row. The malattia branch below row-locks the user's
    // *other* requests through applyMalattiaOverlap, and those row locks must
    // never come first.
    await lockLeaveUser(client, userId);

    // What actually gets stored. For malattia it can be shorter than what was
    // asked: a "certificato di continuazione" is issued ON the last day the
    // previous certificate covers, so its first day is already certified and
    // must be recorded once, under the protocol that claimed it. Refusing the
    // whole request instead — which is what the plain duplicate guard did —
    // left the employee with no way out at all, since neither
    // /request-cancellation nor /cancel accepts a malattia.
    let fromTs = b.from_ts;
    let toTs = b.to_ts;
    let alreadyCovered: string[] = [];
    if (b.type === 'malattia') {
      const resolved = await resolveMalattiaWindow(
        client,
        userId,
        b.from_ts,
        b.to_ts,
        // Checked above: a malattia without its INPS protocol never gets here.
        b.inps_protocol!,
        null
      );
      fromTs = resolved.fromTs;
      toTs = resolved.toTs;
      alreadyCovered = resolved.alreadyCovered;
    }

    const duration = await computeDurationHours(client, userId, b.type, fromTs, toTs);
    if (duration <= 0) {
      throw new ValidationError(
        'la richiesta non copre ore lavorative (verifica l\'orario assegnato)'
      );
    }

    // Per-day cap: the sum of (existing active requests + this one) cannot
    // exceed the user's timesheet hours for any single day, and the window may
    // not duplicate an active request of the same type. malattia is exempt from
    // the hours half — it deliberately overrides overlapping rows via
    // applyMalattiaOverlap below — and its same-type question was already
    // answered by resolveMalattiaWindow, on the window being stored.
    await assertPerDayCap(client, userId, b.type, fromTs, toTs, null);

    // Quota balance is informational only. Submissions never blocked: companies
    // decide policy themselves and the counter is allowed to go negative.
    const status = b.type === 'malattia' ? 'approved' : 'pending';
    const ins = await client.query(
      `INSERT INTO leave_requests(
         tenant_id, user_id, type, status,
         from_ts, to_ts, duration_hours,
         inps_protocol, user_note,
         assenza_subtype, is_paid,
         decided_by, decided_at
       ) VALUES (
         current_setting('app.current_tenant_id')::uuid,
         current_setting('app.current_user_id')::uuid,
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
       ) RETURNING *`,
      [
        b.type,
        status,
        fromTs,
        toTs,
        duration,
        b.inps_protocol ?? null,
        b.user_note ?? null,
        b.type === 'assenza' ? b.assenza_subtype ?? null : null,
        b.type === 'assenza' ? b.is_paid ?? null : null,
        b.type === 'malattia' ? userId : null,
        b.type === 'malattia' ? new Date().toISOString() : null,
      ]
    );
    const row = ins.rows[0];
    await logEvent(client, row.id, 'submit', {
      type: b.type,
      duration_hours: duration,
      // Only when the two differ, so the ordinary submit's payload is unchanged.
      // A continuation records fewer days than the certificate names, and the
      // trail has to say which days went where — the alternative is an employee
      // and an admin reading the same certificate off two different windows.
      ...(alreadyCovered.length > 0
        ? {
            requested_from: b.from_ts,
            requested_to: b.to_ts,
            already_certified_days: alreadyCovered,
          }
        : {}),
    });

    if (b.type === 'malattia') {
      const result = await applyMalattiaOverlap(client, userId, row.id, fromTs, toTs);
      if (result.supersededIds.length > 0 || result.trimmedIds.length > 0) {
        await logEvent(client, row.id, 'malattia.overlap_applied', {
          superseded: result.supersededIds,
          trimmed: result.trimmedIds,
          // Only when there is one, so an ordinary sick note's payload is
          // unchanged. A certificate falling INSIDE a holiday leaves the
          // employee with two rows where they filed one; without this the days
          // after the certificate look like they were dropped, which is exactly
          // what they used to be.
          ...(result.splits.length > 0 ? { split: result.splits } : {}),
        });
        for (const sid of result.supersededIds) {
          await logEvent(client, sid, 'superseded_by_malattia', { malattia_id: row.id });
        }
        for (const tid of result.trimmedIds) {
          await logEvent(client, tid, 'trimmed_by_malattia', { malattia_id: row.id });
        }
        // Both halves get the link, in both directions: an admin opening either
        // row has to be able to reach the other one and the certificate that
        // separated them.
        for (const s of result.splits) {
          await logEvent(client, s.originalId, 'split_by_malattia', {
            malattia_id: row.id,
            continuation_request_id: s.continuationId,
          });
          await logEvent(client, s.continuationId, 'resumed_after_malattia', {
            malattia_id: row.id,
            original_request_id: s.originalId,
          });
        }
      }
    } else {
      // Who to tell is a tenant-RLS read, so it has to happen on this client,
      // inside the transaction. The sending itself (Brevo SMTP + a fetch to
      // exp.host) does not — and must not, or it holds the employee's leave
      // lock and a pool connection for as long as the socket hangs.
      const approverIds = await loadLeaveApproverIds(client, userId);
      const tenantId = req.user!.tenantId;
      afterCommit(() =>
        notifyLeaveSubmitted(tenantId, approverIds, {
          requestId: row.id,
          type: b.type,
          // The stored window, not the requested one: they are the same for
          // every type that reaches here, and an approver must never be shown
          // a period the row does not hold.
          from_ts: fromTs,
          to_ts: toTs,
          duration_hours: duration,
          requester_id: userId,
          reason: b.user_note,
        })
      );
    }
    ok(res, row, 201);
  })
);

// Admin inserts ferie/permesso on behalf of one employee — used to resolve a
// schedule anomaly. Unlike POST '/', the rows are created already approved with
// the admin as decider, flagged created_by_admin, and the employee is notified.
// Quota is informational (never blocks), same as submit.
const AdminCreateBody = z.object({
  user_id: z.string().uuid(),
  type: z.enum(['ferie', 'permessi']),
  from_ts: z.string().datetime({ offset: true }),
  to_ts: z.string().datetime({ offset: true }),
  all_day: z.boolean().optional(),
  user_note: z.string().max(1000).optional(),
});

// Same body, one giornata cut into fasce. A separate schema rather than making
// from_ts/to_ts optional on AdminCreateBody: a body where two fields are
// required only when a third is absent is a shape every caller has to
// re-derive, and the two endpoints do not even answer the same thing (one leave
// row vs a giornata envelope).
const AdminCreateDayBody = z.object({
  user_id: z.string().uuid(),
  type: z.enum(['ferie', 'permessi']),
  // Ordered or not, the handler sorts. The ceiling is a sanity bound, not a
  // policy: no orario in shift_template_slots has anything like twelve fasce in
  // one day, and a set that large is a caller looping over a month by mistake —
  // which is exactly the shape that must not collapse into ONE notification.
  windows: z
    .array(
      z.object({
        from_ts: z.string().datetime({ offset: true }),
        to_ts: z.string().datetime({ offset: true }),
      })
    )
    .min(1)
    .max(12),
  all_day: z.boolean().optional(),
  user_note: z.string().max(1000).optional(),
});

/** A leave_requests row as the API hands it back — pg returns it untyped. */
interface LeaveRow {
  id: string;
  [column: string]: unknown;
}

/** What one giornata booked as one or more rows amounts to. */
export interface GiornataBooking {
  /** The created rows, earliest window first. */
  rows: LeaveRow[];
  /** Earliest start across the set. */
  from_ts: string;
  /** Latest end across the set. */
  to_ts: string;
  /** Sum of the rows' hours — the unpaid gap between two fasce is in neither. */
  duration_hours: number;
}

/**
 * How far apart the two ends of ONE giornata may be.
 *
 * A ceiling rather than "every window falls on the same Europe/Rome date": a
 * night turno legitimately runs 22:00 → 06:00 and belongs to one giornata while
 * touching two dates, and refusing it here would make this endpoint reach less
 * far than the single-window one it is meant to replace for split shifts. What
 * the bound does stop is the misuse the single notification would otherwise
 * hide — a caller handing in a month of windows and the employee getting one
 * "assenza inserita" naming a period nobody booked as a period.
 */
const GIORNATA_MAX_SPAN_MS = 24 * 60 * 60 * 1000;

/**
 * Book one employee's absence for ONE giornata — one window or several — all of
 * them or none.
 *
 * The defect this exists for. Since d99dd8a a permesso proposed over an orario
 * spezzato is booked one row PER FASCIA, so the unpaid gap between the fasce is
 * charged to nobody; apps/web Anomalies.tsx did that with a sequential,
 * non-atomic loop of POST /leaves/admin-create calls. Time System, fasce
 * 09:00-13:00 + 14:00-18:00, employee already holding an approved 1h permesso
 * 13:00-14:00 inside the gap: the day is proposed as two 4h parts, the first
 * passes the per-day cap (1h + 4h on 8h) and COMMITS, the second trips it
 * (9h on 8h) and fails. The giornata is left half-booked — half the hole
 * covered, half still an anomaly — and the panel does not refetch on error, so
 * there is no in-app way to finish or retry it.
 *
 * Everything the fix needs is therefore in ONE transaction, under ONE advisory
 * lock, judged over the WHOLE set: {@link assertPerDayCapForWindows} sums the
 * fasce per day before they meet the day's capacity, so a set that only
 * overflows jointly is refused before the first INSERT and the day is left
 * exactly as it was.
 *
 * Two properties are about the giornata rather than the row, and both would be
 * wrong if this were a loop over the single-row path:
 *
 *  - ONE notification. The employee was absent one day and is told once, with
 *    the giornata's own period (earliest start → latest end) and the hours
 *    actually booked. A row per fascia meant two "assenza inserita" pushes and
 *    two emails for one day. It is registered through afterCommit, so a
 *    rolled-back set sends nothing and no SMTP socket is ever held inside the
 *    transaction — see the hook's contract in lib/route-helpers.ts.
 *  - ONE audit_log entry, under the action leave.admin_create the Registro
 *    attività already renders, naming the giornata and listing the parts. A new
 *    AuditAction would have had to be mirrored in the union, the i18n labels and
 *    the category map for no gain: from the Registro's point of view an admin
 *    inserted one absence on one day, which is what the row already says.
 *
 * leave_audit_log stays per row — it is keyed by request_id and is the trail of
 * that specific request, so collapsing it would leave rows with no history.
 *
 * The one-window call is byte-identical to what POST /admin-create shipped:
 * same INSERT, same logEvent payload, same audit `after`, same notification.
 * That is why /admin-create now goes through here too — the alternative is two
 * implementations of one rule, and the day they drift is the day one of them
 * lets a double booking through.
 */
export async function createGiornataLeaves(
  client: PoolClient,
  input: {
    userId: string;
    type: 'ferie' | 'permessi';
    windows: ReadonlyArray<{ from_ts: string; to_ts: string }>;
    allDay: boolean;
    userNote: string | null;
  },
  ctx: { req: Request; afterCommit: AfterCommit }
): Promise<GiornataBooking> {
  // Sorted so the rows, the audit payload and the giornata's own period all
  // read in clock order whatever the caller sent.
  const windows = [...input.windows].sort(
    (a, b) => new Date(a.from_ts).getTime() - new Date(b.from_ts).getTime()
  );
  for (const w of windows) {
    const from = new Date(w.from_ts);
    const to = new Date(w.to_ts);
    if (to.getTime() <= from.getTime()) {
      throw new ValidationError('to_ts deve essere maggiore di from_ts');
    }
    if (input.type === 'permessi' && !input.allDay) {
      const span = to.getTime() - from.getTime();
      if (span % quarterMs() !== 0) {
        throw new ValidationError('il permesso deve essere multiplo di 15 minuti');
      }
      if (span < quarterMs()) {
        throw new ValidationError('durata minima del permesso: 15 minuti');
      }
    }
  }
  const fromTs = windows[0]!.from_ts;
  const toTs = windows.reduce(
    (latest, w) => (new Date(w.to_ts).getTime() > new Date(latest).getTime() ? w.to_ts : latest),
    windows[0]!.to_ts
  );
  if (new Date(toTs).getTime() - new Date(fromTs).getTime() > GIORNATA_MAX_SPAN_MS) {
    throw new ValidationError(
      'i periodi devono appartenere alla stessa giornata (massimo 24 ore tra inizio e fine)'
    );
  }

  const member = await client.query(
    `SELECT 1 FROM memberships
      WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
        AND user_id = $1 AND deleted_at IS NULL`,
    [input.userId]
  );
  if (member.rowCount === 0) throw new NotFoundError('user not in tenant');

  // Step 1 of the lock order (lib/leave-quota.ts), before any read the inserts
  // depend on. This is the endpoint the anomalies bulk bar calls, once per
  // selected row and in parallel, which is how Time System got 16h of ferie on
  // one day (August 2026). Taken ONCE for the whole giornata: every fascia of
  // this call is written under the same lock, so no concurrent writer can slip
  // between two of them either.
  await lockLeaveUser(client, input.userId);

  // Per window: a fascia that covers no scheduled hour is a 0h row nobody can
  // read, and the caller has to hear which one rather than get a total that
  // happens to be positive.
  const durations: number[] = [];
  for (const w of windows) {
    const d = await computeDurationHours(client, input.userId, input.type, w.from_ts, w.to_ts);
    if (d <= 0) {
      throw new ValidationError(
        'la richiesta non copre ore lavorative (verifica l\'orario assegnato)'
      );
    }
    durations.push(d);
  }
  const totalHours = Math.round(durations.reduce((sum, d) => sum + d, 0) * 100) / 100;

  // Same guards as POST '/': an admin insert may not book more hours on a date
  // than the employee is scheduled to work, nor duplicate an active request of
  // the same type. Over the whole SET, which is the half a loop of
  // single-window calls could not do — two fasce that each fit and jointly
  // overflow are refused here, before anything is written.
  await assertPerDayCapForWindows(
    client,
    input.userId,
    input.type,
    windows.map((w) => ({ fromTs: w.from_ts, toTs: w.to_ts })),
    null
  );

  const rows: LeaveRow[] = [];
  for (const [i, w] of windows.entries()) {
    const ins = await client.query<LeaveRow>(
      `INSERT INTO leave_requests(
         tenant_id, user_id, type, status,
         from_ts, to_ts, duration_hours,
         user_note, created_by_admin,
         decided_by, decided_at
       ) VALUES (
         current_setting('app.current_tenant_id')::uuid,
         $1, $2, 'approved', $3, $4, $5, $6, true,
         current_setting('app.current_user_id')::uuid, now()
       ) RETURNING *`,
      [input.userId, input.type, w.from_ts, w.to_ts, durations[i]!, input.userNote]
    );
    const row = ins.rows[0]!;
    rows.push(row);
    await logEvent(client, row.id, 'admin_create', {
      type: input.type,
      duration_hours: durations[i]!,
      on_behalf_of: input.userId,
      // Only when the giornata really was cut into fasce, so a single-window
      // insert records exactly the payload it always did. A row that is one of
      // several has to say so: on its own it looks like a half day the admin
      // chose, and the sibling it was booked with is the missing half.
      ...(windows.length > 1
        ? {
            part: i + 1,
            parts: windows.length,
            giornata_from: fromTs,
            giornata_to: toTs,
          }
        : {}),
    });
  }

  await logAudit(client, {
    action: 'leave.admin_create',
    resourceType: 'leave',
    resourceId: rows[0]!.id,
    targetUserId: input.userId,
    after: {
      type: input.type,
      date_from: fromTs,
      date_to: toTs,
      status: 'approved',
      // Additive, and only for a split giornata: the Registro detail dialog
      // renders the object field by field, and the single-row case must keep
      // showing the three keys it always showed.
      ...(windows.length > 1
        ? {
            parts: windows.map((w) => ({ from: w.from_ts, to: w.to_ts })),
            request_ids: rows.map((r) => r.id),
          }
        : {}),
    },
    req: ctx.req,
  });

  const tenantId = ctx.req.user!.tenantId;
  const adminId = ctx.req.user!.id;
  ctx.afterCommit(() =>
    notifyLeaveAddedByAdmin(
      tenantId,
      {
        requestId: rows[0]!.id,
        type: input.type,
        // The giornata, not the fascia: the employee was absent from the first
        // start to the last end, and duration_hours already says the unpaid gap
        // in between was charged to nobody.
        from_ts: fromTs,
        to_ts: toTs,
        duration_hours: totalHours,
        requester_id: input.userId,
        reason: input.userNote ?? undefined,
      },
      adminId
    )
  );

  return { rows, from_ts: fromTs, to_ts: toTs, duration_hours: totalHours };
}

leavesRouter.post(
  '/admin-create',
  requireAdmin,
  tenantHandler(async (req, res, client, afterCommit) => {
    const parse = AdminCreateBody.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    const booking = await createGiornataLeaves(
      client,
      {
        userId: b.user_id,
        type: b.type,
        windows: [{ from_ts: b.from_ts, to_ts: b.to_ts }],
        allDay: b.all_day ?? false,
        userNote: b.user_note ?? null,
      },
      { req, afterCommit }
    );
    // The created row itself, exactly as before — NOT the giornata envelope.
    // apps/web Anomalies.tsx, e2e/fixtures/api-client.ts adminCreateLeave and
    // the anomalies specs all read this response as a leave row.
    ok(res, booking.rows[0]!, 201);
  })
);

/**
 * The whole giornata in one atomic call: several windows, one employee, one
 * day.
 *
 * A NEW endpoint rather than an array on /admin-create, and the reason is the
 * response, not the body. /admin-create answers with the created leave row
 * itself — apps/web, e2e/fixtures/api-client.ts and the anomalies specs all
 * read `data` as a leave — so an array-mode would have to answer something else
 * on the same URL and every existing caller would need to know which shape it
 * is about to get. The guarantees differ too: this one promises all-or-nothing
 * over a set and exactly one notification, which is not what a caller of
 * /admin-create asked for. Two contracts, two URLs; /admin-create keeps its
 * body, its response and its behaviour byte-for-byte, and both run the same
 * code underneath.
 */
leavesRouter.post(
  '/admin-create-day',
  requireAdmin,
  tenantHandler(async (req, res, client, afterCommit) => {
    const parse = AdminCreateDayBody.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    const booking = await createGiornataLeaves(
      client,
      {
        userId: b.user_id,
        type: b.type,
        windows: b.windows,
        allDay: b.all_day ?? false,
        userNote: b.user_note ?? null,
      },
      { req, afterCommit }
    );
    ok(
      res,
      {
        leaves: booking.rows,
        count: booking.rows.length,
        from_ts: booking.from_ts,
        to_ts: booking.to_ts,
        duration_hours: booking.duration_hours,
      },
      201
    );
  })
);

// Filter enum is wider than TypeEnum: it also accepts 'chiusura' (company
// events) which users cannot create but the calendar must be able to filter.
const FilterTypeEnum = z.enum(['ferie', 'permessi', 'malattia', 'assenza', 'chiusura']);

const ListQuery = z.object({
  status: z.string().optional(),
  type: FilterTypeEnum.optional(),
  user_id: z.string().uuid().optional(),
  scope: z.enum(['mine', 'inbox', 'all']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

leavesRouter.get(
  '/',
  tenantHandler(async (req, res, client) => {
    const parse = ListQuery.safeParse(req.query);
    if (!parse.success) throw new ValidationError('invalid query', parse.error.flatten());
    const q = parse.data;
    const scope = q.scope ?? (req.user!.role === 'admin' ? 'all' : 'mine');

    const where: string[] = ['1=1'];
    const params: unknown[] = [];

    // Approver-inbox SQL: rows visible to a given approverId are either
    // explicitly mapped via leave_approvers OR, when the requester has no
    // approvers configured, fall back to admins.
    const inboxSql = (approverId: number, isAdminLiteral: string): string => `(
      EXISTS (
        SELECT 1 FROM leave_approvers la
         WHERE la.user_id = lr.user_id AND la.approver_user_id = $${approverId}
      )
      OR (
        ${isAdminLiteral} AND NOT EXISTS (
          SELECT 1 FROM leave_approvers la2 WHERE la2.user_id = lr.user_id
        )
      )
    )`;

    if (scope === 'mine') {
      params.push(req.user!.id);
      where.push(`lr.user_id = $${params.length}`);
    } else if (scope === 'inbox') {
      params.push(req.user!.id);
      where.push(inboxSql(params.length, req.user!.role === 'admin' ? 'TRUE' : 'FALSE'));
    } else if (scope === 'all') {
      if (req.user!.role !== 'admin') {
        params.push(req.user!.id);
        where.push(`(lr.user_id = $${params.length} OR ${inboxSql(params.length, 'FALSE')})`);
      }
    }
    if (q.status) {
      params.push(q.status);
      where.push(`lr.status = $${params.length}`);
    }
    if (q.type) {
      params.push(q.type);
      where.push(`lr.type = $${params.length}`);
    }
    if (q.user_id) {
      params.push(q.user_id);
      where.push(`lr.user_id = $${params.length}`);
    }
    if (q.from) {
      params.push(q.from);
      where.push(`lr.to_ts >= ($${params.length}::timestamp AT TIME ZONE ${TENANT_TZ_SQL})`);
    }
    if (q.to) {
      params.push(q.to);
      where.push(
        `lr.from_ts < (($${params.length}::date + 1)::timestamp AT TIME ZONE ${TENANT_TZ_SQL})`
      );
    }

    const sql = `
      SELECT lr.*,
             COALESCE(au.email, lr.user_id::text) AS user_email,
             au.display_name AS user_display_name,
             dec_au.display_name AS decided_by_display_name,
             COALESCE(dec_au.email, lr.decided_by::text) AS decided_by_email
        FROM leave_requests lr
        LEFT JOIN auth_users au ON au.id = lr.user_id
        LEFT JOIN auth_users dec_au ON dec_au.id = lr.decided_by
       WHERE ${where.join(' AND ')}
       ORDER BY lr.created_at DESC
       LIMIT 500`;
    const r = await client.query(sql, params);
    ok(res, r.rows);
  })
);

leavesRouter.get(
  '/:id',
  tenantHandler(async (req, res, client) => {
    const r = await client.query(
      `SELECT lr.*,
              COALESCE(au.email, lr.user_id::text) AS user_email,
              au.display_name AS user_display_name
         FROM leave_requests lr
         LEFT JOIN auth_users au ON au.id = lr.user_id
        WHERE lr.id = $1`,
      [req.params.id]
    );
    if (r.rowCount === 0) throw new NotFoundError('leave_request');
    const events = await client.query(
      `SELECT id, actor_user_id, action, payload, created_at
         FROM leave_audit_log
        WHERE request_id = $1
        ORDER BY created_at`,
      [req.params.id]
    );
    ok(res, { ...r.rows[0], events: events.rows });
  })
);

const RejectBody = z.object({ rejection_reason: z.string().min(1).max(500) });

leavesRouter.post(
  '/:id/approve',
  tenantHandler(async (req, res, client, afterCommit) => {
    const row = await lockRequestForUpdate(client, String(req.params.id));
    if (row.status !== 'pending') {
      throw new ConflictError('richiesta non più in attesa', 'NOT_PENDING');
    }
    await assertCanDecide(client, req.user!.id, req.user!.role, row.user_id);

    // Re-check the per-day cap and the same-type overlap in case other
    // requests landed between submit and approve. Exclude this row's id so an
    // exact-match self-overlap doesn't double-count. malattia is exempt
    // (assertPerDayCap short-circuits on type='malattia'). The advisory lock it
    // takes is already held — lockRequestForUpdate took it above, in the right
    // order.
    await assertPerDayCap(
      client,
      row.user_id,
      row.type as 'ferie' | 'permessi' | 'malattia' | 'assenza',
      typeof row.from_ts === 'string' ? row.from_ts : new Date(row.from_ts).toISOString(),
      typeof row.to_ts === 'string' ? row.to_ts : new Date(row.to_ts).toISOString(),
      row.id
    );

    // Approval never blocked by quota — see submission rationale.
    await client.query(
      `UPDATE leave_requests
          SET status = 'approved',
              decided_by = current_setting('app.current_user_id')::uuid,
              decided_at = now()
        WHERE id = $1`,
      [row.id]
    );
    await logEvent(client, row.id, 'approve');
    await logAudit(client, {
      action: 'leave.approve',
      resourceType: 'leave',
      resourceId: row.id,
      targetUserId: row.user_id,
      after: { type: row.type, date_from: row.from_ts, date_to: row.to_ts, status: 'approved' },
      req,
    });
    const tenantId = req.user!.tenantId;
    const approverId = req.user!.id;
    afterCommit(() =>
      notifyLeaveDecided(
        tenantId,
        {
          requestId: row.id,
          type: row.type,
          from_ts: row.from_ts,
          to_ts: row.to_ts,
          duration_hours: Number(row.duration_hours),
          requester_id: row.user_id,
        },
        'approved',
        approverId
      )
    );
    const updated = await loadRequest(client, row.id);
    ok(res, updated);
  })
);

leavesRouter.post(
  '/:id/reject',
  tenantHandler(async (req, res, client, afterCommit) => {
    const parse = RejectBody.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const row = await lockRequestForUpdate(client, String(req.params.id));
    if (row.status !== 'pending') {
      throw new ConflictError('richiesta non più in attesa', 'NOT_PENDING');
    }
    await assertCanDecide(client, req.user!.id, req.user!.role, row.user_id);

    await client.query(
      `UPDATE leave_requests
          SET status = 'rejected',
              decided_by = current_setting('app.current_user_id')::uuid,
              decided_at = now(),
              rejection_reason = $2
        WHERE id = $1`,
      [row.id, parse.data.rejection_reason]
    );
    await logEvent(client, row.id, 'reject', { reason: parse.data.rejection_reason });
    await logAudit(client, {
      action: 'leave.reject',
      resourceType: 'leave',
      resourceId: row.id,
      targetUserId: row.user_id,
      after: {
        type: row.type,
        date_from: row.from_ts,
        date_to: row.to_ts,
        status: 'rejected',
        reason: parse.data.rejection_reason,
      },
      req,
    });
    const tenantId = req.user!.tenantId;
    const approverId = req.user!.id;
    const rejectionReason = parse.data.rejection_reason;
    afterCommit(() =>
      notifyLeaveDecided(
        tenantId,
        {
          requestId: row.id,
          type: row.type,
          from_ts: row.from_ts,
          to_ts: row.to_ts,
          duration_hours: Number(row.duration_hours),
          requester_id: row.user_id,
        },
        'rejected',
        approverId,
        rejectionReason
      )
    );
    const updated = await loadRequest(client, row.id);
    ok(res, updated);
  })
);

leavesRouter.post(
  '/:id/cancel',
  tenantHandler(async (req, res, client) => {
    const row = await lockRequestForUpdate(client, String(req.params.id));
    if (row.user_id !== req.user!.id) {
      throw new ForbiddenError('solo l\'autore può annullare');
    }
    if (row.status !== 'pending') {
      throw new ConflictError('annullabile solo se in attesa', 'NOT_PENDING');
    }
    await client.query(
      `UPDATE leave_requests SET status = 'cancelled' WHERE id = $1`,
      [row.id]
    );
    await logEvent(client, row.id, 'cancel');
    const updated = await loadRequest(client, row.id);
    ok(res, updated);
  })
);

const CancelRequestBody = z.object({
  cancellation_reason: z.string().min(1).max(500),
});

leavesRouter.post(
  '/:id/request-cancellation',
  tenantHandler(async (req, res, client, afterCommit) => {
    const parse = CancelRequestBody.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const row = await lockRequestForUpdate(client, String(req.params.id));
    if (row.user_id !== req.user!.id) {
      throw new ForbiddenError('solo l\'autore può richiedere annullamento');
    }
    if (row.status !== 'approved') {
      throw new ConflictError(
        'annullamento richiedibile solo su richieste approvate',
        'NOT_APPROVED'
      );
    }
    if (row.type === 'malattia') {
      throw new ConflictError(
        'malattia non annullabile da utente — contatta admin',
        'NOT_ALLOWED'
      );
    }
    await client.query(
      `UPDATE leave_requests
          SET status = 'cancellation_pending',
              cancellation_reason = $2
        WHERE id = $1`,
      [row.id, parse.data.cancellation_reason]
    );
    await logEvent(client, row.id, 'request_cancellation', {
      reason: parse.data.cancellation_reason,
    });
    // Approver lookup inside the transaction (tenant-RLS read), delivery after
    // it — see the afterCommit contract in lib/route-helpers.ts.
    const approverIds = await loadLeaveApproverIds(client, row.user_id);
    const tenantId = req.user!.tenantId;
    const cancellationReason = parse.data.cancellation_reason;
    afterCommit(() =>
      notifyCancellationRequested(tenantId, approverIds, {
        requestId: row.id,
        type: row.type,
        from_ts: row.from_ts,
        to_ts: row.to_ts,
        duration_hours: Number(row.duration_hours),
        requester_id: row.user_id,
        reason: cancellationReason,
      })
    );
    const updated = await loadRequest(client, row.id);
    ok(res, updated);
  })
);

const DecideCancelBody = z.object({
  approve: z.boolean(),
  reason: z.string().max(500).optional(),
});

leavesRouter.post(
  '/:id/decide-cancellation',
  tenantHandler(async (req, res, client, afterCommit) => {
    const parse = DecideCancelBody.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const row = await lockRequestForUpdate(client, String(req.params.id));
    if (row.status !== 'cancellation_pending') {
      throw new ConflictError('nessuna richiesta di annullamento attiva', 'WRONG_STATE');
    }
    await assertCanDecide(client, req.user!.id, req.user!.role, row.user_id);

    const newStatus = parse.data.approve ? 'cancelled_post_approval' : 'approved';
    await client.query(
      `UPDATE leave_requests
          SET status = $2,
              cancellation_decided_by = current_setting('app.current_user_id')::uuid,
              cancellation_decided_at = now()
        WHERE id = $1`,
      [row.id, newStatus]
    );
    await logEvent(client, row.id, 'decide_cancellation', {
      approve: parse.data.approve,
      reason: parse.data.reason ?? null,
    });
    await logAudit(client, {
      action: 'leave.decide_cancellation',
      resourceType: 'leave',
      resourceId: row.id,
      targetUserId: row.user_id,
      after: {
        type: row.type,
        date_from: row.from_ts,
        date_to: row.to_ts,
        status: newStatus,
        reason: parse.data.reason ?? null,
      },
      req,
    });
    const tenantId = req.user!.tenantId;
    const accepted = parse.data.approve;
    afterCommit(() =>
      notifyCancellationDecided(
        tenantId,
        {
          requestId: row.id,
          type: row.type,
          from_ts: row.from_ts,
          to_ts: row.to_ts,
          duration_hours: Number(row.duration_hours),
          requester_id: row.user_id,
        },
        accepted
      )
    );
    const updated = await loadRequest(client, row.id);
    ok(res, updated);
  })
);

// Admin force-cancel (e.g. after revoking malattia).
leavesRouter.post(
  '/:id/admin-revoke',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parse = z.object({ reason: z.string().min(1).max(500) }).safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const revoked = await lockRequestForUpdate(client, String(req.params.id));
    await client.query(
      `UPDATE leave_requests
          SET status = 'cancelled_post_approval',
              cancellation_decided_by = current_setting('app.current_user_id')::uuid,
              cancellation_decided_at = now(),
              cancellation_reason = $2
        WHERE id = $1`,
      [req.params.id, parse.data.reason]
    );
    await logEvent(client, String(req.params.id), 'admin_revoke', { reason: parse.data.reason });
    await logAudit(client, {
      action: 'leave.admin_revoke',
      resourceType: 'leave',
      resourceId: String(req.params.id),
      targetUserId: revoked.user_id,
      after: {
        type: revoked.type,
        date_from: revoked.from_ts,
        date_to: revoked.to_ts,
        status: 'cancelled_post_approval',
        reason: parse.data.reason,
      },
      req,
    });
    const updated = await loadRequest(client, String(req.params.id));
    ok(res, updated);
  })
);

/* ----- Admin bulk company events (e.g. "Chiusura aziendale agosto") ----- */

const BulkBody = z.object({
  title: z.string().min(1).max(200),
  from_ts: z.string().datetime({ offset: true }),
  to_ts: z.string().datetime({ offset: true }),
  // false → non-deducting 'chiusura'; true → approved 'ferie' that consumes quota.
  deduct_ferie: z.boolean().default(false),
  // Omitted/empty → every active member of the tenant.
  user_ids: z.array(z.string().uuid()).optional(),
  user_note: z.string().max(1000).optional(),
});

leavesRouter.post(
  '/bulk',
  requireAdmin,
  tenantHandler(async (req, res, client, afterCommit) => {
    const parse = BulkBody.safeParse(req.body);
    if (!parse.success) throw new ValidationError('invalid body', parse.error.flatten());
    const b = parse.data;
    if (new Date(b.to_ts).getTime() <= new Date(b.from_ts).getTime()) {
      throw new ValidationError('to_ts deve essere maggiore di from_ts');
    }

    let userIds = b.user_ids ?? [];
    if (userIds.length === 0) {
      const all = await client.query(
        `SELECT user_id FROM memberships
          WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
            AND active = TRUE
            AND deleted_at IS NULL`
      );
      userIds = all.rows.map((r) => r.user_id as string);
    }
    // Sorted, not just deduplicated: this transaction ends up holding one
    // advisory lock per user, and two concurrent bulks that grabbed overlapping
    // user sets in different orders would deadlock on each other. A total order
    // on the key makes that impossible.
    userIds = Array.from(new Set(userIds)).sort();
    if (userIds.length === 0) throw new ValidationError('nessun utente selezionato');

    const type: StoredLeaveType = b.deduct_ferie ? 'ferie' : 'chiusura';
    const batchRow = await client.query(`SELECT gen_random_uuid() AS id`);
    const batchId = batchRow.rows[0].id as string;

    const created: string[] = [];
    const skipped: Array<{ user_id: string; days: string[]; reason: string }> = [];
    let skippedDayCount = 0;
    for (const uid of userIds) {
      // Step 1 of the lock order (lib/leave-quota.ts). This endpoint used to
      // take no lock at all and call no guard, so it could duplicate an absence
      // that another request was creating at the same instant — the exact shape
      // of the August incident, just with the company closure as one of the two
      // writers.
      await lockLeaveUser(client, uid);

      // Deliberately NOT the full per-day cap. A closure is mandatory and
      // admin-imposed: an employee who already has a 2h permesso on a closure
      // day would push the day to 10h on an 8h capacity and the whole closure
      // would be refused for them, which is not what "chiusura aziendale"
      // means — payroll settles those hours by type, not by sum. What is never
      // legitimate is filing the SAME kind of absence twice over the same
      // window, so only the duplicate guard applies here. With deduct_ferie
      // that also means a closure will not double-book ferie the employee had
      // already been granted for those days.
      //
      // Day-granular, and that granularity is the fix: asking the guard about
      // the window as a whole and dropping the employee on any hit deleted the
      // other seven days of a Christmas closure for anyone with one ferie day
      // in the middle of it. splitClosureAroundOverlaps returns the free runs
      // to insert and names the days it had to drop.
      const split = await splitClosureAroundOverlaps(client, uid, type, b.from_ts, b.to_ts);
      if (split.blockedDays.length > 0) {
        skippedDayCount += split.blockedDays.length;
        skipped.push({
          user_id: uid,
          days: split.blockedDays.map((d) => d.iso),
          reason: describeOverlap(type, split.blockedDays[0]!.clash),
        });
      }
      if (split.segments.length === 0) continue;

      for (const seg of split.segments) {
        // Closures span whole days; hours follow the user's shift template, same
        // path 'ferie' uses. Per segment, not per closure: a split employee must
        // not be charged the hours of the days that were skipped.
        const duration = await computeDurationHours(client, uid, 'ferie', seg.fromTs, seg.toTs);
        const ins = await client.query(
          `INSERT INTO leave_requests(
             tenant_id, user_id, type, status, from_ts, to_ts, duration_hours,
             decided_by, decided_at, created_by_admin, batch_id, title, user_note
           ) VALUES (
             current_setting('app.current_tenant_id')::uuid, $1, $2, 'approved',
             $3, $4, $5,
             current_setting('app.current_user_id')::uuid, now(), TRUE, $6, $7, $8
           ) RETURNING id`,
          [uid, type, seg.fromTs, seg.toTs, duration, batchId, b.title, b.user_note ?? null]
        );
        await logEvent(client, ins.rows[0].id, 'admin_bulk_create', {
          batch_id: batchId,
          title: b.title,
          type,
          deduct_ferie: b.deduct_ferie,
          // The requested window and the granted one differ for a split
          // employee; the audit trail has to say which is which.
          requested_from: b.from_ts,
          requested_to: b.to_ts,
          skipped_days: split.blockedDays.map((d) => d.iso),
        });
      }
      created.push(uid);
    }

    // Every selected employee was fully covered → nothing happened, so do not
    // answer 201 with an empty batch. Throwing also rolls the transaction back,
    // so no orphan batch_id is left behind. Note this now means FULLY covered:
    // one free day anywhere in the window puts the employee in `created` and
    // the closure through.
    if (created.length === 0) {
      const first = skipped[0];
      throw new ConflictError(
        `Nessuna riga creata: tutti i ${skipped.length} dipendenti selezionati hanno già un'assenza dello stesso tipo per ogni giorno del periodo.${first ? ` ${first.reason}` : ''}`,
        'LEAVE_OVERLAP'
      );
    }

    await logAudit(client, {
      action: 'leave.bulk_create',
      resourceType: 'leave',
      resourceId: batchId,
      after: {
        type,
        date_from: b.from_ts,
        date_to: b.to_ts,
        user_count: created.length,
        skipped_count: skipped.length,
        skipped_day_count: skippedDayCount,
      },
      req,
    });

    // Only the employees who actually got a row. notifyBulkEvent needs no
    // transactional client (it reads recipients through adminPool), so this is
    // purely about not holding the closure's locks across an SMTP run. The
    // notification announces the closure's window, which is the company fact
    // even for an employee whose own rows skip a day of it — their calendar
    // shows what they were actually granted.
    const tenantId = req.user!.tenantId;
    afterCommit(() =>
      notifyBulkEvent(tenantId, created, {
        title: b.title,
        from_ts: b.from_ts,
        to_ts: b.to_ts,
        deducts_ferie: b.deduct_ferie,
        batchId,
      })
    );

    // skipped[] names the employee AND the days: a closure that silently missed
    // three days of one person's window would otherwise be discovered in the
    // payroll export. apps/web BulkEventModal renders it instead of closing on
    // success — a 201 the admin never reads is how the holes stayed invisible.
    // Additive fields; existing callers read batch_id / created_count /
    // user_ids and are unaffected.
    ok(
      res,
      {
        batch_id: batchId,
        created_count: created.length,
        user_ids: created,
        skipped_count: skipped.length,
        skipped_day_count: skippedDayCount,
        skipped,
      },
      201
    );
  })
);

leavesRouter.post(
  '/bulk/:batchId/revoke',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const parsed = z.string().uuid().safeParse(req.params.batchId);
    if (!parsed.success) throw new ValidationError('batchId non valido');

    // Same lock order as everywhere else, even though this handler cannot
    // deadlock on its own (it takes only row locks, and a transaction that
    // never waits on an advisory lock can never close the cycle). Taking them
    // keeps the invariant uniform — "no leave row is written without its
    // employee's lock" — and, more usefully, stops this bulk UPDATE from
    // interleaving with a malattia sweep that is mid-flight on one of the same
    // rows. Sorted for the same reason as POST /bulk. The owner set cannot grow
    // underneath us: only POST /bulk inserts rows for a batch_id, and it
    // generates a fresh one per call.
    //
    // Keying on batch_id alone — never on one row per employee — is also what
    // lets POST /bulk split a closure around days an employee already had
    // booked: an employee with three segments revokes exactly like one with a
    // single row, and DISTINCT collapses their locks to one.
    const owners = await client.query(
      `SELECT DISTINCT user_id
         FROM leave_requests
        WHERE batch_id = $1
          AND status = 'approved'
        ORDER BY user_id`,
      [parsed.data]
    );
    for (const o of owners.rows) await lockLeaveUser(client, o.user_id as string);

    const r = await client.query(
      `UPDATE leave_requests
          SET status = 'cancelled_post_approval',
              cancellation_decided_by = current_setting('app.current_user_id')::uuid,
              cancellation_decided_at = now(),
              cancellation_reason = COALESCE(cancellation_reason, 'Evento aziendale annullato')
        WHERE batch_id = $1
          AND status = 'approved'
        RETURNING id`,
      [parsed.data]
    );
    if (r.rowCount) {
      await logAudit(client, {
        action: 'leave.bulk_revoke',
        resourceType: 'leave',
        resourceId: parsed.data,
        after: { revoked_count: r.rowCount },
        req,
      });
    }
    ok(res, { revoked_count: r.rowCount ?? 0 });
  })
);
