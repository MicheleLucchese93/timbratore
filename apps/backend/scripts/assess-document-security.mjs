// Local-only diagnostic for the document-sharing security assessment.
// Run from apps/backend: node --import tsx scripts/assess-document-security.mjs
// Reports both passing controls and reproducible gaps; does not change app code.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { env } from '../src/env.ts';

assert.notEqual(env.NODE_ENV, 'production', 'Assessment fixtures must never run in production');
for (const name of ['DATABASE_URL', 'ADMIN_DATABASE_URL']) {
  const url = new URL(env[name] ?? env.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), `${name} must be local`);
}
assert.equal(env.STORAGE_DRIVER, 'disk', 'This diagnostic must not write to R2');
assert.equal(env.DEV_AUTH_ENABLED, true, 'Local development authentication is required');

const disk = await mkdtemp(join(tmpdir(), 'sonoqui-document-assessment-'));
env.STORAGE_DISK_PATH = disk;
const { adminPool } = await import('../src/lib/admin-db.ts');
const { pool, withTenantRLS } = await import('../src/lib/db.ts');
const { signDevToken } = await import('../src/lib/jwt.ts');
const { storagePut } = await import('../src/lib/storage.ts');
const { documentSessionId } = await import('../src/lib/document-security.ts');
const { deleteDueDocument } = await import('../src/services/jobs/documents-retention.ts');
const { createApp } = await import('../src/app.ts');
const { rootLogger } = await import('../src/lib/logger.ts');
rootLogger.level = 'silent';

const tenants = [randomUUID(), randomUUID()];
const owner = randomUUID();
const plainAdmin = randomUUID();
const staff = randomUUID();
const otherStaff = randomUUID();
const results = [];
let server;
function record(name, secure, evidence) {
  results.push({ name, result: secure ? 'PASS' : 'GAP', evidence });
}
const hash = (code) => createHash('sha256').update(code).digest('hex');

