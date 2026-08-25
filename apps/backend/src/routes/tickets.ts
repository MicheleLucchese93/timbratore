import { Router, raw } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { asyncHandler, tenantHandler } from '../lib/route-helpers.js';
import { adminPool } from '../lib/admin-db.js';
import { ok } from '../lib/api-response.js';
import { AppError, NotFoundError, ValidationError } from '../errors/index.js';
import { storageGet, storagePut } from '../lib/storage.js';
import { ticketRef } from '../lib/ticket-ref.js';
import { notifyCustomerReply, notifyNewTicket } from '../lib/ticket-notifications.js';
import { createLogger } from '../lib/logger.js';
import {
  TICKET_ATTACHMENT_MAX_BYTES,
  TICKET_ATTACHMENT_MAX_FILES,
  TICKET_BODY_MAX,
  TICKET_SUBJECT_MAX,
  isTicketAttachmentMime,
} from '@sonoqui/shared';

const logger = createLogger('tickets');

/**
 * Support tickets, from the CUSTOMER's side (migration 061).
 *
 * ADMINS ONLY — `requireAdmin` on every route, on top of an RLS policy that says
 * the same thing. A ticket is the company's request about its subscription, not
 * an employee's question about their own timesheet, and the person who answers it
 * is a reseller with no relationship to an individual employee. Every admin of the
 * company sees every ticket the company opened: a support conversation only one of
 * three admins can read is one that stalls when that person is on holiday.
 *
 * WHAT RUNS WHERE, and why it is split.
 *   - Everything the customer legitimately owns runs under tenant RLS
 *     (tenantHandler): reading their tickets, raising one, replying, marking one
 *     resolved, marking one read.
 *   - ONE statement runs on the owner pool: putting `handling_status` back to
 *     `in_lavorazione` after a reply. Migration 061 took that column out of the
 *     app role's reach on purpose, and this is the single customer action that
 *     legitimately moves it. The new value is computed in SQL from the old one so
 *     it cannot be passed in wrong.
 *
 * ATTACHMENTS ARE A SECOND CALL, not a multipart field, and that is deliberate:
 * the codebase has no multipart parser (documents upload the raw bytes with the
 * metadata in the query string, for CORS reasons spelled out there) and adding
 * one for this would be a new dependency in every image. So a reply is created
 * first and its files are POSTed onto it, exactly like the documents flow. The
 * consequence to know about: the operator notice goes out with the reply's text,
 * so a file uploaded a second later is not mentioned in that email — it is
 * visible on the ticket, which is where the answer happens.
 */
export const ticketsRouter = Router();
ticketsRouter.use(authenticate);
ticketsRouter.use(requireAdmin);

/**
 * Abuse ceiling, per account. Nothing here costs a completion, so this is about
 * storage and mail volume, not spend: far above any real conversation and far
 * below a script.
 */
const writeLimiter = rateLimit({
  windowMs: 10 * 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Keyed on the account, not the address: one office behind a NAT is several
  // paying companies. The IP branch is a fallback that cannot be reached here
  // (the limiter runs after `authenticate`), and it goes through
  // ipKeyGenerator so an IPv6 client cannot rotate through its own /64 —
  // a bare req.ip also trips express-rate-limit's ERR_ERL_KEY_GEN_IPV6 check.
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? 'anon'),
});

/**
 * The columns the CUSTOMER's surface may see, listed rather than `*`.
 *
 * `internal_note` and `assigned_to` are deliberately absent: both are
 * operator-only (migration 061), the note is triage written in the knowledge that
 * the customer will never read it, and the assignee is a person the product never
 * names to a customer. A `SELECT *` here would put both on the wire the day
 * somebody widened the response type.
 */
