import nodemailer, { type Transporter } from 'nodemailer';
import type { DocumentCategory } from '@sonoqui/shared';
import { env } from '../env.js';
import { createLogger } from './logger.js';
import { renderTemplate, escapeHtml, stripHeader } from './template-renderer.js';

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

export { escapeHtml, stripHeader };

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

/* ----- Leave-related email templates ----- */

const TYPE_LABEL: Record<string, { it: string; en: string }> = {
  ferie: { it: 'Ferie', en: 'Holiday' },
  permessi: { it: 'Permesso', en: 'Time off' },
  malattia: { it: 'Malattia', en: 'Sick leave' },
  assenza: { it: 'Assenza', en: 'Absence' },
  chiusura: { it: 'Chiusura aziendale', en: 'Company closure' },
};

const SUBJECTS = {
  submitted: {
    it: (label: string, who: string) =>
      `[sonoQui] Nuova richiesta di ${label.toLowerCase()} — ${who}`,
    en: (label: string, who: string) =>
      `[sonoQui] New ${label.toLowerCase()} request — ${who}`,
  },
  decided: {
    it: (label: string, verb: string) =>
      `[sonoQui] Richiesta di ${label.toLowerCase()} ${verb}`,
    en: (label: string, verb: string) =>
      `[sonoQui] ${label} request ${verb}`,
  },
  cancellationRequested: {
    it: (label: string, who: string) =>
      `[sonoQui] ${who} chiede di annullare ${label.toLowerCase()}`,
    en: (label: string, who: string) =>
      `[sonoQui] ${who} is cancelling ${label.toLowerCase()}`,
  },
  cancellationDecided: {
    it: (label: string, verb: string) =>
      `[sonoQui] Annullamento ${label.toLowerCase()} ${verb}`,
    en: (label: string, verb: string) =>
      `[sonoQui] ${label} cancellation ${verb}`,
  },
} as const;

function decisionVerb(decision: 'approved' | 'rejected', language: 'it' | 'en'): string {
  if (language === 'it') return decision === 'approved' ? 'approvata' : 'rifiutata';
  return decision === 'approved' ? 'approved' : 'rejected';
}

function cancellationVerb(accepted: boolean, language: 'it' | 'en'): string {
  if (language === 'it') return accepted ? 'accettato' : 'rifiutato';
  return accepted ? 'accepted' : 'rejected';
}

function fmtRange(fromIso: string, toIso: string, type: string, language: 'it' | 'en'): string {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const sameDay = from.toDateString() === to.toDateString();
  const locale = language === 'it' ? 'it-IT' : 'en-GB';
  const dOpts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };
  const tOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  if (type === 'permessi' && sameDay) {
    return `${from.toLocaleDateString(locale, dOpts)} ${from.toLocaleTimeString(locale, tOpts)}–${to.toLocaleTimeString(locale, tOpts)}`;
  }
  if (sameDay) return from.toLocaleDateString(locale, dOpts);
  return `${from.toLocaleDateString(locale, dOpts)} → ${to.toLocaleDateString(locale, dOpts)}`;
}

function actionUrl(): string {
  return env.WEB_PUBLIC_URL.replace(/\/$/, '') + '/leaves';
}

export interface LeaveMailPayload {
  type: string;
  from_ts: string;
  to_ts: string;
  duration_hours: number;
  requester_name: string;
  approver_name?: string;
  reason?: string;
  language?: 'it' | 'en';
}

function labelFor(type: string, language: 'it' | 'en'): string {
  return TYPE_LABEL[type]?.[language] ?? type;
}

