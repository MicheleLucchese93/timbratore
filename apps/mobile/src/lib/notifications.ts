import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { api } from './api';
import { useSession } from '../store/session';
import type { StampEventType } from '@sonoqui/shared';

const READ_KEY = 'sonoqui.notifications.read';

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

export type AppNotificationType =
  | 'correction_pending'
  | 'correction_approved'
  | 'correction_rejected'
  | 'correction_acted'
  | 'leave_pending'
  | 'leave_cancellation_pending'
  | 'leave_approved'
  | 'leave_rejected'
  | 'leave_cancelled';

export interface AppNotification {
  id: string;
  type: AppNotificationType;
  title: string;
  body: string;
  created_at: string;
  is_read: boolean;
  source_id: string;
  /** Tab the item opens when tapped. */
  route: 'correzioni' | 'richieste';
}

type LeaveType = 'ferie' | 'permessi' | 'malattia' | 'assenza' | 'chiusura';

// Subset of GET /api/v1/leaves rows the notification feed needs.
export interface LeaveRow {
  id: string;
  user_id: string;
  user_email?: string;
  user_display_name?: string | null;
  type: LeaveType;
  status: string;
  from_ts: string;
  to_ts: string;
  rejection_reason: string | null;
  cancellation_reason: string | null;
  decided_by: string | null;
  decided_at: string | null;
  cancellation_decided_at?: string | null;
  title?: string | null;
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

async function loadReadSet(): Promise<Set<string>> {
  const raw = await storeGet(READ_KEY);
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

async function saveReadSet(set: Set<string>): Promise<void> {
  await storeSet(READ_KEY, JSON.stringify([...set]));
}

// Build the in-app feed by merging two data sources, scoped by the viewer's
// own id rather than role: a correction/leave is mine (I'm the requester) or
// it's in my inbox (I approve/admin it). This mirrors what the server pushes
// (notifications.ts on the backend) so the in-app list, OS badge and push
// stay in sync. `leavesInbox` = GET /leaves?scope=inbox (rows awaiting my
// decision); `leavesMine` = scope=mine (my own requests).
function deriveNotifications(
  corrections: CorrectionRow[],
  leavesInbox: LeaveRow[],
  leavesMine: LeaveRow[],
  meId: string,
  readIds: Set<string>
): AppNotification[] {
  const out: AppNotification[] = [];
  const seen = new Set<string>();
  const push = (n: Omit<AppNotification, 'is_read'>) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    out.push({ ...n, is_read: readIds.has(n.id) });
  };

  for (const r of corrections) {
    const label = `${humanEvent(r.claimed_event_type)} ${formatWhen(r.claimed_occurred_at)}`;
    if (r.user_id === meId) {
      // My own correction: notify me of the decision.
      if (r.status === 'approved' || r.status === 'rejected') {
        push({
          id: `${r.status}:${r.id}`,
          type: r.status === 'approved' ? 'correction_approved' : 'correction_rejected',
          title: r.status === 'approved' ? 'Correzione approvata' : 'Correzione rifiutata',
          body: r.resolution_note?.trim()
            ? r.resolution_note
            : `${label} ${r.status === 'approved' ? 'approvata' : 'rifiutata'}.`,
          created_at: r.resolved_at ?? r.created_at,
          source_id: r.id,
          route: 'correzioni',
        });
      }
    } else if (r.status === 'pending') {
      // Someone else's request awaiting my decision.
      push({
        id: `pending:${r.id}`,
        type: 'correction_pending',
        title: 'Nuova richiesta di correzione',
        body: `${r.user_email ?? 'Dipendente'} — ${label}`,
        created_at: r.created_at,
        source_id: r.id,
        route: 'correzioni',
      });
    } else if ((r.status === 'approved' || r.status === 'rejected') && r.resolved_by === meId) {
      // A request I decided — keep a record in the feed.
      push({
        id: `acted:${r.id}`,
        type: 'correction_acted',
        title: r.status === 'approved' ? 'Correzione approvata' : 'Correzione rifiutata',
        body: `${r.user_email ?? 'Dipendente'} — ${label}`,
        created_at: r.resolved_at ?? r.created_at,
        source_id: r.id,
        route: 'correzioni',
      });
    }
  }

  // Inbox leaves: pending decisions and cancellation requests assigned to me.
  for (const lr of leavesInbox) {
    if (lr.user_id === meId) continue;
    const who = lr.user_display_name?.trim() || lr.user_email || 'Dipendente';
    if (lr.status === 'pending') {
      push({
        id: `leave-pending:${lr.id}`,
        type: 'leave_pending',
        title: 'Nuova richiesta di assenza',
        body: `${who} — ${leaveLabel(lr)} ${formatWhen(lr.from_ts)}`,
        created_at: lr.created_at,
        source_id: lr.id,
        route: 'richieste',
      });
    } else if (lr.status === 'cancellation_pending') {
      push({
        id: `leave-cancel:${lr.id}`,
        type: 'leave_cancellation_pending',
        title: 'Richiesta di annullamento',
        body: `${who} — ${leaveLabel(lr)} ${formatWhen(lr.from_ts)}`,
        created_at: lr.created_at,
        source_id: lr.id,
        route: 'richieste',
      });
    }
  }

  // My own leaves: notify me when a decision lands. Skip self-decided rows
  // (malattia is auto-approved on submit, decided_by = me) — that's not news.
  for (const lr of leavesMine) {
    if (lr.user_id !== meId) continue;
    const label = `${leaveLabel(lr)} ${formatWhen(lr.from_ts)}`;
    if (lr.status === 'approved' && lr.decided_by && lr.decided_by !== meId) {
      push({
        id: `leave-approved:${lr.id}`,
        type: 'leave_approved',
        title: 'Assenza approvata',
        body: `${label} approvata.`,
        created_at: lr.decided_at ?? lr.created_at,
        source_id: lr.id,
        route: 'richieste',
      });
    } else if (lr.status === 'rejected') {
      push({
        id: `leave-rejected:${lr.id}`,
        type: 'leave_rejected',
        title: 'Assenza rifiutata',
        body: lr.rejection_reason?.trim() ? lr.rejection_reason : `${label} rifiutata.`,
        created_at: lr.decided_at ?? lr.created_at,
        source_id: lr.id,
        route: 'richieste',
      });
    } else if (lr.status === 'cancelled_post_approval') {
      push({
        id: `leave-cancelled:${lr.id}`,
        type: 'leave_cancelled',
        title: 'Assenza annullata',
        body: lr.cancellation_reason?.trim() ? lr.cancellation_reason : `${label} annullata.`,
        created_at: lr.cancellation_decided_at ?? lr.decided_at ?? lr.created_at,
        source_id: lr.id,
        route: 'richieste',
      });
    }
  }

  out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return out;
}

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
    const [corrections, leavesInbox, leavesMine, readSet] = await Promise.all([
      api<CorrectionRow[]>('/api/v1/correction-requests').catch(() => null),
      api<LeaveRow[]>('/api/v1/leaves?scope=inbox').catch(() => null),
      api<LeaveRow[]>('/api/v1/leaves?scope=mine').catch(() => null),
      loadReadSet(),
    ]);
    // Every source errored — treat as a transient blip and keep the current
    // list rather than blanking it (mirrors session.refresh's posture).
    if (corrections === null && leavesInbox === null && leavesMine === null) {
      set({ loading: false });
      return;
    }
    const list = deriveNotifications(
      corrections ?? [],
      leavesInbox ?? [],
      leavesMine ?? [],
      meId,
      readSet
    );
    set({
      notifications: list,
      unreadCount: list.filter((n) => !n.is_read).length,
      loading: false,
    });
  },
  async markAsRead(id) {
    const readSet = await loadReadSet();
    readSet.add(id);
    await saveReadSet(readSet);
    const list = get().notifications.map((n) => (n.id === id ? { ...n, is_read: true } : n));
    set({ notifications: list, unreadCount: list.filter((n) => !n.is_read).length });
  },
  async markAllAsRead() {
    const readSet = await loadReadSet();
    for (const n of get().notifications) readSet.add(n.id);
    await saveReadSet(readSet);
    const list = get().notifications.map((n) => ({ ...n, is_read: true }));
    set({ notifications: list, unreadCount: 0 });
  },
}));

function humanEvent(e: StampEventType): string {
  switch (e) {
    case 'clock_in': return 'Ingresso';
    case 'clock_out': return 'Uscita';
    case 'break_start': return 'Inizio pausa';
    case 'break_end': return 'Fine pausa';
    case 'lunch_start': return 'Inizio pausa pranzo';
    case 'lunch_end': return 'Fine pausa pranzo';
  }
}

function leaveLabel(lr: LeaveRow): string {
  if (lr.title?.trim()) return lr.title;
  switch (lr.type) {
    case 'ferie': return 'Ferie';
    case 'permessi': return 'Permesso';
    case 'malattia': return 'Malattia';
    case 'assenza': return 'Assenza';
    case 'chiusura': return 'Chiusura aziendale';
    default: return lr.type;
  }
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('it-IT', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
