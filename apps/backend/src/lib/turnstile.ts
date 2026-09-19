import { env } from '../env.js';
import { createLogger } from './logger.js';

const logger = createLogger('turnstile');

export type TurnstileOutcome = 'ok' | 'missing' | 'failed' | 'error' | 'disabled';

/**
 * Verify a Cloudflare Turnstile token with siteverify. Without a configured
 * secret (local dev) the check is 'disabled' and callers let the request
 * through; production refuses to boot with SIGNUP_ENABLED and no secret.
 */
export async function verifyTurnstile(token: string | undefined, ip: string | undefined): Promise<TurnstileOutcome> {
  if (!env.TURNSTILE_SECRET_KEY) return 'disabled';
  if (!token) return 'missing';
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip ?? '' }),
    });
    const json = (await res.json()) as { success?: boolean };
    return json.success ? 'ok' : 'failed';
  } catch (err) {
    logger.error({ err }, 'Turnstile verification error');
    return 'error';
  }
}
