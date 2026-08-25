// Shared stamp types + label helpers, used by both the Timbrature list page
// (Stamps.tsx) and the monthly grid (StampMonthGrid.tsx). Lives here so neither
// component owns the other's types (no import cycle).
import type { StampEventType } from '@sonoqui/shared';

export interface Stamp {
  id: string;
  user_id: string;
  user_email: string;
  event_type: StampEventType;
  occurred_at: string;
  source: string;
  branch_id: string | null;
  notes: string | null;
  suspicious_mock_location: boolean;
  out_of_geofence?: boolean;
  // Edit provenance (migration 059). `original_occurred_at` is the value the
  // employee actually stamped; it stays null for a punch nobody ever moved, so
  // "was this modified?" is a null check and not a history round trip.
  original_occurred_at?: string | null;
  original_event_type?: StampEventType | null;
  edited_at?: string | null;
  edit_count?: number;
  edited_by_name?: string | null;
  deleted_at?: string | null;
  deletion_reason?: string | null;
  deleted_by_name?: string | null;
}

/** The provenance subset every stamp-shaped row shares (list, grid, dossier). */
export interface StampProvenance {
  original_occurred_at?: string | null;
  original_event_type?: string | null;
  edited_at?: string | null;
  edited_by_name?: string | null;
  deleted_at?: string | null;
  deletion_reason?: string | null;
  deleted_by_name?: string | null;
}

/** True when an admin moved this punch away from what the employee stamped. */
export function isEdited(s: StampProvenance): boolean {
  return Boolean(s.original_occurred_at ?? s.original_event_type);
}

export interface Branch {
  id: string;
  name: string;
}

// /api/v1/users returns the membership + anagrafica; the grid only needs the
// identity fields. first/last/display may be null until the admin fills them in.
export interface UserRow {
  user_id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
  // Optional per-employee unique identifier ("Identificativo univoco").
  external_id?: string | null;
}

/** Best human label for a user: display name, then "First Last", then email. */
export function userLabel(u: UserRow): string {
  const full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
  return (u.display_name?.trim() || full || u.email);
}

// Order shown in every event-type <select> — clock pair first, then the two
// break kinds, mirroring the list-page form.
export const EVENT_TYPES: StampEventType[] = [
  'clock_in',
  'clock_out',
  'break_start',
  'break_end',
  'lunch_start',
  'lunch_end',
];

// Stamp origin/source values, in the order shown in the Origine filter.
export const STAMP_SOURCES = [
  'employee_app',
  'employee_correction',
  'admin_manual',
  'system_auto',
  // API module (migration 064): a punch filed by a badge reader, a turnstile or
  // a gestionale. Its own value, not admin_manual — "an administrator entered
  // this" and "a machine did" are different answers on a contested timesheet.
  'api',
] as const;

/** Localized label for a stamp source. Mirrors the list-page badge mapping. */
export function sourceLabel(s: string, t: (k: string) => string): string {
  return s === 'employee_app'
    ? t('common:origin.app')
    : s === 'employee_correction'
      ? t('common:origin.correction')
      : s === 'admin_manual'
        ? t('common:origin.admin')
        : s === 'system_auto'
          ? t('origin.auto')
          : s === 'api'
            ? t('origin.api')
            : s;
}
