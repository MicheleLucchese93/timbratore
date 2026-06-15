// Per-user HR documents (cedolini, CU, contratti, comunicazioni, altro).
//
// Admin uploads a PDF for a specific employee; the employee reads it from
// their Documents section. Storage is R2 (object per document), metadata in
// the `documents` table. A `document_views` row records the first time the
// owning employee opens a document — admins viewing never count as a view.
//
// Dependency-free on purpose: this module is consumed as source by web (Vite),
// mobile (Expo) and the backend alike. Timestamps are ISO-8601 strings.

export type DocumentCategory =
  | 'cedolino'
  | 'cu'
  | 'contratto'
  | 'comunicazione'
  | 'altro';

/** Canonical ordered list of categories, for selectors and validation. */
export const DOCUMENT_CATEGORIES: DocumentCategory[] = [
  'cedolino',
  'cu',
  'contratto',
  'comunicazione',
  'altro',
];

/** A single stored document, mirroring the `documents` table row. */
export interface DocumentRecord {
  id: string;
  tenant_id: string;
  /** Target employee (owner) the document belongs to. */
  user_id: string;
  /** Admin who uploaded the document. */
  uploaded_by: string;
  category: DocumentCategory;
  title: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  r2_key: string;
  /** created_at + 36 months; the retention cron hard-deletes past this. */
  retention_until: string;
  created_at: string;
  deleted_at: string | null;
}

/**
 * A document as seen by its owning employee: the record plus when (if ever)
 * they first opened it. `viewed_at` is null until the first download.
 */
export interface DocumentListItem extends DocumentRecord {
  viewed_at: string | null;
}

/**
 * A document as seen by an admin: adds the view count and a display name for
 * the target employee. Admin reads never mutate `viewed_at` / `view_count`.
 */
export interface DocumentAdminItem extends DocumentListItem {
  view_count: number;
  user_display_name?: string;
}
