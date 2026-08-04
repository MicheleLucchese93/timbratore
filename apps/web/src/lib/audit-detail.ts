// Turns the raw before/after JSON of an audit_log row into something an admin
// can read: Italian field labels, formatted dates/times, enum values resolved to
// their UI labels, and — when the row carries both snapshots — only the fields
// that actually changed, rendered as "prima → dopo".
//
// The payload vocabulary is whatever the backend handed to logAudit(), which for
// several actions is a whole DB row. Everything here therefore degrades: an
// unknown key falls back to a humanized version of itself, an unknown enum value
// falls back to the raw string, and internal columns (ids, tenant_id, …) are
// dropped so they never reach the grid.
import { fmtDate, fmtDateTime, fmtNumber, localeTag } from '../i18n/format.ts';

export type TFn = (key: string, opts?: Record<string, unknown>) => string;

/** The subset of an audit entry this module needs. */
export interface AuditRowLike {
  action: string;
  before: unknown;
  after: unknown;
}

/** One rendered row of the detail table. `prev` is set only in diff mode. */
export interface AuditField {
  key: string;
  label: string;
  value: string;
  prev: string | null;
  /** True when the field is background info, kept out of the compact summary. */
  minor: boolean;
}

const DT: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

// Internal plumbing: never shown, in the grid or in the dialog. Foreign keys are
// dropped by the generic `_id` rule below; these are the named exceptions.
const HIDDEN = new Set([
  'id',
  'tenant_id',
  'user_id',
  'created_at',
  'updated_at',
  'created_by',
  'deleted_at',
  'address_components',
  'notified_at',
  // The bulletin body is HTML and can be pages long — the Bacheca page shows it.
  'body_html',
  'reminder_sent_at',
  'queued_hours',
]);

// Flags that describe how the operation was performed rather than what it
// changed. They are identical in both snapshots, so the diff would drop them —
// but "this was a bulk edit" is worth keeping on the entry.
const CONTEXT = new Set(['bulk']);

// Shown in the dialog, never in the one-line summary: true but rarely the point.
const MINOR = new Set([
  'bulk',
  'latitude',
  'longitude',
  'gps_accuracy_m',
  'geofence_distance_m',
  'device_platform',
  'device_app_version',
  'edit_count',
  'edited_at',
  'timezone',
  'ordering',
  'position',
  'key',
]);

// What matters first, per action family. Everything not listed keeps its
// payload order after these.
const PRIORITY: Record<string, string[]> = {
  'stamp.': ['event_type', 'occurred_at', 'source', 'notes', 'deletion_reason', 'date', 'stamps'],
  'anomaly.': ['kind', 'date', 'note'],
  'correction.': ['event_type', 'occurred_at', 'is_edit', 'note'],
  'leave.': ['type', 'date_from', 'date_to', 'status', 'reason', 'user_count'],
  'leave_quota.': [
    'name',
    'type',
    'hours_default',
    'initial_balance',
    'started_on',
    'accrual_amount',
    'accrual_frequency',
  ],
  'shift_template.': ['name', 'slots', 'active', 'break_enabled', 'description'],
  'shift_assignment.': ['valid_from', 'valid_to'],
  'branch.': ['name', 'address', 'radius_m', 'enforce_radius', 'smart_working', 'active'],
  'bulletin.': ['title', 'start_at', 'end_at', 'target_all', 'notify_email', 'notify_push'],
  'cantiere.': ['name', 'address', 'status', 'user_ids'],
  'mezzo.': ['name', 'user_ids', 'custom_values'],
  'cantieri_field.': ['label', 'field_type', 'required', 'scope', 'cantiere_ids'],
  'cantiere_entry.': [
    'entry_date',
    'activity_text',
    'activity_start',
    'activity_end',
    'travel_start',
    'travel_end',
    'custom_values',
  ],
  'export.': ['format', 'period_from', 'period_to', 'filename'],
  'document.': ['title', 'filename', 'category'],
  'user.': [
    'email',
    'role',
    'first_name',
    'last_name',
    'external_id',
    'stamp_modes',
    'cantieri_role',
    'is_documentale',
    'branch_ids',
    'approver_user_ids',
  ],
};

