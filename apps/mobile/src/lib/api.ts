import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const ACCESS_KEY = 'sonoqui.access_token';
const REFRESH_KEY = 'sonoqui.refresh_token';
// Chosen company, sent as X-Tenant-Id on every request (users may belong to
// several). Cached in memory so we don't hit the keychain on each call.
const TENANT_KEY = 'sonoqui.tenant_id';

// Mirrors Documents/Penno/apps/mobile/src/services/secureStorage.ts —
// cold-start keychain reads throw transiently on iOS (first read after
// device boot or app-kill). A single throw, treated as "no token", was
// the bug that auto-logged users out. Retry ladder [200, 500] ms.
const SECURE_RETRY_DELAYS_MS = [200, 500];

// Proactive refresh window: rotate the access token this many seconds
// before its `exp` claim. Penno's supabase-js does the same on a timer;
// we mirror by parsing the JWT and arming a setTimeout.
const REFRESH_SKEW_SECONDS = 60;

function extra(): { apiBaseUrl?: string; authBaseUrl?: string } {
  return (Constants.expoConfig?.extra as { apiBaseUrl?: string; authBaseUrl?: string } | undefined) ?? {};
}
export function apiBaseUrl(): string {
  return extra().apiBaseUrl ?? 'http://localhost:4000';
}
export function authBaseUrl(): string {
  return extra().authBaseUrl ?? '';
}

async function storeGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  }
  const maxAttempts = 1 + SECURE_RETRY_DELAYS_MS.length;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await SecureStore.getItemAsync(key);
    } catch (e) {
      lastError = e;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, SECURE_RETRY_DELAYS_MS[attempt - 1]));
      }
    }
  }
  console.warn('[sonoqui] SecureStore read failed after retries', { key, err: String(lastError) });
  return null;
}
async function storeSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
    return;
  }
  // AFTER_FIRST_UNLOCK matches Penno — the default WHEN_UNLOCKED throws
  // "device locked" errors when the OS reads the token in the moments
  // right after a device unlock or during background → foreground.
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
}
async function storeDel(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

function decodeJwtExp(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json =
      typeof globalThis.atob === 'function'
        ? globalThis.atob(padded)
        : Buffer.from(padded, 'base64').toString('utf8');
    const parsed = JSON.parse(json) as { exp?: number };
    return typeof parsed.exp === 'number' ? parsed.exp : null;
  } catch {
    return null;
  }
}

let proactiveTimer: ReturnType<typeof setTimeout> | null = null;
function clearProactiveTimer(): void {
  if (proactiveTimer) {
    clearTimeout(proactiveTimer);
    proactiveTimer = null;
  }
}
function scheduleProactiveRefresh(accessToken: string): void {
  clearProactiveTimer();
  const exp = decodeJwtExp(accessToken);
  if (!exp) return;
  const nowSec = Math.floor(Date.now() / 1000);
  const delayMs = Math.max(0, (exp - REFRESH_SKEW_SECONDS - nowSec) * 1000);
  proactiveTimer = setTimeout(() => {
    void refreshAccessToken();
  }, delayMs);
}
export async function ensureProactiveRefreshScheduled(): Promise<void> {
  if (proactiveTimer) return;
  const at = await getToken();
  if (at) scheduleProactiveRefresh(at);
}

export async function getToken(): Promise<string | null> { return storeGet(ACCESS_KEY); }
export async function getRefreshToken(): Promise<string | null> { return storeGet(REFRESH_KEY); }
export async function setTokens(access: string, refresh: string): Promise<void> {
  await storeSet(ACCESS_KEY, access);
  await storeSet(REFRESH_KEY, refresh);
  scheduleProactiveRefresh(access);
}

let tenantIdCache: string | null | undefined; // undefined = not yet loaded
export async function getTenantId(): Promise<string | null> {
  if (tenantIdCache !== undefined) return tenantIdCache;
  tenantIdCache = await storeGet(TENANT_KEY);
  return tenantIdCache;
}
export async function setTenantId(id: string | null): Promise<void> {
  tenantIdCache = id;
  if (id) await storeSet(TENANT_KEY, id);
  else await storeDel(TENANT_KEY);
}

