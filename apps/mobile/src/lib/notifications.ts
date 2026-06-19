import { create } from 'zustand';
import { api } from './api';
import { useSession } from '../store/session';
import type { StampEventType } from '@sonoqui/shared';

// CorrectionRow is still imported by CorrectionsTab, so keep it exported here.
export interface CorrectionRow {
  id: string;
  user_id: string;
  user_email?: string;
  user_display_name?: string | null;
  original_stamp_id: string | null;
  original_event_type: StampEventType | null;
  original_occurred_at: string | null;
  original_branch_id: string | null;
  original_branch_name: string | null;
  claimed_event_type: StampEventType;
  claimed_occurred_at: string;
  claimed_branch_id: string | null;
  claimed_branch_name: string | null;
  justification: string;
  status: 'pending' | 'approved' | 'rejected' | 'superseded';
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
}

// Mobile tab a tapped notification opens. Matches the `route` the backend stores.
export type NotificationRoute = 'richieste' | 'correzioni' | 'documenti';

// Notification kinds emitted by the backend pipeline (lib/notifications.ts).
// Typed as a plain string so an unknown future kind still renders (with the
// default icon) rather than failing to compile the client.
export type AppNotificationKind = string;

export interface AppNotification {
  id: string;
  kind: AppNotificationKind;
  title: string;
  body: string;
  created_at: string;
  is_read: boolean;
  /** Tab the item opens when tapped (null = no deep-link). */
  route: NotificationRoute | null;
  /** Push payload (ids, decision) — drives the icon and deep-link. */
  data: Record<string, unknown>;
}

// Row shape from GET /api/v1/notifications, after api() unwraps { data }.
interface ServerNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  route: string | null;
  source_id: string | null;
  is_read: boolean;
  created_at: string;
}

interface NotificationState {
  notifications: AppNotification[];
  unreadCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
}

function toApp(n: ServerNotification): AppNotification {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    created_at: n.created_at,
    is_read: n.is_read,
    route: (n.route as NotificationRoute) ?? null,
    data: n.data ?? {},
  };
}

// The bell reads persisted rows from the server (one per notify* event, written
// for every recipient by the backend). Read-state lives in `read_at` on the
// server, so marking read syncs across the user's devices — no device-local set.
export const useNotifications = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  loading: false,
  async refresh() {
    const meId = useSession.getState().me?.user.id;
    if (!meId) {
      set({ notifications: [], unreadCount: 0, loading: false });
      return;
    }
    set({ loading: true });
    const rows = await api<ServerNotification[]>('/api/v1/notifications').catch(() => null);
    // Transient error — keep the current list rather than blanking it
    // (mirrors session.refresh's posture).
    if (rows === null) {
      set({ loading: false });
      return;
    }
    const list = rows.map(toApp);
    set({
      notifications: list,
      unreadCount: list.filter((n) => !n.is_read).length,
      loading: false,
    });
  },
  async markAsRead(id) {
    // Optimistic flip, then persist. The server is authoritative on the next
    // refresh, so a failed POST self-heals.
    const list = get().notifications.map((n) => (n.id === id ? { ...n, is_read: true } : n));
    set({ notifications: list, unreadCount: list.filter((n) => !n.is_read).length });
    await api(`/api/v1/notifications/${id}/read`, { method: 'POST' }).catch(() => {});
  },
  async markAllAsRead() {
    const list = get().notifications.map((n) => ({ ...n, is_read: true }));
    set({ notifications: list, unreadCount: 0 });
    await api('/api/v1/notifications/read-all', { method: 'POST' }).catch(() => {});
  },
}));
