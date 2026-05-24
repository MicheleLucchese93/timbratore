import { createHash } from 'node:crypto';
import { pool } from '../lib/db.js';
import { env } from '../env.js';
import { ExternalServiceError } from '../errors/index.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('geocoding');

let lastCallAt = 0;
const MIN_INTERVAL_MS = 1000;

export interface GeocodeResult {
  lat: number;
  lng: number;
  components: Record<string, unknown>;
}

function hashAddr(addr: string): string {
  return createHash('sha256').update(addr.trim().toLowerCase()).digest('hex');
}

export async function forwardGeocode(address: string): Promise<GeocodeResult> {
  const h = hashAddr(address);
  const cached = await pool.query(
    `SELECT result FROM geocode_cache
     WHERE address_hash = $1 AND created_at > now() - interval '90 days'`,
    [h]
  );
  if (cached.rowCount && cached.rows[0]) return cached.rows[0].result;

  const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastCallAt));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();

  const url =
    'https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=' +
    encodeURIComponent(address);
  let body: Array<{ lat: string; lon: string; address: Record<string, unknown> }>;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': env.NOMINATIM_USER_AGENT },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error(`nominatim status ${r.status}`);
    body = (await r.json()) as typeof body;
  } catch (err) {
    logger.warn({ err }, 'nominatim failed');
    throw new ExternalServiceError('Geocoding service unavailable', 'GEOCODING_UNAVAILABLE');
  }
  if (body.length === 0) throw new ExternalServiceError('Address not found', 'GEOCODING_UNAVAILABLE');
  const hit = body[0]!;
  const result: GeocodeResult = {
    lat: Number(hit.lat),
    lng: Number(hit.lon),
    components: hit.address,
  };
  await pool.query(
    `INSERT INTO geocode_cache(address_hash, result, created_at)
     VALUES ($1, $2, now())
     ON CONFLICT (address_hash) DO UPDATE SET result = EXCLUDED.result, created_at = now()`,
    [h, result]
  );
  return result;
}
