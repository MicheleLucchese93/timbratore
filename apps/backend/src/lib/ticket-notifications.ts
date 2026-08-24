import { adminPool } from './admin-db.js';
import { env } from '../env.js';
import { createLogger } from './logger.js';
import {
  buildTicketAckMail,
  buildTicketOperatorMail,
  buildTicketReplyMail,
  buildTicketStatusMail,
  sendMail,
} from './mailer.js';
import { TICKET_STATUS_MAIL_STATES, type TicketHandlingStatus } from '@sonoqui/shared';

const logger = createLogger('ticket-notifications');

/**
 * Telling the other side that a support ticket moved.
 *
 * EVERYTHING HERE IS BEST-EFFORT AND NEVER THROWS. By the time any of it runs
 * the row is committed and visible in both UIs; a relay that is down, or a
 * partner row that has gone missing, must not turn a stored conversation into a
 * failed request. Callers therefore do not need to catch — but they should still
 * `await`, because an unhandled rejection in a detached promise takes the
 * process down under Node's default policy.
 *
 * NO PUSH AND NO BELL ROW, deliberately. The bell (migration 043) and push exist
 * for the employee who needs to know about their own timesheet on their phone; a
 * ticket lives on an admin's desk in the web app, and the operator's home is the
 * console, which counts its own queue. Email is the only channel here, and it
 * carries the content rather than "hai una nuova notifica".
 */

export interface TicketMailContext {
  ticket_id: string;
  ref: string;
  subject: string;
  body: string;
  category: string | null;
  priority: string | null;
  handling_status: TicketHandlingStatus;
  handling_updated_at: string;
  tenant_id: string;
  tenant_name: string | null;
  /** The admin who opened it. */
  user_id: string;
  author_email: string | null;
  author_language: 'it' | 'en';
  /** The operator holding it, when assigned and still active. */
  assignee_email: string | null;
  /** The partner who provisioned the tenant, when there is one and still active. */
  partner_email: string | null;
}

/**
 * Everything the mail paths need about a ticket, in one query.
 *
 * One round trip rather than four, and — more importantly — the four facts stay
 * consistent with each other: a mail addressed to the assignee about a ticket
 * whose assignee changed between two reads is a mail sent to the wrong person.
 *
 * Runs on the owner pool: it reaches partnership_members and auth_users, neither
 * of which the app role can see.
 */
export async function ticketMailContext(ticketId: string): Promise<TicketMailContext | null> {
  const r = await adminPool.query(
    `SELECT t.id            AS ticket_id,
            t.ref, t.subject, t.body, t.category, t.priority,
            t.handling_status, t.handling_updated_at, t.tenant_id, t.user_id,
            tn.ragione_sociale AS tenant_name,
            au.email         AS author_email,
            COALESCE(up.language, 'it') AS author_language,
            asg.email        AS assignee_email,
            pau.email        AS partner_email
       FROM support_tickets t
       JOIN tenants tn ON tn.id = t.tenant_id
       LEFT JOIN auth_users au ON au.id = t.user_id
       LEFT JOIN user_preferences up ON up.user_id = t.user_id
       -- The assignee, only while their console access is live: a mail to a
       -- deactivated member is a mail nobody reads.
       LEFT JOIN partnership_members apm ON apm.user_id = t.assigned_to AND apm.active
       LEFT JOIN auth_users asg ON asg.id = apm.user_id
       LEFT JOIN partnership_members ppm ON ppm.user_id = tn.created_by_partner AND ppm.active
       LEFT JOIN auth_users pau ON pau.id = ppm.user_id
      WHERE t.id = $1`,
    [ticketId]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    ...row,
    author_language: row.author_language === 'en' ? 'en' : 'it',
  } as TicketMailContext;
}

/**
 * Who hears about work on a ticket.
 *
 * The platform mailbox (SUPPORT_TICKET_TO) is ALWAYS on the list: it is the
 * address that guarantees a request reaches a human even for a tenant no partner
 * manages, and it is the one recipient that cannot be deactivated out of
 * existence. On top of it, the most specific operator there is — the assignee if
 * the ticket has one, otherwise the partner who provisioned the tenant — so a
 * reseller still learns about their own customer without every platform admin
 * being copied on all of it.
 *
 * Deduplicated case-insensitively: the platform mailbox belongs to a real
 * partnership admin, so it is frequently also the assignee, and a mail addressed
 * twice to one address is how a recipient learns to filter the lot into a folder.
 */
export function operatorRecipients(ctx: TicketMailContext): string[] {
  const out: string[] = [env.SUPPORT_TICKET_TO];
  const specific = ctx.assignee_email ?? ctx.partner_email;
  if (specific && specific.trim().toLowerCase() !== env.SUPPORT_TICKET_TO.trim().toLowerCase()) {
    out.push(specific);
  }
  return out;
}