const TICKET_COLUMNS = `
  t.id, t.ref, t.subject, t.body, t.category, t.priority, t.status,
  t.handling_status, t.handling_updated_at, t.last_message_at,
  t.created_at, t.resolved_at,
  COALESCE(
    NULLIF(au.display_name, ''),
    NULLIF(TRIM(CONCAT_WS(' ', au.first_name, au.last_name)), ''),
    au.email
  ) AS opened_by_name,
  (
    SELECT count(*) FROM support_ticket_messages m
     WHERE m.ticket_id = t.id
       AND m.author_role = 'operator'
       AND (t.user_last_read_at IS NULL OR m.created_at > t.user_last_read_at)
  )::int AS unread_count
`;
const TICKET_FROM = `FROM support_tickets t LEFT JOIN auth_users au ON au.id = t.user_id`;

const CreateTicket = z.object({
  subject: z.string().trim().min(3).max(TICKET_SUBJECT_MAX),
  body: z.string().trim().min(10).max(TICKET_BODY_MAX),
  // Free text on purpose (see the shared package): the picker's options are a UI
  // concern and a server-side enum would make a copy edit a deploy.
  category: z.string().trim().max(40).nullable().optional(),
  priority: z.string().trim().max(20).nullable().optional(),
});

const Reply = z.object({
  body: z.string().trim().min(2).max(TICKET_BODY_MAX),
});

const uuid = z.string().uuid();

/**
 * Assemble a thread, folding attachments into their message.
 *
 * The operator's NAME is deliberately dropped here. `author_label` is on the row
 * and is shown in the console, but a customer is answered by «l'assistenza», not
 * by Anna: naming an individual invites the next request to be addressed to that
 * person, who may be on holiday, may work for the reseller, and may have left.
 */
