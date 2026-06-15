import { Router, raw } from 'express';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { asyncHandler, tenantHandler } from '../lib/route-helpers.js';
import { adminPool } from '../lib/admin-db.js';
import { ok } from '../lib/api-response.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors/index.js';
import { env } from '../env.js';
import {
  storagePut,
  storageDelete,
  storagePresignedGetUrl,
  getObject,
} from '../lib/storage.js';
import { notifyDocumentUploaded } from '../lib/notifications.js';
import { createLogger } from '../lib/logger.js';
import { DOCUMENT_CATEGORIES, type DocumentCategory } from '@sonoqui/shared';

const logger = createLogger('documents');

export const documentsRouter = Router();
documentsRouter.use(authenticate);

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const PRESIGN_TTL_SECONDS = 60;
const PDF_MIME = 'application/pdf';
const PDF_MAGIC = Buffer.from('%PDF');

const CATEGORY_ENUM = z.enum(
  DOCUMENT_CATEGORIES as [DocumentCategory, ...DocumentCategory[]]
);

// Upload metadata travels in headers (the request body is the raw PDF binary,
// same transport as POST /api/v1/users/import). Title + filename are
// percent-encoded by the client so non-ASCII (accents) survive a header.
const UploadHeaders = z.object({
  user_id: z.string().uuid(),
  category: CATEGORY_ENUM,
  title: z.string().min(1).max(300),
  filename: z.string().min(1).max(300),
});

// R2 keys must be safe path segments. Strip anything that isn't a sane filename
// char, collapse runs, keep a .pdf suffix. The DB still stores the original
// filename verbatim in original_filename for display/download.
function sanitizeFilename(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? name;
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 200);
  const safe = cleaned.length > 0 ? cleaned : 'document';
  return safe.toLowerCase().endsWith('.pdf') ? safe : `${safe}.pdf`;
}

function decodeHeaderValue(v: string | undefined): string {
  if (!v) return '';
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/* ----- POST /api/v1/documents — ADMIN upload (raw PDF body) ----- */
documentsRouter.post(
  '/',
  requireAdmin,
  raw({ type: '*/*', limit: '15mb' }),
  tenantHandler(async (req, res, client) => {
    const parsed = UploadHeaders.safeParse({
      user_id: req.header('x-doc-user-id'),
      category: req.header('x-doc-category'),
      title: decodeHeaderValue(req.header('x-doc-title')),
      filename: decodeHeaderValue(req.header('x-doc-filename')),
    });
    if (!parsed.success) {
      throw new ValidationError('invalid document metadata', parsed.error.flatten());
    }
    const meta = parsed.data;

    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new ValidationError('File PDF mancante', undefined);
    }
    if (body.length > MAX_BYTES) {
      throw new ValidationError('Il file supera il limite di 15MB', undefined);
    }
    // %PDF magic bytes. Reject anything that is not actually a PDF.
    if (!body.subarray(0, 4).equals(PDF_MAGIC)) {
      throw new ValidationError('Il file non è un PDF valido', {
        code: 'DOCUMENT_INVALID_FILE',
      });
    }

    // Target user must be an active member of the caller's tenant. RLS pins the
    // tenant; this also rejects uploads aimed at a user outside it.
    const member = await client.query(
      `SELECT 1 FROM memberships
        WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
          AND user_id = $1 AND active = TRUE AND deleted_at IS NULL`,
      [meta.user_id]
    );
    if (member.rowCount === 0) throw new NotFoundError('user not in tenant');

    const tenantId = req.user!.tenantId;
    const sanitized = sanitizeFilename(meta.filename);

    // Insert the row first to mint the document id, then key the R2 object by it
    // so the storage path is collision-free even for identical filenames.
    await client.query(`SELECT set_config('app.change_reason', $1, true)`, [
      `document_upload:${meta.category}`,
    ]);
    const ins = await client.query(
      `INSERT INTO documents(
         tenant_id, user_id, uploaded_by, category, title, original_filename,
         mime_type, size_bytes, r2_key, retention_until
       )
       VALUES (
         current_setting('app.current_tenant_id')::uuid, $1,
         current_setting('app.current_user_id')::uuid, $2, $3, $4,
         $5, $6, $7, now() + interval '36 months'
       )
       RETURNING *`,
      [
        meta.user_id,
        meta.category,
        meta.title,
        meta.filename,
        PDF_MIME,
        body.length,
        // Placeholder; rewritten to the id-keyed path below in the same tx.
        'pending',
      ]
    );
    const doc = ins.rows[0];
    const r2Key = `tenants/${tenantId}/documents/${doc.id}/${sanitized}`;
    const upd = await client.query(
      `UPDATE documents SET r2_key = $1 WHERE id = $2 RETURNING *`,
      [r2Key, doc.id]
    );
    const finalDoc = upd.rows[0];

    // Object store write happens inside the request — if it throws, the tx
    // rolls back and no orphan row survives.
    await storagePut(r2Key, body, PDF_MIME);

    // Fire-and-forget: a notification failure must never fail the upload.
    notifyDocumentUploaded(client, {
      documentId: finalDoc.id,
      userId: finalDoc.user_id,
      category: finalDoc.category as DocumentCategory,
      title: finalDoc.title,
    }).catch((err) => logger.error({ err, document_id: finalDoc.id }, 'notify document failed'));

    ok(res, finalDoc, 201);
  })
);

