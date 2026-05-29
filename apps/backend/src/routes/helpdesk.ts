import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { createTransport } from 'nodemailer';
import rateLimit from 'express-rate-limit';
import { env } from '../env.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('Helpdesk');

export const helpdeskRouter = Router();

const helpdeskLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Strip CR/LF from values that flow into mail headers (subject, From, etc.)
 * to prevent SMTP header injection.
 */
function stripHeader(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/** Minimal HTML escape for user input rendered in the HTML email body. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const helpdeskSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[^\r\n]+$/, 'Invalid characters'),
  email: z.string().email().max(254),
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

// POST /api/v1/helpdesk  — public contact form (website "Contattaci").
helpdeskRouter.post('/', helpdeskLimiter, async (req: Request, res: Response) => {
  const parsed = helpdeskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { name, email, subject, message, turnstileToken } = parsed.data;
  const source = parsed.data.source ?? 'sonoqui';

  // Verify Cloudflare Turnstile only when a secret is configured. When set,
  // the token is REQUIRED (refusing one is a 400, so curl can't skip CAPTCHA).
  if (env.TURNSTILE_SECRET_KEY && !turnstileToken) {
    logger.warn({ ip: req.ip }, 'Helpdesk submission missing turnstileToken');
    res.status(400).json({ error: 'CAPTCHA token required.' });
    return;
  }
  if (env.TURNSTILE_SECRET_KEY && turnstileToken) {
    try {
      const cfRes = await fetch(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            secret: env.TURNSTILE_SECRET_KEY,
            response: turnstileToken,
            remoteip: req.ip || '',
          }),
        }
      );
      const cfResult = (await cfRes.json()) as { success: boolean };
      if (!cfResult.success) {
        logger.warn('Turnstile verification failed');
        res.status(400).json({ error: 'CAPTCHA verification failed.' });
        return;
      }
    } catch (err) {
      logger.error({ error: err }, 'Turnstile verification error');
      res.status(500).json({ error: 'Failed to verify CAPTCHA. Please try again.' });
      return;
    }
  }

  if (!env.HELPDESK_TO) {
    logger.error('HELPDESK_TO is not configured');
    res.status(503).json({ error: 'Helpdesk is not configured.' });
    return;
  }
  if (!env.SMTP_USER || !env.SMTP_PASS) {
    logger.error('SMTP credentials are not configured');
    res.status(503).json({ error: 'Helpdesk is not configured.' });
    return;
  }

  try {
    const transporter = createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: false,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });

    const safeSource = stripHeader(source).toUpperCase();
    const safeSubject = stripHeader(subject);
    const safeName = stripHeader(name);
    const safeEmail = stripHeader(email);

    await transporter.sendMail({
      from: env.SMTP_FROM || env.SMTP_USER,
      to: env.HELPDESK_TO,
      replyTo: safeEmail,
      subject: `[${safeSource}] ${safeSubject}`,
      text: `Source: ${safeSource}\nName: ${safeName}\nEmail: ${safeEmail}\nSubject: ${safeSubject}\n\n${message}`,
      html: `
        <h3>Nuova richiesta di contatto ${escapeHtml(safeSource)}</h3>
        <p><strong>Nome:</strong> ${escapeHtml(safeName)}</p>
        <p><strong>Email:</strong> ${escapeHtml(safeEmail)}</p>
        <p><strong>Oggetto:</strong> ${escapeHtml(safeSubject)}</p>
        <hr/>
        <p>${escapeHtml(message).replace(/\n/g, '<br/>')}</p>
      `,
    });

    logger.info({ source }, 'Helpdesk email sent');
    res.json({ success: true });
  } catch (err) {
    logger.error({ error: err }, 'Failed to send helpdesk email');
    res.status(500).json({ error: 'Failed to send message. Please try again later.' });
  }
});
