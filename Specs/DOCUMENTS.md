# Per-user HR documents — feature spec

**Status:** APPROVED — foundation in progress. Author: product dev, 2026-06-15.
**Migration:** `041_documents.sql`.
**Shared types:** `packages/shared/src/documents/index.ts`.

---

## 1. Use case

An admin uploads a PDF (cedolino, CU, contratto, comunicazione, altro) for a
specific employee. The employee finds it in their **Documenti** section (mobile
tab + web My Dashboard). Each document targets exactly one employee. This is the
sonoQui replacement for emailing payslips around.

Storage: one R2 object per document. Metadata in Postgres (`documents`). A
`document_views` row records the first time the **owning employee** opens a
document. Admin reads never count as a view.

## 2. Locked product decisions

- **File type:** PDF only, max **15 MB** per file. Other types rejected
  server-side (`%PDF` magic-byte check + size check).
- **Categories** (fixed lowercase enum): `cedolino` · `cu` · `contratto` ·
  `comunicazione` · `altro`.
- **Uploader:** ADMIN only.
- **Bulk upload (web admin):** admin drops MANY PDFs at once; the client
  auto-matches each filename to a user by `codice_fiscale` or `matricola`
  substring (both live on `memberships`, exposed via the users API), shows a
  mapping preview with manual override for unmatched files, then on confirm
  loops **one POST per file**. No FormData support is added to `api.ts` — files
  are sent as raw binary, exactly like the xlsx user import.
- **Retention:** `retention_until = created_at + 36 months`. A **daily cron**
  hard-deletes (R2 object + DB row) where `retention_until < now()` AND
  `deleted_at IS NULL`.
- **Download:** via short-lived presigned GET URL (TTL 60s).
- **Notifications:** email + push, **BOTH default ON**, per-user opt-out.
  - Email toggle surfaced on web Settings + mobile Profilo.
  - Push toggle on mobile Profilo.
  - Note: `email_documents` defaulting to ON **diverges** from the usual
    email-opt-IN default elsewhere — intentional, a new HR document matters.
- **Replace / correct:** admin DELETE + re-upload (new row). No in-place edit,
  no versioning.
- **Mobile gate:** the Documents section requires **biometric auth every time it
  opens** (on focus), independent of the global app-lock toggle.
  Device-passcode fallback; block with a clear message only if neither
  biometric nor passcode is available.
- **Views:** admin views NEVER count. Enforced in the download endpoint — a view
  row is inserted only when `role==='user'` AND `doc.user_id===caller`.

## 3. Data model (`041_documents.sql`)

### `documents`
| column | type | notes |
|---|---|---|
| id | uuid PK | `gen_random_uuid()` |
| tenant_id | uuid NOT NULL | `REFERENCES tenants(id)` |
| user_id | uuid NOT NULL | target employee (owner) |
| uploaded_by | uuid NOT NULL | admin who uploaded |
| category | text NOT NULL | CHECK in the 5-value enum |
| title | text NOT NULL | |
| original_filename | text NOT NULL | |
| mime_type | text NOT NULL | |
| size_bytes | bigint NOT NULL | |
| r2_key | text NOT NULL | `tenants/{tenant}/documents/{doc}/{file}` |
| retention_until | timestamptz NOT NULL | created_at + 36 months |
| deleted_at | timestamptz | soft-delete marker |
| created_at | timestamptz NOT NULL | `now()` |

Indexes: `(tenant_id, user_id, created_at DESC) WHERE deleted_at IS NULL`;
`(retention_until) WHERE deleted_at IS NULL` (for the retention cron).

### `document_views`
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid NOT NULL | `REFERENCES tenants(id)` |
| document_id | uuid NOT NULL | `REFERENCES documents(id) ON DELETE CASCADE` |
| user_id | uuid NOT NULL | the employee who opened it |
| viewed_at | timestamptz NOT NULL | `now()` |