export function buildSubmittedMail(p: LeaveMailPayload): {
  subject: string;
  text: string;
  html: string;
} {
  const language = p.language ?? 'it';
  const label = labelFor(p.type, language);
  const range = fmtRange(p.from_ts, p.to_ts, p.type, language);
  const subject = SUBJECTS.submitted[language](label, p.requester_name);
  const text =
    language === 'it'
      ? `${p.requester_name} ha inviato una richiesta di ${label.toLowerCase()}.\n` +
        `Periodo: ${range}\nOre: ${p.duration_hours}\n` +
        (p.reason ? `Note: ${p.reason}\n` : '') +
        `\nAccedi a sonoQui per approvare o rifiutare.`
      : `${p.requester_name} submitted a ${label.toLowerCase()} request.\n` +
        `Period: ${range}\nHours: ${p.duration_hours}\n` +
        (p.reason ? `Note: ${p.reason}\n` : '') +
        `\nOpen sonoQui to approve or reject.`;
  const html = renderTemplate('leave-submitted.html', {
    language,
    TypeLabel: label,
    RequesterName: p.requester_name,
    Range: range,
    DurationHours: String(p.duration_hours),
    HasNote: p.reason ? '1' : '0',
    Note: p.reason ?? '',
    ActionUrl: actionUrl(),
  });
  return { subject, text, html };
}

export function buildDecidedMail(
  p: LeaveMailPayload,
  decision: 'approved' | 'rejected',
  rejectionReason?: string
): { subject: string; text: string; html: string } {
  const language = p.language ?? 'it';
  const label = labelFor(p.type, language);
  const range = fmtRange(p.from_ts, p.to_ts, p.type, language);
  const verb = decisionVerb(decision, language);
  const subject = SUBJECTS.decided[language](label, verb);
  const reasonLine =
    decision === 'rejected' && rejectionReason
      ? (language === 'it' ? `Motivo: ${rejectionReason}\n` : `Reason: ${rejectionReason}\n`)
      : '';
  const approverLine = p.approver_name
    ? (language === 'it' ? `Decisa da: ${p.approver_name}\n` : `Decided by: ${p.approver_name}\n`)
    : '';
  const text =
    language === 'it'
      ? `La tua richiesta di ${label.toLowerCase()} è stata ${verb}.\n` +
        `Periodo: ${range}\nOre: ${p.duration_hours}\n${reasonLine}${approverLine}`
      : `Your ${label.toLowerCase()} request has been ${verb}.\n` +
        `Period: ${range}\nHours: ${p.duration_hours}\n${reasonLine}${approverLine}`;
  const html = renderTemplate('leave-decided.html', {
    language,
    TypeLabel: label,
    Range: range,
    DurationHours: String(p.duration_hours),
    DecisionVerb: verb,
    HasReason: decision === 'rejected' && rejectionReason ? '1' : '0',
    Reason: rejectionReason ?? '',
    HasApprover: p.approver_name ? '1' : '0',
    ApproverName: p.approver_name ?? '',
  });
  return { subject, text, html };
}

export function buildCancellationRequestedMail(p: LeaveMailPayload): {
  subject: string;
  text: string;
  html: string;
} {
  const language = p.language ?? 'it';
  const label = labelFor(p.type, language);
  const range = fmtRange(p.from_ts, p.to_ts, p.type, language);
  const subject = SUBJECTS.cancellationRequested[language](label, p.requester_name);
  const text =
    language === 'it'
      ? `${p.requester_name} chiede l'annullamento di una richiesta di ${label.toLowerCase()} già approvata.\n` +
        `Periodo: ${range}\n` +
        (p.reason ? `Motivo: ${p.reason}\n` : '')
      : `${p.requester_name} is asking to cancel an approved ${label.toLowerCase()} request.\n` +
        `Period: ${range}\n` +
        (p.reason ? `Reason: ${p.reason}\n` : '');
  const html = renderTemplate('leave-cancellation-requested.html', {
    language,
    TypeLabel: label,
    RequesterName: p.requester_name,
    Range: range,
    DurationHours: String(p.duration_hours),
    HasReason: p.reason ? '1' : '0',
    Reason: p.reason ?? '',
    ActionUrl: actionUrl(),
  });
  return { subject, text, html };
}

/* ----- Correction-request email templates ----- */

