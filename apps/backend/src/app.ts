import express, { type Express, type Response } from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { env } from './env.js';
import { requestId } from './middleware/request-id.js';
import { requestLogger } from './middleware/request-logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { meRouter } from './routes/me.js';
import { branchesRouter } from './routes/branches.js';
import { usersRouter } from './routes/users.js';
import { stampsRouter } from './routes/stamps.js';
import { adminStampsRouter } from './routes/admin-stamps.js';
import { correctionRequestsRouter } from './routes/correction-requests.js';
import { exportsRouter } from './routes/exports.js';
import { realtimeRouter } from './routes/realtime.js';
import { settingsRouter } from './routes/settings.js';
import { appVersionRouter } from './routes/app-version.js';
import { dashboardRouter } from './routes/dashboard.js';
import { placesRouter } from './routes/places.js';
import { shiftsRouter } from './routes/shifts.js';
import { leavesRouter } from './routes/leaves.js';
import { leaveQuotasRouter } from './routes/leave-quotas.js';
import { helpdeskRouter } from './routes/helpdesk.js';
import { internalE2eRouter } from './routes/internal-e2e.js';
import { internalProvisionRouter } from './routes/internal-provision.js';

export function createApp(): Express {
  const app = express();
  app.set('trust proxy', env.TRUSTED_PROXY_HOPS);
  app.use(requestId);
  app.use(requestLogger);
  app.use(compression());

  // Configured cross-origin clients (web/mobile) PLUS the API's own origin: the
  // static auth pages (reset-password.html, confirm-email.html) are served from
  // BACKEND_URL and POST same-origin to /api/v1/auth/*; the browser still
  // attaches an Origin header to those POSTs, so the API must allow its own
  // origin or they fail with CORS_NOT_ALLOWED (hit both recovery and invite).
  const allowed = [
    ...env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    env.BACKEND_URL.replace(/\/+$/, ''),
  ];
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (allowed.includes(origin)) return cb(null, true);
        return cb(new Error('CORS_NOT_ALLOWED'));
      },
      credentials: true,
    })
  );
  app.use(
    helmet({
      contentSecurityPolicy: false,
      hsts:
        env.NODE_ENV === 'production'
          ? { maxAge: 63_072_000, includeSubDomains: true, preload: true }
          : false,
    })
  );

  // Input is validated per-route with Zod and persisted via parameterized
  // queries; output is escaped at every sink (React on the web, escapeHtml in
  // email templates/renderer). We deliberately do NOT mutate request bodies
  // here — a blanket xss() pass corrupts legitimate values (passwords, notes
  // containing < or >) and is the wrong layer for XSS defense.
  app.use(express.json({ limit: '1mb' }));

  const limiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.NODE_ENV === 'development' ? env.RATE_LIMIT_MAX * 10 : env.RATE_LIMIT_MAX,
    skip: (req) => req.path.startsWith('/health'),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  });
  app.use(limiter);

  // Static helpers served same-origin so GoTrue invite / recovery links land here.
  // publicDir resolves relative to the apps/backend working dir.
  const publicDir = path.resolve(process.cwd(), 'public');
  // Defense-in-depth CSP for the static auth HTML pages (reset-password,
  // confirm-email, email templates). JSON API responses don't need a CSP;
  // these served documents do. 'unsafe-inline' stays because each page has a
  // small inline bootstrap script and Cloudflare injects an edge beacon.
  const HTML_CSP =
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; " +
    "frame-ancestors 'none'; object-src 'none'";
  const setHtmlCsp = (res: Response, filePath: string): void => {
    if (filePath.endsWith('.html')) res.setHeader('Content-Security-Policy', HTML_CSP);
  };
  app.use(express.static(publicDir, { extensions: ['html'], maxAge: '5m', setHeaders: setHtmlCsp }));
  app.use('/templates', express.static(path.join(publicDir, 'templates'), { extensions: ['html'], setHeaders: setHtmlCsp }));

  app.use('/health', healthRouter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/me', meRouter);
  app.use('/api/v1/branches', branchesRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/stamps', stampsRouter);
  app.use('/api/v1/admin', adminStampsRouter);
  app.use('/api/v1/correction-requests', correctionRequestsRouter);
  app.use('/api/v1/exports', exportsRouter);
  app.use('/api/v1/realtime', realtimeRouter);
  app.use('/api/v1/settings', settingsRouter);
  app.use('/api/v1/app-version', appVersionRouter);
  app.use('/api/v1/dashboard', dashboardRouter);
  app.use('/api/v1/places', placesRouter);
  app.use('/api/v1/shifts', shiftsRouter);
  app.use('/api/v1/leaves', leavesRouter);
  app.use('/api/v1/leave-quotas', leaveQuotasRouter);
  app.use('/api/v1/helpdesk', helpdeskRouter);
  // The internal-e2e router runs destructive cross-table deletes. It mounts
  // ONLY when both the bearer secret AND the tenant pin are configured — so a
  // misconfigured deploy fails closed (endpoint absent) instead of exposing an
  // unscoped purge. Every query inside is then hard-scoped to E2E_TEST_TENANT_ID.
  if (env.E2E_PURGE_SECRET && env.E2E_TEST_TENANT_ID) {
    app.use('/api/v1/_internal/e2e', internalE2eRouter);
  } else if (env.E2E_PURGE_SECRET) {
    console.warn(
      'E2E_PURGE_SECRET is set but E2E_TEST_TENANT_ID is missing — e2e purge endpoint NOT mounted (refusing an unscoped destructive route).'
    );
  }

  // Tenant provisioning (create tenant + invite first admin). Mounts ONLY when
  // PROVISION_SECRET is configured, so a deploy without it exposes no such route.
  if (env.PROVISION_SECRET) {
    app.use('/api/v1/_internal/provision', internalProvisionRouter);
  }

  app.use(errorHandler);
  return app;
}