function toThread(
  messages: { id: string; author_role: string; body: string; created_at: string }[],
  attachments: {
    id: string;
    message_id: string;
    filename: string;
    mime: string;
    size_bytes: number;
    uploaded_by: string;
  }[]
): unknown[] {
  const byMessage = new Map<string, unknown[]>();
  for (const a of attachments) {
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
  return messages.map((m) => ({
    id: m.id,
    author: m.author_role,
    body: m.body,
    created_at: m.created_at,
    attachments: byMessage.get(m.id) ?? [],
  }));
}

/* ----- GET /api/v1/tickets — the company's tickets, newest first ----- */
ticketsRouter.get(
  '/',
  tenantHandler(async (_req, res, client) => {
    // Capped rather than paginated: the list is a reminder of what is
    // outstanding, not an archive to browse.
    const r = await client.query(
      `SELECT ${TICKET_COLUMNS} ${TICKET_FROM}
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT 200`
    );
    ok(res, r.rows);
  })
);

/* ----- POST /api/v1/tickets — raise one ----- */
ticketsRouter.post(
  '/',
  writeLimiter,
  tenantHandler(async (req, res, client, afterCommit) => {
    const parsed = CreateTicket.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('invalid ticket', parsed.error.flatten());
    const d = parsed.data;

    // ticketRef() is a date plus four random digits: ten thousand codes a day, so
    // a collision is unlikely but not impossible. ON CONFLICT DO NOTHING returns
    // no row, and we draw again rather than failing a request over bookkeeping.
    let row: Record<string, unknown> | undefined;
    for (let attempt = 0; attempt < 5 && !row; attempt += 1) {
      const ins = await client.query(
        `INSERT INTO support_tickets(tenant_id, user_id, ref, subject, body, category, priority)
         VALUES (current_setting('app.current_tenant_id')::uuid,
                 current_setting('app.current_user_id')::uuid,
                 $1, $2, $3, $4, $5)
         ON CONFLICT (ref) DO NOTHING
         RETURNING id`,
        [ticketRef(), d.subject, d.body, d.category ?? null, d.priority ?? null]
      );
      row = ins.rows[0];
    }
    if (!row) {
      throw new AppError({
        status: 503,
        code: 'TICKET_REF_EXHAUSTED',
        message: 'Impossibile generare un riferimento per la richiesta. Riprova.',
      });
    }
    const ticketId = String(row.id);

    // THE OPENING REQUEST IS ALSO MESSAGE #1, and that needs saying because it
    // looks like duplication of `body`.
    //
    // It buys two things. The thread renders uniformly — request, then replies,
    // one component — instead of a special first bubble the UI has to synthesise.
    // And an attachment needs a message to hang off (support_ticket_attachments
    // .message_id is NOT NULL), so without this a customer could not attach the
    // screenshot to the bug report itself, only to a follow-up — which is the one
    // moment they most want to.
    //
    // The two copies cannot drift: neither is editable. `body` has no UPDATE
    // grant for the app role and none for the console either, and messages are
    // insert-only by grant (migration 061 §5). `body` stays denormalised on the
    // row because the console list, the search and every mail read it without
    // wanting the thread.
    const first = await client.query(
      `INSERT INTO support_ticket_messages(ticket_id, tenant_id, author_role, author_user_id, body)
       VALUES ($1, current_setting('app.current_tenant_id')::uuid, 'user',
               current_setting('app.current_user_id')::uuid, $2)
       RETURNING id`,
      [ticketId, d.body]
    );

    const created = await client.query(
      `SELECT ${TICKET_COLUMNS} ${TICKET_FROM} WHERE t.id = $1`,
      [row.id]
    );
    // After COMMIT, never inside: an email cannot be rolled back, and a notice
    // about a ticket that never materialised is worse than a late one.
    afterCommit(() => notifyNewTicket(ticketId));

    logger.info({ ticket_id: ticketId, tenant_id: req.user!.tenantId }, 'support ticket raised');
    // `first_message_id` is what the client POSTs its attachments onto.
    ok(res, { ...created.rows[0], first_message_id: first.rows[0].id }, 201);
  })
);

/* ----- GET /api/v1/tickets/:id — one ticket with its thread ----- */
ticketsRouter.get(
  '/:id',
  tenantHandler(async (req, res, client) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw new NotFoundError('ticket');

    const t = await client.query(
      `SELECT ${TICKET_COLUMNS} ${TICKET_FROM} WHERE t.id = $1`,
      [id.data]
    );
    // RLS has already scoped the read, so a miss is either a nonexistent ticket
    // or another tenant's — 404 for both, never 403, which would confirm the id.
    if (t.rowCount === 0) throw new NotFoundError('ticket');

    const [messages, attachments, events] = await Promise.all([
      client.query(
        `SELECT id, author_role, body, created_at FROM support_ticket_messages
          WHERE ticket_id = $1 ORDER BY created_at, id`,
        [id.data]
      ),
      client.query(
        `SELECT id, message_id, filename, mime, size_bytes, uploaded_by
           FROM support_ticket_attachments
          WHERE ticket_id = $1 ORDER BY created_at, id`,
        [id.data]
      ),
      // The state history (migration 063). Safe to send as-is: the rows carry no
      // actor, so nothing here names an operator.
      client.query(
        `SELECT id, kind, from_status, to_status, at FROM support_ticket_events
          WHERE ticket_id = $1 ORDER BY at, id`,
        [id.data]
      ),
    ]);

    // OPENING THE TICKET MARKS IT READ, which is why a GET carries a write. The
    // alternative was a second call from the client, and a client that forgets to
    // make it leaves a badge that never clears. This does not touch updated_at:
    // reading is not a change, and the console sorts on activity.
    //
    // Skipped in a read-only partner support session: that transaction is SET
    // TRANSACTION READ ONLY, so the UPDATE would abort the whole request — and a
    // partner inspecting the customer's app must not clear the customer's badge.
    if (!req.support) {
      await client.query(`UPDATE support_tickets SET user_last_read_at = now() WHERE id = $1`, [
        id.data,
      ]);
    }

    ok(res, {
      // Built from the row as READ, so unread_count still describes what the
      // reader is about to see rather than the zero just written.
      ticket: t.rows[0],
      messages: toThread(messages.rows, attachments.rows),
      events: events.rows,
    });
  })
);

