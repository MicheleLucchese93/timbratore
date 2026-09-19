// HTTP + auth client for the partner app. Mirrors apps/web/src/lib/api.ts but
// with NO tenant scoping (X-Tenant-Id) — partnership members operate across
// tenants, not inside one. Tokens use partner-specific localStorage keys so the
// app never collides with the main webapp when sharing an origin in dev.
const ACCESS_KEY = 'sonoqui.partner.access_token';
const REFRESH_KEY = 'sonoqui.partner.refresh_token';

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const AUTH_BASE = (import.meta.env.VITE_AUTH_URL ?? '').replace(/\/$/, '');

export function apiUrl(path: string): string {
  return API_BASE && path.startsWith('/api') ? `${API_BASE}${path}` : path;
}
function authUrl(path: string): string {
  if (!AUTH_BASE) {
    throw Object.assign(new Error('VITE_AUTH_URL not configured'), { code: 'CONFIG' });
  }
  return `${AUTH_BASE}${path}`;
}

export function getToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}
function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}
export function setTokens(access: string, refresh: string): void {
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}
export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export interface ApiError extends Error {
  code?: string;
  status?: number;
  details?: unknown;
}

let refreshing: Promise<boolean> | null = null;
async function refreshAccessToken(): Promise<boolean> {
  if (refreshing) return refreshing;
  const rt = getRefreshToken();
  if (!rt || !AUTH_BASE) return false;
  refreshing = (async () => {
    try {
      const r = await fetch(authUrl('/token?grant_type=refresh_token'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: rt }),
      });
      if (!r.ok) return false;
      const body = (await r.json()) as { access_token: string; refresh_token: string };
      setTokens(body.access_token, body.refresh_token);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

// Bearer-authenticated fetch with one silent token refresh on 401. Shared by the
// JSON client below and by file downloads, which need the raw Response.
async function authedFetch(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const exec = async (): Promise<Response> => {
    const headers = new Headers(init.headers ?? {});
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    let body = init.body;
    if (init.json !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(init.json);
    }
    return fetch(apiUrl(path), { ...init, headers, body });
  };
  let res = await exec();
  if (res.status === 401 && getToken()) {
    const rt = getRefreshToken();
    const refreshed = rt && AUTH_BASE ? await refreshAccessToken() : false;
    if (refreshed) {
      res = await exec();
    } else {
      clearTokens();
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.assign('/login');
      }
    }
  }
  return res;
}

function toApiError(status: number, parsed: unknown): ApiError {
  const err: ApiError = new Error('API error');
  err.status = status;
  if (parsed && typeof parsed === 'object' && 'error' in parsed) {
    const e = (parsed as { error: { code?: string; message?: string; details?: unknown } }).error;
    err.message = e.message ?? err.message;
    err.code = e.code;
    err.details = e.details;
  }
  return err;
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown } = {}
): Promise<T> {
  const res = await authedFetch(path, init);
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  if (!res.ok) throw toApiError(res.status, parsed);
  if (parsed && typeof parsed === 'object' && 'data' in (parsed as Record<string, unknown>)) {
    return (parsed as { data: T }).data;
  }
  return parsed as T;
}

/** `attachment; filename="x.csv"` → `x.csv` (null when absent or unreadable). */
function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch { /* fall through to the plain form */ }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() || null;
}

/**
 * Authenticated file download (an <a href> carries no bearer token): fetch the
 * file as a blob and hand it to the browser. The server's Content-Disposition
 * name wins when the browser can read it; `fallbackName` otherwise. Failures
 * throw the same ApiError shape as `api()` so callers map `errors.<code>`.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const res = await authedFetch(path, { headers: { Accept: '*/*' } });
  if (!res.ok) {
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try { parsed = JSON.parse(text); } catch { parsed = text; }
    }
    throw toApiError(res.status, parsed);
  }
  const blob = await res.blob();
  const name = filenameFromDisposition(res.headers.get('Content-Disposition')) ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function isAuthConfigured(): boolean {
  return !!AUTH_BASE;
}

export async function loginWithPassword(email: string, password: string): Promise<void> {
  const r = await fetch(authUrl('/token?grant_type=password'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) {
    let parsed: { error_description?: string; msg?: string; error_code?: string; error?: string } = {};
    try { parsed = await r.json(); } catch { /* ignore */ }
    const err: ApiError = new Error(parsed.error_description ?? parsed.msg ?? 'Login failed');
    err.status = r.status;
    err.code = parsed.error_code ?? parsed.error;
    throw err;
  }
  const body = (await r.json()) as { access_token: string; refresh_token: string };
  setTokens(body.access_token, body.refresh_token);
}

// Dev fallback when GoTrue is not provisioned (local backend, DEV_AUTH_ENABLED).
export async function loginWithDevToken(email: string): Promise<void> {
  const r = await fetch(apiUrl('/api/v1/auth/dev-token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!r.ok) {
    const err: ApiError = new Error('dev-token login failed');
    err.status = r.status;
    throw err;
  }
  const body = (await r.json()) as { data: { token: string } };
  setTokens(body.data.token, body.data.token);
}

export async function logout(): Promise<void> {
  const rt = getRefreshToken();
  clearTokens();
  if (rt && AUTH_BASE) {
    try {
      await fetch(authUrl('/logout'), { method: 'POST', headers: { Authorization: `Bearer ${rt}` } });
    } catch { /* ignore */ }
  }
}
