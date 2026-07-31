import { create } from 'zustand';
import {
  api,
  getToken,
  getTenantId,
  setTenantId,
  isSupportMode,
  endSupportSession,
  logout as logoutAuth,
} from '../lib/api.ts';

/** True while this tab runs a read-only partner support session. Every write
 *  affordance keys off this; the server refuses writes regardless. */
export function useReadOnly(): boolean {
  return useSession((s) => s.me?.support?.active === true);
}

export interface TenantOption {
  tenant_id: string;
  ragione_sociale: string;
  role: 'admin' | 'user';
}

export interface MeResponse {
  user: {
    id: string;
    email: string;
    role: 'admin' | 'user';
    // Additive capability: may upload + OTP-view every employee's documents.
    is_documentale: boolean;
    // Cantieri module role, independent of the tenant role. null = no access.
    cantieri_role: 'admin' | 'user' | null;
    first_name: string | null;
    last_name: string | null;
    display_name: string | null;
    stamp_modes: Array<'gps' | 'remote' | 'wifi'>;
  };
  tenant: {
    id: string;
    ragione_sociale: string;
    language: 'it' | 'en';
    timezone: string;
    mock_location_action: 'allow' | 'flag' | 'block';
    max_admins: number;
    max_users: number;
    max_branches: number;
    max_documentali: number;
    // Cantieri module toggled per tenant by the partner/reseller.
    cantieri_enabled: boolean;
  };
  branches: Array<{
    id: string;
    name: string;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    radius_m: number;
    enforce_radius: boolean;
    smart_working: boolean;
  }>;
  preferences?: {
    language: 'it' | 'en' | null;
    email_notifications_enabled?: boolean;
    push_token_registered?: boolean;
    notification_preferences?: Record<string, boolean>;
  };
  /** Present ONLY while a partner is inspecting this company read-only. Server
   *  derived from the session token — the client cannot opt out of it. */
  support?: {
    active: boolean;
    session_id: string;
    tenant_name: string;
    expires_at: string;
    actor_email: string | null;
    tenant_suspended: boolean;
  };
}

interface SessionState {
  loading: boolean;
  me: MeResponse | null;
  /** Every company the logged-in user belongs to (≥1 once authenticated). */
  tenants: TenantOption[];
  /** The chosen company, or null while the chooser must be shown. */
  activeTenantId: string | null;
  error: string | null;
  refresh: () => Promise<void>;
  chooseTenant: (tenantId: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useSession = create<SessionState>((set, get) => ({
  loading: !!getToken(),
  me: null,
  tenants: [],
  activeTenantId: null,
  error: null,
  async refresh() {
    if (!getToken()) {
      set({ loading: false, me: null, tenants: [], activeTenantId: null });
      return;
    }
    set({ loading: true, error: null });
    try {
      // Read-only support session: exactly one company, pinned server-side in
      // the token. Skip the company list AND setTenantId — writing the tenant to
      // localStorage would leak into the partner's own tabs.
      if (isSupportMode()) {
        const me = await api<MeResponse>('/api/v1/me');
        set({
          loading: false,
          me,
          tenants: [
            {
              tenant_id: me.tenant.id,
              ragione_sociale: me.tenant.ragione_sociale,
              role: me.user.role,
            },
          ],
          activeTenantId: me.tenant.id,
        });
        return;
      }
      // Tenant-agnostic on purpose (see api noTenant): a stale stored tenant id
      // must not block reading our own company list.
      const { tenants } = await api<{ tenants: TenantOption[] }>('/api/v1/me/tenants', {
        noTenant: true,
      });
      if (tenants.length === 0) {
        // Valid token but no active membership — nothing to show; sign out and
        // surface a generic, non-enumerating error so the login screen explains
        // why instead of silently returning to it.
        await logoutAuth();
        set({
          loading: false,
          me: null,
          tenants: [],
          activeTenantId: null,
          error: 'invalid_credentials',
        });
        return;
      }
      // Honour a previous choice; auto-pick when there's only one company.
      let active = getTenantId();
      if (!active || !tenants.some((t) => t.tenant_id === active)) active = null;
      if (!active && tenants.length === 1) active = tenants[0]?.tenant_id ?? null;
      setTenantId(active);
      if (!active) {
        // Multiple companies, none chosen → force the chooser. Don't load /me
        // yet: role, branches and nav all depend on which company is picked.
        set({ loading: false, me: null, tenants, activeTenantId: null });
        return;
      }
      const me = await api<MeResponse>('/api/v1/me');
      set({ loading: false, me, tenants, activeTenantId: active });
    } catch (err) {
      // A valid GoTrue token that resolves no company (403 NO_ACTIVE_TENANT /
      // TENANT_NOT_ALLOWED — e.g. a partner not assigned to any tenant, or a
      // suspended company) is "signed in but no access": show the SAME generic
      // message as a wrong password (never reveal it → no account enumeration).
      // Anything else (network, 5xx) is transient → generic retry. The code
      // lives in the store so it survives the AppShellSkeleton remount the login
      // screen goes through while `loading` flips.
      const code = (err as { code?: string } | null)?.code;
      const error =
        code === 'NO_ACTIVE_TENANT' || code === 'TENANT_NOT_ALLOWED'
          ? 'invalid_credentials'
          : 'default';
      // A failed support session ends on its own screen — never on the login
      // form, which a partner has no business seeing here.
      if (isSupportMode()) {
        endSupportSession();
        set({ loading: false, me: null, tenants: [], activeTenantId: null, error: null });
        return;
      }
      await logoutAuth();
      set({ loading: false, me: null, tenants: [], activeTenantId: null, error });
    }
  },
  async chooseTenant(tenantId) {
    setTenantId(tenantId);
    set({ activeTenantId: tenantId });
    // Re-resolve from scratch: this validates membership and reloads /me, so
    // role/branches/nav switch to the newly selected company.
    await get().refresh();
  },
  async logout() {
    if (isSupportMode()) {
      // "Termina sessione": drop the tab's token and land on the ended screen.
      // The server-side row is revoked from the console; expiry closes it anyway.
      endSupportSession();
      set({ me: null, tenants: [], activeTenantId: null, error: null });
      return;
    }
    await logoutAuth();
    set({ me: null, tenants: [], activeTenantId: null, error: null });
  },
}));