/* ----- PATCH /api/v1/tickets/:id — the customer's own flag ----- */
ticketsRouter.patch(
  '/:id',
  tenantHandler(async (req, res, client) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw new NotFoundError('ticket');
    const parsed = z.object({ status: z.enum(['open', 'resolved']) }).safeParse(req.body);
    if (!parsed.success) throw new ValidationError('invalid status', parsed.error.flatten());

    // Both directions, not a one-way "resolve": the flag is the customer's own
    // opinion of whether they still need an answer, and one misplaced click must
    // not be permanent. It changes nothing on the team's side and mails nobody.
    const upd = await client.query(
      `UPDATE support_tickets
          SET status = $2,
              -- Derived from the status in the same statement so the CHECK in
              -- migration 061 cannot be reached with the two disagreeing.
              -- coalesce keeps "when they first closed it" on a re-resolve.
              resolved_at = CASE WHEN $2 = 'resolved' THEN coalesce(resolved_at, now()) ELSE NULL END,
              updated_at = now()
        WHERE id = $1
        RETURNING id`,
      [id.data, parsed.data.status]
    );
    if (upd.rowCount === 0) throw new NotFoundError('ticket');
    const r = await client.query(`SELECT ${TICKET_COLUMNS} ${TICKET_FROM} WHERE t.id = $1`, [
      id.data,
    ]);
    ok(res, r.rows[0]);
  })
);

/* ----- POST /api/v1/tickets/:id/messages — the customer's turn ----- */
ticketsRouter.post(
  '/:id/messages',
  writeLimiter,
  tenantHandler(async (req, res, client, afterCommit) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw new NotFoundError('ticket');
    const parsed = Reply.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('invalid reply', parsed.error.flatten());
    const body = parsed.data.body;

    const t = await client.query(
      `SELECT id, handling_status FROM support_tickets WHERE id = $1`,
      [id.data]
    );
    if (t.rowCount === 0) throw new NotFoundError('ticket');

    const ins = await client.query(
      `INSERT INTO support_ticket_messages(ticket_id, tenant_id, author_role, author_user_id, body)
       VALUES ($1, current_setting('app.current_tenant_id')::uuid, 'user',
               current_setting('app.current_user_id')::uuid, $2)
       RETURNING id, author_role, body, created_at`,
      [id.data, body]
    );
    const message = ins.rows[0];

    // The ticket goes back to the team, on the OWNER pool: handling_status is not
    // writable by the app role (migration 061 §5) and this is the one customer
    // action that legitimately moves it. The transition is computed in SQL from
    // the old value, mirroring handlingAfterUserReply() in @sonoqui/shared —
    // which the web app uses to warn that a reply will reopen a closed request.
    const reopened = await adminPool.query(
      `UPDATE support_tickets
          SET handling_status = CASE WHEN handling_status = 'nuovo' THEN 'nuovo' ELSE 'in_lavorazione' END,
              handling_updated_at = CASE WHEN handling_status = 'nuovo' THEN handling_updated_at ELSE now() END,
              last_message_at = $2,
              updated_at = now()
        WHERE id = $1
        RETURNING handling_status`,
      [id.data, message.created_at]
    );

    const ticketId = id.data;
    afterCommit(() => notifyCustomerReply(ticketId, body));

    ok(res, {
      message: toThread([message], [])[0],
      handling_status: reopened.rows[0]?.handling_status ?? t.rows[0].handling_status,
    });
  })
);

/* ----- POST /api/v1/tickets/:id/messages/:messageId/attachments -----
 * One file, raw in the body, metadata in the query string. Same shape as the
 * documents upload and for the same reason: custom X-* headers are not in the
 * gateway's CORS allow-list, and there is no multipart parser in this image. *
 * The CLIENT MUST send `Content-Type: application/octet-stream` and put the real
 * mime in `?mime=`. express.json() is mounted globally (app.ts), so a .json
 * attachment sent under its own type is parsed into an object — and capped at
 * 1mb — before this raw handler runs, and the buffer check below would reject a
 * file the user did attach. */
