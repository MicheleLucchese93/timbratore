const ACCESS_KEY = 'sonoqui.access_token';
const REFRESH_KEY = 'sonoqui.refresh_token';
// Which company the user is currently working in. Sent as X-Tenant-Id on every
// request so the backend scopes to the chosen membership (users may belong to
// several companies). Absent → backend falls back to the most-recent one.
const TENANT_KEY = 'sonoqui.tenant_id';

// In dev, Vite proxies /api → http://localhost:4000. In prod, VITE_API_URL
// is baked at build time (see apps/web/Dockerfile build args).
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
export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}
export function setTokens(access: string, refresh: string): void {
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}
export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(TENANT_KEY);
}

export function getTenantId(): string | null {
  return localStorage.getItem(TENANT_KEY);
}
export function setTenantId(id: string | null): void {
  if (id) localStorage.setItem(TENANT_KEY, id);
  else localStorage.removeItem(TENANT_KEY);
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

export async function api<T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown; noTenant?: boolean } = {}
): Promise<T> {
  const exec = async (): Promise<Response> => {
    const headers = new Headers(init.headers ?? {});
    headers.set('Accept', 'application/json');
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    // Tenant scope. Skipped for the company-list call (noTenant), which must
    // stay agnostic so a stale stored id can't 403 us out of our own list.
    if (!init.noTenant) {
      const tid = getTenantId();
      if (tid) headers.set('X-Tenant-Id', tid);
    }
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
    // GoTrue machine code (e.g. 'invalid_credentials'); the UI maps it to a
    // localized message instead of surfacing GoTrue's raw English `msg`.
    err.code = parsed.error_code ?? parsed.error;
    throw err;
  }
  const body = (await r.json()) as PasswordLoginResult;
  setTokens(body.access_token, body.refresh_token);
  return body;
}

export function isAuthConfigured(): boolean {
  return !!AUTH_BASE;
}

// Dev fallback when GoTrue not provisioned. Backend mints HS256 directly.
export async function loginWithDevToken(email: string): Promise<{ access_token: string; user: { id: string; email: string } }> {
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
  const body = (await r.json()) as { data: { token: string; user: { id: string; email: string } } };
  setTokens(body.data.token, body.data.token);
  return { access_token: body.data.token, user: body.data.user };
}

export async function logout(): Promise<void> {
  const rt = getRefreshToken();
  clearTokens();
  if (rt && AUTH_BASE) {
    try {
      await fetch(authUrl('/logout'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${rt}` },
      });
    } catch { /* ignore */ }
  }
}
