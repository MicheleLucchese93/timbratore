import type { PoolClient } from 'pg';
import { adminPool } from './admin-db.js';
import { createLogger } from './logger.js';
import {
  buildSubmittedMail,
  buildDecidedMail,
  buildCancellationRequestedMail,
  buildCancellationDecidedMail,
  sendMail,
  type LeaveMailPayload,
} from './mailer.js';

const logger = createLogger('notifications');

interface RecipientRow {
  user_id: string;
  email: string | null;
  display_name: string | null;
  push_token: string | null;
  language: string | null;
}

async function loadRecipients(userIds: string[]): Promise<RecipientRow[]> {
  if (userIds.length === 0) return [];
  const r = await adminPool.query(
    `SELECT au.id AS user_id, au.email, au.display_name,
            up.push_token, up.language
       FROM auth_users au
       LEFT JOIN user_preferences up ON up.user_id = au.id
      WHERE au.id = ANY($1::uuid[])`,
    [userIds]
  );
  return r.rows;
}

async function loadApproverIds(client: PoolClient, userId: string): Promise<string[]> {
  const r = await client.query(
    `SELECT approver_user_id FROM leave_approvers WHERE user_id = $1`,
    [userId]
  );
  return r.rows.map((row) => row.approver_user_id);
}

async function sendExpoPush(
  token: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  if (!token.startsWith('ExponentPushToken[') && !token.startsWith('ExpoPushToken[')) {
    // Non-Expo tokens not handled here (FCM/APNs would need their own dispatcher).
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
  const approverIds = await loadApproverIds(client, ctx.requester_id);
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
    if (a.email) {
      await sendMail({ to: a.email, subject: mail.subject, text: mail.text, html: mail.html });
    }
    if (a.push_token) {
      await sendExpoPush(a.push_token, 'Nuova richiesta', `${requesterName}: ${labelOf(ctx.type)}`, {
        kind: 'leave_submitted',
        request_id: ctx.requestId,
      });
    }
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
  if (requester.email) {
    await sendMail({ to: requester.email, subject: mail.subject, text: mail.text, html: mail.html });
  }
  if (requester.push_token) {
    const verb = decision === 'approved' ? 'approvata' : 'rifiutata';
    await sendExpoPush(
      requester.push_token,
      `Richiesta ${verb}`,
      `${labelOf(ctx.type)} ${verb}${rejectionReason ? `: ${rejectionReason}` : ''}`,
      { kind: 'leave_decided', request_id: ctx.requestId, decision }
    );
  }
  void client;
}

export async function notifyCancellationRequested(
  client: PoolClient,
  ctx: LeaveContext
): Promise<void> {
  const approverIds = await loadApproverIds(client, ctx.requester_id);
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
    if (a.email) {
      await sendMail({ to: a.email, subject: mail.subject, text: mail.text, html: mail.html });
    }
    if (a.push_token) {
      await sendExpoPush(
        a.push_token,
        'Annullamento richiesto',
        `${requesterName}: ${labelOf(ctx.type)}`,
        { kind: 'leave_cancellation_requested', request_id: ctx.requestId }
      );
    }
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
  if (requester.email) {
    await sendMail({ to: requester.email, subject: mail.subject, text: mail.text, html: mail.html });
  }
  if (requester.push_token) {
    await sendExpoPush(
      requester.push_token,
      `Annullamento ${accepted ? 'accettato' : 'rifiutato'}`,
      labelOf(ctx.type),
      { kind: 'leave_cancellation_decided', request_id: ctx.requestId, accepted }
    );
  }
}

function labelOf(type: string): string {
  if (type === 'ferie') return 'Ferie';
  if (type === 'permessi') return 'Permesso';
  if (type === 'malattia') return 'Malattia';
  return type;
}
