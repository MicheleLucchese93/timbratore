import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../env.js';
import { createLogger } from './logger.js';

const logger = createLogger('mailer');

let cached: Transporter | null = null;

function transporter(): Transporter | null {
  if (!env.SMTP_USER || !env.SMTP_PASS) return null;
  if (cached) return cached;
  cached = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: false,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  return cached;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function stripHeader(s: string): string {
  return s.replace(/[\r\n]/g, ' ').slice(0, 998);
}

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}

export async function sendMail(input: MailInput): Promise<boolean> {
  const t = transporter();
  if (!t) {
    logger.warn({ to: input.to, subject: input.subject }, 'SMTP not configured, mail skipped');
    return false;
  }
  try {
    await t.sendMail({
      from: env.SMTP_FROM || env.SMTP_USER,
      to: input.to,
      subject: stripHeader(input.subject),
      text: input.text,
      html: input.html,
      replyTo: input.replyTo ? stripHeader(input.replyTo) : undefined,
    });
    return true;
  } catch (err) {
    logger.error({ err, to: input.to }, 'mail send failed');
    return false;
  }
}

/* ----- Leave-related email templates (Italian) ----- */

function wrap(subject: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#111">
<h2 style="margin:0 0 12px">${escapeHtml(subject)}</h2>
${bodyHtml}
<p style="margin-top:24px;color:#666;font-size:12px">SonoQui — gestione presenze</p>
</body></html>`;
}

function fmtRange(fromIso: string, toIso: string, type: string): string {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const sameDay = from.toDateString() === to.toDateString();
  const dOpts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };
  const tOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  if (type === 'permessi' && sameDay) {
    return `${from.toLocaleDateString('it-IT', dOpts)} ${from.toLocaleTimeString('it-IT', tOpts)}–${to.toLocaleTimeString('it-IT', tOpts)}`;
  }
  if (sameDay) return from.toLocaleDateString('it-IT', dOpts);
  return `${from.toLocaleDateString('it-IT', dOpts)} → ${to.toLocaleDateString('it-IT', dOpts)}`;
}

const TYPE_LABEL: Record<string, string> = {
  ferie: 'Ferie',
  permessi: 'Permesso',
  malattia: 'Malattia',
};

export interface LeaveMailPayload {
  type: string;
  from_ts: string;
  to_ts: string;
  duration_hours: number;
  requester_name: string;
  approver_name?: string;
  reason?: string;
}

export function buildSubmittedMail(p: LeaveMailPayload): { subject: string; text: string; html: string } {
  const label = TYPE_LABEL[p.type] ?? p.type;
  const range = fmtRange(p.from_ts, p.to_ts, p.type);
  const subject = `[SonoQui] Nuova richiesta di ${label.toLowerCase()} — ${p.requester_name}`;
  const text =
    `${p.requester_name} ha inviato una richiesta di ${label.toLowerCase()}.\n` +
    `Periodo: ${range}\n` +
    `Ore: ${p.duration_hours}\n` +
    (p.reason ? `Note: ${p.reason}\n` : '') +
    `\nAccedi all'app per approvare o rifiutare.`;
  const html = wrap(
    subject,
    `<p><strong>${escapeHtml(p.requester_name)}</strong> ha inviato una richiesta di <strong>${escapeHtml(label)}</strong>.</p>
     <ul>
       <li>Periodo: ${escapeHtml(range)}</li>
       <li>Ore: ${p.duration_hours}</li>
       ${p.reason ? `<li>Note: ${escapeHtml(p.reason)}</li>` : ''}
     </ul>
     <p>Accedi all'app per approvare o rifiutare.</p>`
  );
  return { subject, text, html };
}

export function buildDecidedMail(
  p: LeaveMailPayload,
  decision: 'approved' | 'rejected',
  rejectionReason?: string
): { subject: string; text: string; html: string } {
  const label = TYPE_LABEL[p.type] ?? p.type;
  const range = fmtRange(p.from_ts, p.to_ts, p.type);
  const action = decision === 'approved' ? 'approvata' : 'rifiutata';
  const subject = `[SonoQui] Richiesta di ${label.toLowerCase()} ${action}`;
  const reasonLine = decision === 'rejected' && rejectionReason
    ? `Motivo: ${rejectionReason}\n` : '';
  const text =
    `La tua richiesta di ${label.toLowerCase()} è stata ${action}.\n` +
    `Periodo: ${range}\n` +
    `Ore: ${p.duration_hours}\n` +
    reasonLine +
    (p.approver_name ? `Decisa da: ${p.approver_name}\n` : '');
  const html = wrap(
    subject,
    `<p>La tua richiesta di <strong>${escapeHtml(label)}</strong> è stata <strong>${action}</strong>.</p>
     <ul>
       <li>Periodo: ${escapeHtml(range)}</li>
       <li>Ore: ${p.duration_hours}</li>
       ${decision === 'rejected' && rejectionReason ? `<li>Motivo: ${escapeHtml(rejectionReason)}</li>` : ''}
       ${p.approver_name ? `<li>Decisa da: ${escapeHtml(p.approver_name)}</li>` : ''}
     </ul>`
  );
  return { subject, text, html };
}

export function buildCancellationRequestedMail(
  p: LeaveMailPayload
): { subject: string; text: string; html: string } {
  const label = TYPE_LABEL[p.type] ?? p.type;
  const range = fmtRange(p.from_ts, p.to_ts, p.type);
  const subject = `[SonoQui] ${p.requester_name} chiede di annullare ${label.toLowerCase()}`;
  const text =
    `${p.requester_name} ha richiesto l'annullamento di una richiesta di ${label.toLowerCase()} già approvata.\n` +
    `Periodo: ${range}\n` +
    (p.reason ? `Motivo: ${p.reason}\n` : '');
  const html = wrap(
    subject,
    `<p><strong>${escapeHtml(p.requester_name)}</strong> chiede l'annullamento di una richiesta già approvata.</p>
     <ul>
       <li>Tipo: ${escapeHtml(label)}</li>
       <li>Periodo: ${escapeHtml(range)}</li>
       ${p.reason ? `<li>Motivo: ${escapeHtml(p.reason)}</li>` : ''}
     </ul>`
  );
  return { subject, text, html };
}

export function buildCancellationDecidedMail(
  p: LeaveMailPayload,
  accepted: boolean
): { subject: string; text: string; html: string } {
  const label = TYPE_LABEL[p.type] ?? p.type;
  const range = fmtRange(p.from_ts, p.to_ts, p.type);
  const verb = accepted ? 'accettato' : 'rifiutato';
  const subject = `[SonoQui] Annullamento ${label.toLowerCase()} ${verb}`;
  const text =
    `La tua richiesta di annullamento è stata ${verb}.\n` +
    `Tipo: ${label}\nPeriodo: ${range}\n`;
  const html = wrap(
    subject,
    `<p>La tua richiesta di annullamento è stata <strong>${verb}</strong>.</p>
     <ul>
       <li>Tipo: ${escapeHtml(label)}</li>
       <li>Periodo: ${escapeHtml(range)}</li>
     </ul>`
  );
  return { subject, text, html };
}
