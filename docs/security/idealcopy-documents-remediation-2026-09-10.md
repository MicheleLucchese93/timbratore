# Idealcopy document security: remediation record

10 September 2026. Follows the [initial assessment](idealcopy-documents-assessment-2026-09-10.md). This record contains no employee data, credentials, object paths, or signed URLs. Production checks use aggregate metadata; no employee PDF bodies were downloaded and no employee notifications were sent.

## Cloudflare dashboard verification

Verified through Chrome's native MCP controls in account `d99d141402ac05f695e7d3cf8d1e16f3`:

- `sonoqui-documents` public access is disabled, its public development URL is disabled, and no custom domain is configured.
- The bucket reports Eastern Europe (`EEUR`) location, with default jurisdiction. A location hint is not an explicit EU jurisdiction restriction.
- CORS is not configured. R2 data-access logging was enabled during remediation and the dashboard showed **Enabled** with a Workers Observability link. Cloudflare documents asynchronous, best-effort delivery for successful operations; failed requests (HTTP 400+) are excluded and earlier activity is not backfilled. This supplements application records rather than providing a complete audit trail. [R2 Data Access Logs](https://developers.cloudflare.com/r2/buckets/data-access-logs/).
- The Workers & Pages inventory listed two Pages projects, `custodo` and `timesystem-demo`. Their production and preview settings showed no resource bindings; no R2 bindings or R2 credential variables were found in those settings. No separate Worker application appeared in the inventory. This does not prove that historic deployment bundles or other account administrators cannot contain/use storage credentials.
- The application's access-key ID matches the account token named **R2 Account Token**, with **Admin Read & Write on all buckets**. It is also used by `penno-api` and the infrastructure environment. Narrowing or revoking it in place would affect other services. SonoQui requires a dedicated Object Read & Write credential restricted to `sonoqui-documents`; this remains open until that credential is installed and verified.
- Another user token, `claude_code`, also has all-bucket administrative access. Account-wide administrator credentials remain a trust boundary even after the application credential is reduced.

R2 encrypts all object data and metadata at rest with AES-256 under Cloudflare-managed keys. This is automatic and is independent of tenant authorization. Tenant isolation here uses authorization, RLS, and checked object prefixes in a shared bucket; it does not use separate tenant encryption keys. [Cloudflare R2 data security](https://developers.cloudflare.com/r2/reference/data-security/).

## Implemented corrections

| Gap | Correction | Verification |
|---|---|---|
| Gateway URL metadata leakage | Redact `title`, `filename`, `user_id`, and `category` on all 14 SonoQui ingresses. Deploy script synchronizes the filter. | Production Caddy validated and reloaded. Synthetic anonymous POSTs to four API/proxy hostnames returned 401; all four origin log records excluded every sensitive field. Public edge requests were blocked with 403, so origin probes used loopback with the existing origin certificate. |
| OTP concurrent guessing/replay | Transactional row lock, persisted attempt accounting, single-use consumption, and per-user verification rate limit. | Eight concurrent wrong submissions starting at four attempts stopped at five; two correct submissions produced exactly one success. |
| OTP shared across sessions / stale capability | Bind grants to the signed GoTrue session ID, falling back to token hash. Read fresh membership state for document routes; database trigger clears step-up grants on capability/deactivation/deletion changes. | A separate token is denied, revocation takes effect immediately, and re-grant requires a new OTP. |
| Cache persistence | `private, no-store` on document APIs, new R2 writes, and signed GET response override; metadata-only backfill script for existing documents. | All 14 active production objects updated with unchanged ETags/sizes; a second HEAD pass found 14 already private and zero requiring update. A disposable R2 object confirmed the signed-response override and was deleted. Four production API/proxy hostnames returned anonymous 401 responses with the expected cache header. |
| Orphaned upload after database failure | Persist a pending record before PUT; finalize under lock; hide pending records; daily cleanup retries stale pending records. Never compensate a lost COMMIT response by blindly deleting bytes. | Post-PUT audit failure, lost COMMIT reply, in-flight lock, storage deletion failure and successful retry all pass. |
| Weak SQL write/receipt boundaries | Remove normal-role metadata write policies, constrain object key scope, validate keys before storage operations, and bind receipts to the same document/tenant/recipient. | Forged cross-tenant key and receipt rejected; real successful upload, owner read and deletion pass. |
| Audit writes fail open | Documentale list/download fail if their audit insert fails. | Covered by route review; OTP event logging remains best effort. |
| Deployment drift | Require R2 in production; restrict JWT algorithm to HS256; run migrations on one dedicated connection and during API deployment. | TypeScript and backend suite pass. API is stopped only after image build, before schema migration, to avoid old uploads racing the new key constraint. |

## Validation and rollout

- Backend suite: **293 tests passed**, zero failed or skipped.
- Document security regression script: **25 checks passed**, using real HTTP routes and non-bypass PostgreSQL RLS with local synthetic fixtures; cleanup completed. It refuses production mode, remote databases, or R2 storage and is registered in CI.
- Backend TypeScript, shell syntax and diff whitespace checks passed.
- Production migration preflight: 15 document rows across the shared service, zero invalid object keys, zero inconsistent receipts, migrations through 065 present.
- [PR #90](https://github.com/MicheleLucchese93/timbratore/pull/90) passed CI and was merged as `56bc663e896097906b9e4398eead20c02ff317a2`. Build/typecheck, PostgreSQL tests (including the new security checks), Gitleaks, and Trivy dependency/configuration scans passed. The PR workflow skipped its image scan.
- Migration 066 applied at approximately 09:47 UTC. The API was restarted with image `sha256:ba97341281eb8432a7c6fee677050cd818772bb6241056fa7426481619a115fb`, built from the identical application source before migration. Docker reports healthy; `/health` returns 200. Source/container document-route SHA-256 hashes match. The old image was retained under `sonoqui-api:before-document-security-20260910`; rollback also requires schema compatibility review.
- Production RLS after deployment: owner sees one sampled document; same-tenant non-owner, owner under another tenant and foreign user/tenant each see zero. Normal-role document write policies are absent, both new constraints are validated, and the revocation trigger is enabled.
- Final Idealcopy reconciliation: 13 metadata rows, 12 active documents and 12 R2 objects; all active objects have matching sizes/PDF types and `private, no-store`; no pending uploads, untracked objects or remaining soft-deleted objects. The inventory grew during the assessment while the service was in use; these are the final counts, distinct from the initial baseline.
- Cache metadata backfill completed across all 14 active service documents, without reading employee PDF bodies.

## Remaining decisions and limits

1. Finish dedicated bucket-scoped application credential provisioning and review the owners/rotation of shared account administrator credentials. A Chrome form is prepared for `sonoqui-prod-documents`: Object Read & Write, only `sonoqui-documents`, no automatic expiry, no IP filter (downloads use end-user signed URLs). No new credential has been issued yet. The Chrome MCP policy requires confirmation at issuance of new security-sensitive access.
2. Keep historical gateway log access restricted and review retention/backups. Existing log copies were not erased by this change. Upload metadata still travels in URL query parameters, so Cloudflare or other intermediaries need separate log review; moving metadata into multipart bodies is a coordinated client/API change.
3. Decide whether an explicit EU jurisdiction is required. Current location is EEUR, default jurisdiction; encryption does not establish residency. R2 data-access logging is now enabled, with the delivery and coverage limits above.
4. Documentale entitlement remains administered by tenant admins, who can self-grant subject to the existing cap. A separation-of-duties policy requires a product/ownership decision.
5. JWT audience rollout must be coordinated with GoTrue: current live tokens have an empty `aud`. Setting `authenticated` only on the API would invalidate current sessions. Issuer validation remains pinned and HS256 is now explicit.
6. Signed URLs remain reusable bearer links for 60 seconds and cannot be recalled on logout. Owner receipts record link issuance, not proof that a person read a file. PDF signature/size validation does not provide malware scanning.
7. Database volumes, metadata backups and historical logs require their own encryption/access assessment. This work verifies R2 document storage, not every payroll-related copy across the infrastructure.

The original production dependency audit found no high/critical advisory. The two moderate package entries concern one transitive UUID advisory through ExcelJS; inspected usage did not exercise the affected buffer-argument API. This is not an exhaustive penetration test or repository-history secret scan.
