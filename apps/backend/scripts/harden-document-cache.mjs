// Set privacy metadata on existing documents without downloading their bodies.
// Dry run by default: node --import tsx scripts/harden-document-cache.mjs [--apply]
import assert from 'node:assert/strict';
import { HeadObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../src/env.ts';
import { adminPool } from '../src/lib/admin-db.ts';
import { getStorageClient } from '../src/lib/storage.ts';
import { assertDocumentKey, PRIVATE_DOCUMENT_CACHE_CONTROL } from '../src/lib/document-security.ts';

assert.equal(env.STORAGE_DRIVER, 'r2', 'R2 storage is required');
const apply = process.argv.includes('--apply');
const s3 = getStorageClient();
const Bucket = env.R2_BUCKET;
const counts = { inspected: 0, alreadyPrivate: 0, updated: 0, needsUpdate: 0, skipped: 0 };
try {
  const ids = (await adminPool.query("SELECT id FROM documents WHERE deleted_at IS NULL AND storage_state='ready'")).rows;
  for (const { id } of ids) {
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      // Keep delete/replace from committing while metadata is copied, so the
      // copy cannot resurrect an object whose deletion has already committed.
      const r = await client.query("SELECT id,tenant_id,r2_key FROM documents WHERE id=$1 AND deleted_at IS NULL AND storage_state='ready' FOR SHARE", [id]);
      if (!r.rowCount) { counts.skipped++; await client.query('COMMIT'); continue; }
      const doc = r.rows[0];
      assertDocumentKey(doc);
      const Key = doc.r2_key;
      const h = await s3.send(new HeadObjectCommand({ Bucket, Key }));
      counts.inspected++;
      if (h.CacheControl === PRIVATE_DOCUMENT_CACHE_CONTROL) counts.alreadyPrivate++;
      else if (!apply) counts.needsUpdate++;
      else {
        await s3.send(new CopyObjectCommand({
          Bucket, Key,
          CopySource: `${Bucket}/${Key.split('/').map(encodeURIComponent).join('/')}`,
          CopySourceIfMatch: h.ETag,
          MetadataDirective: 'REPLACE',
          Metadata: h.Metadata,
          CacheControl: PRIVATE_DOCUMENT_CACHE_CONTROL,
          ContentType: h.ContentType,
          ContentDisposition: h.ContentDisposition,
          ContentEncoding: h.ContentEncoding,
          ContentLanguage: h.ContentLanguage,
          StorageClass: h.StorageClass,
          Expires: h.Expires,
        }));
        const verified = await s3.send(new HeadObjectCommand({ Bucket, Key }));
        assert.equal(verified.CacheControl, PRIVATE_DOCUMENT_CACHE_CONTROL);
        assert.equal(verified.ETag, h.ETag, 'Object content changed unexpectedly');
        assert.equal(verified.ContentLength, h.ContentLength);
        counts.updated++;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      // Neither keys nor object names belong in command logs.
      throw new Error(`Cache hardening failed: ${err.name}`);
    } finally { client.release(); }
  }
  console.log(JSON.stringify({ apply, ...counts }));
} finally { s3.destroy(); await adminPool.end(); }
