export type Role = 'admin' | 'user';

export type StampEventType =
  | 'clock_in'
  | 'clock_out'
  | 'break_start'
  | 'break_end';

export type StampSource =
  | 'employee_app'
  | 'employee_correction'
  | 'admin_manual';

export type GeofencePolicy = 'lenient' | 'strict';

export type MockLocationAction = 'allow' | 'flag' | 'block';

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
  geofence_policy: GeofencePolicy;
  gps_accuracy_ceiling_m: number;
  mock_location_action: MockLocationAction;
  break_paid_threshold_min: number;
  max_shift_hours: number;
  max_break_hours: number;
  deleted_at: string | null;
  created_at: string;
}

export interface Membership {
  id: string;
  tenant_id: string;
  user_id: string;
  role: Role;
  active: boolean;
  disable_desktop_clock_in: boolean;
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
