import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../env.js';

// Shared S3-compatible client for Cloudflare R2. Built lazily on first use so a
// disk-driver deploy (STORAGE_DRIVER=disk, no R2_* vars) never constructs it.
// Cross-cutting: documents (routes/documents.ts) and exports (export-service.ts)
// both go through here so there is exactly one R2 wiring in the codebase.
let client: S3Client | null = null;

export function getStorageClient(): S3Client {
  if (client) return client;
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new Error('R2 storage requested but R2_* env vars are not configured');
  }
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });
  return client;
}

function bucket(): string {
  if (!env.R2_BUCKET) throw new Error('R2_BUCKET is not configured');
  return env.R2_BUCKET;
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  await getStorageClient().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

export async function getObject(key: string): Promise<Buffer> {
  const res = await getStorageClient().send(
    new GetObjectCommand({ Bucket: bucket(), Key: key })
  );
  const body = res.Body;
  if (!body) throw new Error(`R2 object has empty body: ${key}`);
  // Node stream → Buffer. The SDK returns a Readable on Node.
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function getPresignedGetUrl(
  key: string,
  ttlSeconds: number
): Promise<string> {
  return getSignedUrl(
    getStorageClient(),
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
    { expiresIn: ttlSeconds }
  );
}

export async function deleteObject(key: string): Promise<void> {
  await getStorageClient().send(
    new DeleteObjectCommand({ Bucket: bucket(), Key: key })
  );
}

/* ----- Driver-aware helpers -----
 * Documents go to R2 in production (STORAGE_DRIVER=r2) but local dev / tests run
 * on the disk driver. These honor STORAGE_DRIVER the same way export-service's
 * persist()/readExportFile()/deleteExportFile() do, so the documents feature
 * works in both environments without the route caring which backend is active.
 */

export async function storagePut(
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  if (env.STORAGE_DRIVER === 'disk') {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { join, dirname } = await import('node:path');
    const full = join(env.STORAGE_DISK_PATH, key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
    return;
  }
  await putObject(key, body, contentType);
}

export async function storageDelete(key: string): Promise<void> {
  if (env.STORAGE_DRIVER === 'disk') {
    const { rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    await rm(join(env.STORAGE_DISK_PATH, key), { force: true });
    return;
  }
  await deleteObject(key);
}

/**
 * A short-lived URL the client can GET the object from. On R2 this is a real
 * presigned S3 URL. On the disk driver (dev) there is no object store, so we
 * hand back a backend route that streams the file — keeping the API contract
 * ({ url, expires_in }) identical across drivers. `localFallbackUrl` is used
 * only when STORAGE_DRIVER=disk.
 */
export async function storagePresignedGetUrl(
  key: string,
  ttlSeconds: number,
  localFallbackUrl: string
): Promise<string> {
  if (env.STORAGE_DRIVER === 'disk') {
    return localFallbackUrl;
  }
  return getPresignedGetUrl(key, ttlSeconds);
}
