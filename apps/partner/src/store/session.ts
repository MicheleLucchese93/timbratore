import { create } from 'zustand';
import { api, getToken, logout as logoutAuth } from '../lib/api.ts';

export interface PartnerCaps {
  cap_tenants: number | null;
  cap_users_per_tenant: number | null;
  cap_admins_per_tenant: number | null;
  cap_documentali_per_tenant: number | null;
  cap_branches_per_tenant: number | null;
}

export interface PartnerMe {
  user_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  role: 'admin' | 'partner';
  /** True only for the lone super-user — reveals the delete-tenant action. */
  is_super: boolean;
  caps: PartnerCaps;
}

interface SessionState {
  loading: boolean;
  me: PartnerMe | null;
  /** Error code from the last failed resolve (e.g. NOT_PARTNERSHIP_MEMBER). */
  error: string | null;
  refresh: () => Promise<void>;
  updateProfile: (p: { first_name: string | null; last_name: string | null }) => Promise<void>;
  logout: () => Promise<void>;
}

export const useSession = create<SessionState>((set) => ({
  loading: !!getToken(),
  me: null,
  error: null,
  async refresh() {
    if (!getToken()) {
      set({ loading: false, me: null });
      return;
    }
    set({ loading: true, error: null });
    try {
      const me = await api<PartnerMe>('/api/v1/partnership/me');
      set({ loading: false, me, error: null });
    } catch (err) {
      // A valid GoTrue token that isn't a partnership member resolves to 403
      // (NOT_PARTNERSHIP_MEMBER / PARTNERSHIP_INACTIVE) — drop the session and
      // surface the code so the login screen can explain why.
      const code = (err as { code?: string }).code ?? 'failed';
      await logoutAuth();
      set({ loading: false, me: null, error: code });
    }
  },
  async updateProfile(p) {
    const updated = await api<{ first_name: string | null; last_name: string | null; display_name: string | null }>(
      '/api/v1/partnership/me',
      { method: 'PATCH', json: p }
    );
    set((s) => (s.me ? { me: { ...s.me, ...updated } } : {}));
  },
  async logout() {
    await logoutAuth();
    set({ me: null, error: null });
  },
}));
