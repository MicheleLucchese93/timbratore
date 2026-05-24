import { createApp } from './app.js';
import { env } from './env.js';
import { pool } from './lib/db.js';
import { createLogger } from './lib/logger.js';
import { schedulerService } from './services/scheduler-service.js';

const logger = createLogger('server');
const app = createApp();

const server = app.listen(env.PORT, async () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'server started');
  try {
    await pool.query('SELECT 1');
    logger.info('database connection verified');
  } catch (err) {
    logger.error({ err }, 'database connection FAILED on startup');
  }
  if (env.SCHEDULER_ENABLED) schedulerService.start();
});

const shutdown = (): void => {
  schedulerService.stop();
  server.close(() => {
    logger.info('server stopped');
    process.exit(0);
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
