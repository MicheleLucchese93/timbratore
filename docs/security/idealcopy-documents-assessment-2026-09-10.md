# Idealcopy document-sharing security assessment

> Historical baseline, captured before remediation. Current verification and fixes are tracked in [the remediation record](idealcopy-documents-remediation-2026-09-10.md).

Assessed 10 September 2026. Source and production checkout: `e331bb70fcf9b688c3469980958238aabf1f4427`. SHA-256 comparisons confirmed that the running container's document routes, storage module, and environment module match the local source.

**Verdict: tenant and recipient access checks passed; R2 encryption at rest is covered; a clean security sign-off is not yet justified.** Four medium-priority issues need remediation, database safeguards need tightening, and bucket public-access settings and credential scope remain unverified.

Production checks were read-only: configuration, database metadata/RLS, R2 LIST/HEAD requests, and aggregate log inspection. No production payslip bodies were downloaded, no employee read receipts were changed, no emails were sent, and no production configuration was modified. Concurrency and failure-injection tests used synthetic documents in a local database and temporary disk directory; all fixtures were removed. This report contains no employee identifiers, document titles, object keys, credentials, or signed URLs.

**Encryption and isolation**

Production uses `STORAGE_DRIVER=r2` and bucket `sonoqui-documents`. All 11 active Idealcopy documents were found through authenticated R2 HEAD requests, with matching sizes and PDF content types. Cloudflare documents automatic AES-256 encryption of every R2 object and its metadata using Cloudflare-managed keys. No application encryption flag is required. The HEAD responses did not include `ServerSideEncryption`; that absence is not evidence of unencrypted R2 storage. The assurance comes from confirming these objects are in R2 and Cloudflare's documented service guarantee. [Cloudflare data security](https://developers.cloudflare.com/r2/reference/data-security/).

Isolation is enforced by application authorization and PostgreSQL row-level security (RLS), with tenant-prefixed object names. The application uses a shared bucket and storage credential, with no tenant-specific application encryption keys. A compromised backend/storage credential therefore has a broader impact than one tenant. Encryption at rest does not prevent authorized storage credentials from reading objects and does not cover independent copies in logs, PostgreSQL, backups, or downloaded files.

| Control | Evidence | Assessment |
|---|---|---|
| Production storage | R2 configured; all required R2 settings present | Pass |
| Tenant database role | `app` is neither superuser, BYPASSRLS, nor owner of document tables | Pass |
| Elevated database role | `sonoqui_owner` owns the document tables; used for explicitly scoped management operations | Expected, security-critical trust boundary |
| Document visibility | Live SELECT policy requires both tenant and document owner | Pass |
| Live access probe | Owner sees one sampled document; foreign tenant, non-owner admin, and owner under another tenant each see zero | Pass |
| OTP-state visibility | Normal application role sees zero OTP rows in all tested contexts | Pass |
| Idealcopy inventory | 12 metadata rows: 11 active, one soft-deleted; eight distinct recipients across those rows | Verified |
| Object reconciliation | 11 R2 objects, no unmatched objects under Idealcopy's document prefix; soft-deleted object's HEAD returns 404 | Pass at assessment time |
| Metadata integrity | No wrong tenant/document prefixes, missing recipient memberships, mismatched receipts, or overdue active documents | Pass at assessment time |
| Staff access | Two active Documentale admins, one other admin, six ordinary users | Verified; review entitlement ownership periodically |
| Production safeguards | Development authentication disabled; scheduler enabled; production environment file permissions `0600`; fixed test OTP is scoped to a different tenant | Pass for these checks |
| Signed download URLs | Issued after owner authorization or tenant-scoped Documentale + OTP; lifetime 60 seconds | Expected bearer-link tradeoff |
| R2 CORS | No CORS configuration | No wildcard exposure found; browser navigation to signed PDFs does not require cross-origin JavaScript access |
| R2 lifecycle | Only a seven-day incomplete multipart-upload abort rule | Document deletion depends on the application scheduler |

The local HTTP tests additionally confirmed anonymous rejection, a plain admin's exclusion from the all-document view, OTP enforcement, non-owner denial on both `/download` and `/raw`, tenant-header membership validation, cross-tenant denial even for OTP-verified staff, omission of `r2_key` from listings, and preservation of owner receipts during staff access.

**Findings requiring remediation**

