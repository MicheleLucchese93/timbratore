import { create } from 'zustand';
import { api, getToken, logout as logoutAuth } from '../lib/api.ts';

export interface MeResponse {
  user: {
    id: string;
    email: string;
    role: 'admin' | 'user';
    first_name: string | null;
    last_name: string | null;
    display_name: string | null;
    disable_desktop_clock_in: boolean;
  };
  tenant: {
    id: string;
    ragione_sociale: string;
    language: 'it' | 'en';
    timezone: string;
    mock_location_action: 'allow' | 'flag' | 'block';
    max_admins: number;
    max_users: number;
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
    geofence_policy: 'lenient' | 'strict';
    gps_accuracy_ceiling_m: number;
  }>;
}

interface SessionState {
  loading: boolean;
  me: MeResponse | null;
  error: string | null;
  refresh: () => Promise<void>;
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
      const me = await api<MeResponse>('/api/v1/me');
      set({ loading: false, me });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed';
      set({ loading: false, me: null, error: msg });
      await logoutAuth();
    }
  },
  async logout() {
    await logoutAuth();
    set({ me: null, error: null });
  },
}));
