import { create } from 'zustand';
import { api, clearToken, getToken } from '../lib/api';

export interface Me {
  user: { id: string; email: string; role: 'admin' | 'user' };
  tenant: { id: string; ragione_sociale: string; language: 'it' | 'en' };
  branches: Array<{ id: string; name: string; smart_working: boolean }>;
}

interface SessionState {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useSession = create<SessionState>((set) => ({
  me: null,
  loading: false,
  async refresh() {
    if (!(await getToken())) {
      set({ me: null });
      return;
    }
    set({ loading: true });
    try {
      const me = await api<Me>('/api/v1/me');
      set({ me, loading: false });
    } catch {
      await clearToken();
      set({ me: null, loading: false });
    }
  },
  async logout() {
    await clearToken();
    set({ me: null });
  },
}));
