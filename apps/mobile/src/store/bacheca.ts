import { create } from 'zustand';
import type { BulletinFeedItem } from '@sonoqui/shared';
import { api } from '../lib/api';

// Lightweight shared state for the Bacheca unread badge on the tab bar. The
// feed screen owns the message list; this store just exposes the unread count so
// the tab bar (and a startup seed) can render a badge without re-fetching.
interface BachecaState {
  unread: number;
  setUnread: (n: number) => void;
  refresh: () => Promise<void>;
}

export const useBacheca = create<BachecaState>((set) => ({
  unread: 0,
  setUnread: (n) => set({ unread: Math.max(0, n) }),
  refresh: async () => {
    try {
      const items = await api<BulletinFeedItem[]>('/api/v1/bulletins/me');
      set({ unread: items.filter((i) => !i.read).length });
    } catch {
      /* leave the prior count on transient failure */
    }
  },
}));
