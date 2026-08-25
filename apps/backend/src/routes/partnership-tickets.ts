import { Router, raw } from 'express';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { adminPool } from '../lib/admin-db.js';
import { ok } from '../lib/api-response.js';
import { asyncHandler } from '../lib/route-helpers.js';
import { AppError, ForbiddenError, NotFoundError, ValidationError } from '../errors/index.js';
import { authenticatePartner } from '../middleware/partnership-auth.js';
import type { PartnerContext } from '../middleware/partnership-auth.js';
import { logPartnershipAudit, type PartnershipAction } from '../lib/partnership-audit.js';
import { storagePut } from '../lib/storage.js';
import { attachmentKey, streamAttachment } from './tickets.js';
import { notifyOperatorReply, notifyStatusChange } from '../lib/ticket-notifications.js';
import { createLogger } from '../lib/logger.js';
import {
  TICKET_ATTACHMENT_MAX_BYTES,
  TICKET_ATTACHMENT_MAX_FILES,
  TICKET_BODY_MAX,
  TICKET_HANDLING_STATUSES,
  TICKET_NOTE_MAX,
  isTicketAttachmentMime,
  type TicketHandlingStatus,
} from '@sonoqui/shared';

const logger = createLogger('partnership-tickets');

/**
 * The support queue, from the OPERATOR's side (migration 061).
 *
 * WHERE IT LIVES. Under the partnership prefix, because that is the only operator
 * surface there is and it already has what this needs: a GoTrue token resolved
 * against `partnership_members`, an append-only audit log, and the owner pool.
 *
 * WHO MAY USE IT: BOTH partnership roles — `authenticatePartner` and not
 * `requirePartnershipAdmin`. A platform admin manages every ticket on the
 * platform; a partner manages the tickets of the tenants THEY provisioned
 * (`tenants.created_by_partner`), which is the same scope rule their Aziende page
 * uses. A tenant created by an admin belongs to no partner and is platform work.
 * The scoping is the WHERE clause in `scopeSql()` — there is no role check in the
 * handlers pretending to do it, and there must not appear to be one.
 *
 * WHAT AN OPERATOR CAN SEE, stated plainly because it is a disclosure: the
 * subject, the whole request, every reply and every attachment. A ticket body can
 * name an employee. That is the cost of a reseller being able to answer at all,
 * which is why every write here lands in `partnership_audit_log`.
 *
 * WHAT AN OPERATOR CANNOT DO: touch `status`, the customer's own "I no longer
 * need an answer" flag. There is no route for it, deliberately — it is the one
 * thing on the row that is a statement BY the customer rather than about them.
 */
export const partnershipTicketsRouter = Router();
partnershipTicketsRouter.use(authenticatePartner);

function partner(req: Request): PartnerContext {
  if (!req.partner) throw new ForbiddenError('Not a partnership member', 'NOT_PARTNERSHIP_MEMBER');
  return req.partner;
}

/**
 * The scope predicate plus the parameters it needs.
 *
 * `nextParam` is the 1-based index the caller's next placeholder would take, so
 * the fragment appends to a query that already has parameters. The admin branch
 * consumes none. Written once, for the reason every scope predicate in this
 * codebase is written once: getting it wrong in one query out of ten is how a
 * reseller reads another reseller's customer list.
 */
function scopeSql(p: PartnerContext, nextParam: number): { sql: string; params: unknown[] } {
  if (p.role === 'admin') return { sql: 'TRUE', params: [] };
  return { sql: `tn.created_by_partner = $${nextParam}`, params: [p.userId] };
}

const CONSOLE_COLUMNS = `
  t.id, t.ref, t.subject, t.body, t.category, t.priority, t.status,
  t.handling_status, t.handling_updated_at, t.assigned_to, t.internal_note,
  t.last_message_at, t.created_at, t.resolved_at, t.tenant_id,
  tn.ragione_sociale AS tenant_name,
  tn.created_by_partner AS managed_by_partner,
  pau.email AS partner_email,
  au.email  AS opened_by_email,
  COALESCE(
    NULLIF(au.display_name, ''),
    NULLIF(TRIM(CONCAT_WS(' ', au.first_name, au.last_name)), ''),
    au.email
  ) AS opened_by_name,
  -- The assignee by name where the member row has one, by email otherwise: an
  -- operator needs to know WHO holds it, and an empty cell reads as unassigned
  -- when it would really mean "a member with no display name".
  COALESCE(NULLIF(asg.display_name, ''), asg.email) AS assignee_label,
  (SELECT count(*) FROM support_ticket_messages m WHERE m.ticket_id = t.id)::int AS message_count,
  -- CUSTOMER messages the team has not read. Drives the "ha risposto" badge.
  (
    SELECT count(*) FROM support_ticket_messages m
     WHERE m.ticket_id = t.id
       AND m.author_role = 'user'
       AND (t.operator_last_read_at IS NULL OR m.created_at > t.operator_last_read_at)
  )::int AS unread_count
`;

