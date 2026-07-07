// Cantieri module: shared types and constants used by backend, web and mobile.
// Mirrors the DB rows of migration 054 with ISO-string timestamps; times are
// Europe/Rome wall-clock 'HH:MM' strings (same convention as schedule slots).

export type CantieriRole = 'admin' | 'user';
export type CantiereStatus = 'open' | 'closed';
export type CantieriFieldScope = 'entry' | 'mezzo';
export type CantieriFieldType = 'text' | 'number' | 'date' | 'time' | 'boolean' | 'select';

export type CantieriCustomValue = string | number | boolean | null;
export type CantieriCustomValues = Record<string, CantieriCustomValue>;

export const CANTIERE_NAME_MAX = 120;
export const CANTIERE_ADDRESS_MAX = 240;
export const CANTIERE_ACTIVITY_TEXT_MAX = 2000;
export const MEZZO_NAME_MAX = 120;
export const CANTIERI_FIELD_LABEL_MAX = 80;
export const CANTIERI_FIELD_KEY_MAX = 40;
export const CANTIERI_FIELD_OPTION_MAX = 60;
export const CANTIERI_FIELD_OPTIONS_MAX = 30;
export const CANTIERI_FIELDS_PER_SCOPE_MAX = 20;
export const CANTIERE_REPORT_RECIPIENTS_MAX = 5;

export const CANTIERI_FIELD_TYPES: CantieriFieldType[] = [
  'text', 'number', 'date', 'time', 'boolean', 'select',
];

export interface CantieriFieldDef {
  id: string;
  scope: CantieriFieldScope;
  key: string;
  label: string;
  field_type: CantieriFieldType;
  options: string[] | null; // select choices
  required: boolean;
  position: number;
}

export interface CantiereRecord {
  id: string;
  name: string;
  address: string | null;
  status: CantiereStatus;
  created_at: string;
  updated_at: string;
}

export interface MezzoRecord {
  id: string;
  name: string;
  custom_values: CantieriCustomValues;
  created_at: string;
  updated_at: string;
}

export interface CantiereEntryRecord {
  id: string;
  cantiere_id: string;
  user_id: string;
  entry_date: string; // YYYY-MM-DD
  travel_start: string | null; // HH:MM
  travel_end: string | null;
  activity_start: string | null;
  activity_end: string | null;
  activity_text: string | null;
  mezzo_id: string | null;
  custom_values: CantieriCustomValues;
  created_at: string;
  updated_at: string;
}

// Derive a stable custom_values key from an admin-typed label:
// 'Tempo viaggio (min)' -> 'tempo_viaggio_min'. Uniqueness per (scope) is
// enforced by the DB; callers should suffix on conflict.
export function cantieriFieldKeyFromLabel(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, CANTIERI_FIELD_KEY_MAX) || 'campo';
}

// Minutes between two 'HH:MM' wall-clock times on the same day; null when
// either bound is missing or the range is inverted.
export function cantieriIntervalMinutes(start: string | null, end: string | null): number | null {
  const toMinutes = (v: string | null): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(v ?? '');
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  };
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === null || e === null) return null;
  const diff = e - s;
  return diff >= 0 ? diff : null;
}