/* ----- GET /api/v1/documents — ADMIN list (optional user_id filter) ----- */
documentsRouter.get(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    // Computed with the service role (adminPool), NOT the tenant RLS client:
    // document_views RLS only exposes a caller's OWN view rows, so an admin
    // listing other employees' documents would otherwise see view_count=0 and
    // viewed_at=null. We bypass RLS but HARD-SCOPE every row to the caller's
    // tenant (req.user.tenantId) so this can never leak across tenants. This
    // endpoint NEVER records a view.
    const params: unknown[] = [req.user!.tenantId];
    let userFilter = '';
    if (req.query.user_id) {
      const uid = z.string().uuid().safeParse(String(req.query.user_id));
      if (!uid.success) throw new ValidationError('invalid user_id');
      params.push(uid.data);
      userFilter = `AND d.user_id = $${params.length}`;
    }
    const r = await adminPool.query(
      `SELECT d.*,
              COALESCE(
                NULLIF(au.display_name, ''),
                NULLIF(TRIM(CONCAT_WS(' ', au.first_name, au.last_name)), ''),
                au.email
              ) AS user_display_name,
              COALESCE(vc.view_count, 0)::int AS view_count,
              dv.viewed_at
         FROM documents d
         LEFT JOIN auth_users au ON au.id = d.user_id
         LEFT JOIN (
           SELECT document_id, COUNT(*)::int AS view_count
             FROM document_views
            GROUP BY document_id
         ) vc ON vc.document_id = d.id
         LEFT JOIN document_views dv
                ON dv.document_id = d.id AND dv.user_id = d.user_id
        WHERE d.tenant_id = $1 AND d.deleted_at IS NULL
          ${userFilter}
        ORDER BY d.created_at DESC
        LIMIT 1000`,
      params
    );
    ok(res, r.rows);
  })
);

/* ----- GET /api/v1/documents/me — EMPLOYEE list ----- */
documentsRouter.get(
  '/me',
  tenantHandler(async (req, res, client) => {
    // RLS already constrains documents to admin-or-owner; pin explicitly to the
    // caller so an admin hitting /me still only sees their own. NEVER records a
    // view.
    const r = await client.query(
      `SELECT d.*, dv.viewed_at
         FROM documents d
         LEFT JOIN document_views dv
                ON dv.document_id = d.id AND dv.user_id = $1
        WHERE d.user_id = $1 AND d.deleted_at IS NULL
        ORDER BY d.created_at DESC
        LIMIT 1000`,
      [req.user!.id]
    );
    ok(res, r.rows);
  })
);

