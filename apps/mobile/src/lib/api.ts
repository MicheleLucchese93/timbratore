import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const ACCESS_KEY = 'sonoqui.access_token';
const REFRESH_KEY = 'sonoqui.refresh_token';

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
  return SecureStore.getItemAsync(key);
}
async function storeSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}
async function storeDel(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function getToken(): Promise<string | null> { return storeGet(ACCESS_KEY); }
export async function getRefreshToken(): Promise<string | null> { return storeGet(REFRESH_KEY); }
export async function setTokens(access: string, refresh: string): Promise<void> {
  await storeSet(ACCESS_KEY, access);
  await storeSet(REFRESH_KEY, refresh);
}
export async function clearTokens(): Promise<void> {
  await storeDel(ACCESS_KEY);
  await storeDel(REFRESH_KEY);
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
  init: RequestInit & { json?: unknown } = {}
): Promise<T> {
  const exec = async (): Promise<Response> => {
    const headers = new Headers(init.headers ?? {});
    headers.set('Accept', 'application/json');
    const token = await getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
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