try {
  const role = (await pool.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
  assert.equal(role.rolsuper, false);
  assert.equal(role.rolbypassrls, false);
  for (const [i, tid] of tenants.entries()) {
    await adminPool.query('INSERT INTO tenants(id,ragione_sociale) VALUES($1,$2)', [tid, `Security fixture ${i} ${tid}`]);
  }
  for (const [uid, tid, role, capability] of [
    [owner, tenants[0], 'user', false], [owner, tenants[1], 'user', false],
    [plainAdmin, tenants[0], 'admin', false], [staff, tenants[0], 'admin', true],
    [otherStaff, tenants[1], 'admin', true],
  ]) {
    // No auth_users row or recipient address: fixtures cannot send notifications.
    await adminPool.query('INSERT INTO memberships(tenant_id,user_id,role,is_documentale) VALUES($1,$2,$3,$4)', [tid, uid, role, capability]);
  }
  const docs = [];
  for (const tid of tenants) {
    const id = randomUUID();
    const key = `tenants/${tid}/documents/${id}/fixture.pdf`;
    const body = Buffer.from('%PDF-1.4\nSynthetic security fixture, no personal data\n%%EOF');
    await adminPool.query(`INSERT INTO documents(id,tenant_id,user_id,uploaded_by,category,title,original_filename,mime_type,size_bytes,r2_key,retention_until)
      VALUES($1,$2,$3,$3,'altro','Synthetic fixture','fixture.pdf','application/pdf',$4,$5,now()+interval '1 day')`, [id, tid, owner, body.length, key]);
    await storagePut(key, body, 'application/pdf');
    docs.push({ id, key });
  }
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/v1/documents`;
  const tokens = new Map();
  for (const uid of [owner, plainAdmin, staff, otherStaff]) {
    tokens.set(uid, await signDevToken({ sub: uid, email: 'fixture@example.invalid', ttlSeconds: 120 }));
  }
  async function request(path, uid, tid = tenants[0], options = {}) {
    const response = await fetch(base + path, {
      ...options,
      headers: { ...(uid ? { Authorization: `Bearer ${tokens.get(uid)}`, 'X-Tenant-Id': tid } : {}), ...options.headers },
      signal: AbortSignal.timeout(10000),
    });
    const contentType = response.headers.get('content-type') ?? '';
    const body = contentType.includes('application/json') ? await response.json() : await response.text();
    return { status: response.status, body, cache: response.headers.get('cache-control') };
  }
  async function seedOtp(attempts = 0, verified = false) {
    await adminPool.query(`INSERT INTO document_otps(tenant_id,user_id,code_hash,code_expires_at,attempts,verified_until,verified_session_id)
      VALUES($1,$2,$3,now()+interval '10 minutes',$4,CASE WHEN $5 THEN now()+interval '10 minutes' ELSE NULL END,$6)
      ON CONFLICT(tenant_id,user_id) DO UPDATE SET code_hash=EXCLUDED.code_hash,code_expires_at=EXCLUDED.code_expires_at,attempts=EXCLUDED.attempts,verified_until=EXCLUDED.verified_until,verified_session_id=EXCLUDED.verified_session_id`,
    [tenants[0], staff, hash('654321'), attempts, verified, documentSessionId(tokens.get(staff))]);
  }
  const checks = [
    ['anonymous list', '/me', null, tenants[0], 401],
    ['plain admin all-documents list', '', plainAdmin, tenants[0], 403],
    ['staff without OTP all-documents list', '', staff, tenants[0], 403],
    ['same-tenant non-owner download', `/${docs[0].id}/download`, plainAdmin, tenants[0], 404],
    ['same-tenant non-owner raw', `/${docs[0].id}/raw`, plainAdmin, tenants[0], 404],
    ['owner with different selected tenant', `/${docs[0].id}/raw`, owner, tenants[1], 404],
    ['foreign tenant header without membership', '/me', plainAdmin, tenants[1], 403],
    ['owner raw', `/${docs[0].id}/raw`, owner, tenants[0], 200],
  ];
  for (const [name, path, uid, tid, expected] of checks) {
    const r = await request(path, uid, tid);
    assert.equal(r.status, expected, name);
    record(name, true, { status: r.status });
  }
  const mine = await request('/me', owner);
  assert.equal(mine.body.data.length, 1);
  assert.equal(mine.body.data[0].id, docs[0].id);
  assert.equal('r2_key' in mine.body.data[0], false);
  record('owner list is tenant-scoped and hides storage keys', true, { count: 1 });

  await seedOtp(0, true);
  const foreign = await request(`/${docs[1].id}/raw`, staff);
  assert.equal(foreign.status, 404);
  record('OTP-verified staff cannot read a foreign tenant document', true, { status: foreign.status });
  const privileged = await request(`/${docs[0].id}/raw`, staff);
  assert.equal(privileged.status, 200);
  const viewCount = (await adminPool.query('SELECT count(*)::int AS n FROM document_views WHERE document_id=$1', [docs[0].id])).rows[0].n;
  record('staff raw access does not create an owner receipt', viewCount === 0, { receipts: viewCount });
  const firstToken = tokens.get(staff);
  tokens.set(staff, await signDevToken({ sub: staff, email: 'fixture@example.invalid', ttlSeconds: 121 }));
  const otherSession = await request('', staff);
  record('OTP access is isolated to the verified login session', otherSession.status === 403, { status: otherSession.status });
  tokens.set(staff, firstToken);
  await adminPool.query('UPDATE memberships SET is_documentale=false WHERE tenant_id=$1 AND user_id=$2', [tenants[0], staff]);
  const revoked = await request('', staff);
  await adminPool.query('UPDATE memberships SET is_documentale=true WHERE tenant_id=$1 AND user_id=$2', [tenants[0], staff]);
  const restored = await request('', staff);
  record('revocation is immediate and re-grant requires fresh OTP', revoked.status === 403 && restored.body.error?.code === 'OTP_REQUIRED', { revoked: revoked.status, restoredCode: restored.body.error?.code });
  const raw = await request(`/${docs[0].id}/raw`, owner);
  const download = await request(`/${docs[0].id}/download`, owner);
  record('sensitive responses explicitly forbid caching', [mine, raw, download].every(r => /no-store/i.test(r.cache ?? '')), {
    list: mine.cache, raw: raw.cache, download: download.cache,
  });

  const uploaded = await request(`?${new URLSearchParams({ user_id: owner, category: 'altro', title: 'Synthetic lifecycle', filename: 'private-name.pdf' })}`, staff, tenants[0], {
    method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: Buffer.from('%PDF-1.4\nSynthetic lifecycle\n%%EOF'),
  });
  assert.equal(uploaded.status, 201);
  const ready = (await adminPool.query('SELECT * FROM documents WHERE id=$1', [uploaded.body.data.id])).rows[0];
  assert.equal(ready.storage_state, 'ready');
  assert.ok(ready.r2_key.endsWith('/document.pdf'));
  assert.equal((await request(`/${ready.id}/raw`, owner)).status, 200);
  await seedOtp(0, true);
  assert.equal((await request(`/${ready.id}`, staff, tenants[0], { method: 'DELETE' })).status, 200);
  assert.equal((await request(`/${ready.id}/raw`, owner)).status, 404);
  await assert.rejects(readFile(join(disk, ready.r2_key)), { code: 'ENOENT' });
  record('successful upload, owner read, and deletion preserve opaque keys and visibility', true, {});

  // Pause after the real SELECT completes: models concurrent requests observing
  // the same OTP before any can UPDATE it. Database and route code remain real.
  async function concurrentVerification(codes) {
    const original = adminPool.query;
    let seen = 0;
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    const timeout = setTimeout(release, 3000);
    adminPool.query = async function (...args) {
      const r = await original.apply(this, args);
      if (typeof args[0] === 'string' && /SELECT code_hash, code_expires_at, attempts/.test(args[0])) {
        if (++seen === codes.length) release();
        await barrier;
      }
      return r;
    };
    try {
      return await Promise.all(codes.map(code => request('/otp/verify', staff, tenants[0], {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
      })));
    } finally { clearTimeout(timeout); release(); adminPool.query = original; }
  }
  await seedOtp(4);
  const attempts = await concurrentVerification(Array(8).fill('000000'));
  const attempted = (await adminPool.query('SELECT attempts FROM document_otps WHERE tenant_id=$1 AND user_id=$2', [tenants[0], staff])).rows[0].attempts;
  record('OTP five-attempt limit survives concurrent requests', attempted <= 5, { startingAttempts: 4, finalAttempts: attempted, statuses: attempts.map(r => r.status) });
  await seedOtp();
  const replays = await concurrentVerification(['654321', '654321']);
  const accepted = replays.filter(r => r.status === 200).length;
  record('OTP is consumed exactly once under concurrency', accepted === 1, { accepted, statuses: replays.map(r => r.status) });

  // Force the first audit statement to fail AFTER the real storage write. This
  // diagnoses compensation when a transaction aborts after a successful PUT.
  const originalConnect = adminPool.connect;
  let injected = false;
  adminPool.connect = function (...args) {
    if (typeof args[0] === 'function') return originalConnect.apply(this, args);
    return originalConnect.apply(this, args).then(client => {
      const originalQuery = client.query;
      const originalRelease = client.release;
      client.query = function (...queryArgs) {
        if (!injected && typeof queryArgs[0] === 'string' && /INSERT INTO audit_log/.test(queryArgs[0]) && queryArgs[1]?.includes('document.upload')) {
          injected = true;
          return Promise.reject(new Error('Synthetic post-PUT audit failure'));
        }
        return originalQuery.apply(this, queryArgs);
      };
      client.release = function (...releaseArgs) {
        client.query = originalQuery;
        client.release = originalRelease;
        return originalRelease.apply(this, releaseArgs);
      };
      return client;
    });
  };
  const beforeFiles = new Set(await readdir(disk, { recursive: true }));
  const marker = `Synthetic-${randomUUID()}`;
  let failedUpload;
  try {
    failedUpload = await request(`?${new URLSearchParams({ user_id: owner, category: 'altro', title: marker, filename: 'rollback.pdf' })}`, staff, tenants[0], {
      method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: Buffer.from('%PDF-1.4\nSynthetic rollback fixture\n%%EOF'),
    });
  } finally { adminPool.connect = originalConnect; }
  assert.ok(injected, 'Post-PUT fault must be exercised');
  assert.equal(failedUpload.status, 500);
  const extraPdf = (await readdir(disk, { recursive: true })).filter(f => !beforeFiles.has(f) && f.endsWith('.pdf'));
  const pending = (await adminPool.query('SELECT id,storage_state FROM documents WHERE title=$1', [marker])).rows[0];
  record('failed upload leaves a durable pending record for cleanup', pending?.storage_state === 'pending', { status: failedUpload.status, remainingPdfObjects: extraPdf.length, state: pending?.storage_state });
  const pendingRead = await request(`/${pending.id}/raw`, owner);
  record('pending uploads are hidden from recipients', pendingRead.status === 404, { status: pendingRead.status });
  assert.equal(await deleteDueDocument(pending.id), false, 'Fresh upload must not be retired');
  await adminPool.query("UPDATE documents SET created_at=now()-interval '2 days' WHERE id=$1", [pending.id]);
  const lock = await adminPool.connect();
  try {
    await lock.query('BEGIN');
    await lock.query('SELECT id FROM documents WHERE id=$1 FOR UPDATE', [pending.id]);
    record('cleanup skips an in-flight upload lock', !(await deleteDueDocument(pending.id)), {});
  } finally { await lock.query('ROLLBACK'); lock.release(); }

  const pendingKey = (await adminPool.query('SELECT r2_key FROM documents WHERE id=$1', [pending.id])).rows[0].r2_key;
  const pendingPath = join(disk, pendingKey);
  const pendingBytes = await readFile(pendingPath);
  await rm(pendingPath);
  await mkdir(pendingPath); // rm(force:true) cannot remove a directory: storage failure.
  await assert.rejects(deleteDueDocument(pending.id));
  assert.equal((await adminPool.query('SELECT 1 FROM documents WHERE id=$1', [pending.id])).rowCount, 1);
  await rm(pendingPath, { recursive: true });
  await writeFile(pendingPath, pendingBytes);
  record('storage deletion failure keeps the cleanup record for retry', true, {});
  assert.equal(await deleteDueDocument(pending.id), true);
  const afterCleanup = (await readdir(disk, { recursive: true })).filter(f => extraPdf.includes(f));
  record('cleanup removes stale pending bytes and metadata', afterCleanup.length === 0 && (await adminPool.query('SELECT 1 FROM documents WHERE id=$1', [pending.id])).rowCount === 0, { remainingPdfObjects: afterCleanup.length });

  // A real COMMIT succeeds, but its reply is lost. A compensation DELETE here
  // would destroy a successfully committed document, so exercise that boundary.
  let replyLost = false;
  adminPool.connect = function (...args) {
    if (typeof args[0] === 'function') return originalConnect.apply(this, args);
    return originalConnect.apply(this, args).then(client => {
      const query = client.query, release = client.release;
      let finalized = false;
      client.query = async function (...a) {
        const r = await query.apply(this, a);
        if (typeof a[0] === 'string' && /UPDATE documents SET storage_state = 'ready'/.test(a[0])) finalized = true;
        if (a[0] === 'COMMIT' && finalized && !replyLost) {
          replyLost = true;
          throw new Error('Synthetic lost COMMIT reply');
        }
        return r;
      };
      client.release = function (...a) { client.query = query; client.release = release; return release.apply(this, a); };
      return client;
    });
  };
  const ambiguousTitle = `Synthetic-${randomUUID()}`;
  try {
    const r = await request(`?${new URLSearchParams({ user_id: owner, category: 'altro', title: ambiguousTitle, filename: 'commit.pdf' })}`, staff, tenants[0], {
      method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: Buffer.from('%PDF-1.4\nSynthetic COMMIT fixture\n%%EOF'),
    });
    assert.equal(r.status, 500);
  } finally { adminPool.connect = originalConnect; }
  assert.ok(replyLost);
  const committed = (await adminPool.query('SELECT id,storage_state FROM documents WHERE title=$1', [ambiguousTitle])).rows[0];
  assert.equal(committed.storage_state, 'ready');
  assert.equal((await request(`/${committed.id}/raw`, owner)).status, 200);
  assert.equal(await deleteDueDocument(committed.id), false);
  record('lost COMMIT reply preserves the committed document and its bytes', true, {});

  // Defence-in-depth checks: these require app-role SQL access; they are NOT
  // claims that ordinary HTTP callers can submit arbitrary object keys/receipts.
  let forgedKeyAllowed = false;
  try {
    await withTenantRLS(plainAdmin, tenants[0], async client => {
      await client.query(`INSERT INTO documents(tenant_id,user_id,uploaded_by,category,title,original_filename,mime_type,size_bytes,r2_key,retention_until)
        VALUES($1,$2,$2,'altro','Synthetic forged key','fixture.pdf','application/pdf',1,$3,now()+interval '1 day')`, [tenants[0], plainAdmin, docs[1].key]);
      forgedKeyAllowed = true;
      throw new Error('ROLLBACK_FIXTURE');
    });
  } catch (e) { if (e.message !== 'ROLLBACK_FIXTURE' && e.code !== '42501' && e.code !== '23514') throw e; }
  record('database rejects a plain-admin insert referencing a foreign object key', !forgedKeyAllowed, { appRoleAcceptedInsert: forgedKeyAllowed });

  let forgedReceiptAllowed = false;
  try {
    await withTenantRLS(plainAdmin, tenants[0], async client => {
      await client.query('INSERT INTO document_views(tenant_id,document_id,user_id) VALUES($1,$2,$3)', [tenants[0], docs[1].id, plainAdmin]);
      forgedReceiptAllowed = true;
      throw new Error('ROLLBACK_FIXTURE');
    });
  } catch (e) { if (e.message !== 'ROLLBACK_FIXTURE' && !['42501', '23503', '23514'].includes(e.code)) throw e; }
  record('database rejects a receipt referencing a foreign document', !forgedReceiptAllowed, { appRoleAcceptedInsert: forgedReceiptAllowed });
} finally {
  if (server) await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  // Delete only rows under the two fresh UUID tenant fixtures.
  for (const table of ['document_views', 'document_access_log', 'document_otps', 'documents', 'audit_log', 'memberships', 'tenants']) {
    await adminPool.query(`DELETE FROM ${table} WHERE ${table === 'tenants' ? 'id' : 'tenant_id'} = ANY($1::uuid[])`, [tenants]);
  }
  await pool.end();
  await adminPool.end();
  await rm(disk, { recursive: true, force: true });
}
console.log(JSON.stringify({ localOnly: true, productionMutations: false, results }, null, 2));
if (results.some(r => r.result === 'GAP')) process.exitCode = 1;