const CONSOLE_FROM = `
  FROM support_tickets t
  JOIN tenants tn ON tn.id = t.tenant_id
  LEFT JOIN auth_users au ON au.id = t.user_id
  LEFT JOIN auth_users pau ON pau.id = tn.created_by_partner
  LEFT JOIN auth_users asg ON asg.id = t.assigned_to
`;

const uuid = z.string().uuid();

/**
 * The console's row. Only the fields the handlers actually reason about are
 * named; the rest ride along to the client, which is why the index signature is
 * there rather than a full mirror of CONSOLE_COLUMNS that would drift.
 */
interface ConsoleRow extends Record<string, unknown> {
  id: string;
  ref: string;
  tenant_id: string;
  handling_status: TicketHandlingStatus;
  assigned_to: string | null;
  internal_note: string | null;
}

/** One ticket, or null when it is outside this caller's scope. */
async function getScoped(p: PartnerContext, ticketId: string): Promise<ConsoleRow | null> {
  const s = scopeSql(p, 2);
  const r = await adminPool.query<ConsoleRow>(
    `SELECT ${CONSOLE_COLUMNS} ${CONSOLE_FROM} WHERE t.id = $1 AND ${s.sql}`,
    [ticketId, ...s.params]
  );
  return r.rows[0] ?? null;
}

/**
 * One audit row per mutation.
 *
 * `targetLabel` is the REFERENCE and not the subject: the reference is what a
 * reply quotes and what an operator would search the log for, and a subject line
 * can carry an employee's name into a table that is never erased.
 */
async function audit(
  req: Request,
  action: Extract<PartnershipAction, `ticket.${string}`>,
  ticket: Pick<ConsoleRow, 'id' | 'ref'>,
  detail: { before?: unknown; after?: unknown },
  client?: import('pg').PoolClient
): Promise<void> {
  const p = partner(req);
  await logPartnershipAudit(
    {
      actorUserId: p.userId,
      actorRole: p.role,
      action,
      targetType: 'ticket',
      targetId: ticket.id,
      targetLabel: ticket.ref,
      ...detail,
      ip: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    },
    client
  );
}

