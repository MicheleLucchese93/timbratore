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
