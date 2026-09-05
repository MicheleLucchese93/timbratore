import { z } from 'zod';

/**
 * Validation + email rendering for the public website contact form
 * ("Contattaci"). Kept out of the route so it can be unit-tested without
 * loading the server env or an SMTP transport.
 */

/**
 * Strip CR/LF from values that flow into mail headers (subject, From, etc.)
 * to prevent SMTP header injection.
 */
export function stripHeader(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/** Minimal HTML escape for user input rendered in the HTML email body. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const helpdeskSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[^\r\n]+$/, 'Invalid characters'),
  email: z.string().email().max(254),
  // Phone and company are mandatory: a lead without a callback number and a
  // company name is not actionable by sales.
  phone: z
    .string()
    .min(6)
    .max(30)
    .regex(/^[0-9+()./\s-]+$/, 'Invalid phone'),
  company: z.string().min(1).max(120).regex(/^[^\r\n]+$/, 'Invalid characters'),
  subject: z.string().min(1).max(200).regex(/^[^\r\n]+$/, 'Invalid characters'),
  message: z.string().min(1).max(5000),
  source: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid source')
    .optional(),
  turnstileToken: z.string().min(1).optional(),
});

export type HelpdeskSubmission = z.infer<typeof helpdeskSchema>;

export type HelpdeskMail = {
  replyTo: string;
  subject: string;
  text: string;
  html: string;
};

/** Render the notification email for one contact-form submission. */
export function buildHelpdeskMail(submission: HelpdeskSubmission): HelpdeskMail {
  const safeSource = stripHeader(submission.source ?? 'sonoqui').toUpperCase();
  const safeSubject = stripHeader(submission.subject);
  const safeName = stripHeader(submission.name);
  const safeEmail = stripHeader(submission.email);
  const safePhone = stripHeader(submission.phone);
  const safeCompany = stripHeader(submission.company);
  const { message } = submission;

  return {
    replyTo: safeEmail,
    subject: `[${safeSource}] ${safeSubject}`,
    text: [
      `Source: ${safeSource}`,
      `Name: ${safeName}`,
      `Email: ${safeEmail}`,
      `Phone: ${safePhone}`,
      `Company: ${safeCompany}`,
      `Subject: ${safeSubject}`,
      '',
      message,
    ].join('\n'),
    html: `
        <h3>Nuova richiesta di contatto ${escapeHtml(safeSource)}</h3>
        <p><strong>Nome:</strong> ${escapeHtml(safeName)}</p>
        <p><strong>Email:</strong> ${escapeHtml(safeEmail)}</p>
        <p><strong>Telefono:</strong> ${escapeHtml(safePhone)}</p>
        <p><strong>Azienda:</strong> ${escapeHtml(safeCompany)}</p>
        <p><strong>Oggetto:</strong> ${escapeHtml(safeSubject)}</p>
        <hr/>
        <p>${escapeHtml(message).replace(/\n/g, '<br/>')}</p>
      `,
  };
}
