import type { PoolClient } from 'pg';
import { adminPool } from './admin-db.js';
import { createLogger } from './logger.js';
import {
  buildSubmittedMail,
  buildDecidedMail,
  buildCancellationRequestedMail,
  buildCancellationDecidedMail,
  buildCorrectionSubmittedMail,
  buildCorrectionDecidedMail,
  buildReminderMail,
  buildBulkEventMail,
  sendMail,
  type LeaveMailPayload,
  type CorrectionMailPayload,
} from './mailer.js';

const logger = createLogger('notifications');

// Per-kind push opt-out keys stored in user_preferences.notification_preferences.
// Missing keys are treated as `true` (defaults from migrations 021/030).
type PushPrefKey =
  | 'push_leave_decisions'
  | 'push_correction_decisions'
  | 'push_leave_submissions'
  | 'push_correction_submissions'
  | 'push_leave_reminders';

// Per-kind email opt-in keys (migration 030). Missing key falls back to the
// legacy single master switch email_notifications_enabled.
type EmailPrefKey =
  | 'email_leave_decisions'
  | 'email_correction_decisions'
  | 'email_leave_submissions'
  | 'email_correction_submissions'
  | 'email_leave_reminders';

interface RecipientRow {
  user_id: string;
  email: string | null;
  display_name: string | null;
  push_token: string | null;
  language: string | null;
  email_notifications_enabled: boolean;
  notification_preferences: Record<string, unknown> | null;
}

function pushAllowed(recipient: RecipientRow, key: PushPrefKey): boolean {
  const v = recipient.notification_preferences?.[key];
  return typeof v === 'boolean' ? v : true;
}

// Email is opt-in. Use the per-category key when present; otherwise fall back
// to the legacy master switch so pre-migration rows still behave.
function emailAllowed(recipient: RecipientRow, key: EmailPrefKey): boolean {
  const v = recipient.notification_preferences?.[key];
  return typeof v === 'boolean' ? v : recipient.email_notifications_enabled;
}

async function loadRecipients(userIds: string[]): Promise<RecipientRow[]> {
  if (userIds.length === 0) return [];
  const r = await adminPool.query(
    `SELECT au.id AS user_id, au.email, au.display_name,
            up.push_token, up.language,
            COALESCE(up.email_notifications_enabled, FALSE) AS email_notifications_enabled,
            up.notification_preferences
       FROM auth_users au
       LEFT JOIN user_preferences up ON up.user_id = au.id
      WHERE au.id = ANY($1::uuid[])`,
    [userIds]
  );
  return r.rows;
}

async function tenantAdminIds(client: PoolClient): Promise<string[]> {
  const r = await client.query(
    `SELECT user_id FROM memberships
      WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
        AND role = 'admin'
        AND active = TRUE
        AND deleted_at IS NULL`
  );
  return r.rows.map((row) => row.user_id);
}

async function loadLeaveApproverIds(client: PoolClient, requesterId: string): Promise<string[]> {
  const r = await client.query(
    `SELECT approver_user_id FROM leave_approvers WHERE user_id = $1`,
    [requesterId]
  );
  if (r.rowCount && r.rowCount > 0) return r.rows.map((row) => row.approver_user_id);
  // Admin fallback — mirrors assertCanDecide() in leaves.ts.
  const admins = await tenantAdminIds(client);
  return admins.filter((id) => id !== requesterId);
}

async function loadCorrectionApproverIds(
  client: PoolClient,
  requesterId: string
): Promise<string[]> {
  const r = await client.query(
    `SELECT approver_user_id FROM correction_approvers WHERE user_id = $1`,
    [requesterId]
  );
  if (r.rowCount && r.rowCount > 0) return r.rows.map((row) => row.approver_user_id);
  const admins = await tenantAdminIds(client);
  return admins.filter((id) => id !== requesterId);
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: unknown;
}

interface ExpoSendResponse {
  data?: ExpoTicket | ExpoTicket[];
  errors?: unknown;
}

async function sendExpoPush(
  token: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  if (!token.startsWith('ExponentPushToken[') && !token.startsWith('ExpoPushToken[')) {
    return;
  }
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        to: token,
        title,
        body,
        data: data ?? {},
        sound: 'default',
        priority: 'high',
      }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'expo push non-OK');
      return;
    }
    const payload = (await res.json()) as ExpoSendResponse;
    const ticket = Array.isArray(payload.data) ? payload.data[0] : payload.data;
    if (!ticket) {
      logger.warn({ payload }, 'expo push response missing ticket');
      return;
    }
    if (ticket.status === 'ok') {
      logger.info({ ticketId: ticket.id, title }, 'expo push sent');
    } else {
      logger.error(
        { ticketId: ticket.id, message: ticket.message, details: ticket.details },
        'expo push ticket error'
      );
    }
  } catch (err) {
    logger.error({ err }, 'expo push failed');
  }
}

