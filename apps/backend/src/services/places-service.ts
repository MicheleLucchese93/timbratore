import { env } from '../env.js';
import { ExternalServiceError, ValidationError } from '../errors/index.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('places');

const BASE_URL = 'https://places.googleapis.com/v1';
const SEARCH_FIELDS = 'places.id,places.displayName,places.formattedAddress';
const DETAILS_FIELDS =
  'id,displayName,formattedAddress,internationalPhoneNumber,websiteUri,location';

export interface PlaceSuggestion {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
}

export interface PlaceDetail {
  place_id: string;
  description: string;
  display_name: string | null;
  formatted_address: string | null;
  phone: string | null;
  website: string | null;
  geometry: { location: { lat: number; lng: number } } | null;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const TTL_MS = 60 * 60 * 1000;
const searchCache = new Map<string, CacheEntry<PlaceSuggestion[]>>();
const detailsCache = new Map<string, CacheEntry<PlaceDetail>>();

function getCached<T>(map: Map<string, CacheEntry<T>>, key: string): T | null {
  const hit = map.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    map.delete(key);
    return null;
  }
  return hit.value;
}

function setCached<T>(map: Map<string, CacheEntry<T>>, key: string, value: T): void {
  map.set(key, { value, expiresAt: Date.now() + TTL_MS });
}

function requireKey(): string {
  if (!env.GOOGLE_MAPS_API_KEY) {
    throw new ExternalServiceError('Google Maps API key not configured', 'PLACES_UNAVAILABLE');
  }
  return env.GOOGLE_MAPS_API_KEY;
}

function stripPlaceId(id: string): string {
  return id.startsWith('places/') ? id.slice(7) : id;
}

function extractDisplayName(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'text' in value) {
    const t = (value as { text?: unknown }).text;
    return typeof t === 'string' ? t : '';
  }
  return '';
}

export async function searchPlaces(query: string): Promise<PlaceSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];
  const cached = getCached(searchCache, trimmed.toLowerCase());
  if (cached) return cached;
  const apiKey = requireKey();

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/places:searchText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': SEARCH_FIELDS,
      },
      body: JSON.stringify({ textQuery: trimmed, pageSize: 20 }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    logger.warn({ err }, 'google places search fetch failed');
    throw new ExternalServiceError('Places search unavailable', 'PLACES_UNAVAILABLE');
  }
  if (!response.ok) {
    logger.warn({ status: response.status }, 'google places search non-200');
    throw new ExternalServiceError('Places search unavailable', 'PLACES_UNAVAILABLE');
  }
  const body = (await response.json()) as {
    places?: Array<{
      id?: string;
      name?: string;
      displayName?: unknown;
      formattedAddress?: string;
    }>;
  };
  const places = body.places ?? [];
  const results: PlaceSuggestion[] = [];
  for (const p of places) {
    const rawId = p.id ?? p.name ?? '';
    if (!rawId) continue;
    const placeId = stripPlaceId(rawId);
    const displayName = extractDisplayName(p.displayName);
    const formattedAddress = p.formattedAddress ?? '';
    const description = formattedAddress
      ? displayName
        ? `${displayName}, ${formattedAddress}`
        : formattedAddress
      : displayName;
    if (!description) continue;
    results.push({
      place_id: placeId,
      description,
      structured_formatting: {
        main_text: displayName || formattedAddress,
        secondary_text: displayName ? formattedAddress : '',
      },
    });
  }
  setCached(searchCache, trimmed.toLowerCase(), results);
  return results;
}

export async function getPlaceDetails(placeId: string): Promise<PlaceDetail> {
  const clean = stripPlaceId(placeId.trim());
  if (!clean) throw new ValidationError('placeId is required');
  const cached = getCached(detailsCache, clean);
  if (cached) return cached;
  const apiKey = requireKey();

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/places/${encodeURIComponent(clean)}`, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': DETAILS_FIELDS,
      },
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    logger.warn({ err }, 'google places details fetch failed');
    throw new ExternalServiceError('Places details unavailable', 'PLACES_UNAVAILABLE');
  }
  if (!response.ok) {
    logger.warn({ status: response.status }, 'google places details non-200');
    throw new ExternalServiceError('Places details unavailable', 'PLACES_UNAVAILABLE');
  }
  const body = (await response.json()) as {
    id?: string;
    name?: string;
    displayName?: unknown;
    formattedAddress?: string;
    internationalPhoneNumber?: string;
    websiteUri?: string;
    location?: { latitude?: number; longitude?: number };
  };
  const id = stripPlaceId(body.id ?? body.name ?? clean);
  const displayName = extractDisplayName(body.displayName) || null;
  const formattedAddress = body.formattedAddress ?? null;
  const description = formattedAddress
    ? displayName
      ? `${displayName}, ${formattedAddress}`
      : formattedAddress
    : displayName ?? '';
  const lat = body.location?.latitude;
  const lng = body.location?.longitude;
  const geometry =
    typeof lat === 'number' && typeof lng === 'number'
      ? { location: { lat, lng } }
      : null;

  const detail: PlaceDetail = {
    place_id: id,
    description,
    display_name: displayName,
    formatted_address: formattedAddress,
    phone: body.internationalPhoneNumber ?? null,
    website: body.websiteUri ?? null,
    geometry,
  };
  setCached(detailsCache, clean, detail);
  return detail;
}