1. **P2 — Production gateway logs retain document titles and filenames.** The deployed `/opt/infra/caddy/sites.d/sonoqui.caddy` imports the ordinary `access_log`, and its adapted configuration uses JSON encoders without the document query filter. All 22 document-upload entries found in the sampled gateway log tail (up to 20,000 entries from the previous 48 hours) contained unredacted `title` and `filename` query values. This is a service-wide sample, not a count attributed exclusively to Idealcopy. These fields can reveal employee names, document type, and payroll period to log readers and log copies independently of R2 controls.

   The intended filter already exists in [infra/caddy-sonoqui.snippet](/Users/michele.lucchese/Documents/Timbratore/infra/caddy-sonoqui.snippet:12), but [deploy.sh](/Users/michele.lucchese/Documents/Timbratore/deploy.sh:19) does not synchronize this gateway configuration. Apply the filter to every upload ingress, including any same-origin API proxy; validate and reload Caddy; verify with a synthetic upload that the sensitive values are absent from new logs. Review access and retention for historical logs and their copies before any disposal. Longer term, put upload metadata in a multipart body so intermediaries do not receive it as URL parameters. Backend request logging already strips query strings.

2. **P2 — OTP verification is not atomic.** [documents.ts](/Users/michele.lucchese/Documents/Timbratore/apps/backend/src/routes/documents.ts:228) reads the hash, expiry, and attempt count independently of its subsequent updates. Concurrent callers can all observe an eligible code. A deterministic local test released eight real HTTP verification requests after their SELECTs: starting with four attempts, all eight wrong codes were evaluated, ending at 12 attempts rather than locking at five. Two concurrent submissions of the correct code both returned HTTP 200.

   This weakens the additional verification gate for an already authenticated Documentale account; it is not an anonymous or cross-tenant bypass. Use one transaction and row lock for verification, failed-attempt accounting, and code consumption, or an equivalent atomic compare-and-update design. Persist failed attempts before returning an error, and coordinate OTP replacement with verification. Add a verification rate limit as an additional safeguard. Acceptance: at most one success per code and at most the configured number of evaluated guesses under concurrency.

