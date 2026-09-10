import { createHash, timingSafeEqual } from 'node:crypto';
import { adminPool } from './admin-db.js';

export const PRIVATE_DOCUMENT_CACHE_CONTROL = 'private, no-store';

export function documentSessionId(token: string, sessionId?: string): string {
  // GoTrue's session_id survives refresh. Older tokens without one are scoped
  // to the individual bearer token, so a refresh safely requires another OTP.
  return createHash('sha256').update(sessionId ? `session:${sessionId}` : `token:${token}`).digest('hex');
}

export function assertDocumentKey(doc: { tenant_id: string; id: string; r2_key: string }): void {
  const prefix = `tenants/${doc.tenant_id}/documents/${doc.id}/`;
  if (!doc.r2_key.startsWith(prefix) || !/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,203}$/.test(doc.r2_key.slice(prefix.length))) {
    // Do not expose the object key (which may contain a name) in errors/logs.
    throw new Error('Invalid document storage scope');
  }
}

export async function verifyDocumentOtp(opts: {
  tenantId: string;
  userId: string;
  sessionId: string;
  code: string;
}): Promise<'verified' | 'invalid' | 'locked'> {
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT code_hash, code_expires_at, attempts, code_expires_at > now() AS unexpired
         FROM document_otps WHERE tenant_id = $1 AND user_id = $2 FOR UPDATE`,
      [opts.tenantId, opts.userId]
    );
    const rec = result.rows[0];
    let outcome: 'verified' | 'invalid' | 'locked' = 'invalid';
    if (rec?.code_hash && rec.unexpired) {
      if (rec.attempts >= 5) outcome = 'locked';
      else {
        const expected = Buffer.from(rec.code_hash);
        const provided = Buffer.from(createHash('sha256').update(opts.code).digest('hex'));
        if (expected.length === provided.length && timingSafeEqual(expected, provided)) {
          await client.query(
            `UPDATE document_otps SET verified_until = now() + interval '10 minutes',
                    verified_session_id = $3, code_hash = NULL, code_expires_at = NULL, attempts = 0
              WHERE tenant_id = $1 AND user_id = $2`,
            [opts.tenantId, opts.userId, opts.sessionId]
          );
          outcome = 'verified';
        } else {
          await client.query(
            `UPDATE document_otps SET attempts = attempts + 1 WHERE tenant_id = $1 AND user_id = $2`,
            [opts.tenantId, opts.userId]
          );
        }
      }
    }
    // Commit failed attempts too. Throwing a validation error inside the
    // transaction would roll back the very counter that enforces the limit.
    await client.query('COMMIT');
    return outcome;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