/** How a company is named to an operator. Never an empty string in a subject line. */
function tenantLabel(ctx: TicketMailContext): string {
  return ctx.tenant_name?.trim() || ctx.author_email || 'azienda senza nome';
}

function metaLabel(ctx: TicketMailContext): string {
  return [ctx.category, ctx.priority].filter(Boolean).join(' · ') || '—';
}

/**
 * A ticket has just been raised: acknowledge it to the customer and tell whoever
 * will work it.
 *
 * Called AFTER the row is committed, never inside the transaction that wrote it:
 * an email cannot be rolled back, and a notice about a ticket that never
 * materialised is worse than a late one.
 */
export async function notifyNewTicket(ticketId: string): Promise<void> {
  try {
    const ctx = await ticketMailContext(ticketId);
    if (!ctx) {
      logger.warn({ ticket_id: ticketId }, 'new-ticket notice skipped: ticket not found');
      return;
    }
    const operator = buildTicketOperatorMail({
      kind: 'new',
      ticketId: ctx.ticket_id,
      ticketRef: ctx.ref,
      subject: ctx.subject,
      body: ctx.body,
      tenantName: tenantLabel(ctx),
      meta: metaLabel(ctx),
      authorEmail: ctx.author_email,
    });
    await sendMail({
      to: operatorRecipients(ctx),
      ...operator,
      // Straight back to the admin who wrote, so an operator who prefers mail can
      // answer without opening the console.
      ...(ctx.author_email ? { replyTo: ctx.author_email } : {}),
    });

    if (ctx.author_email) {
      const ack = buildTicketAckMail({
        ticketRef: ctx.ref,
        subject: ctx.subject,
        language: ctx.author_language,
      });
      await sendMail({ to: ctx.author_email, ...ack });
    }
    logger.info({ ticket_id: ticketId, ref: ctx.ref }, 'new-ticket notices sent');
  } catch (err) {
    logger.error({ err, ticket_id: ticketId }, 'new-ticket notice failed');
  }
}

/** The customer answered on an existing ticket — tell whoever holds it. */
export async function notifyCustomerReply(ticketId: string, body: string): Promise<void> {
  try {
    const ctx = await ticketMailContext(ticketId);
    if (!ctx) {
      logger.warn({ ticket_id: ticketId }, 'customer-reply notice skipped: ticket not found');
      return;
    }
    const mail = buildTicketOperatorMail({
      kind: 'reply',
      ticketId: ctx.ticket_id,
      ticketRef: ctx.ref,
      subject: ctx.subject,
      body,
      tenantName: tenantLabel(ctx),
      meta: metaLabel(ctx),
      authorEmail: ctx.author_email,
    });
    await sendMail({
      to: operatorRecipients(ctx),
      ...mail,
      ...(ctx.author_email ? { replyTo: ctx.author_email } : {}),
    });
  } catch (err) {
    logger.error({ err, ticket_id: ticketId }, 'customer-reply notice failed');
  }
}

/**
 * An operator replied — tell the admin who opened the ticket.
 *
 * `replyTo` is the operator's own address rather than the noreply sender: a
 * customer who answers from their mail client should reach a person. The in-app
 * thread is the preferred channel but it is not the only one they will use.
 */
export async function notifyOperatorReply(input: {
  ticketId: string;
  body: string;
  handlingStatus: TicketHandlingStatus;
  operatorEmail: string | null;
}): Promise<void> {
  try {
    const ctx = await ticketMailContext(input.ticketId);
    if (!ctx || !ctx.author_email) return;
    const mail = buildTicketReplyMail({
      ticketRef: ctx.ref,
      subject: ctx.subject,
      body: input.body,
      handlingStatus: input.handlingStatus,
      language: ctx.author_language,
    });
    await sendMail({
      to: ctx.author_email,
      ...mail,
      ...(input.operatorEmail ? { replyTo: input.operatorEmail } : {}),
    });
  } catch (err) {
    logger.error({ err, ticket_id: input.ticketId }, 'operator-reply notice failed');
  }
}

/**
 * The team moved the ticket.
 *
 * Silent for the states TICKET_STATUS_MAIL_STATES leaves out, and the caller is
 * expected to have checked that the state actually CHANGED — an operator
 * clicking `in_lavorazione` on a ticket already there has told the customer
 * nothing new.
 */
export async function notifyStatusChange(input: {
  ticketId: string;
  handlingStatus: TicketHandlingStatus;
}): Promise<void> {
  if (!TICKET_STATUS_MAIL_STATES.includes(input.handlingStatus)) return;
  try {
    const ctx = await ticketMailContext(input.ticketId);
    if (!ctx || !ctx.author_email) return;
    const mail = buildTicketStatusMail({
      ticketRef: ctx.ref,
      subject: ctx.subject,
      handlingStatus: input.handlingStatus,
      language: ctx.author_language,
    });
    await sendMail({ to: ctx.author_email, ...mail });
  } catch (err) {
    logger.error({ err, ticket_id: input.ticketId }, 'status-change notice failed');
  }
}
