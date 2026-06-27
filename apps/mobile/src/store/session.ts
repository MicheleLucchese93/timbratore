import { create } from 'zustand';
import {
  api,
  ensureProactiveRefreshScheduled,
  getRefreshToken,
  getTenantId,
  getToken,
  setTenantId,
  setSessionInvalidHandler,
  logout as logoutAuth,
} from '../lib/api';

export interface TenantOption {
  tenant_id: string;
  ragione_sociale: string;
  role: 'admin' | 'user';
}

export interface Me {
  user: {
    id: string;
    email: string;
    role: 'admin' | 'user';
    first_name: string | null;
    last_name: string | null;
    display_name: string | null;
    stamp_modes: Array<'gps' | 'remote' | 'wifi'>;
  };
  tenant: { id: string; ragione_sociale: string; language: 'it' | 'en' };
  branches: Array<{ id: string; name: string; smart_working: boolean }>;
  preferences?: {
    language: 'it' | 'en';
    email_notifications_enabled: boolean;
    push_token_registered: boolean;
    notification_preferences: {
      push_leave_decisions: boolean;
      push_correction_decisions: boolean;
      push_leave_submissions: boolean;
      push_correction_submissions: boolean;
      push_leave_reminders: boolean;
      push_documents?: boolean;
      push_stamp_reminders?: boolean;
      email_documents?: boolean;
    };
  };
}

interface SessionState {
  me: Me | null;
  /** Every company the user belongs to (≥1 once authenticated). */
  tenants: TenantOption[];
  /** Chosen company, or null while the chooser must be shown. */
  activeTenantId: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  chooseTenant: (tenantId: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useSession = create<SessionState>((set, get) => ({
  me: null,
  tenants: [],
  activeTenantId: null,
  loading: false,
  async refresh() {
    // Match Documents/Penno App.tsx bootstrap: if neither token is
    // present, there's no session — show login, but DO NOT call
    // logoutAuth() (nothing to clear, and a spurious clear-and-set
    // would race other call sites).
    const [accessToken, refreshToken] = await Promise.all([
      getToken(),
      getRefreshToken(),
    ]);
    if (!accessToken && !refreshToken) {
      set({ me: null, tenants: [], activeTenantId: null, loading: false });
      return;
    }
    // Re-arm proactive refresh on cold start so a session restored from
    // SecureStore rotates its access token ~60s before exp regardless of
    // API traffic.
    await ensureProactiveRefreshScheduled();
    set({ loading: true });
    try {
      // Tenant-agnostic (noTenant): a stale stored id must not block reading
      // our own company list.
      const { tenants } = await api<{ tenants: TenantOption[] }>('/api/v1/me/tenants', {
        noTenant: true,
      });
      if (tenants.length === 0) {
        await logoutAuth();
        set({ me: null, tenants: [], activeTenantId: null, loading: false });
        return;
      }
      // Honour a previous choice; auto-pick when there's only one company.
      let active = await getTenantId();
      if (!active || !tenants.some((t) => t.tenant_id === active)) active = null;
      if (!active && tenants.length === 1) active = tenants[0]?.tenant_id ?? null;
      await setTenantId(active);
      if (!active) {
        // Multiple companies, none chosen → show the chooser. Don't load /me
        // yet: role, branches and tabs all depend on which company is picked.
        set({ me: null, tenants, activeTenantId: null, loading: false });
        return;
      }
      const me = await api<Me>('/api/v1/me');
      set({ me, tenants, activeTenantId: active, loading: false });
      void import('../lib/push').then((m) => m.registerPushTokenIfNeeded());
    } catch (e) {
      const status = (e as { status?: number }).status;
      // Only clear tokens on confirmed auth rejection. Network blips,
      // 5xx, timeouts, SecureStore transient throws — keep the session
      // and let the next foreground / proactive refresh retry. This is
      // the Penno App.tsx pattern: refresh failures are warned, never
      // SIGNED_OUT.
      if (status === 401 || status === 403) {
        await logoutAuth();
        set({ me: null, tenants: [], activeTenantId: null, loading: false });
      } else {
        console.warn('[sonoqui] session refresh transient failure', {
          status,
          message: e instanceof Error ? e.message : String(e),
        });
        // Preserve any previously-loaded `me`/tenants so the UI doesn't bounce
        // to the login screen on a momentary blip.
        set({ loading: false, me: get().me });
      }
    }
  },
  async chooseTenant(tenantId) {
    await setTenantId(tenantId);
    set({ activeTenantId: tenantId });
    // Re-resolve from scratch: validates membership + reloads /me, so
    // role/branches/tabs switch to the newly selected company.
    await get().refresh();
  },
  async logout() {
    await logoutAuth();
    set({ me: null, tenants: [], activeTenantId: null });
  },
}));

// When any request reports the session's tenant is gone (suspended / revoked),
// drop the session so the navigator returns to login. Tokens are already
// cleared by api(); just reset store state.
setSessionInvalidHandler(() => {
  useSession.setState({ me: null, tenants: [], activeTenantId: null, loading: false });
});
