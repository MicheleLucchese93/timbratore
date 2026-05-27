import { create } from 'zustand';
import {
  api,
  ensureProactiveRefreshScheduled,
  getRefreshToken,
  getToken,
  logout as logoutAuth,
} from '../lib/api';

export interface Me {
  user: {
    id: string;
    email: string;
    role: 'admin' | 'user';
    first_name: string | null;
    last_name: string | null;
    display_name: string | null;
  };
  tenant: { id: string; ragione_sociale: string; language: 'it' | 'en' };
  branches: Array<{ id: string; name: string; smart_working: boolean }>;
  preferences?: {
    language: 'it' | 'en';
    email_notifications_enabled: boolean;
    push_token_registered: boolean;
  };
}

interface SessionState {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useSession = create<SessionState>((set, get) => ({
  me: null,
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
      set({ me: null, loading: false });
      return;
    }
    // Re-arm proactive refresh on cold start so a session restored from
    // SecureStore rotates its access token ~60s before exp regardless of
    // API traffic.
    await ensureProactiveRefreshScheduled();
    set({ loading: true });
    try {
      const me = await api<Me>('/api/v1/me');
      set({ me, loading: false });
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
        set({ me: null, loading: false });
      } else {
        console.warn('[sonoqui] session refresh transient failure', {
          status,
          message: e instanceof Error ? e.message : String(e),
        });
        // Preserve any previously-loaded `me` so the UI doesn't bounce
        // to the login screen on a momentary blip.
        set({ loading: false, me: get().me });
      }
    }
  },
  async logout() {
    await logoutAuth();
    set({ me: null });
  },
}));
