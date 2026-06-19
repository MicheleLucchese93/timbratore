import { Router, raw } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { authenticate, requireDocumentale } from '../middleware/auth.js';
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
import { buildDocumentOtpMail, sendMail } from '../lib/mailer.js';
import { createLogger } from '../lib/logger.js';
import { DOCUMENT_CATEGORIES, type DocumentCategory } from '@sonoqui/shared';

const logger = createLogger('documents');

export const documentsRouter = Router();
documentsRouter.use(authenticate);

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const PRESIGN_TTL_SECONDS = 60;
const PDF_MIME = 'application/pdf';
const PDF_MAGIC = Buffer.from('%PDF');

// OTP gate for the Documentale all-tenant view. One emailed 6-digit code unlocks
// viewing+downloading for OTP_SESSION_TTL_MIN minutes; every individual access is
// still logged. Codes are SHA-256-hashed at rest, single-use, attempt-capped.
const OTP_LENGTH = 6;
const OTP_CODE_TTL_MIN = 10;
const OTP_SESSION_TTL_MIN = 10;
const OTP_MAX_ATTEMPTS = 5;

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

function presignFor(doc: { id: string; r2_key: string }): Promise<string> {
  const localFallback =
    env.BACKEND_URL.replace(/\/+$/, '') + `/api/v1/documents/${doc.id}/raw`;
  return storagePresignedGetUrl(doc.r2_key, PRESIGN_TTL_SECONDS, localFallback);
}

async function getObjectForDriver(key: string): Promise<Buffer> {
  if (env.STORAGE_DRIVER === 'disk') {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    return readFile(join(env.STORAGE_DISK_PATH, key));
  }
  return getObject(key);
}

/* ===================== Documentale OTP + audit helpers ===================== */

function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function generateOtp(tenantId: string): string {
  // Deterministic code for the pinned e2e tenant so the mutating suite can drive
  // the OTP flow without reading email. Never fires for real tenants (env unset
  // in prod, and gated on the exact test-tenant id).
  if (env.E2E_FIXED_OTP && env.E2E_TEST_TENANT_ID && tenantId === env.E2E_TEST_TENANT_ID) {
    return env.E2E_FIXED_OTP;
  }
  return crypto.randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, '0');
}

type AccessAction =
  | 'list'
  | 'download'
  | 'delete'
  | 'otp_request'
  | 'otp_verify'
  | 'otp_verify_fail';