// Candidate i18n prefixes per payload key, tried in order. Shared vocabularies
// live in the `common` namespace so the Registro reads exactly like the page the
// value came from; audit-only ones are in `value.*` of the audit namespace.
const VALUE_KEYS: Record<string, string[]> = {
  event_type: ['common:stampEvent.'],
  original_event_type: ['common:stampEvent.'],
  claimed_event_type: ['common:stampEvent.'],
  kind: ['common:anomaly.'],
  anomaly_kind: ['common:anomaly.'],
  role: ['common:role.'],
  cantieri_role: ['common:role.'],
  status: ['value.status.', 'common:status.'],
  type: ['common:leaveType.', 'value.type.'],
  source: ['value.source.'],
  format: ['value.format.'],
  category: ['value.category.'],
  field_type: ['value.field_type.'],
  scope: ['value.scope.'],
  geofence_policy: ['value.geofence_policy.'],
  accrual_frequency: ['value.accrual_frequency.'],
  stamp_modes: ['value.stamp_mode.'],
  is_edit: ['value.is_edit.'],
};

/** Minutes-valued keys, so "15" reads "15 min". Suffix `_min` also matches. */
const MINUTE_SUFFIXES = ['_min', '_min_min', '_max_min'];

function isHidden(key: string): boolean {
  if (HIDDEN.has(key)) return true;
  // Foreign keys are opaque uuids; the label they point at is either the
  // Destinatario column or a name field already in the payload.
  return key.endsWith('_id') || key.endsWith('_by_user_id');
}

