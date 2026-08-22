import type { Request, Response, NextFunction } from 'express';
import type { PoolClient } from 'pg';
import { withSupportRLS, withTenantRLS } from './db.js';
import { createLogger } from './logger.js';
import { UnauthorizedError } from '../errors/index.js';

const logger = createLogger('route-helpers');

/**
 * Register work that must happen only if the transaction COMMITs, and must NOT
 * happen inside it.
 *
 * The reason it exists: notification sending. notifyLeaveSubmitted /
 * notifyLeaveAddedByAdmin used to run in the middle of the leave transaction,
 * which meant nodemailer talking to Brevo SMTP (no connectionTimeout is
 * configured, so the default 10-minute socket timeout applies) and a bare
 * fetch() to exp.host both happened while the transaction still held the
 * employee's leave advisory lock and one of the pool's 20 connections. One
 * stalled send blocked every subsequent leave write for that employee for as
 * long as the socket hung.
 *
 * Semantics worth knowing before using it:
 *  - tasks run in registration order, after COMMIT, and never if the handler
 *    threw (a rolled-back write must not send "richiesta approvata");
 *  - the HTTP response has already been written by then — handlers call ok()
 *    inside the transaction — so a failing task cannot turn into an error
 *    response. It is logged and swallowed, exactly as a failed send was before,
 *    when it was merely inside the transaction;
 *  - the transactional client is released before they run. Anything a task
 *    needs from the database must be read inside the handler and captured.
 */
export type AfterCommit = (task: () => Promise<void>) => void;

export type TenantHandler = (
  req: Request,
  res: Response,
  client: PoolClient,
  afterCommit: AfterCommit
) => Promise<unknown>;

export function tenantHandler(fn: TenantHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) return next(new UnauthorizedError());
    const pending: Array<() => Promise<void>> = [];
    // A partner support session gets the same handlers on a read-only,
    // support-scoped transaction (see withSupportRLS). Nothing else changes:
    // handlers stay unaware they are serving an inspection session.
    const run = req.support ? withSupportRLS : withTenantRLS;
    run(req.user.id, req.user.tenantId, (client) =>
      fn(req, res, client, (task) => {
        pending.push(task);
      })
    )
      .then(() => runAfterCommit(pending, req.originalUrl))
      .catch(next);
  };
}

/**
 * Run the registered tasks, in order, swallowing every failure.
 *
 * It must never reject. It is chained off the transaction's own promise, and
 * the HTTP response was already written inside the handler — a rejection here
 * would land in the same .catch(next) as a genuine handler error and try to
 * send a second response for a request that actually succeeded. One send
 * failing must also not skip the rest: a leave with three approvers should
 * still reach approvers two and three when approver one's mailbox times out.
 */
export async function runAfterCommit(
  pending: Array<() => Promise<void>>,
  path: string
): Promise<void> {
  for (const task of pending) {
    try {
      await task();
    } catch (err) {
      logger.error({ err, path }, 'after-commit task failed');
    }
  }
}

export type AsyncHandler = (
  req: Request,
  res: Response
) => Promise<unknown> | unknown;

export function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}