`UNIQUE (document_id, user_id)` — first open wins, `ON CONFLICT DO NOTHING`.

### RLS
- `documents` SELECT: `tenant_id = auth.tenant_id() AND (auth.is_admin() OR user_id = auth.uid())`.
- `documents` INSERT/UPDATE/DELETE: `auth.is_admin() AND tenant_id = auth.tenant_id()`.
- `document_views` SELECT/INSERT: `user_id = auth.uid() AND tenant_id = auth.tenant_id()`.
  Admin view aggregates for the admin list are computed server-side (service role).

### Notification preferences
`user_preferences.notification_preferences` jsonb gains `push_documents` (default
true) and `email_documents` (default true). Default rewritten + existing rows
backfilled (existing keys win; idempotent) — same pattern as migrations 021/030.

## 4. API contract (FROZEN)

Base: `/api/v1/documents` — all routes go through standard `authenticate`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/v1/documents` | admin | raw binary body (`express.raw({type:'*/*', limit:'15mb'})`), metadata in headers |
| GET | `/api/v1/documents?user_id=` | admin | `DocumentAdminItem[]`, optional filter, never records a view |
| GET | `/api/v1/documents/me` | employee | `DocumentListItem[]` WHERE `user_id = req.user.id`, never records a view |
| GET | `/api/v1/documents/:id/download` | admin or owning employee | presigned GET URL (TTL 60s); inserts a view only for owning employee |
| DELETE | `/api/v1/documents/:id` | admin | soft-delete row + delete R2 object |

**POST upload headers** (body is the binary PDF):
- `X-Doc-User-Id` — target employee uuid
- `X-Doc-Category` — one of the enum
- `X-Doc-Title` — `decodeURIComponent`
- `X-Doc-Filename` — `decodeURIComponent` (original filename)

Validation (Zod on headers): `%PDF` magic bytes; size ≤ 15 MB; `user_id` is a
real active member of the tenant; valid category. Transport mirrors
`POST /api/v1/users/import` (raw binary xlsx).

Effect: PUT object to R2 at
`tenants/{tenant_id}/documents/{document_id}/{sanitized_filename}`; insert row
with `retention_until = now() + interval '36 months'`; fire
`notifyDocumentUploaded` (fire-and-forget).

**Responses** wrap data: `{ ok:true, data: <Document> }`,
`{ ok:true, data: DocumentAdminItem[] }`, `{ ok:true, data: DocumentListItem[] }`,
`{ ok:true, data: { url, expires_in } }`, `{ ok:true, data: { id } }`.

**Error codes** (`packages/shared/src/error-codes.ts`):
`DOCUMENT_NOT_FOUND`, `DOCUMENT_INVALID_FILE`.

**Push payload** for the new-doc push: `{ kind: 'document', document_id }`.

## 5. Shared types (`packages/shared/src/documents/index.ts`)

```ts
type DocumentCategory = 'cedolino' | 'cu' | 'contratto' | 'comunicazione' | 'altro';
const DOCUMENT_CATEGORIES: DocumentCategory[];
interface DocumentRecord   { id; tenant_id; user_id; uploaded_by; category; title;
                             original_filename; mime_type; size_bytes; r2_key;
                             retention_until; created_at; deleted_at }
interface DocumentListItem  extends DocumentRecord  { viewed_at: string | null }
interface DocumentAdminItem extends DocumentListItem { view_count: number;
                                                       user_display_name?: string }
```
Timestamps are ISO-8601 strings.

## 6. Out of scope / follow-ups

- Backend routes (`apps/backend/src/routes/documents.ts`), R2 client wiring,
  `notifyDocumentUploaded`, retention cron — separate work items.
- Web admin upload UI + bulk matcher; web employee list — separate.
- Mobile Documents tab + biometric gate — separate.
- In-app manual (`apps/web/src/pages/Manual.tsx`) + e2e Playwright coverage must
  be updated when the user-facing UI lands (per repo policy).
