/**
 * Filename helpers for downloads (Content-Disposition).
 *
 * Third copy of the same slugifier is where it stops: cantieri reports, stamp
 * dossiers and payroll exports all need the same "turn a company / person /
 * site name into something safe on every filesystem" rule.
 */

/**
 * Lowercase ASCII slug: accents folded, every other run collapsed to a single
 * dash. `fallback` covers a name that slugs down to nothing (e.g. a company
 * written entirely in a non-Latin script).
 */
export function safeFileName(name: string, fallback = 'file', maxLen = 60): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      // Combining diacritics left behind by NFD (è → e + U+0300).
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, maxLen)
      .replace(/-+$/, '') || fallback
  );
}

/**
 * `YYYYMMDD-HHMM` in the given zone — the timestamp that goes in a download
 * name. Zoned rather than UTC so it reads as the moment the admin saw in the
 * app, and sortable so a Downloads folder orders itself.
 */
export function fileTimestamp(d: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  // Intl can render midnight as hour "24" in some locales/zones; normalise.
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}${get('month')}${get('day')}-${hour}${get('minute')}`;
}
