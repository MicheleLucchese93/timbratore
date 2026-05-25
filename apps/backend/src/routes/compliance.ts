import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { tenantHandler } from '../lib/route-helpers.js';
import { renderDpiaHtml, renderPrivacyNoticeHtml, renderArt4ChecklistHtml } from '../services/compliance-templates.js';
import { renderDpiaDocx, renderPrivacyNoticeDocx, renderArt4ChecklistDocx } from '../services/compliance-docx.js';
import { ok } from '../lib/api-response.js';

export const complianceRouter = Router();
complianceRouter.use(authenticate);
complianceRouter.use(requireAdmin);

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function safeSlug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp("[\u0300-\u036f]", "g"), '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'azienda';
}

function sendDocx(res: import('express').Response, filename: string, buf: Buffer): void {
  res.setHeader('Content-Type', DOCX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', String(buf.length));
  res.end(buf);
}

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

complianceRouter.get(
  '/dpia.docx',
  tenantHandler(async (req, res, client) => {
    const t = await client.query(`SELECT * FROM tenants WHERE id = $1`, [req.user!.tenantId]);
    const tenant = t.rows[0];
    const buf = await renderDpiaDocx(tenant);
    sendDocx(res, `dpia-${safeSlug(tenant.ragione_sociale)}.docx`, buf);
  })
);

complianceRouter.get(
  '/privacy-notice.docx',
  tenantHandler(async (req, res, client) => {
    const t = await client.query(`SELECT * FROM tenants WHERE id = $1`, [req.user!.tenantId]);
    const tenant = t.rows[0];
    const buf = await renderPrivacyNoticeDocx(tenant);
    sendDocx(res, `informativa-privacy-${safeSlug(tenant.ragione_sociale)}.docx`, buf);
  })
);

complianceRouter.get(
  '/art4-checklist.docx',
  tenantHandler(async (req, res, client) => {
    const t = await client.query(`SELECT * FROM tenants WHERE id = $1`, [req.user!.tenantId]);
    const tenant = t.rows[0];
    const buf = await renderArt4ChecklistDocx(tenant);
    sendDocx(res, `checklist-art4-${safeSlug(tenant.ragione_sociale)}.docx`, buf);
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