const EVENT_LABEL: Record<string, { it: string; en: string }> = {
  clock_in: { it: 'Ingresso', en: 'Clock in' },
  clock_out: { it: 'Uscita', en: 'Clock out' },
  break_start: { it: 'Inizio pausa', en: 'Break start' },
  break_end: { it: 'Fine pausa', en: 'Break end' },
  lunch_start: { it: 'Inizio pausa pranzo', en: 'Lunch start' },
  lunch_end: { it: 'Fine pausa pranzo', en: 'Lunch end' },
};

export interface CorrectionMailPayload {
  event_type: string;
  occurred_at: string;
  is_edit: boolean;
  justification: string;
  requester_name: string;
  approver_name?: string;
  note?: string;
  language?: 'it' | 'en';
}

function eventLabel(eventType: string, language: 'it' | 'en'): string {
  return EVENT_LABEL[eventType]?.[language] ?? eventType;
}

function fmtMoment(iso: string, language: 'it' | 'en'): string {
  const d = new Date(iso);
  const locale = language === 'it' ? 'it-IT' : 'en-GB';
  return d.toLocaleString(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function correctionsActionUrl(): string {
  return env.WEB_PUBLIC_URL.replace(/\/$/, '') + '/corrections';
}

export function buildCorrectionSubmittedMail(p: CorrectionMailPayload): {
  subject: string;
  text: string;
  html: string;
} {
  const language = p.language ?? 'it';
  const evt = eventLabel(p.event_type, language);
  const when = fmtMoment(p.occurred_at, language);
  const kind =
    language === 'it'
      ? p.is_edit
        ? 'Modifica timbratura'
        : 'Timbratura mancante'
      : p.is_edit
        ? 'Edit existing stamp'
        : 'Missing stamp';
  const subject =
    language === 'it'
      ? `[sonoQui] Nuova correzione timbratura — ${p.requester_name}`
      : `[sonoQui] New stamp correction — ${p.requester_name}`;
  const text =
    language === 'it'
      ? `${p.requester_name} ha inviato una richiesta di correzione.\n` +
        `Tipo: ${kind}\nEvento: ${evt}\nQuando: ${when}\nMotivazione: ${p.justification}\n` +
        `\nAccedi a sonoQui per approvare o rifiutare.`
      : `${p.requester_name} submitted a stamp correction.\n` +
        `Kind: ${kind}\nEvent: ${evt}\nWhen: ${when}\nReason: ${p.justification}\n` +
        `\nOpen sonoQui to approve or reject.`;
  const html = renderTemplate('correction-submitted.html', {
    language,
    RequesterName: p.requester_name,
    Kind: kind,
    EventLabel: evt,
    When: when,
    Justification: p.justification,
    ActionUrl: correctionsActionUrl(),
  });
  return { subject, text, html };
}

export function buildCorrectionDecidedMail(
  p: CorrectionMailPayload,
  decision: 'approved' | 'rejected'
): { subject: string; text: string; html: string } {
  const language = p.language ?? 'it';
  const evt = eventLabel(p.event_type, language);
  const when = fmtMoment(p.occurred_at, language);
  const verb = decisionVerb(decision, language);
  const subject =
    language === 'it'
      ? `[sonoQui] Correzione ${verb}`
      : `[sonoQui] Correction ${verb}`;
  const noteLine = p.note
    ? language === 'it' ? `Nota: ${p.note}\n` : `Note: ${p.note}\n`
    : '';
  const approverLine = p.approver_name
    ? language === 'it' ? `Decisa da: ${p.approver_name}\n` : `Decided by: ${p.approver_name}\n`
    : '';
  const text =
    language === 'it'
      ? `La tua richiesta di correzione è stata ${verb}.\nEvento: ${evt}\nQuando: ${when}\n${noteLine}${approverLine}`
      : `Your correction request has been ${verb}.\nEvent: ${evt}\nWhen: ${when}\n${noteLine}${approverLine}`;
  const html = renderTemplate('correction-decided.html', {
    language,
    EventLabel: evt,
    When: when,
    DecisionVerb: verb,
    HasNote: p.note ? '1' : '0',
    Note: p.note ?? '',
    HasApprover: p.approver_name ? '1' : '0',
    ApproverName: p.approver_name ?? '',
  });
  return { subject, text, html };
}

export function buildCancellationDecidedMail(
  p: LeaveMailPayload,
  accepted: boolean
): { subject: string; text: string; html: string } {
  const language = p.language ?? 'it';
  const label = labelFor(p.type, language);
  const range = fmtRange(p.from_ts, p.to_ts, p.type, language);
  const verb = cancellationVerb(accepted, language);
  const subject = SUBJECTS.cancellationDecided[language](label, verb);
  const text =
    language === 'it'
      ? `La tua richiesta di annullamento è stata ${verb}.\nTipo: ${label}\nPeriodo: ${range}\n`
      : `Your cancellation request has been ${verb}.\nType: ${label}\nPeriod: ${range}\n`;
  const html = renderTemplate('leave-cancellation-decided.html', {
    language,
    TypeLabel: label,
    Range: range,
    DurationHours: String(p.duration_hours),
    DecisionVerb: verb,
  });
  return { subject, text, html };
}

/* ----- 24h reminder + company-event emails (inline HTML, no template file) ----- */

function inlineMail(heading: string, bodyLines: string[]): string {
  const rows = bodyLines.map((l) => `<p style="margin:4px 0;color:#334155">${l}</p>`).join('');
  return (
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px">` +
    `<h2 style="color:#0f172a;font-size:18px;margin:0 0 12px">${escapeHtml(heading)}</h2>` +
    rows +
    `<p style="margin-top:20px;color:#94a3b8;font-size:12px">sonoQui</p>` +
    `</div>`
  );
}

export interface ReminderMailPayload {
  type: string;
  from_ts: string;
  to_ts: string;
  title?: string | null;
  language?: 'it' | 'en';
}

/** "Tomorrow you have ferie" reminder, sent the evening before from_ts. */
export function buildReminderMail(p: ReminderMailPayload): {
  subject: string;
  text: string;
  html: string;
} {
  const language = p.language ?? 'it';
  const label = p.title || labelFor(p.type, language);
  const range = fmtRange(p.from_ts, p.to_ts, p.type, language);
  const subject =
    language === 'it'
      ? `[sonoQui] Promemoria: domani ${label}`
      : `[sonoQui] Reminder: ${label} starts tomorrow`;
  const lines =
    language === 'it'
      ? [`Domani inizia: <strong>${escapeHtml(label)}</strong>.`, `Periodo: ${escapeHtml(range)}`]
      : [`Starting tomorrow: <strong>${escapeHtml(label)}</strong>.`, `Period: ${escapeHtml(range)}`];
  const text =
    language === 'it'
      ? `Promemoria: domani inizia ${label}.\nPeriodo: ${range}\n`
      : `Reminder: ${label} starts tomorrow.\nPeriod: ${range}\n`;
  return { subject, text, html: inlineMail(language === 'it' ? 'Promemoria' : 'Reminder', lines) };
}

export interface BulkEventMailPayload {
  title: string;
  from_ts: string;
  to_ts: string;
  deducts_ferie: boolean;
  language?: 'it' | 'en';
}

/** Notice sent to each user when an admin pushes a company event to them. */
export function buildBulkEventMail(p: BulkEventMailPayload): {
  subject: string;
  text: string;
  html: string;
} {
  const language = p.language ?? 'it';
  const range = fmtRange(p.from_ts, p.to_ts, 'chiusura', language);
  const subject =
    language === 'it'
      ? `[sonoQui] Nuovo evento aziendale: ${p.title}`
      : `[sonoQui] New company event: ${p.title}`;
  const ferieLine = p.deducts_ferie
    ? language === 'it'
      ? 'Questo periodo è conteggiato come ferie.'
      : 'This period is counted as holiday.'
    : language === 'it'
      ? 'Questo periodo non intacca le tue ferie.'
      : 'This period does not affect your holiday balance.';
  const lines =
    language === 'it'
      ? [
          `È stato aggiunto un evento al tuo calendario: <strong>${escapeHtml(p.title)}</strong>.`,
          `Periodo: ${escapeHtml(range)}`,
          escapeHtml(ferieLine),
        ]
      : [
          `An event was added to your calendar: <strong>${escapeHtml(p.title)}</strong>.`,
          `Period: ${escapeHtml(range)}`,
          escapeHtml(ferieLine),
        ];
  const text =
    language === 'it'
      ? `Nuovo evento aziendale: ${p.title}.\nPeriodo: ${range}\n${ferieLine}\n`
      : `New company event: ${p.title}.\nPeriod: ${range}\n${ferieLine}\n`;
  return {
    subject,
    text,
    html: inlineMail(language === 'it' ? 'Evento aziendale' : 'Company event', lines),
  };
}

/* ----- New-document email ----- */

const DOCUMENT_CATEGORY_LABEL: Record<DocumentCategory, { it: string; en: string }> = {
  cedolino: { it: 'Cedolino', en: 'Payslip' },
  cu: { it: 'Certificazione Unica (CU)', en: 'Single Certification (CU)' },
  contratto: { it: 'Contratto', en: 'Contract' },
  comunicazione: { it: 'Comunicazione', en: 'Communication' },
  altro: { it: 'Altro', en: 'Other' },
};

export function documentCategoryLabel(
  category: DocumentCategory,
  language: 'it' | 'en'
): string {
  return DOCUMENT_CATEGORY_LABEL[category]?.[language] ?? category;
}

export interface DocumentUploadedMailPayload {
  title: string;
  category: DocumentCategory;
  language?: 'it' | 'en';
}

function documentsActionUrl(): string {
  return env.WEB_PUBLIC_URL.replace(/\/$/, '') + '/documents';
}

/** Notice sent to an employee when an admin uploads a new document for them. */
export function buildDocumentUploadedMail(p: DocumentUploadedMailPayload): {
  subject: string;
  text: string;
  html: string;
} {
  const language = p.language ?? 'it';
  const categoryLabel = documentCategoryLabel(p.category, language);
  const subject =
    language === 'it'
      ? `[sonoQui] Nuovo documento: ${p.title}`
      : `[sonoQui] New document: ${p.title}`;
  const text =
    language === 'it'
      ? `È disponibile un nuovo documento per te.\n` +
        `Titolo: ${p.title}\nCategoria: ${categoryLabel}\n` +
        `\nAccedi a sonoQui per visualizzarlo.`
      : `A new document is available for you.\n` +
        `Title: ${p.title}\nCategory: ${categoryLabel}\n` +
        `\nOpen sonoQui to view it.`;
  const html = renderTemplate('document-uploaded.html', {
    language,
    Title: p.title,
    CategoryLabel: categoryLabel,
    ActionUrl: documentsActionUrl(),
  });
  return { subject, text, html };
}

/* ----- Documentale OTP email ----- */

export interface DocumentOtpMailPayload {
  code: string;
  ttlMinutes: number;
  language?: 'it' | 'en';
}

/**
 * One-time code emailed to a Documentale member before they may view the
 * tenant's documents. The code is in the BODY only (never the subject), since
 * subject lines surface in lock-screen notification previews.
 */
export function buildDocumentOtpMail(p: DocumentOtpMailPayload): {
  subject: string;
  text: string;
  html: string;
} {
  const language = p.language ?? 'it';
  const subject =
    language === 'it'
      ? `[sonoQui] Codice di verifica per i documenti`
      : `[sonoQui] Your documents verification code`;
  const text =
    language === 'it'
      ? `Il tuo codice di verifica per consultare i documenti è: ${p.code}\n` +
        `Il codice è valido per ${p.ttlMinutes} minuti. Non condividerlo con nessuno.\n` +
        `Se non hai richiesto questo codice, ignora questa email.`
      : `Your verification code to view documents is: ${p.code}\n` +
        `The code is valid for ${p.ttlMinutes} minutes. Do not share it with anyone.\n` +
        `If you did not request this code, ignore this email.`;
  const html = renderTemplate('document-otp.html', {
    language,
    Code: p.code,
    TtlMinutes: String(p.ttlMinutes),
  });
  return { subject, text, html };
}
