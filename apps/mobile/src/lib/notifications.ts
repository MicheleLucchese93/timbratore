import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { api } from './api';
import type { StampEventType } from '@sonoqui/shared';

const READ_KEY = 'sonoqui.notifications.read';

export interface CorrectionRow {
  id: string;
  user_id: string;
  user_email?: string;
  original_stamp_id: string | null;
  claimed_event_type: StampEventType;
  claimed_occurred_at: string;
  claimed_branch_id: string | null;
  justification: string;
  status: 'pending' | 'approved' | 'rejected' | 'superseded';
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
}

export interface AppNotification {
  id: string;
  type: 'correction_pending' | 'correction_approved' | 'correction_rejected';
  title: string;
  body: string;
  created_at: string;
  is_read: boolean;
  source_id: string;
}

interface NotificationState {
  notifications: AppNotification[];
  unreadCount: number;
  loading: boolean;
  refresh: (role: 'admin' | 'user') => Promise<void>;
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

function deriveNotifications(rows: CorrectionRow[], role: 'admin' | 'user', readIds: Set<string>): AppNotification[] {
  const out: AppNotification[] = [];
  for (const r of rows) {
    if (role === 'admin') {
      if (r.status === 'pending') {
        out.push({
          id: `pending:${r.id}`,
          type: 'correction_pending',
          title: 'Nuova richiesta di correzione',
          body: `${r.user_email ?? 'Dipendente'} — ${humanEvent(r.claimed_event_type)} ${formatWhen(r.claimed_occurred_at)}`,
          created_at: r.created_at,
          is_read: readIds.has(`pending:${r.id}`),
          source_id: r.id,
        });
      }
    } else {
      if (r.status === 'approved') {
        out.push({
          id: `approved:${r.id}`,
          type: 'correction_approved',
          title: 'Correzione approvata',
          body:
            r.resolution_note?.trim()
              ? r.resolution_note
              : `${humanEvent(r.claimed_event_type)} ${formatWhen(r.claimed_occurred_at)} approvata.`,
          created_at: r.resolved_at ?? r.created_at,
          is_read: readIds.has(`approved:${r.id}`),
          source_id: r.id,
        });
      } else if (r.status === 'rejected') {
        out.push({
          id: `rejected:${r.id}`,
          type: 'correction_rejected',
          title: 'Correzione rifiutata',
          body:
            r.resolution_note?.trim()
              ? r.resolution_note
              : `${humanEvent(r.claimed_event_type)} ${formatWhen(r.claimed_occurred_at)} rifiutata.`,
          created_at: r.resolved_at ?? r.created_at,
          is_read: readIds.has(`rejected:${r.id}`),
          source_id: r.id,
        });
      }
    }
  }
  out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return out;
}

export const useNotifications = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  loading: false,
  async refresh(role) {
    set({ loading: true });
    try {
      const rows = await api<CorrectionRow[]>('/api/v1/correction-requests');
      const readSet = await loadReadSet();
      const list = deriveNotifications(rows, role, readSet);
      set({
        notifications: list,
        unreadCount: list.filter((n) => !n.is_read).length,
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
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
