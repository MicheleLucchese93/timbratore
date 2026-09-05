import { Router, type Request, type Response } from 'express';
import { createTransport } from 'nodemailer';
import rateLimit from 'express-rate-limit';
import { env } from '../env.js';
import { createLogger } from '../lib/logger.js';
import { buildHelpdeskMail, helpdeskSchema } from '../lib/helpdesk-mail.js';

const logger = createLogger('Helpdesk');

export const helpdeskRouter = Router();

const helpdeskLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
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

  const { turnstileToken } = parsed.data;
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

    const mail = buildHelpdeskMail(parsed.data);

    await transporter.sendMail({
      from: env.SMTP_FROM || env.SMTP_USER,
      to: env.HELPDESK_TO,
      replyTo: mail.replyTo,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });

    logger.info({ source }, 'Helpdesk email sent');
    res.json({ success: true });
  } catch (err) {
    logger.error({ error: err }, 'Failed to send helpdesk email');
    res.status(500).json({ error: 'Failed to send message. Please try again later.' });
  }
});
