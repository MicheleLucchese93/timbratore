import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { tenantHandler } from '../lib/route-helpers.js';
import { ok } from '../lib/api-response.js';
import { NotFoundError, ValidationError } from '../errors/index.js';

// In-app notification feed (the mobile bell). Rows are written by the server
// notification pipeline (lib/notifications.ts) on the service role; here we only
// READ the caller's own rows and flip read_at. RLS (migration 043) already
// scopes every statement to the caller, the explicit user_id predicate is
// belt-and-suspenders and mirrors the other routes' style.
export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

notificationsRouter.get(
  '/',
  tenantHandler(async (_req, res, client) => {
    const r = await client.query(
      `SELECT id, kind, title, body, data, route, source_id,
              (read_at IS NOT NULL) AS is_read, created_at
         FROM notifications
        WHERE user_id = current_setting('app.current_user_id')::uuid
        ORDER BY created_at DESC
        LIMIT 100`
    );
    ok(res, r.rows);
  })
);

// Mark every unread notification read. Declared before '/:id/read' is irrelevant
// for routing (distinct path shapes) but reads naturally next to the GET.
notificationsRouter.post(
  '/read-all',
  tenantHandler(async (_req, res, client) => {
    const r = await client.query(
      `UPDATE notifications SET read_at = now()
        WHERE user_id = current_setting('app.current_user_id')::uuid
          AND read_at IS NULL`
    );
    ok(res, { updated: r.rowCount ?? 0 });
  })
);

notificationsRouter.post(
  '/:id/read',
  tenantHandler(async (req, res, client) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw new ValidationError('invalid id');
    const r = await client.query(
      `UPDATE notifications SET read_at = COALESCE(read_at, now())
        WHERE id = $1 AND user_id = current_setting('app.current_user_id')::uuid
        RETURNING id`,
      [id.data]
    );
    if (r.rowCount === 0) throw new NotFoundError('notification');
    ok(res, { ok: true });
  })
);
