// Italian national public holidays (festività nazionali).
//
// Fixed-date holidays plus the two movable ones tied to Easter (Pasqua and
// Lunedì dell'Angelo / Pasquetta). Regional patron-saint holidays are NOT
// included — they vary per comune and are out of scope.
//
// Dependency-free on purpose: this module is consumed as source by web
// (Vite) and mobile (Expo) alike, so it sticks to native Date + plain math.

export interface Holiday {
  /** YYYY-MM-DD */
  date: string;
  /** Italian display name. */
  name: string;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Easter Sunday for a Gregorian year, via the Meeus/Jones/Butcher algorithm.
 * Returns 1-based month (3 = March, 4 = April) and day.
 */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function addDaysToYMD(year: number, month: number, day: number, add: number): string {
  // month is 1-based here; Date uses 0-based.
  const dt = new Date(Date.UTC(year, month - 1, day + add));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** All Italian national holidays for the given year, sorted by date. */
export function italianHolidays(year: number): Holiday[] {
  const easter = easterSunday(year);
  const pasqua = `${year}-${pad2(easter.month)}-${pad2(easter.day)}`;
  const pasquetta = addDaysToYMD(year, easter.month, easter.day, 1);

  const fixed: Holiday[] = [
    { date: `${year}-01-01`, name: 'Capodanno' },
    { date: `${year}-01-06`, name: 'Epifania' },
    { date: `${year}-04-25`, name: 'Festa della Liberazione' },
    { date: `${year}-05-01`, name: 'Festa del Lavoro' },
    { date: `${year}-06-02`, name: 'Festa della Repubblica' },
    { date: `${year}-08-15`, name: 'Ferragosto' },
    { date: `${year}-11-01`, name: 'Tutti i Santi' },
    { date: `${year}-12-08`, name: 'Immacolata Concezione' },
    { date: `${year}-12-25`, name: 'Natale' },
    { date: `${year}-12-26`, name: 'Santo Stefano' },
    { date: pasqua, name: 'Pasqua' },
    { date: pasquetta, name: "Lunedì dell'Angelo" },
  ];
  return fixed.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
}

/**
 * Holiday lookup map keyed by YYYY-MM-DD, covering every year touched by the
 * given inclusive ISO date range. Handy for calendar grids that straddle a
 * year boundary (e.g. a December→January week).
 */
export function holidayMapForRange(fromISO: string, toISO: string): Map<string, string> {
  const fromYear = Number(fromISO.slice(0, 4));
  const toYear = Number(toISO.slice(0, 4));
  const map = new Map<string, string>();
  for (let y = fromYear; y <= toYear; y++) {
    for (const h of italianHolidays(y)) map.set(h.date, h.name);
  }
  return map;
}

/** Returns the holiday name for an ISO date, or null. */
export function holidayName(iso: string): string | null {
  const year = Number(iso.slice(0, 4));
  if (!Number.isFinite(year)) return null;
  for (const h of italianHolidays(year)) {
    if (h.date === iso) return h.name;
  }
  return null;
}
