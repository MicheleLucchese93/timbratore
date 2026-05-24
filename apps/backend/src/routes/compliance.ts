import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { tenantHandler } from '../lib/route-helpers.js';
import { renderDpiaHtml, renderPrivacyNoticeHtml, renderArt4ChecklistHtml } from '../services/compliance-templates.js';
import { ok } from '../lib/api-response.js';

export const complianceRouter = Router();
complianceRouter.use(authenticate);
complianceRouter.use(requireAdmin);

complianceRouter.get(
  '/dpia.html',
  tenantHandler(async (req, res, client) => {
    const t = await client.query(`SELECT * FROM tenants WHERE id = $1`, [req.user!.tenantId]);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderDpiaHtml(t.rows[0]));
  })
);

complianceRouter.get(
  '/privacy-notice.html',
  tenantHandler(async (req, res, client) => {
    const t = await client.query(`SELECT * FROM tenants WHERE id = $1`, [req.user!.tenantId]);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderPrivacyNoticeHtml(t.rows[0]));
  })
);

complianceRouter.get(
  '/art4-checklist.html',
  tenantHandler(async (req, res, client) => {
    const t = await client.query(`SELECT * FROM tenants WHERE id = $1`, [req.user!.tenantId]);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderArt4ChecklistHtml(t.rows[0]));
  })
);

complianceRouter.post(
  '/accept-dpa',
  tenantHandler(async (req, res, client) => {
    const r = await client.query(
      `UPDATE tenants
       SET dpa_accepted_at = now(), dpa_accepted_by = current_setting('app.current_user_id')::uuid, dpa_version = 'v1'
       WHERE id = $1
       RETURNING dpa_accepted_at, dpa_version`,
      [req.user!.tenantId]
    );
    ok(res, r.rows[0]);
  })
);