export async function clearTokens(): Promise<void> {
  clearProactiveTimer();
  tenantIdCache = null;
  await storeDel(ACCESS_KEY);
  await storeDel(REFRESH_KEY);
  await storeDel(TENANT_KEY);
}

// UI language ('it' | 'en'). Persisted alongside tokens so the chosen language
// survives restarts and is read once at cold start to seed i18next. Kept here
// to reuse the same dual web/native storage + retry ladder as the tokens.
const LANG_KEY = 'sonoqui.lang';
export async function getStoredLang(): Promise<string | null> {
  return storeGet(LANG_KEY);
}
export async function setStoredLang(value: string): Promise<void> {
  await storeSet(LANG_KEY, value);
}

export interface ApiError extends Error {
  code?: string;
  status?: number;
  details?: unknown;
}

let refreshing: Promise<boolean> | null = null;
async function refreshAccessToken(): Promise<boolean> {
  if (refreshing) return refreshing;
  const rt = await getRefreshToken();
  if (!rt || !authBaseUrl()) return false;
  refreshing = (async () => {
    try {
      const r = await fetch(`${authBaseUrl()}/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: rt }),
      });
      if (!r.ok) return false;
      const body = (await r.json()) as { access_token: string; refresh_token: string };
      await setTokens(body.access_token, body.refresh_token);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown; noTenant?: boolean } = {}
): Promise<T> {
  const exec = async (): Promise<Response> => {
    const headers = new Headers(init.headers ?? {});
    headers.set('Accept', 'application/json');
    const token = await getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    // Tenant scope. Skipped for the company-list call (noTenant) so a stale
    // stored id can't 403 us out of our own list.
    if (!init.noTenant) {
      const tid = await getTenantId();
      if (tid) headers.set('X-Tenant-Id', tid);
    }
    let body = init.body;
    if (init.json !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(init.json);
    }
    return fetch(`${apiBaseUrl()}${path}`, { ...init, headers, body });
  };
  let res = await exec();
  if (res.status === 401 && (await getRefreshToken())) {
    const ok = await refreshAccessToken();
    if (ok) res = await exec();
  }
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  if (!res.ok) {
    const err: ApiError = new Error('API error');
    err.status = res.status;
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      const e = (parsed as { error: { code?: string; message?: string; details?: unknown } }).error;
      err.message = e.message ?? err.message;
      err.code = e.code;
      err.details = e.details;
    }
    throw err;
  }
  if (parsed && typeof parsed === 'object' && 'data' in (parsed as Record<string, unknown>)) {
    return (parsed as { data: T }).data;
  }
  return parsed as T;
}

export interface PasswordLoginResult {
  access_token: string;
  refresh_token: string;
  user: { id: string; email: string };
}

export async function loginWithPassword(email: string, password: string): Promise<PasswordLoginResult> {
  if (!authBaseUrl()) {
    throw Object.assign(new Error('Auth URL non configurato'), { code: 'CONFIG' });
  }
  const r = await fetch(`${authBaseUrl()}/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) {
    let parsed: { error_description?: string; msg?: string } = {};
    try { parsed = await r.json(); } catch { /* ignore */ }
    const err: ApiError = new Error(parsed.error_description ?? parsed.msg ?? 'Login fallito');
    err.status = r.status;
    throw err;
  }
  const body = (await r.json()) as PasswordLoginResult;
  await setTokens(body.access_token, body.refresh_token);
  return body;
}

export async function recoverPassword(email: string): Promise<void> {
  // Backend `POST /api/v1/auth/recover` proxies GoTrue and always returns 200,
  // so the caller can show a generic "email sent" message without leaking
  // whether the address exists. We post raw because the user has no session
  // yet (`api()` would attach a Bearer header that the backend ignores here,
  // but the simpler shape keeps the call symmetrical with web's ForgotPassword).
  await api('/api/v1/auth/recover', { method: 'POST', json: { email } });
}

export async function logout(): Promise<void> {
  const at = await getToken();
  await clearTokens();
  if (at && authBaseUrl()) {
    try {
      await fetch(`${authBaseUrl()}/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${at}` },
      });
    } catch { /* ignore */ }
  }
}
