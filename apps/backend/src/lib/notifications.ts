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
  sendMail,
  type LeaveMailPayload,
  type CorrectionMailPayload,
} from './mailer.js';

const logger = createLogger('notifications');

// Per-kind push opt-out keys stored in user_preferences.notification_preferences.
// Missing keys are treated as `true` (defaults from migration 021).
type PushPrefKey =
  | 'push_leave_decisions'
  | 'push_correction_decisions'
  | 'push_leave_submissions'
  | 'push_correction_submissions';

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
      body: JSON.stringify({ to: token, title, body, data: data ?? {}, sound: 'default' }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'expo push non-OK');
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
  email: { subject: string; text: string; html: string } | null
): Promise<void> {
  if (push && recipient.push_token && pushAllowed(recipient, push.prefKey)) {
    await sendExpoPush(recipient.push_token, push.title, push.body, push.data);
  }
  if (email && recipient.email && recipient.email_notifications_enabled) {
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
  type: 'ferie' | 'permessi' | 'malattia';
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

  const payload: LeaveMailPayload = {
    type: ctx.type,
    from_ts: ctx.from_ts,
    to_ts: ctx.to_ts,
    duration_hours: ctx.duration_hours,
    requester_name: requesterName,
    reason: ctx.reason,
  };
  const mail = buildSubmittedMail(payload);

  for (const a of approvers) {
    await deliver(
      a,
      {
        title: 'Nuova richiesta',
        body: `${requesterName}: ${labelOf(ctx.type)}`,
        data: { kind: 'leave_submitted', request_id: ctx.requestId },
        prefKey: 'push_leave_submissions',
      },
      mail
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
  const payload: LeaveMailPayload = {
    type: ctx.type,
    from_ts: ctx.from_ts,
    to_ts: ctx.to_ts,
    duration_hours: ctx.duration_hours,
    requester_name: requester.display_name || requester.email || 'Utente',
    approver_name: approver?.display_name || approver?.email || undefined,
  };
  const mail = buildDecidedMail(payload, decision, rejectionReason);
  const verb = decision === 'approved' ? 'approvata' : 'rifiutata';
  await deliver(
    requester,
    {
      title: `Richiesta ${verb}`,
      body: `${labelOf(ctx.type)} ${verb}${rejectionReason ? `: ${rejectionReason}` : ''}`,
      data: { kind: 'leave_decided', request_id: ctx.requestId, decision },
      prefKey: 'push_leave_decisions',
    },
    mail
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
  const payload: LeaveMailPayload = {
    type: ctx.type,
    from_ts: ctx.from_ts,
    to_ts: ctx.to_ts,
    duration_hours: ctx.duration_hours,
    requester_name: requesterName,
    reason: ctx.reason,
  };
  const mail = buildCancellationRequestedMail(payload);
  for (const a of approvers) {
    await deliver(
      a,
      {
        title: 'Annullamento richiesto',
        body: `${requesterName}: ${labelOf(ctx.type)}`,
        data: { kind: 'leave_cancellation_requested', request_id: ctx.requestId },
        prefKey: 'push_leave_submissions',
      },
      mail
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
  const payload: LeaveMailPayload = {
    type: ctx.type,
    from_ts: ctx.from_ts,
    to_ts: ctx.to_ts,
    duration_hours: ctx.duration_hours,
    requester_name: requester.display_name || requester.email || 'Utente',
  };
  const mail = buildCancellationDecidedMail(payload, accepted);
  await deliver(
    requester,
    {
      title: `Annullamento ${accepted ? 'accettato' : 'rifiutato'}`,
      body: labelOf(ctx.type),
      data: { kind: 'leave_cancellation_decided', request_id: ctx.requestId, accepted },
      prefKey: 'push_leave_decisions',
    },
    mail
  );
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

  const payload: CorrectionMailPayload = {
    event_type: ctx.event_type,
    occurred_at: ctx.occurred_at,
    is_edit: ctx.is_edit,
    justification: ctx.justification,
    requester_name: requesterName,
  };
  const mail = buildCorrectionSubmittedMail(payload);
  for (const a of approvers) {
    await deliver(
      a,
      {
        title: 'Nuova correzione',
        body: `${requesterName}: ${correctionLabel(ctx.event_type)}`,
        data: { kind: 'correction_submitted', request_id: ctx.requestId },
        prefKey: 'push_correction_submissions',
      },
      mail
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
  const payload: CorrectionMailPayload = {
    event_type: ctx.event_type,
    occurred_at: ctx.occurred_at,
    is_edit: ctx.is_edit,
    justification: ctx.justification,
    requester_name: requester.display_name || requester.email || 'Utente',
    approver_name: approver?.display_name || approver?.email || undefined,
    note,
  };
  const mail = buildCorrectionDecidedMail(payload, decision);
  const verb = decision === 'approved' ? 'approvata' : 'rifiutata';
  await deliver(
    requester,
    {
      title: `Correzione ${verb}`,
      body: `${correctionLabel(ctx.event_type)}${note ? `: ${note}` : ''}`,
      data: { kind: 'correction_decided', request_id: ctx.requestId, decision },
      prefKey: 'push_correction_decisions',
    },
    mail
  );
}

function labelOf(type: string): string {
  if (type === 'ferie') return 'Ferie';
  if (type === 'permessi') return 'Permesso';
  if (type === 'malattia') return 'Malattia';
  return type;
}

function correctionLabel(eventType: string): string {
  switch (eventType) {
    case 'clock_in': return 'Ingresso';
    case 'clock_out': return 'Uscita';
    case 'break_start': return 'Inizio pausa';
    case 'break_end': return 'Fine pausa';
    case 'lunch_start': return 'Inizio pausa pranzo';
    case 'lunch_end': return 'Fine pausa pranzo';
    default: return eventType;
  }
}
