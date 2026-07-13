import { create } from 'zustand';
import { api } from '../lib/api';

// Lightweight shared state for the Richieste "da approvare" badge on the tab
// bar. The Richieste screen owns the inbox list; this store just exposes the
// pending-approval count so the tab bar (and a startup seed) can render a badge
// without re-fetching. Count matches the "Da approvare · N" figure on screen:
// inbox rows still awaiting a decision — a new request (status === 'pending')
// or a cancellation request on an approved leave ('cancellation_pending').
interface RichiesteState {
  pending: number;
  setPending: (n: number) => void;
  refresh: () => Promise<void>;
}

interface InboxRow {
  status: string;
}

// Inbox rows that still need an approver decision — a new leave request or a
// cancellation request on an already-approved leave.
const isAwaitingDecision = (r: InboxRow): boolean =>
  r.status === 'pending' || r.status === 'cancellation_pending';

export const useRichieste = create<RichiesteState>((set) => ({
  pending: 0,
  setPending: (n) => set({ pending: Math.max(0, n) }),
  refresh: async () => {
    try {
      const rows = await api<InboxRow[]>('/api/v1/leaves?scope=inbox');
      set({ pending: rows.filter(isAwaitingDecision).length });
    } catch {
      /* leave the prior count on transient failure */
    }
  },
}));