3. **P2 — Sensitive responses and R2 objects lack explicit cache prevention.** All 11 active R2 objects returned no `Cache-Control` metadata. The local `/me`, `/raw`, and `/download` responses also lacked `Cache-Control`. [storage.ts](/Users/michele.lucchese/Documents/Timbratore/apps/backend/src/lib/storage.ts:43) sets only content type on PUT; [documents.ts](/Users/michele.lucchese/Documents/Timbratore/apps/backend/src/routes/documents.ts:589) streams PDFs without a no-store header. Browsers can retain sensitive responses according to their cache behavior after application sessions or links expire. This is not a claim that a shared cache has already disclosed documents.

   Set `Cache-Control: private, no-store` consistently on document API responses and served PDFs, including errors where appropriate. Set it on new R2 objects and address existing objects or validated signed-response overrides. Signed URLs are reusable bearer capabilities until expiry, so logout or role revocation cannot recall an already issued link; use an authenticated download proxy if immediate revocation is required. No cache header can prevent an authorized employee from saving a PDF intentionally. [Cloudflare presigned URL semantics](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

4. **P2 — Upload rollback can orphan stored PDFs beyond retention tracking.** [documents.ts](/Users/michele.lucchese/Documents/Timbratore/apps/backend/src/routes/documents.ts:373) writes storage before audit insertion and COMMIT. The catch block rolls back PostgreSQL but does not compensate the object write. Local injection of an audit failure after a successful storage write produced HTTP 500, zero document rows, and one remaining PDF. The same ordering is used by the R2 driver; the failure was reproduced with disk storage, not against production.

   [documents-retention.ts](/Users/michele.lucchese/Documents/Timbratore/apps/backend/src/services/jobs/documents-retention.ts:22) starts from database rows, so it cannot discover an object whose row never committed. No such objects were found in Idealcopy's current prefix. Track uploads durably through pending/ready states and reconcile failures, or implement safe compensation with durable retries. Handle ambiguous COMMIT outcomes carefully: verify whether a document committed before deleting its bytes. Acceptance: injected post-PUT failures leave either no object or a durable cleanup record, and reconciliation detects unreferenced objects.

**Additional safeguards and design limits**

- **Database write safeguards are weaker than the HTTP policy.** Migration 042 tightened SELECT but left migration 041's admin INSERT/UPDATE/DELETE policies in place. A local normal-role SQL test accepted an own-tenant document row containing another tenant's object key. Another accepted a receipt with the caller's tenant/user but a foreign document ID. These tests required direct SQL access and were rolled back; no ordinary HTTP path to submit those forged values was found. Remove unnecessary document write privileges/policies from the normal application role; validate object-key ownership before reads/deletes/signing; enforce recipient membership and receipt-to-document tenant/owner consistency through constraints and policies. Evidence: [041_documents.sql](/Users/michele.lucchese/Documents/Timbratore/apps/backend/supabase/migrations/041_documents.sql:62).
- **Documentale is not an independently administered boundary.** Tenant admins can manage the capability, including self-grant, subject to the tenant cap; the existing test suite intentionally exercises this. They can then verify their own email OTP. An admin excluded from HR documents is therefore not permanently excluded by a separate authority. Capability governance needs a product decision if separation from tenant administration is required. See [users.ts](/Users/michele.lucchese/Documents/Timbratore/apps/backend/src/routes/users.ts:647).
- **OTP authorization is shared across a user's sessions.** `verified_until` is keyed by tenant and user, not login session/device. A second valid token for that user benefits from the same ten-minute window. Capability removal blocks access, but the stored window is not cleared by the capability update; quick re-grant may reuse it. Bind step-up authorization to a login session and clear it on revocation if session-specific verification is intended.
- **Audit availability and receipts have limits.** Documentale access-log insertion is best effort. A database logging failure does not prevent document access. Owner `/download` records link issuance, while direct owner `/raw` does not record a view; neither proves a human read the PDF. Do not represent these as immutable, complete download evidence without further changes.
- **PDF validation is minimal.** Uploads are bounded at 15 MiB and checked for the `%PDF` prefix, with sanitized storage filenames. That is a file signature check, not full PDF validation or malware inspection. Evaluate isolated scanning if uploads may come from untrusted or compromised staff accounts.
- **Deployment defaults can weaken assurances.** Production currently uses R2, but environment validation still permits production with disk storage. Production JWT audience is not pinned. Explicit storage requirements, audience/algorithm validation, and configuration checks would reduce drift. These were not demonstrated as current tenant-isolation exploits.

**Checks still required before sign-off**

| Unverified control | Required evidence |
|---|---|
| Public R2 access | Confirm `r2.dev` access disabled and enumerate all custom domains, public routes, and Worker bindings exposing this bucket. Check anonymous access on every configured ingress using a synthetic object. |
| Credential scope and lifecycle | Confirm the application's R2 key is limited to the required bucket and object operations, with documented owners and rotation; review account members and other credentials/Workers with bucket access. |
| R2 location and logging | Verify configured jurisdiction/location and any required data-access logging. Do not infer residency or audit coverage from encryption. |
| Database, logs, and backups | Verify encryption and access controls for metadata, gateway logs, and backups separately; check historical log-copy retention. |

The available R2 credentials support storage operations, but no Cloudflare management credential was present in the backend environment. The existing dashboard connection failed during inspection. An unsigned S3 HEAD returned HTTP 400 without object data; this does **not** establish that `r2.dev` or a custom domain is private. R2 public access can be enabled independently through those mechanisms. [Cloudflare public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/). Bucket-scoped credentials are supported and should be verified in the account settings. [Cloudflare R2 authentication](https://developers.cloudflare.com/r2/api/tokens/).

**Validation and development hygiene**

The [local diagnostic](/Users/michele.lucchese/Documents/Timbratore/apps/backend/scripts/assess-document-security.mjs) exercises actual routes and PostgreSQL RLS with synthetic tenants. It produced **11 PASS results and six GAP results**, grouping the latter into OTP concurrency (two), missing cache headers, orphan compensation, and database safeguards (two). Gateway logging was assessed separately in production. It refuses production mode, remote database hosts, or R2 storage; fixture cleanup was independently checked to leave zero synthetic tenants. It reports gaps rather than asserting the implementation is secure.

Run from `/Users/michele.lucchese/Documents/Timbratore/apps/backend`:

```sh
node --import tsx scripts/assess-document-security.mjs
```

Backend TypeScript validation passed with `tsc --noEmit -p apps/backend/tsconfig.json`. A backend production-dependency audit reported zero high/critical advisories and two moderate package entries from one advisory: ExcelJS's transitive `uuid` dependency. The advisory concerns buffer arguments in UUID v3/v5/v6; the installed ExcelJS source uses v4 without a supplied buffer, so exploitability on that inspected path was not demonstrated. The backend's direct UUID dependency is separate. Do not apply the audit's suggested major ExcelJS downgrade blindly. [Upstream UUID advisory](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq).

The tracked environment files inspected were examples, and the backend's production environment file was permission-restricted. This was not a full repository-history secret scan or an exhaustive penetration test. No remediation was deployed, and no application behavior was changed by this assessment.

**Recommended order:** correct gateway logging and verify bucket exposure/credential scope first; then fix OTP concurrency, cache policy, and durable upload cleanup; then strengthen database invariants and add the security cases to CI. Recheck these controls after deployment before recording a clean sign-off.