/* ----- GET /api/v1/documents/:id/download — admin OR owning employee ----- */
documentsRouter.get(
  '/:id/download',
  tenantHandler(async (req, res, client) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw new ValidationError('invalid id');
    // RLS enforces admin-or-owner visibility; a non-owner employee sees no row.
    const r = await client.query(
      `SELECT * FROM documents WHERE id = $1 AND deleted_at IS NULL`,
      [id.data]
    );
    if (r.rowCount === 0) throw new NotFoundError('document');
    const doc = r.rows[0];

    // Record the FIRST view only for the owning employee. Admins never count.
    if (req.user!.role === 'user' && doc.user_id === req.user!.id) {
      await client.query(
        `INSERT INTO document_views(tenant_id, document_id, user_id)
         VALUES (current_setting('app.current_tenant_id')::uuid, $1,
                 current_setting('app.current_user_id')::uuid)
         ON CONFLICT (document_id, user_id) DO NOTHING`,
        [doc.id]
      );
    }

    const localFallback =
      env.BACKEND_URL.replace(/\/+$/, '') + `/api/v1/documents/${doc.id}/raw`;
    const url = await storagePresignedGetUrl(doc.r2_key, PRESIGN_TTL_SECONDS, localFallback);
    ok(res, { url, expires_in: PRESIGN_TTL_SECONDS });
  })
);

/* ----- GET /api/v1/documents/:id/raw — disk-driver stream fallback -----
 * Only meaningful when STORAGE_DRIVER=disk (dev/test): R2 deployments hand the
 * client a presigned URL straight to the object store and never hit this. Same
 * RLS gate (admin-or-owner) as /download, but does NOT record a view (the view
 * is recorded by /download, which the client always calls first). */
documentsRouter.get(
  '/:id/raw',
  tenantHandler(async (req, res, client) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw new ValidationError('invalid id');
    const r = await client.query(
      `SELECT * FROM documents WHERE id = $1 AND deleted_at IS NULL`,
      [id.data]
    );
    if (r.rowCount === 0) throw new NotFoundError('document');
    const doc = r.rows[0];
    const buf = await getObjectForDriver(doc.r2_key);
    res.setHeader('Content-Type', doc.mime_type || PDF_MIME);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${sanitizeFilename(doc.original_filename)}"`
    );
    res.send(buf);
    return undefined;
  })
);

async function getObjectForDriver(key: string): Promise<Buffer> {
  if (env.STORAGE_DRIVER === 'disk') {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    return readFile(join(env.STORAGE_DISK_PATH, key));
  }
  return getObject(key);
}

/* ----- DELETE /api/v1/documents/:id — ADMIN soft-delete + drop R2 object ----- */
documentsRouter.delete(
  '/:id',
  requireAdmin,
  tenantHandler(async (req, res, client) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw new ValidationError('invalid id');
    const sel = await client.query(
      `SELECT * FROM documents WHERE id = $1 AND deleted_at IS NULL`,
      [id.data]
    );
    if (sel.rowCount === 0) throw new NotFoundError('document');
    const doc = sel.rows[0];

    await client.query(`SELECT set_config('app.change_reason', 'document_delete', true)`);
    const upd = await client.query(
      `UPDATE documents SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id`,
      [doc.id]
    );
    if (upd.rowCount === 0) throw new ForbiddenError();

    // Drop the object after the soft-delete commits intent. A storage failure
    // must not resurrect the row, so swallow + log — the retention cron will
    // also attempt the object delete later.
    await storageDelete(doc.r2_key).catch((err) =>
      logger.error({ err, document_id: doc.id }, 'R2 delete failed on document delete')
    );

    ok(res, { id: doc.id });
  })
);