ticketsRouter.post(
  '/:id/messages/:messageId/attachments',
  writeLimiter,
  raw({ type: '*/*', limit: TICKET_ATTACHMENT_MAX_BYTES }),
  tenantHandler(async (req, res, client) => {
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

    // The message must be one the caller wrote, on the ticket named in the path.
    // Both halves matter: RLS already scopes the ticket, but without the author
    // check an admin could hang a file off the operator's reply and it would
    // render as though the assistance team had sent it.
    const m = await client.query(
      `SELECT m.id
         FROM support_ticket_messages m
        WHERE m.id = $1
          AND m.ticket_id = $2
          AND m.author_role = 'user'
          AND m.author_user_id = current_setting('app.current_user_id')::uuid`,
      [ids.data.messageId, ids.data.id]
    );
    if (m.rowCount === 0) throw new NotFoundError('message');

    const existing = await client.query(
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
    const key = attachmentKey(req.user!.tenantId, ids.data.id, attachmentId, meta.data.filename);
    // Bytes first, row second. A failure between the two leaves an unreferenced
    // object (swept with the tenant); the reverse leaves a download button on a
    // file that does not exist, on evidence the customer believes they sent.
    await storagePut(key, bytes, meta.data.mime);
    const ins = await client.query(
      `INSERT INTO support_ticket_attachments
         (id, ticket_id, message_id, tenant_id, uploaded_by, filename, mime, size_bytes, r2_key)
       VALUES ($1, $2, $3, current_setting('app.current_tenant_id')::uuid, 'user', $4, $5, $6, $7)
       RETURNING id, filename, mime, size_bytes, uploaded_by`,
      [
        attachmentId,
        ids.data.id,
        ids.data.messageId,
        meta.data.filename.slice(0, 300),
        meta.data.mime,
        bytes.length,
        key,
      ]
    );
    ok(res, ins.rows[0], 201);
  })
);

/* ----- GET /api/v1/tickets/:id/attachments/:attachmentId — download ----- */
ticketsRouter.get(
  '/:id/attachments/:attachmentId',
  tenantHandler(async (req, res, client) => {
    const ids = z
      .object({ id: uuid, attachmentId: uuid })
      .safeParse({ id: req.params.id, attachmentId: req.params.attachmentId });
    if (!ids.success) throw new NotFoundError('attachment');

    // The join onto support_tickets is what authorises this: RLS scopes that
    // table to the caller's tenant, so an attachment id from another company
    // resolves to nothing — no separate ownership check to forget.
    const a = await client.query(
      `SELECT a.filename, a.mime, a.r2_key
         FROM support_ticket_attachments a
         JOIN support_tickets t ON t.id = a.ticket_id
        WHERE a.id = $1 AND a.ticket_id = $2`,
      [ids.data.attachmentId, ids.data.id]
    );
    if (a.rowCount === 0) throw new NotFoundError('attachment');
    await streamAttachment(res, a.rows[0]);
  })
);

/** `tenants/{tenant}/support/{ticket}/{attachment}/{name}` — the documents layout. */
export function attachmentKey(
  tenantId: string,
  ticketId: string,
  attachmentId: string,
  filename: string
): string {
  return `tenants/${tenantId}/support/${ticketId}/${attachmentId}/${sanitizeKeySegment(filename)}`;
}

/**
 * R2 keys must be safe path segments. The row keeps the original filename
 * verbatim for display and for the download's Content-Disposition.
 */
export function sanitizeKeySegment(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? name;
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : 'allegato';
}

/**
 * Send one attachment back, decrypted by nobody and rendered by nothing.
 *
 * `Content-Disposition: attachment` rather than inline: the file came from
 * outside — a customer's machine, or an operator's — and rendering somebody's
 * HTML or SVG on the app's own origin is how a support attachment becomes a
 * session. `private, no-store` because it is one company's file behind a bearer
 * token, and a shared cache holding it would be a cross-tenant leak.
 */
export async function streamAttachment(
  res: import('express').Response,
  row: { filename: string; mime: string; r2_key: string }
): Promise<void> {
  const bytes = await storageGet(row.r2_key);
  res.setHeader('Content-Type', row.mime);
  res.setHeader('Content-Length', String(bytes.byteLength));
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${row.filename.replace(/["\\\r\n]/g, '_')}"`
  );
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(bytes);
}