async function deliver(
  recipient: RecipientRow,
  push:
    | { title: string; body: string; data?: Record<string, unknown>; prefKey: PushPrefKey }
    | null,
  email: { subject: string; text: string; html: string; prefKey: EmailPrefKey } | null
): Promise<void> {
  if (push && recipient.push_token && pushAllowed(recipient, push.prefKey)) {
    await sendExpoPush(recipient.push_token, push.title, push.body, push.data);
  }
  if (email && recipient.email && emailAllowed(recipient, email.prefKey)) {
    await sendMail({
      to: recipient.email,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
  }
}

interface LeaveContext {
  requestId: string;
  type: 'ferie' | 'permessi' | 'malattia' | 'assenza';
  from_ts: string;
  to_ts: string;
  duration_hours: number;
  requester_id: string;
  reason?: string;
}

export async function notifyLeaveSubmitted(
  client: PoolClient,
  ctx: LeaveContext
): Promise<void> {
  const approverIds = await loadLeaveApproverIds(client, ctx.requester_id);
  if (approverIds.length === 0) return;
  const [requesterRow] = await loadRecipients([ctx.requester_id]);
  const approvers = await loadRecipients(approverIds);
  const requesterName =
    requesterRow?.display_name || requesterRow?.email || 'Utente';

  for (const a of approvers) {
    const lang = asLang(a.language);
    const mail = buildSubmittedMail({
      type: ctx.type,
      from_ts: ctx.from_ts,
      to_ts: ctx.to_ts,
      duration_hours: ctx.duration_hours,
      requester_name: requesterName,
      reason: ctx.reason,
      language: lang,
    });
    await deliver(
      a,
      {
        title: PUSH.leaveSubmitted.title[lang],
        body: PUSH.leaveSubmitted.body(requesterName, labelOf(ctx.type, lang))[lang],
        data: { kind: 'leave_submitted', request_id: ctx.requestId },
        prefKey: 'push_leave_submissions',
      },
      { ...mail, prefKey: 'email_leave_submissions' }
    );
  }
}

export async function notifyLeaveDecided(
  client: PoolClient,
  ctx: LeaveContext,
  decision: 'approved' | 'rejected',
  approverId: string,
  rejectionReason?: string
): Promise<void> {
  const [requester] = await loadRecipients([ctx.requester_id]);
  const [approver] = await loadRecipients([approverId]);
  if (!requester) return;
  const lang = asLang(requester.language);
  const payload: LeaveMailPayload = {
    type: ctx.type,
    from_ts: ctx.from_ts,
    to_ts: ctx.to_ts,
    duration_hours: ctx.duration_hours,
    requester_name: requester.display_name || requester.email || 'Utente',
    approver_name: approver?.display_name || approver?.email || undefined,
    language: lang,
  };
  const mail = buildDecidedMail(payload, decision, rejectionReason);
  await deliver(
    requester,
    {
      title: PUSH.leaveDecided.title(decision)[lang],
      body: PUSH.leaveDecided.body(labelOf(ctx.type, lang), decision, rejectionReason)[lang],
      data: { kind: 'leave_decided', request_id: ctx.requestId, decision },
      prefKey: 'push_leave_decisions',
    },
    { ...mail, prefKey: 'email_leave_decisions' }
  );
  void client;
}

export async function notifyCancellationRequested(
  client: PoolClient,
  ctx: LeaveContext
): Promise<void> {
  const approverIds = await loadLeaveApproverIds(client, ctx.requester_id);
  if (approverIds.length === 0) return;
  const [requester] = await loadRecipients([ctx.requester_id]);
  const approvers = await loadRecipients(approverIds);
  const requesterName = requester?.display_name || requester?.email || 'Utente';
  for (const a of approvers) {
    const lang = asLang(a.language);
    const mail = buildCancellationRequestedMail({
      type: ctx.type,
      from_ts: ctx.from_ts,
      to_ts: ctx.to_ts,
      duration_hours: ctx.duration_hours,
      requester_name: requesterName,
      reason: ctx.reason,
      language: lang,
    });
    await deliver(
      a,
      {
        title: PUSH.cancellationRequested.title[lang],
        body: PUSH.cancellationRequested.body(requesterName, labelOf(ctx.type, lang))[lang],
        data: { kind: 'leave_cancellation_requested', request_id: ctx.requestId },
        prefKey: 'push_leave_submissions',
      },
      { ...mail, prefKey: 'email_leave_submissions' }
    );
  }
}

export async function notifyCancellationDecided(
  _client: PoolClient,
  ctx: LeaveContext,
  accepted: boolean
): Promise<void> {
  const [requester] = await loadRecipients([ctx.requester_id]);
  if (!requester) return;
  const lang = asLang(requester.language);
  const payload: LeaveMailPayload = {
    type: ctx.type,
    from_ts: ctx.from_ts,
    to_ts: ctx.to_ts,
    duration_hours: ctx.duration_hours,
    requester_name: requester.display_name || requester.email || 'Utente',
    language: lang,
  };
  const mail = buildCancellationDecidedMail(payload, accepted);
  await deliver(
    requester,
    {
      title: PUSH.cancellationDecided.title(accepted)[lang],
      body: labelOf(ctx.type, lang),
      data: { kind: 'leave_cancellation_decided', request_id: ctx.requestId, accepted },
      prefKey: 'push_leave_decisions',
    },
    { ...mail, prefKey: 'email_leave_decisions' }
  );
}

/**
 * 24h-before reminder for a single upcoming leave. Called by the daily cron
 * (cross-tenant via adminPool) once per qualifying row.
 */
export async function notifyLeaveReminder(
  userId: string,
  leave: {
    requestId: string;
    type: string;
    from_ts: string;
    to_ts: string;
    title?: string | null;
  }
): Promise<void> {
  const [recipient] = await loadRecipients([userId]);
  if (!recipient) return;
  const language = asLang(recipient.language);
  const label = leave.title || labelOf(leave.type, language);
  const mail = buildReminderMail({
    type: leave.type,
    from_ts: leave.from_ts,
    to_ts: leave.to_ts,
    title: leave.title,
    language,
  });
  await deliver(
    recipient,
    {
      title: PUSH.reminder.title[language],
      body: PUSH.reminder.body(label)[language],
      data: { kind: 'leave_reminder', request_id: leave.requestId },
      prefKey: 'push_leave_reminders',
    },
    { ...mail, prefKey: 'email_leave_reminders' }
  );
}

/**
 * Notice to each user an admin pushed a company event to (bulk insert). Gated
 * under the user-facing leave channel (decisions). adminPool-backed, so it can
 * run inside or outside a request transaction.
 */
export async function notifyBulkEvent(
  userIds: string[],
  event: { title: string; from_ts: string; to_ts: string; deducts_ferie: boolean; batchId: string }
): Promise<void> {
  const recipients = await loadRecipients(userIds);
  for (const r of recipients) {
    const language = asLang(r.language);
    const mail = buildBulkEventMail({
      title: event.title,
      from_ts: event.from_ts,
      to_ts: event.to_ts,
      deducts_ferie: event.deducts_ferie,
      language,
    });
    await deliver(
      r,
      {
        title: PUSH.bulkEvent.title[language],
        body: event.title,
        data: { kind: 'company_event', batch_id: event.batchId },
        prefKey: 'push_leave_decisions',
      },
      { ...mail, prefKey: 'email_leave_decisions' }
    );
  }
}

/* ----- Correction-request notifications ----- */

interface CorrectionContext {
  requestId: string;
  event_type: string;
  occurred_at: string;
  is_edit: boolean;
  justification: string;
  requester_id: string;
}

export async function notifyCorrectionSubmitted(
  client: PoolClient,
  ctx: CorrectionContext
): Promise<void> {
  const approverIds = await loadCorrectionApproverIds(client, ctx.requester_id);
  if (approverIds.length === 0) return;
  const [requesterRow] = await loadRecipients([ctx.requester_id]);
  const approvers = await loadRecipients(approverIds);
  const requesterName =
    requesterRow?.display_name || requesterRow?.email || 'Utente';

  for (const a of approvers) {
    const lang = asLang(a.language);
    const mail = buildCorrectionSubmittedMail({
      event_type: ctx.event_type,
      occurred_at: ctx.occurred_at,
      is_edit: ctx.is_edit,
      justification: ctx.justification,
      requester_name: requesterName,
      language: lang,
    });
    await deliver(
      a,
      {
        title: PUSH.correctionSubmitted.title[lang],
        body: PUSH.correctionSubmitted.body(requesterName, correctionLabel(ctx.event_type, lang))[lang],
        data: { kind: 'correction_submitted', request_id: ctx.requestId },
        prefKey: 'push_correction_submissions',
      },
      { ...mail, prefKey: 'email_correction_submissions' }
    );
  }
}

export async function notifyCorrectionDecided(
  _client: PoolClient,
  ctx: CorrectionContext,
  decision: 'approved' | 'rejected',
  approverId: string,
  note?: string
): Promise<void> {
  const [requester] = await loadRecipients([ctx.requester_id]);
  const [approver] = await loadRecipients([approverId]);
  if (!requester) return;
  const lang = asLang(requester.language);
  const payload: CorrectionMailPayload = {
    event_type: ctx.event_type,
    occurred_at: ctx.occurred_at,
    is_edit: ctx.is_edit,
    justification: ctx.justification,
    requester_name: requester.display_name || requester.email || 'Utente',
    approver_name: approver?.display_name || approver?.email || undefined,
    note,
    language: lang,
  };
  const mail = buildCorrectionDecidedMail(payload, decision);
  await deliver(
    requester,
    {
      title: PUSH.correctionDecided.title(decision)[lang],
      body: PUSH.correctionDecided.body(correctionLabel(ctx.event_type, lang), note)[lang],
      data: { kind: 'correction_decided', request_id: ctx.requestId, decision },
      prefKey: 'push_correction_decisions',
    },
    { ...mail, prefKey: 'email_correction_decisions' }
  );
}

/* ----- Push-notification localization -----
 * Push titles/bodies are localized per recipient (each user may differ), so
 * every builder takes the recipient language. Emails are localized separately
 * by passing `language` into the mail payload (see mailer.ts). */
type Lang = 'it' | 'en';
function asLang(v: string | null | undefined): Lang {
  return v === 'en' ? 'en' : 'it';
}

const LEAVE_LABEL: Record<string, Record<Lang, string>> = {
  ferie: { it: 'Ferie', en: 'Holiday' },
  permessi: { it: 'Permesso', en: 'Leave' },
  malattia: { it: 'Malattia', en: 'Sick leave' },
  assenza: { it: 'Assenza', en: 'Absence' },
  chiusura: { it: 'Chiusura aziendale', en: 'Company closure' },
};
function labelOf(type: string, lang: Lang): string {
  return LEAVE_LABEL[type]?.[lang] ?? type;
}

const EVENT_LABEL: Record<string, Record<Lang, string>> = {
  clock_in: { it: 'Ingresso', en: 'Clock-in' },
  clock_out: { it: 'Uscita', en: 'Clock-out' },
  break_start: { it: 'Inizio pausa', en: 'Break start' },
  break_end: { it: 'Fine pausa', en: 'Break end' },
  lunch_start: { it: 'Inizio pausa pranzo', en: 'Lunch start' },
  lunch_end: { it: 'Fine pausa pranzo', en: 'Lunch end' },
};
function correctionLabel(eventType: string, lang: Lang): string {
  return EVENT_LABEL[eventType]?.[lang] ?? eventType;
}

// Localized push title/body strings, keyed by recipient language.
const PUSH = {
  leaveSubmitted: {
    title: { it: 'Nuova richiesta', en: 'New request' },
    body: (name: string, label: string) => ({ it: `${name}: ${label}`, en: `${name}: ${label}` }),
  },
  leaveDecided: {
    title: (d: 'approved' | 'rejected'): Record<Lang, string> =>
      d === 'approved'
        ? { it: 'Richiesta approvata', en: 'Request approved' }
        : { it: 'Richiesta rifiutata', en: 'Request rejected' },
    body: (label: string, d: 'approved' | 'rejected', reason?: string): Record<Lang, string> => {
      const v = { it: d === 'approved' ? 'approvata' : 'rifiutata', en: d === 'approved' ? 'approved' : 'rejected' };
      const tail = reason ? `: ${reason}` : '';
      return { it: `${label} ${v.it}${tail}`, en: `${label} ${v.en}${tail}` };
    },
  },
  cancellationRequested: {
    title: { it: 'Annullamento richiesto', en: 'Cancellation requested' },
    body: (name: string, label: string) => ({ it: `${name}: ${label}`, en: `${name}: ${label}` }),
  },
  cancellationDecided: {
    title: (accepted: boolean): Record<Lang, string> =>
      accepted
        ? { it: 'Annullamento accettato', en: 'Cancellation accepted' }
        : { it: 'Annullamento rifiutato', en: 'Cancellation rejected' },
  },
  reminder: {
    title: { it: 'Promemoria', en: 'Reminder' },
    body: (label: string) => ({ it: `Domani: ${label}`, en: `Tomorrow: ${label}` }),
  },
  bulkEvent: {
    title: { it: 'Evento aziendale', en: 'Company event' },
  },
  correctionSubmitted: {
    title: { it: 'Nuova correzione', en: 'New correction' },
    body: (name: string, label: string) => ({ it: `${name}: ${label}`, en: `${name}: ${label}` }),
  },
  correctionDecided: {
    title: (d: 'approved' | 'rejected'): Record<Lang, string> =>
      d === 'approved'
        ? { it: 'Correzione approvata', en: 'Correction approved' }
        : { it: 'Correzione rifiutata', en: 'Correction rejected' },
    body: (label: string, note?: string): Record<Lang, string> => {
      const tail = note ? `: ${note}` : '';
      return { it: `${label}${tail}`, en: `${label}${tail}` };
    },
  },
} as const;
