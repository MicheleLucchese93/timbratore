import cron, { type ScheduledTask } from 'node-cron';
import { createLogger } from '../lib/logger.js';
import { processExportJobs } from './jobs/process-exports.js';
import { cleanupOldGps } from './jobs/cleanup-old-gps.js';
import { cleanupExpiredIdempotency } from './jobs/cleanup-idempotency.js';
import { forgottenClockoutReminder } from './jobs/forgotten-clockout.js';
import { retentionEnforcement } from './jobs/retention-enforcement.js';
import { leaveDailyAccrual } from './jobs/leave-daily-accrual.js';

const logger = createLogger('scheduler');

class SchedulerService {
  private jobs: ScheduledTask[] = [];
  start(): void {
    this.jobs.push(
      cron.schedule('* * * * *', () => safeRun('process_exports', processExportJobs))
    );
    this.jobs.push(
      cron.schedule(
        '30 4 * * *',
        () => safeRun('cleanup_old_gps', cleanupOldGps),
        { timezone: 'UTC' }
      )
    );
    this.jobs.push(
      cron.schedule(
        '30 3 * * *',
        () => safeRun('cleanup_idempotency', cleanupExpiredIdempotency),
        { timezone: 'UTC' }
      )
    );
    this.jobs.push(
      cron.schedule(
        '*/15 * * * *',
        () => {
          const now = new Date();
          const h = Number(
            new Intl.DateTimeFormat('en-GB', {
              timeZone: 'Europe/Rome',
              hour: '2-digit',
              hour12: false,
            }).format(now)
          );
          if (h >= 18 && h <= 22) safeRun('forgotten_clockout', forgottenClockoutReminder);
        },
        { timezone: 'Europe/Rome' }
      )
    );
    this.jobs.push(
      cron.schedule(
        '0 2 * * 0',
        () => safeRun('retention_enforcement', retentionEnforcement),
        { timezone: 'Europe/Rome' }
      )
    );
    // Daily at 00:30 Europe/Rome — run per-template accrual if today is the
    // template's anchor day (monthly: every day_of_month; yearly: month+day).
    this.jobs.push(
      cron.schedule(
        '30 0 * * *',
        () => safeRun('leave_daily_accrual', leaveDailyAccrual),
        { timezone: 'Europe/Rome' }
      )
    );
    logger.info({ jobs: this.jobs.length }, 'scheduler started');
  }
  stop(): void {
    for (const j of this.jobs) j.stop();
    this.jobs = [];
    logger.info('scheduler stopped');
  }
}

function safeRun(name: string, fn: () => Promise<void>): void {
  fn().catch((err) => logger.error({ err, name }, 'cron job failed'));
}

export const schedulerService = new SchedulerService();