/** `expected_lunch_max_min` → `Expected lunch max min`. Last-resort label. */
function humanize(key: string): string {
  const s = key.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function label(key: string, t: TFn): string {
  return t(`field.${key}`, { defaultValue: '' }) || humanize(key);
}

/** First prefix that has a translation for `raw`, else the raw value. */
function enumLabel(key: string, raw: string, t: TFn): string {
  for (const prefix of VALUE_KEYS[key] ?? []) {
    const hit = t(`${prefix}${raw}`, { defaultValue: '' });
    if (hit) return hit;
  }
  return raw;
}

function isSlot(v: unknown): v is { day_of_week: number; start_time: string; end_time: string } {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.start_time === 'string' && typeof o.end_time === 'string';
}

// Short weekday name for an ISO weekday (1 = Monday … 7 = Sunday), derived from
// the locale exactly like the Orari page does — Jan 1 2024 was a Monday, so
// day-of-month `iso` lands on the matching weekday.
function dowLabel(iso: number): string {
  if (!Number.isInteger(iso) || iso < 1 || iso > 7) return String(iso);
  const s = new Date(Date.UTC(2024, 0, iso)).toLocaleDateString(localeTag(), { weekday: 'short' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** `Lun 08:30–12:30, 14:00–18:00 · Mar …` from the shift_templates.slots array. */
function formatSlots(slots: unknown[], t: TFn): string {
  const byDay = new Map<number, string[]>();
  for (const s of slots) {
    if (!isSlot(s)) continue;
    const day = Number(s.day_of_week);
    const list = byDay.get(day) ?? [];
    list.push(`${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`);
    byDay.set(day, list);
  }
  if (byDay.size === 0) return t('detail.none');
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, ranges]) => `${dowLabel(day)} ${ranges.join(', ')}`)
    .join(' · ');
}

function formatArray(key: string, arr: unknown[], t: TFn): string {
  if (arr.length === 0) return t('detail.none');
  if (key === 'slots') return formatSlots(arr, t);
  // Lists of references (user_ids, branch_ids, cantiere_ids, …) say nothing as
  // uuids — the count is the only readable fact.
  if (arr.every((v) => typeof v === 'string' && UUID_RE.test(v))) {
    return t('detail.selected', { count: arr.length });
  }
  return arr.map((v) => formatValue(key, v, t)).join(', ');
}

/** `{ore_lavorate: 9}` → `Ore lavorate: 9`. Used for cantieri custom_values. */
function formatObject(obj: Record<string, unknown>, t: TFn): string {
  const parts = Object.entries(obj)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${label(k, t)}: ${formatValue(k, v, t)}`);
  return parts.length ? parts.join(' · ') : t('detail.none');
}

export function formatValue(key: string, v: unknown, t: TFn): string {
  if (v === null || v === undefined || v === '') return t('detail.empty');
  // Enum lookup runs before the type branches so a key with its own vocabulary
  // (is_edit reads as a request kind, not as a yes/no) wins over the default.
  if (VALUE_KEYS[key] && !Array.isArray(v) && typeof v !== 'object') {
    return enumLabel(key, String(v), t);
  }
  if (typeof v === 'boolean') return t(v ? 'common:btn.yes' : 'common:btn.no');
  if (typeof v === 'number') {
    if (MINUTE_SUFFIXES.some((s) => key.endsWith(s))) return t('detail.minutes', { n: v });
    if (key.endsWith('_m')) return t('detail.meters', { n: v });
    return fmtNumber(v);
  }
  if (Array.isArray(v)) return formatArray(key, v, t);
  if (typeof v === 'object') return formatObject(v as Record<string, unknown>, t);
  const s = String(v);
  if (ISO_DATETIME_RE.test(s)) return fmtDateTime(s, DT);
  if (ISO_DATE_RE.test(s)) return fmtDate(s);
  if (TIME_RE.test(s)) return s.slice(0, 5);
  if (UUID_RE.test(s)) return t('detail.empty');
  return s;
}

/** Key-order-independent comparison, so a reordered snapshot isn't a "change". */
function stable(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (typeof v === 'object') {
    return `{${Object.entries(v as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, val]) => `${k}:${stable(val)}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function priorityOf(action: string): string[] {
  const family = Object.keys(PRIORITY).find((p) => action.startsWith(p));
  return (family ? PRIORITY[family] : undefined) ?? [];
}

/**
 * The readable fields of one audit entry.
 *
 * With both snapshots (admin edits) only the changed fields are returned, each
 * carrying its previous value. With one snapshot (creations, deletions, decision
 * payloads) every non-empty field is returned with `prev = null`.
 */
export function auditFields(row: AuditRowLike, t: TFn): AuditField[] {
  const before = asObject(row.before);
  const after = asObject(row.after);
  const diff = before !== null && after !== null;

  // A non-object payload (legacy rows stored a bare string/number) has no
  // fields to name — surface it as a single unlabeled line.
  if (!before && !after) {
    const raw = row.after ?? row.before;
    if (raw === null || raw === undefined) return [];
    return [
      { key: '_raw', label: t('detail.value'), value: String(raw), prev: null, minor: false },
    ];
  }

  const source = after ?? before!;
  const keys = diff ? [...new Set([...Object.keys(before!), ...Object.keys(after!)])] : Object.keys(source);
  const order = priorityOf(row.action);
  const rank = (k: string) => {
    const i = order.indexOf(k);
    return i === -1 ? order.length : i;
  };

  return keys
    .filter((k) => !isHidden(k))
    .filter((k) => {
      const v = source[k];
      const present = v !== null && v !== undefined && v !== '';
      if (!diff) return present;
      return stable(before![k]) !== stable(after![k]) || (CONTEXT.has(k) && present);
    })
    .sort((a, b) => rank(a) - rank(b) || keys.indexOf(a) - keys.indexOf(b))
    .map((k) => {
      // An unchanged context flag has no "prima" to show — render it as a plain
      // value so the Prima column stays empty for it.
      const changed = !diff || stable(before![k]) !== stable(after![k]);
      return {
        key: k,
        label: label(k, t),
        value: formatValue(k, (after ?? before!)[k], t),
        prev: diff && changed ? formatValue(k, before![k], t) : null,
        minor: MINOR.has(k),
      };
    });
}

/** The fields worth putting in the grid cell: significant ones, capped. */
export function summaryFields(row: AuditRowLike, t: TFn, max = 4): AuditField[] {
  const all = auditFields(row, t);
  const significant = all.filter((f) => !f.minor);
  return (significant.length ? significant : all).slice(0, max);
}

/** Plain-text rendering of {@link summaryFields}, for tooltips and sorting. */
export function auditSummaryText(row: AuditRowLike, t: TFn, max = 4): string {
  return summaryFields(row, t, max)
    .map((f) => (f.prev !== null ? `${f.label}: ${f.prev} → ${f.value}` : `${f.label}: ${f.value}`))
    .join(' · ');
}