// Append-only audit of every Documentale document access + OTP event. Distinct
// from document_views (the owner read-receipt) — a Documentale access must NEVER
// touch that. Best-effort: an audit write failure must not fail the user action.
async function logDocumentAccess(opts: {
  tenantId: string;
  actorId: string;
  action: AccessAction;
  documentId?: string | null;
  targetUserId?: string | null;
}): Promise<void> {
  try {
    await adminPool.query(
      `INSERT INTO document_access_log(tenant_id, actor_user_id, action, document_id, target_user_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [opts.tenantId, opts.actorId, opts.action, opts.documentId ?? null, opts.targetUserId ?? null]
    );
  } catch (err) {
    logger.error({ err, action: opts.action }, 'document access log write failed');
  }
}

async function otpSessionActive(tenantId: string, userId: string): Promise<boolean> {
  const r = await adminPool.query(
    `SELECT 1 FROM document_otps
      WHERE tenant_id = $1 AND user_id = $2 AND verified_until > now()`,
    [tenantId, userId]
  );
  return (r.rowCount ?? 0) > 0;
}

// Express middleware: 403 OTP_REQUIRED unless the caller holds a live OTP
// session. The web client catches this code and shows the code-entry modal.
async function requireDocumentaleOtp(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const active = await otpSessionActive(req.user!.tenantId, req.user!.id);
    if (!active) return next(new ForbiddenError('OTP verification required', 'OTP_REQUIRED'));
    next();
  } catch (err) {
    next(err as Error);
  }
}

const otpRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  keyGenerator: (req: Request) => req.user?.id ?? req.ip ?? 'anon',
  message: { error: 'Too many code requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/* ===================== OTP endpoints (Documentale) ===================== */

/* ----- POST /api/v1/documents/otp/request — email a fresh code to self ----- */
documentsRouter.post(
  '/otp/request',
  requireDocumentale,
  otpRequestLimiter,
  asyncHandler(async (req, res) => {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const email = req.user!.email;
    if (!email) throw new ValidationError('Nessuna email registrata per questo utente');

    const code = generateOtp(tenantId);
    await adminPool.query(
      `INSERT INTO document_otps(tenant_id, user_id, code_hash, code_expires_at, attempts)
       VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval, 0)
       ON CONFLICT (tenant_id, user_id)
       DO UPDATE SET code_hash = EXCLUDED.code_hash,
                     code_expires_at = EXCLUDED.code_expires_at,
                     attempts = 0`,
      [tenantId, userId, hashOtp(code), String(OTP_CODE_TTL_MIN)]
    );

    const langRow = await adminPool.query(
      `SELECT language FROM user_preferences WHERE user_id = $1`,
      [userId]
    );
    const language = langRow.rows[0]?.language === 'en' ? 'en' : 'it';
    const mail = buildDocumentOtpMail({ code, ttlMinutes: OTP_CODE_TTL_MIN, language });
    // The code lives only in the user's inbox — never in the API response.
    await sendMail({ to: email, subject: mail.subject, text: mail.text, html: mail.html });
    await logDocumentAccess({ tenantId, actorId: userId, action: 'otp_request' });
    ok(res, { sent: true, expires_in_minutes: OTP_CODE_TTL_MIN });
  })
);

/* ----- POST /api/v1/documents/otp/verify — exchange a code for a session ----- */
const VerifyBody = z.object({ code: z.string().min(1).max(12) });
documentsRouter.post(
  '/otp/verify',
  requireDocumentale,
  asyncHandler(async (req, res) => {
    const parsed = VerifyBody.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Codice non valido');
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;

    const row = await adminPool.query(
      `SELECT code_hash, code_expires_at, attempts
         FROM document_otps WHERE tenant_id = $1 AND user_id = $2`,
      [tenantId, userId]
    );
    const rec = row.rows[0];
    if (!rec || !rec.code_hash || !rec.code_expires_at || new Date(rec.code_expires_at) < new Date()) {
      await logDocumentAccess({ tenantId, actorId: userId, action: 'otp_verify_fail' });
      throw new ValidationError('Codice non valido o scaduto', { code: 'OTP_INVALID' });
    }
    if (rec.attempts >= OTP_MAX_ATTEMPTS) {
      await logDocumentAccess({ tenantId, actorId: userId, action: 'otp_verify_fail' });
      throw new ForbiddenError('Troppi tentativi. Richiedi un nuovo codice.', 'OTP_LOCKED');
    }

    const provided = hashOtp(parsed.data.code);
    const matches =
      rec.code_hash.length === provided.length &&
      crypto.timingSafeEqual(Buffer.from(rec.code_hash), Buffer.from(provided));
    if (!matches) {
      await adminPool.query(
        `UPDATE document_otps SET attempts = attempts + 1 WHERE tenant_id = $1 AND user_id = $2`,
        [tenantId, userId]
      );
      await logDocumentAccess({ tenantId, actorId: userId, action: 'otp_verify_fail' });
      throw new ValidationError('Codice non valido', { code: 'OTP_INVALID' });
    }

    await adminPool.query(
      `UPDATE document_otps
          SET verified_until = now() + ($3 || ' minutes')::interval,
              code_hash = NULL, code_expires_at = NULL, attempts = 0
        WHERE tenant_id = $1 AND user_id = $2`,
      [tenantId, userId, String(OTP_SESSION_TTL_MIN)]
    );
    await logDocumentAccess({ tenantId, actorId: userId, action: 'otp_verify' });
    ok(res, { verified: true, session_minutes: OTP_SESSION_TTL_MIN });
  })
);

/* ----- GET /api/v1/documents/otp/status — is a session live? ----- */
documentsRouter.get(
  '/otp/status',
  requireDocumentale,
  asyncHandler(async (req, res) => {
    const r = await adminPool.query(
      `SELECT verified_until FROM document_otps WHERE tenant_id = $1 AND user_id = $2`,
      [req.user!.tenantId, req.user!.id]
    );
    const vu = r.rows[0]?.verified_until ? new Date(r.rows[0].verified_until) : null;
    const active = !!vu && vu > new Date();
    ok(res, { verified: active, verified_until: active ? vu!.toISOString() : null });
  })
);

/* ===================== Document management (Documentale) ===================== */

/* ----- POST /api/v1/documents — DOCUMENTALE upload (raw PDF body) -----
 * Runs on the service role (adminPool): the own-only documents RLS would block
 * a non-owner INSERT...RETURNING, so the elevated upload path is explicit and
 * hard-scoped to the caller's tenant. A plain admin (no capability) is rejected
 * by requireDocumentale. */
documentsRouter.post(
  '/',
  requireDocumentale,
  raw({ type: '*/*', limit: '15mb' }),
  asyncHandler(async (req, res) => {
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

    const tenantId = req.user!.tenantId;
    const actorId = req.user!.id;
    const sanitized = sanitizeFilename(meta.filename);

    const client = await adminPool.connect();
    let finalDoc;
    try {
      await client.query('BEGIN');

      // Target user must be an active member of the caller's tenant.
      const member = await client.query(
        `SELECT 1 FROM memberships
          WHERE tenant_id = $1 AND user_id = $2 AND active = TRUE AND deleted_at IS NULL`,
        [tenantId, meta.user_id]
      );
      if (member.rowCount === 0) throw new NotFoundError('user not in tenant');

      // Insert the row first to mint the document id, then key the R2 object by
      // it so the storage path is collision-free even for identical filenames.
      const ins = await client.query(
        `INSERT INTO documents(
           tenant_id, user_id, uploaded_by, category, title, original_filename,
           mime_type, size_bytes, r2_key, retention_until
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + interval '36 months')
         RETURNING *`,
        [
          tenantId,
          meta.user_id,
          actorId,
          meta.category,
          meta.title,
          meta.filename,
          PDF_MIME,
          body.length,
          'pending', // placeholder; rewritten to the id-keyed path below in the same tx
        ]
      );
      const doc = ins.rows[0];
      const r2Key = `tenants/${tenantId}/documents/${doc.id}/${sanitized}`;
      const upd = await client.query(
        `UPDATE documents SET r2_key = $1 WHERE id = $2 RETURNING *`,
        [r2Key, doc.id]
      );
      finalDoc = upd.rows[0];

      // Object store write inside the tx — if it throws, the tx rolls back and
      // no orphan row survives.
      await storagePut(r2Key, body, PDF_MIME);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

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

/* ----- GET /api/v1/documents — DOCUMENTALE list (OTP-gated) -----
 * Service role, HARD-SCOPED to the caller's tenant so it can never leak across
 * tenants. document_views RLS only exposes a caller's OWN view rows, so view
 * aggregates are computed here. NEVER records a view. */
documentsRouter.get(
  '/',
  requireDocumentale,
  requireDocumentaleOtp,
  asyncHandler(async (req, res) => {
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
    await logDocumentAccess({ tenantId: req.user!.tenantId, actorId: req.user!.id, action: 'list' });
    ok(res, r.rows);
  })
);

/* ----- GET /api/v1/documents/recipients — DOCUMENTALE upload picker -----
 * Minimal employee list (id, name, codice_fiscale, matricola) so the upload form
 * can auto-match files to employees. NOT OTP-gated: uploading is providing data,
 * not viewing it. A plain admin without the capability is rejected. */
documentsRouter.get(
  '/recipients',
  requireDocumentale,
  asyncHandler(async (req, res) => {
    const r = await adminPool.query(
      `SELECT m.user_id,
              COALESCE(au.email, m.user_id::text) AS email,
              au.display_name,
              m.codice_fiscale,
              m.matricola,
              m.active
         FROM memberships m
         LEFT JOIN auth_users au ON au.id = m.user_id
        WHERE m.tenant_id = $1 AND m.deleted_at IS NULL
        ORDER BY COALESCE(NULLIF(au.display_name, ''), au.email) ASC`,
      [req.user!.tenantId]
    );
    ok(res, r.rows);
  })
);

/* ----- GET /api/v1/documents/me — EMPLOYEE list (own only) ----- */
documentsRouter.get(
  '/me',
  tenantHandler(async (req, res, client) => {
    // RLS constrains documents to own-only; pin explicitly to the caller too so
    // intent is obvious. NEVER records a view.
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

/* ----- GET /api/v1/documents/:id/download — owning employee OR Documentale ----- */
documentsRouter.get(
  '/:id/download',
  tenantHandler(async (req, res, client) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw new ValidationError('invalid id');

    // Owner path: own-only RLS returns the row ONLY if the caller owns it. This
    // is the unchanged employee self-download — receipt invariant preserved.
    const own = await client.query(
      `SELECT * FROM documents WHERE id = $1 AND deleted_at IS NULL`,
      [id.data]
    );
    if (own.rowCount && own.rows[0].user_id === req.user!.id) {
      const doc = own.rows[0];
      // Record the FIRST view only for the OWNING employee (role='user' AND own
      // doc). A Documentale never reaches this branch, so the read-receipt can
      // only ever be flipped by the destination user.
      if (req.user!.role === 'user') {
        await client.query(
          `INSERT INTO document_views(tenant_id, document_id, user_id)
           VALUES (current_setting('app.current_tenant_id')::uuid, $1,
                   current_setting('app.current_user_id')::uuid)
           ON CONFLICT (document_id, user_id) DO NOTHING`,
          [doc.id]
        );
      }
      const url = await presignFor(doc);
      ok(res, { url, expires_in: PRESIGN_TTL_SECONDS });
      return;
    }

    // Not the owner → only a Documentale with a live OTP session may proceed.
    if (!req.user!.isDocumentale) throw new NotFoundError('document');
    if (!(await otpSessionActive(req.user!.tenantId, req.user!.id))) {
      throw new ForbiddenError('OTP verification required', 'OTP_REQUIRED');
    }
    const r = await adminPool.query(
      `SELECT * FROM documents WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id.data, req.user!.tenantId]
    );
    if (r.rowCount === 0) throw new NotFoundError('document');
    const doc = r.rows[0];
    await logDocumentAccess({
      tenantId: req.user!.tenantId,
      actorId: req.user!.id,
      action: 'download',
      documentId: doc.id,
      targetUserId: doc.user_id,
    });
    const url = await presignFor(doc);
    ok(res, { url, expires_in: PRESIGN_TTL_SECONDS });
  })
);