/* ----- GET /api/v1/partnership/tickets — the worklist ----- */
const ListQuery = z.object({
  handling: z.enum(['aperti', 'tutti', ...TICKET_HANDLING_STATUSES]).default('aperti'),
  assignment: z.enum(['tutte', 'mie', 'non_assegnate']).default('tutte'),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

partnershipTicketsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const p = partner(req);
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) throw new ValidationError('invalid query', parsed.error.flatten());
    const f = parsed.data;

    const params: unknown[] = [];
    const where: string[] = [];
    const s = scopeSql(p, params.length + 1);
    where.push(s.sql);
    params.push(...s.params);

    if (f.handling === 'aperti') {
      // "Da lavorare": the work, not the archive.
      //
      // `status <> 'resolved'` matters as much as the team's own state here. The
      // customer's flag is theirs, and the console has no control that touches
      // it — but "non mi serve più una risposta" is exactly the sentence that
      // means there is no work left, whatever state we had reached. Without this
      // a request the customer settled themselves sits in the queue as «Nuova»
      // for good, and the queue stops being a list of things to do.
      //
      // It is a FILTER, not a state change: nothing writes handling_status on
      // their behalf, the request keeps whatever we had said about it, and a
      // reopen puts it straight back in the queue.
      where.push(`t.handling_status NOT IN ('risolto', 'chiuso') AND t.status <> 'resolved'`);
    } else if (f.handling !== 'tutti') {
      params.push(f.handling);
      where.push(`t.handling_status = $${params.length}`);
    }

    if (f.assignment === 'mie') {
      params.push(p.userId);
      where.push(`t.assigned_to = $${params.length}`);
    } else if (f.assignment === 'non_assegnate') {
      where.push('t.assigned_to IS NULL');
    }

    if (f.q) {
      params.push(`%${f.q}%`);
      const ph = `$${params.length}`;
      where.push(
        `(t.ref ILIKE ${ph} OR t.subject ILIKE ${ph} OR tn.ragione_sociale ILIKE ${ph} OR au.email ILIKE ${ph})`
      );
    }

    const whereSql = where.join(' AND ');
    const total = await adminPool.query(
      `SELECT count(*)::int AS n ${CONSOLE_FROM} WHERE ${whereSql}`,
      params
    );

    params.push(f.limit, f.offset);
    const rows = await adminPool.query(
      // Oldest first inside the open view, newest first otherwise: a queue is
      // worked from the front — the ticket that has waited longest is the one that
      // matters — while the archive is read as a history.
      `SELECT ${CONSOLE_COLUMNS} ${CONSOLE_FROM}
        WHERE ${whereSql}
        ORDER BY ${f.handling === 'aperti' ? 't.created_at ASC, t.id ASC' : 't.created_at DESC, t.id DESC'}
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    ok(res, { items: rows.rows, total: total.rows[0]?.n ?? 0 });
  })
);

/* ----- GET /api/v1/partnership/tickets/meta/assignees -----
 * Admin only, because only an admin may assign to somebody other than
 * themselves: a partner's picker has exactly two entries — themselves and
 * nobody — and both are known to the client without asking. Declared before
 * '/:id' so the literal path wins over the parameter. */
partnershipTicketsRouter.get(
  '/meta/assignees',
  asyncHandler(async (req, res) => {
    const p = partner(req);
    if (p.role !== 'admin') {
      ok(res, []);
      return;
    }
    const r = await adminPool.query(
      `SELECT pm.user_id, pm.role,
              COALESCE(NULLIF(au.display_name, ''), au.email) AS label,
              au.email
         FROM partnership_members pm
         JOIN auth_users au ON au.id = pm.user_id
        WHERE pm.active
        ORDER BY pm.role, COALESCE(NULLIF(au.display_name, ''), au.email)`
    );
    ok(res, r.rows);
  })
);

/* ----- GET /api/v1/partnership/tickets/:id — the whole ticket ----- */
partnershipTicketsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const p = partner(req);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw new NotFoundError('ticket');
    const ticket = await getScoped(p, id.data);
    // Out of scope and nonexistent are the same answer, so the 404 cannot be used
    // to discover which tickets exist.
    if (!ticket) throw new NotFoundError('ticket');

    const [messages, attachments, events] = await Promise.all([
      adminPool.query(
        `SELECT id, author_role, author_label, body, created_at
           FROM support_ticket_messages WHERE ticket_id = $1 ORDER BY created_at, id`,
        [id.data]
      ),
      adminPool.query(
        `SELECT id, message_id, filename, mime, size_bytes, uploaded_by
           FROM support_ticket_attachments WHERE ticket_id = $1 ORDER BY created_at, id`,
        [id.data]
      ),
      adminPool.query(
        `SELECT id, kind, from_status, to_status, at FROM support_ticket_events
          WHERE ticket_id = $1 ORDER BY at, id`,
        [id.data]
      ),
    ]);

    // Opening it IS the event, same as on the customer's side.
    await adminPool.query(
      `UPDATE support_tickets SET operator_last_read_at = now() WHERE id = $1`,
      [id.data]
    );

    // The console assembles its own thread rather than reusing the customer's
    // helper, for one reason: it DOES name whoever answered. `author_label` is
    // frozen at write time, so an old reply keeps its author after the member row
    // is renamed or removed — and it must never reach the customer's payload.
    const byMessage = new Map<string, Record<string, unknown>[]>();
    for (const a of attachments.rows) {
      const list = byMessage.get(a.message_id) ?? [];
      list.push({
        id: a.id,
        filename: a.filename,
        mime: a.mime,
        size_bytes: a.size_bytes,
        uploaded_by: a.uploaded_by,
      });
      byMessage.set(a.message_id, list);
    }

    ok(res, {
      // From the row as read, so unread_count still describes what the operator is
      // about to see rather than the zero just written.
      ticket,
      messages: messages.rows.map((m) => ({
        id: m.id,
        author: m.author_role,
        author_label: m.author_label ?? null,
        body: m.body,
        created_at: m.created_at,
        attachments: byMessage.get(m.id) ?? [],
      })),
      events: events.rows,
    });
  })
);

/* ----- PATCH /api/v1/partnership/tickets/:id — status, assignment, note ----- */
const Patch = z
  .object({
    handling_status: z.enum(TICKET_HANDLING_STATUSES).optional(),
    /**
     * 'me' claims it, null hands it back, a uuid assigns it to another member —
     * which only a platform admin may do (a partner has no business naming
     * another partner's staff).
     */
    assigned_to: z.union([z.literal('me'), uuid, z.null()]).optional(),
    internal_note: z.string().max(TICKET_NOTE_MAX).nullable().optional(),
  })
  .refine(
    (v) =>
      v.handling_status !== undefined ||
      v.assigned_to !== undefined ||
      v.internal_note !== undefined,
    { message: 'nothing to update' }
  );

partnershipTicketsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const p = partner(req);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw new NotFoundError('ticket');
    const parsed = Patch.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('invalid update', parsed.error.flatten());
    const d = parsed.data;

    const before = await getScoped(p, id.data);
    if (!before) throw new NotFoundError('ticket');
    let current = before;

    // THE THREE FIELDS ARRIVE IN ONE REQUEST BUT ARE APPLIED AS SEPARATE
    // STATEMENTS, each with its own audit row. A single 'ticket.update' entry
    // carrying a diff would make "who closed this" a question you answer by
    // reading JSON; separate actions make it a query on one column.
    if (d.assigned_to !== undefined) {
      const assignee = d.assigned_to === 'me' ? p.userId : d.assigned_to;
      if (assignee && assignee !== p.userId && p.role !== 'admin') {
        throw new AppError({
          status: 403,
          code: 'TICKET_ASSIGN_FORBIDDEN',
          message: 'Solo un amministratore può assegnare una richiesta a un altro operatore.',
        });
      }
      if (assignee && assignee !== p.userId) {
        // The FK would refuse an unknown id, but an INACTIVE member is a valid row
        // and assigning to one is how a ticket ends up owned by somebody who can
        // no longer sign in.
        const m = await adminPool.query(
          `SELECT 1 FROM partnership_members WHERE user_id = $1 AND active`,
          [assignee]
        );
        if (m.rowCount === 0) {
          throw new AppError({
            status: 400,
            code: 'TICKET_ASSIGNEE_INVALID',
            message: 'Operatore non trovato o disattivato.',
          });
        }
      }
      // Taking a ticket in charge also moves `nuovo` on to `in_lavorazione` — one
      // click, because an operator who has claimed a ticket and left it marked new
      // has told the queue nothing. A later state is left alone: claiming one that
      // is `in_attesa_cliente` must not silently say the team is working again.
      await adminPool.query(
        `UPDATE support_tickets
            SET assigned_to = $2::uuid,
                handling_status = CASE
                  WHEN $2::uuid IS NOT NULL AND handling_status = 'nuovo' THEN 'in_lavorazione'
                  ELSE handling_status END,
                handling_updated_at = CASE
                  WHEN $2::uuid IS NOT NULL AND handling_status = 'nuovo' THEN now()
                  ELSE handling_updated_at END,
                updated_at = now()
          WHERE id = $1`,
        [id.data, assignee]
      );
      current = (await getScoped(p, id.data))!;
      await audit(req, 'ticket.assign', current, {
        before: { assigned_to: before.assigned_to },
        after: { assigned_to: assignee },
      });
    }

    if (d.handling_status !== undefined && d.handling_status !== current.handling_status) {
      await adminPool.query(
        `UPDATE support_tickets
            SET handling_status = $2, handling_updated_at = now(), updated_at = now()
          WHERE id = $1`,
        [id.data, d.handling_status]
      );
      const after = (await getScoped(p, id.data))!;
      await audit(req, 'ticket.status', after, {
        before: { handling_status: current.handling_status },
        after: { handling_status: d.handling_status },
      });
      current = after;
    }

    if (d.internal_note !== undefined) {
      await adminPool.query(
        `UPDATE support_tickets
            SET internal_note = NULLIF(BTRIM(COALESCE($2::text, '')), ''), updated_at = now()
          WHERE id = $1`,
        [id.data, d.internal_note]
      );
      const after = (await getScoped(p, id.data))!;
      // The note's TEXT is not audited, only that it changed: it is triage written
      // in the knowledge that nobody outside the team reads it, and copying it into
      // an append-only log would outlive the ticket it belongs to.
      await audit(req, 'ticket.note', after, {
        before: { had_note: before.internal_note !== null },
        after: { has_note: after.internal_note !== null },
      });
      current = after;
    }

    // One mail, at the end, and only when the state actually moved.
    if (current.handling_status !== before.handling_status) {
      await notifyStatusChange({
        ticketId: id.data,
        handlingStatus: current.handling_status,
      });
    }

    ok(res, current);
  })
);

/* ----- POST /api/v1/partnership/tickets/:id/messages — the team's reply ----- */
const Reply = z.object({
  body: z.string().trim().min(2).max(TICKET_BODY_MAX),
  /**
   * Where the reply leaves the ticket. Sent by the console rather than inferred,
   * because only the person writing knows whether they answered the question or
   * asked one: the same paragraph can mean `risolto` or `in_attesa_cliente`.
   * Omitted means "leave the state alone".
   */
  next_status: z.enum(TICKET_HANDLING_STATUSES).optional(),
});

partnershipTicketsRouter.post(
  '/:id/messages',
  asyncHandler(async (req, res) => {
    const p = partner(req);
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw new NotFoundError('ticket');
    const parsed = Reply.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('invalid reply', parsed.error.flatten());
    const { body, next_status: nextStatus } = parsed.data;

    const ticket = await getScoped(p, id.data);
    if (!ticket) throw new NotFoundError('ticket');

    const client = await adminPool.connect();
    let message: { id: string; author_role: string; body: string; created_at: string };
    try {
      await client.query('BEGIN');
      const ins = await client.query(
        `INSERT INTO support_ticket_messages
           (ticket_id, tenant_id, author_role, author_user_id, author_label, body)
         VALUES ($1, $2, 'operator', $3, $4, $5)
         RETURNING id, author_role, body, created_at`,
        [id.data, ticket.tenant_id, p.userId, p.email, body]
      );
      message = ins.rows[0];
      await client.query(
        `UPDATE support_tickets
            SET last_message_at = $2,
                handling_status = COALESCE($3::text, handling_status),
                handling_updated_at = CASE WHEN $3::text IS NULL THEN handling_updated_at ELSE now() END,
                -- The operator has by definition just read the thread they
                -- replied to, so their unread badge clears without a second call.
                operator_last_read_at = now(),
                updated_at = now()
          WHERE id = $1`,
        [id.data, message.created_at, nextStatus ?? null]
      );
      // In the SAME transaction as the reply: a log that can commit without its
      // mutation, or the reverse, is worse than no log because it is trusted.
      await audit(
        req,
        'ticket.reply',
        ticket,
        {
          after: {
            next_status: nextStatus ?? null,
            // Length, not the text: the reply is already stored in
            // support_ticket_messages, and the audit log is never erased.
            chars: body.length,
          },
        },
        client
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    // After the commit, and best-effort inside: the reply is visible in the app
    // whatever the relay does.
    await notifyOperatorReply({
      ticketId: id.data,
      body,
      handlingStatus: nextStatus ?? ticket.handling_status,
      operatorEmail: p.email,
    });

    logger.info(
      { ticket_id: id.data, ref: ticket.ref, next_status: nextStatus ?? null },
      'operator replied to a ticket'
    );
    const updated = await getScoped(p, id.data);
    ok(res, { message: { ...message, author: message.author_role, attachments: [] }, ticket: updated }, 201);
  })
);

/* ----- POST /api/v1/partnership/tickets/:id/messages/:messageId/attachments -----
 * An operator's own file. It goes under the CUSTOMER's tenant prefix (migration
 * 061): an operator has no tenant, and the file belongs to the conversation — so
 * it is erased with the company it concerns. *
 * The CLIENT MUST send `Content-Type: application/octet-stream` and put the real
 * mime in `?mime=`. express.json() is mounted globally (app.ts), so a .json
 * attachment sent under its own type is parsed into an object — and capped at
 * 1mb — before this raw handler runs, and the buffer check below would reject a
 * file the user did attach. */
partnershipTicketsRouter.post(
  '/:id/messages/:messageId/attachments',
  raw({ type: '*/*', limit: TICKET_ATTACHMENT_MAX_BYTES }),
  asyncHandler(async (req, res) => {
    const p = partner(req);
    const ids = z
      .object({ id: uuid, messageId: uuid })
      .safeParse({ id: req.params.id, messageId: req.params.messageId });
    if (!ids.success) throw new NotFoundError('ticket');
    const meta = z
      .object({ filename: z.string().min(1).max(300), mime: z.string().min(3).max(120) })
      .safeParse({ filename: req.query.filename, mime: req.query.mime });
    if (!meta.success) throw new ValidationError('invalid attachment metadata', meta.error.flatten());
    if (!isTicketAttachmentMime(meta.data.mime)) {
      throw new AppError({
        status: 400,
        code: 'TICKET_ATTACHMENT_TYPE',
        message: `Formato non accettato: ${meta.data.mime}.`,
      });
    }
    const bytes = req.body;
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new ValidationError('file mancante');
    if (bytes.length > TICKET_ATTACHMENT_MAX_BYTES) {
      throw new AppError({
        status: 413,
        code: 'TICKET_ATTACHMENT_TOO_LARGE',
        message: 'Il file supera il limite di 10MB.',
      });
    }

    const ticket = await getScoped(p, ids.data.id);
    if (!ticket) throw new NotFoundError('ticket');
    // Only onto the operator's own message, and only one this caller wrote: an
    // operator hanging a file off the customer's message would render as though
    // the customer had sent it.
    const m = await adminPool.query(
      `SELECT 1 FROM support_ticket_messages
        WHERE id = $1 AND ticket_id = $2 AND author_role = 'operator' AND author_user_id = $3`,
      [ids.data.messageId, ids.data.id, p.userId]
    );
    if (m.rowCount === 0) throw new NotFoundError('message');
    const existing = await adminPool.query(
      `SELECT count(*)::int AS n FROM support_ticket_attachments WHERE message_id = $1`,
      [ids.data.messageId]
    );
    if ((existing.rows[0]?.n ?? 0) >= TICKET_ATTACHMENT_MAX_FILES) {
      throw new AppError({
        status: 400,
        code: 'TICKET_ATTACHMENT_LIMIT',
        message: `Puoi allegare al massimo ${TICKET_ATTACHMENT_MAX_FILES} file per messaggio.`,
      });
    }

    const attachmentId = randomUUID();
    const key = attachmentKey(
      ticket.tenant_id,
      ids.data.id,
      attachmentId,
      meta.data.filename
    );
    await storagePut(key, bytes, meta.data.mime);
    const ins = await adminPool.query(
      `INSERT INTO support_ticket_attachments
         (id, ticket_id, message_id, tenant_id, uploaded_by, filename, mime, size_bytes, r2_key)
       VALUES ($1, $2, $3, $4, 'operator', $5, $6, $7, $8)
       RETURNING id, filename, mime, size_bytes, uploaded_by`,
      [
        attachmentId,
        ids.data.id,
        ids.data.messageId,
        ticket.tenant_id,
        meta.data.filename.slice(0, 300),
        meta.data.mime,
        bytes.length,
        key,
      ]
    );
    ok(res, ins.rows[0], 201);
  })
);

/* ----- GET /api/v1/partnership/tickets/:id/attachments/:attachmentId ----- */
partnershipTicketsRouter.get(
  '/:id/attachments/:attachmentId',
  asyncHandler(async (req, res) => {
    const p = partner(req);
    const ids = z
      .object({ id: uuid, attachmentId: uuid })
      .safeParse({ id: req.params.id, attachmentId: req.params.attachmentId });
    if (!ids.success) throw new NotFoundError('attachment');

    // Scope-checked in the same statement, so an id from a tenant this caller does
    // not manage is a 404 and not a download.
    const s = scopeSql(p, 3);
    const a = await adminPool.query(
      `SELECT a.filename, a.mime, a.r2_key
         FROM support_ticket_attachments a
         JOIN support_tickets t ON t.id = a.ticket_id
         JOIN tenants tn ON tn.id = t.tenant_id
        WHERE a.id = $1 AND a.ticket_id = $2 AND ${s.sql}`,
      [ids.data.attachmentId, ids.data.id, ...s.params]
    );
    if (a.rowCount === 0) throw new NotFoundError('attachment');
    await streamAttachment(res, a.rows[0]);
  })
);
