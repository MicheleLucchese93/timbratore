import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { tenantHandler } from '../lib/route-helpers.js';
import { ok } from '../lib/api-response.js';

export const realtimeRouter = Router();
realtimeRouter.use(authenticate);

// DEV-STUB: production wires Centrifugo proxy at /centrifugo/{connect,subscribe}.
// Here we expose a poll endpoint that returns events since a given sequence id
// from the centrifugo_outbox table. The web SPA polls this every 3s in dev.
realtimeRouter.get(
  '/since',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const sinceId = Math.max(0, Number(req.query.since ?? 0));
    const channelPrefix = `tenant.${req.user!.tenantId}`;
    const r = await client.query(
      `SELECT id, payload, created_at
       FROM centrifugo_outbox
       WHERE id > $1
         AND payload->>'channel' LIKE $2 || '%'
       ORDER BY id ASC
       LIMIT 200`,
      [sinceId, channelPrefix]
    );
    const last = r.rows.length > 0 && r.rows[r.rows.length - 1] ? r.rows[r.rows.length - 1]!.id : sinceId;
    ok(res, { events: r.rows, last_id: last });
  })
);