/* ----- GET /api/v1/documents/:id/raw — disk-driver stream fallback -----
 * Only meaningful when STORAGE_DRIVER=disk (dev/test). Same access split as
 * /download (owner via RLS, else Documentale + OTP). Does NOT record a view. */
documentsRouter.get(
  '/:id/raw',
  tenantHandler(async (req, res, client) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw new ValidationError('invalid id');

    const own = await client.query(
      `SELECT * FROM documents WHERE id = $1 AND deleted_at IS NULL`,
      [id.data]
    );
    let doc;
    if (own.rowCount && own.rows[0].user_id === req.user!.id) {
      doc = own.rows[0];
    } else {
      if (!req.user!.isDocumentale) throw new NotFoundError('document');
      if (!(await otpSessionActive(req.user!.tenantId, req.user!.id))) {
        throw new ForbiddenError('OTP verification required', 'OTP_REQUIRED');
      }
      const r = await adminPool.query(
        `SELECT * FROM documents WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [id.data, req.user!.tenantId]
      );
      if (r.rowCount === 0) throw new NotFoundError('document');
      doc = r.rows[0];
      await logDocumentAccess({
        tenantId: req.user!.tenantId,
        actorId: req.user!.id,
        action: 'download',
        documentId: doc.id,
        targetUserId: doc.user_id,
      });
    }

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

/* ----- DELETE /api/v1/documents/:id — DOCUMENTALE soft-delete + drop R2 ----- */
documentsRouter.delete(
  '/:id',
  requireDocumentale,
  requireDocumentaleOtp,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw new ValidationError('invalid id');
    const sel = await adminPool.query(
      `SELECT * FROM documents WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id.data, req.user!.tenantId]
    );
    if (sel.rowCount === 0) throw new NotFoundError('document');
    const doc = sel.rows[0];

    const upd = await adminPool.query(
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
    await logDocumentAccess({
      tenantId: req.user!.tenantId,
      actorId: req.user!.id,
      action: 'delete',
      documentId: doc.id,
      targetUserId: doc.user_id,
    });

    ok(res, { id: doc.id });
  })
);
