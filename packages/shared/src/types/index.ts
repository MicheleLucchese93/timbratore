export type Role = 'admin' | 'user';

export type StampEventType =
  | 'clock_in'
  | 'clock_out'
  | 'break_start'
  | 'break_end'
  | 'lunch_start'
  | 'lunch_end';

export type StampSource =
  | 'employee_app'
  | 'employee_correction'
  | 'admin_manual';

export type MockLocationAction = 'allow' | 'flag' | 'block';

// Allowed clock-in methods per user (memberships.stamp_modes).
//   'gps'    → mobile, geofence enforced
//   'remote' → web/desktop, no geofence
//   'wifi'   → reserved, not yet implemented (see Specs/WIFI_STAMPING.md)
// An empty array means the user cannot clock in at all.
export type StampMode = 'gps' | 'remote' | 'wifi';

export interface Tenant {
  id: string;
  ragione_sociale: string;
  country: string;
  timezone: string;
  language: string;
  ccnl: string | null;
  retention_years: number;
  max_admins: number;
  max_users: number;
  max_branches: number;
  mock_location_action: MockLocationAction;
  deleted_at: string | null;
  created_at: string;
}

export interface Membership {
  id: string;
  tenant_id: string;
  user_id: string;
  role: Role;
  active: boolean;
  stamp_modes: StampMode[];
  deleted_at: string | null;
  created_at: string;
}

export interface Branch {
  id: string;
  tenant_id: string;
  name: string;
  address: string | null;
  address_components: Record<string, unknown> | null;
  latitude: number | null;
  longitude: number | null;
  radius_m: number;
  enforce_radius: boolean;
  smart_working: boolean;
  timezone: string | null;
  active: boolean;
  ordering: number;
  deleted_at: string | null;
  created_at: string;
}

export interface Stamp {
  id: string;
  tenant_id: string;
  user_id: string;
  event_type: StampEventType;
  occurred_at: string;
  source: StampSource;
  branch_id: string | null;
  latitude: number | null;
  longitude: number | null;
  gps_accuracy_m: number | null;
  device_platform: string | null;
  device_app_version: string | null;
  suspicious_mock_location: boolean;
  notes: string | null;
  queued_hours: number | null;
  reminder_sent_at: string | null;
  deleted_at: string | null;
  deleted_by_user_id: string | null;
  deletion_reason: string | null;
  created_at: string;
}

export type IsoDayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface ShiftTemplateSlot {
  id: string;
  shift_template_id: string;
  tenant_id: string;
  day_of_week: IsoDayOfWeek;
  start_time: string;
  end_time: string;
}

export interface ShiftTemplate {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  tolerance_in_min: number;
  tolerance_out_min: number;
  expected_break_min_min: number;
  expected_break_max_min: number;
  expected_lunch_min_min: number;
  expected_lunch_max_min: number;
  extraordinary_threshold_min: 15 | 30 | 60;
  count_extraordinary: boolean;
  tolerance_in_breach_deduct_min: number;
  tolerance_out_breach_deduct_min: number;
  tolerance_break_breach_deduct_min: number;
  active: boolean;
  deleted_at: string | null;
  created_at: string;
  slots?: ShiftTemplateSlot[];
}

export interface UserShiftAssignment {
  id: string;
  tenant_id: string;
  user_id: string;
  shift_template_id: string;
  valid_from: string;
  valid_to: string | null;
  created_at: string;
  template_name?: string;
}

export type ShiftAnomalyKind =
  | 'missing_clock_in'
  | 'missing_clock_out'
  | 'late_clock_in'
  | 'early_clock_out'
  | 'worked_on_rest_day'
  | 'break_too_short'
  | 'break_too_long'
  | 'lunch_too_short'
  | 'lunch_too_long';

export interface ShiftAnomaly {
  date: string;
  user_id: string;
  user_email: string;
  user_display_name: string | null;
  shift_template_id: string | null;
  shift_template_name: string | null;
  kind: ShiftAnomalyKind;
  expected_start_at: string | null;
  expected_end_at: string | null;
  actual_start_at: string | null;
  actual_end_at: string | null;
  delta_minutes: number | null;
  break_total_min: number | null;
  lunch_total_min: number | null;
  details: string | null;
}

export interface CorrectionRequest {
  id: string;
  tenant_id: string;
  user_id: string;
  original_stamp_id: string | null;
  claimed_event_type: StampEventType;
  claimed_occurred_at: string;
  claimed_branch_id: string | null;
  justification: string;
  status: 'pending' | 'approved' | 'rejected' | 'superseded';
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
}

export interface ApiEnvelope<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: { code: string; message: string; details?: unknown };
}

export type ApiResponse<T> = ApiEnvelope<T> | ApiError;
