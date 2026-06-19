import cron, { type ScheduledTask } from 'node-cron';
import { createLogger } from '../lib/logger.js';
import { processExportJobs } from './jobs/process-exports.js';
import { cleanupOldGps } from './jobs/cleanup-old-gps.js';
import { cleanupExpiredIdempotency } from './jobs/cleanup-idempotency.js';
import { cleanupExpiredDocumentOtps } from './jobs/cleanup-document-otps.js';
import { forgottenClockoutReminder } from './jobs/forgotten-clockout.js';
import { autoClockout } from './jobs/auto-clockout.js';
import { retentionEnforcement } from './jobs/retention-enforcement.js';
import { leaveDailyAccrual } from './jobs/leave-daily-accrual.js';
import { leaveReminder } from './jobs/leave-reminder.js';
import { documentsRetention } from './jobs/documents-retention.js';

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
        '40 3 * * *',
        () => safeRun('cleanup_document_otps', cleanupExpiredDocumentOtps),
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
    // Every 15 min, all day — a shift can cross the 15h ceiling at any hour
    // (e.g. an evening clock-in hits it past midday next day). Force-closes
    // open shifts at clock_in + 15h.
    this.jobs.push(
      cron.schedule('*/15 * * * *', () => safeRun('auto_clockout', autoClockout))
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
    // Daily at 18:00 Europe/Rome — remind users of leaves starting tomorrow.
    this.jobs.push(
      cron.schedule(
        '0 18 * * *',
        () => safeRun('leave_reminder', leaveReminder),
        { timezone: 'Europe/Rome' }
      )
    );
    // Daily at 03:15 Europe/Rome — hard-delete documents past their 36-month
    // retention horizon (R2 object + DB row + cascaded view rows).
    this.jobs.push(
      cron.schedule(
        '15 3 * * *',
        () => safeRun('documents_retention', documentsRetention),
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
