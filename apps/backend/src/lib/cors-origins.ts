import { env } from '../env.js';

/**
 * The browser origins this API answers to.
 *
 * Shared by the CORS middleware and the `Timing-Allow-Origin` header, which must
 * agree: Server-Timing is only readable cross-origin when the response opts that
 * origin in, and opting in `*` would hand request-duration data to any page on
 * the internet. The API's own origin is included because the static auth pages
 * (reset-password.html, confirm-email.html) are served from BACKEND_URL and POST
 * same-origin to /api/v1/auth/*.
 */
export const allowedOrigins: readonly string[] = [
  ...env.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  env.BACKEND_URL.replace(/\/+$/, ''),
];

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  if (allowedOrigins.includes(origin)) return true;
  // Local dev only: any localhost port, matching the CORS middleware's own
  // escape hatch. NODE_ENV is pinned to 'production' on the server, so this
  // never fires there.
  return env.NODE_ENV !== 'production' && /^http:\/\/localhost(:\d+)?$/.test(origin);
}
