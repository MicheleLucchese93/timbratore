const TOKEN_KEY = 'cisono.token';

// In dev, Vite proxies /api → http://localhost:4000. In prod, VITE_API_URL
// is baked at build time (see apps/web/Dockerfile build args).
const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
export function apiUrl(path: string): string {
  return API_BASE && path.startsWith('/api') ? `${API_BASE}${path}` : path;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export interface ApiError extends Error {
  code?: string;
  status?: number;
  details?: unknown;
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown } = {}
): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  headers.set('Accept', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const res = await fetch(apiUrl(path), { ...init, headers, body });
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

export async function devLogin(email: string): Promise<{ token: string; user: { id: string; email: string } }> {
  const data = await api<{ token: string; user: { id: string; email: string } }>(
    '/api/v1/auth/dev-token',
    { method: 'POST', json: { email } }
  );
  setToken(data.token);
  return data;
}
