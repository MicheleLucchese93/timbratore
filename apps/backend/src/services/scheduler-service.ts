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
import { stampReminder } from './jobs/stamp-reminder.js';
import { documentsRetention } from './jobs/documents-retention.js';
import { cleanupReadNotifications } from './jobs/cleanup-read-notifications.js';
import { bulletinActivation } from './jobs/bulletin-activation.js';
import { flushRequestMetrics } from './jobs/metrics-flush.js';
import { signupMaintenance } from './jobs/signup-maintenance.js';
import { billingReconcile, rederiveStripeTenants } from './jobs/billing-reconcile.js';
import { billingOverLimit } from './jobs/billing-over-limit.js';

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
    // Every 5 min, gated to local 04:00–23:00 Europe/Rome — schedule-aware
    // missed-stamp reminders (expected clock-in/out boundary passed unstamped).
    // The per-user logic self-gates on each slot time + tolerance; the hour gate
    // just skips the dead overnight window for the cross-tenant scan.
    this.jobs.push(
      cron.schedule(
        '*/5 * * * *',
        () => {
          const h = Number(
            new Intl.DateTimeFormat('en-GB', {
              timeZone: 'Europe/Rome',
              hour: '2-digit',
              hour12: false,
            }).format(new Date())
          );
          if (h >= 4 && h <= 23) safeRun('stamp_reminder', stampReminder);
        },
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
    // Daily at 03:50 Europe/Rome — hard-delete notifications read more than
    // 15 days ago (unread rows are kept). Free slot among the nightly sweeps.
    this.jobs.push(
      cron.schedule(
        '50 3 * * *',
        () => safeRun('cleanup_read_notifications', cleanupReadNotifications),
        { timezone: 'Europe/Rome' }
      )
    );
    // Every 5 min — publish notifications for Bacheca messages whose scheduled
    // start_at has passed (immediate posts are notified inline at create).
    this.jobs.push(
      cron.schedule('*/5 * * * *', () => safeRun('bulletin_activation', bulletinActivation))
    );
    // Two minutes past every hour — persist the hour that just closed into
    // request_metrics and mail any route whose p95 crossed PERF_ALERT_P95_MS.
    // The offset gives in-flight requests time to land in the closing bucket.
    this.jobs.push(
      cron.schedule('2 * * * *', () => safeRun('metrics_flush', flushRequestMetrics))
    );
    // No perf_digest cron: the weekly digest is no longer mailed. The daily prod
    // triage routine pulls it instead (scripts/perf-digest.ts, run in this
    // container), in the same pass that reads the logs — see the script header.
    // Self-service signup + billing (Specs/SELF_SERVICE_BILLING.md).
    // Hourly: expire links, purge abandoned requests, reminders.
    this.jobs.push(
      cron.schedule('17 * * * *', () => safeRun('signup_maintenance', signupMaintenance))
    );
    // Once at start: re-derive Stripe-billed entitlements for the CURRENT
    // STRIPE_MODE, so a sandbox ↔ live flip takes effect with the restart.
    safeRun('billing_rederive', rederiveStripeTenants);
    // Nightly: re-sync Stripe (lost-webhook safety net), VIES re-checks, log prune.
    this.jobs.push(
      cron.schedule(
        '50 3 * * *',
        () => safeRun('billing_reconcile', billingReconcile),
        { timezone: 'Europe/Rome' }
      )
    );
    // Mornings: over-limit notices to downgraded companies (D7).
    this.jobs.push(
      cron.schedule(
        '0 9 * * *',
        () => safeRun('billing_over_limit', billingOverLimit),
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
