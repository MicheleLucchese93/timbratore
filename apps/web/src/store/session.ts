import { create } from 'zustand';
import { api, getToken, getTenantId, setTenantId, logout as logoutAuth } from '../lib/api.ts';

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
      // Tenant-agnostic on purpose (see api noTenant): a stale stored tenant id
      // must not block reading our own company list.
      const { tenants } = await api<{ tenants: TenantOption[] }>('/api/v1/me/tenants', {
        noTenant: true,
      });
      if (tenants.length === 0) {
        // Valid token but no active membership — nothing to show; sign out.
        await logoutAuth();
        set({ loading: false, me: null, tenants: [], activeTenantId: null });
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
      const msg = err instanceof Error ? err.message : 'failed';
      await logoutAuth();
      set({ loading: false, me: null, tenants: [], activeTenantId: null, error: msg });
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
    await logoutAuth();
    set({ me: null, tenants: [], activeTenantId: null, error: null });
  },
}));
