import express, { type Express } from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { env } from './env.js';
import { requestId } from './middleware/request-id.js';
import { requestLogger } from './middleware/request-logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { sanitizeBody } from './middleware/sanitize.js';
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
import { complianceRouter } from './routes/compliance.js';
import { appVersionRouter } from './routes/app-version.js';
import { dashboardRouter } from './routes/dashboard.js';
import { placesRouter } from './routes/places.js';

export function createApp(): Express {
  const app = express();
  app.set('trust proxy', env.TRUSTED_PROXY_HOPS);
  app.use(requestId);
  app.use(requestLogger);
  app.use(compression());

  const allowed = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
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

  app.use(express.json({ limit: '1mb' }));
  app.use(sanitizeBody);

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
  app.use(express.static(publicDir, { extensions: ['html'], maxAge: '5m' }));
  app.use('/templates', express.static(path.join(publicDir, 'templates'), { extensions: ['html'] }));

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
  app.use('/api/v1/compliance', complianceRouter);
  app.use('/api/v1/app-version', appVersionRouter);
  app.use('/api/v1/dashboard', dashboardRouter);
  app.use('/api/v1/places', placesRouter);

  app.use(errorHandler);
  return app;
}
