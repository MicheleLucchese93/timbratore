import { currentLang } from './index.ts';

// All date/number formatting goes through here so a single source decides the
// locale. English uses en-GB (24h clock, day/month/year order) to stay close to
// the Italian layout users are used to.
export function localeTag(): string {
  return currentLang() === 'en' ? 'en-GB' : 'it-IT';
}

type DateInput = Date | string | number;

export function fmtDateTime(d: DateInput, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(d).toLocaleString(localeTag(), opts);
}

export function fmtDate(d: DateInput, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(d).toLocaleDateString(localeTag(), opts);
}

export function fmtTime(d: DateInput, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(d).toLocaleTimeString(localeTag(), opts);
}

export function fmtNumber(n: number, opts?: Intl.NumberFormatOptions): string {
  return Number(n).toLocaleString(localeTag(), opts);
}
