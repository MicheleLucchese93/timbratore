// Calendar dates in the *browser's* local zone — which for this product is the
// same wall-clock the employee stamped in.
//
// `new Date().toISOString().slice(0, 10)` answers in UTC instead. In Europe/Rome
// that is the previous day for the whole 00:00–02:00 window (00:00–01:00 in
// winter), so a filter default or a date prefill silently reads yesterday for
// anyone working past midnight.

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local calendar day of `d` as 'YYYY-MM-DD'. */
export function isoLocalDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local calendar day `n` days before today, as 'YYYY-MM-DD'. */
export function isoLocalDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoLocalDate(d);
}

/** Value for an <input type="datetime-local">: local 'YYYY-MM-DDTHH:MM'.
 *
 *  The input renders and re-parses this string in the browser's zone, so it has
 *  to be written in that zone too. Feeding it `toISOString().slice(0, 16)` shows
 *  the UTC wall-clock and — because `new Date(value)` on the way back reads it as
 *  local — silently shifts the instant by the zone offset on every save. */
export function localDateTimeInputValue(d: Date = new Date()): string {
  return `${isoLocalDate(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
