import { isValidPartitaIva, normalizePartitaIva } from '@sonoqui/shared';
import { env } from '../env.js';
import { createLogger } from './logger.js';

const logger = createLogger('vat');

/**
 * Result of checking an Italian P.IVA against the EU VIES service.
 *
 * - valid        VIES confirms it; name/address usually come back too.
 * - not_in_vies  VIES says "not valid". For an Italian number with a correct
 *                check digit this mostly means the company never opted in to
 *                intra-EU trade (Italian VAT numbers enter VIES only on request,
 *                and drop out after four quarters without intra-EU filings), so
 *                it is ACCEPTED and flagged for review, never rejected (D2).
 * - unavailable  VIES or the Italian member-state service did not answer;
 *                accepted and re-checked later by the vies-recheck job.
 */
export type VatStatus = 'valid' | 'not_in_vies' | 'unavailable';

export interface ViesResult {
  status: VatStatus;
  partitaIva: string;
  name: string | null;
  address: string | null;
  /** VIES consultation number — the legal proof that the check was made. */
  requestIdentifier: string | null;
  checkedAt: string;
}

export interface ParsedItalianAddress {
  address: string | null;
  cap: string | null;
  city: string | null;
  province: string | null;
}

const VIES_URL = 'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; result: ViesResult }>();

/** VIES answers "---" (or blanks) where a member state does not disclose a field. */
function clean(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+\n/g, '\n').trim();
  return t && t !== '---' ? t : null;
}

/**
 * Check one Italian P.IVA on VIES. Never throws: every failure mode maps to a
 * status, because none of them may block a registration (D2). Results are
 * cached for 24h per number — VIES rate-limits by caller IP and a signup form
 * re-checks on every keystroke-pause otherwise.
 */
export async function checkVies(input: string, opts: { force?: boolean } = {}): Promise<ViesResult> {
  const piva = normalizePartitaIva(input);
  const now = new Date().toISOString();
  if (!isValidPartitaIva(piva)) {
    // Callers validate first; this is a guard, not a code path users reach.
    return { status: 'not_in_vies', partitaIva: piva, name: null, address: null, requestIdentifier: null, checkedAt: now };
  }
  const hit = cache.get(piva);
  if (!opts.force && hit && Date.now() - hit.at < CACHE_TTL_MS && hit.result.status !== 'unavailable') {
    return hit.result;
  }

  const body: Record<string, string> = { countryCode: 'IT', vatNumber: piva };
  if (env.VIES_REQUESTER_VAT) {
    body.requesterMemberStateCode = 'IT';
    body.requesterNumber = env.VIES_REQUESTER_VAT;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.VIES_TIMEOUT_MS);
  let result: ViesResult;
  try {
    const res = await fetch(VIES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    result = mapViesResponse(piva, res.status, json, now);
  } catch (err) {
    logger.warn({ err: (err as Error).message, piva }, 'VIES request failed');
    result = { status: 'unavailable', partitaIva: piva, name: null, address: null, requestIdentifier: null, checkedAt: now };
  } finally {
    clearTimeout(timer);
  }
  cache.set(piva, { at: Date.now(), result });
  return result;
}

/**
 * Map a VIES REST response. Exported for tests. The service answers 200 with
 * `valid:false` for an unknown number, and either a non-2xx or a body carrying
 * `userError`/`errorWrappers` when a member-state service is down or throttled.
 */
export function mapViesResponse(
  piva: string,
  httpStatus: number,
  json: Record<string, unknown> | null,
  checkedAt: string
): ViesResult {
  const base = { partitaIva: piva, checkedAt };
  if (!json || httpStatus >= 500 || httpStatus === 429) {
    return { ...base, status: 'unavailable', name: null, address: null, requestIdentifier: null };
  }
  const userError = typeof json.userError === 'string' ? json.userError : null;
  const wrappers = Array.isArray(json.errorWrappers) ? json.errorWrappers : [];
  const valid = json.valid === true || json.isValid === true;
  if (!valid && (wrappers.length > 0 || (userError && userError !== 'VALID' && userError !== 'INVALID'))) {
    // MS_UNAVAILABLE, TIMEOUT, MS_MAX_CONCURRENT_REQ, SERVICE_UNAVAILABLE, …
    return { ...base, status: 'unavailable', name: null, address: null, requestIdentifier: null };
  }
  if (httpStatus >= 400) {
    return { ...base, status: 'unavailable', name: null, address: null, requestIdentifier: null };
  }
  return {
    ...base,
    status: valid ? 'valid' : 'not_in_vies',
    name: valid ? clean(json.name) : null,
    address: valid ? clean(json.address) : null,
    requestIdentifier: clean(json.requestIdentifier),
  };
}

/**
 * Best-effort split of the one-string address VIES returns for Italian
 * companies ("VIA ROMA 1 \n37100 VERONA VR\n") into the fields a fattura
 * elettronica needs. Anything it can't recognise stays in `address`; the user
 * confirms every field before it is used.
 */
export function parseItalianAddress(raw: string | null | undefined): ParsedItalianAddress {
  const empty: ParsedItalianAddress = { address: null, cap: null, city: null, province: null };
  if (!raw) return empty;
  const lines = raw
    .split(/\n|,/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (lines.length === 0) return empty;
  let capLineIdx = -1;
  let cap: string | null = null;
  let city: string | null = null;
  let province: string | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^(\d{5})\s+(.+?)(?:\s+\(?([A-Z]{2})\)?)?$/.exec(lines[i]!.toUpperCase());
    if (m) {
      capLineIdx = i;
      cap = m[1]!;
      city = titleCase(m[2]!.trim());
      province = m[3] ?? null;
      break;
    }
  }
  const streetLines = capLineIdx >= 0 ? lines.slice(0, capLineIdx) : lines;
  return {
    address: streetLines.length ? titleCase(streetLines.join(', ')) : null,
    cap,
    city,
    province,
  };
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s'’\-/])([a-zà-ù])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** For tests. */
export function clearViesCache(): void {
  cache.clear();
}
