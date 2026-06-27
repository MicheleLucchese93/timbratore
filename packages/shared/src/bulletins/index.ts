// Bacheca: company bulletin board.
//
// An admin publishes a rich-text message (HTML, sanitized server-side) to all
// members or a chosen subset, optionally scheduled between start_at and end_at.
// Every member reads live messages from their Bacheca surface and explicitly
// marks each one read; the admin sees how many — and who — have read it.
//
// Dependency-free on purpose: consumed as source by web (Vite), mobile (Expo)
// and the backend alike. Timestamps are ISO-8601 strings.

/** A bulletin row, mirroring the `bulletins` table. */
export interface BulletinRecord {
  id: string;
  tenant_id: string;
  /** Plain-text heading: list title + email subject + push title. */
  title: string;
  /** Sanitized HTML body (server-side allowlist). Safe to render. */
  body_html: string;
  /** true = every active member (incl. future joiners); false = bulletin_targets. */
  target_all: boolean;
  /** null = live immediately. */
  start_at: string | null;
  /** null = never expires. */
  end_at: string | null;
  notify_email: boolean;
  notify_push: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * A bulletin as seen by a member on their Bacheca surface: the message plus
 * their own read state. `read_at` is null until they mark it read.
 */
export interface BulletinFeedItem {
  id: string;
  title: string;
  body_html: string;
  start_at: string | null;
  end_at: string | null;
  created_at: string;
  read: boolean;
  read_at: string | null;
}

/**
 * A bulletin as seen by an admin on the management page: adds recipient + read
 * counts and a derived status. `read_count` never counts the author's view —
 * only explicit member read receipts.
 */
export interface BulletinAdminItem extends BulletinRecord {
  recipient_count: number;
  read_count: number;
}

/** A single read receipt with the reader's display info, for the who-read view. */
export interface BulletinReader {
  user_id: string;
  email: string | null;
  display_name: string | null;
  read_at: string;
}

/** A resolved recipient of a bulletin, with whether they have read it yet. */
export interface BulletinRecipient {
  user_id: string;
  email: string | null;
  display_name: string | null;
  read_at: string | null;
}

/** Lightweight member option for the destination-user picker. */
export interface BulletinRecipientOption {
  user_id: string;
  email: string | null;
  display_name: string | null;
  active: boolean;
}

export const BULLETIN_TITLE_MAX = 200;
export const BULLETIN_BODY_MAX = 50_000;
