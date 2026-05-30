import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { DataGrid, type GridColDef, type GridRenderCellParams } from '@mui/x-data-grid';
import { api } from '../lib/api.ts';
import { dataGridDefaults, dataGridSx } from '../lib/data-grid-style.ts';
import { IconButton } from '../components/IconButton.tsx';
import { LeaveCalendar, type CalendarEvent } from '../components/LeaveCalendar.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';

type LeaveType = 'ferie' | 'permessi' | 'malattia' | 'assenza';
type AssenzaSubtype =
  | 'lutto'
  | 'donazione_sangue'
  | 'permesso_studio'
  | 'permesso_elettorale'
  | 'matrimonio'
  | 'allattamento'
  | 'congedo_parentale'
  | 'legge_104'
  | 'assemblea_sindacale'
  | 'visita_medica'
  | 'motivi_personali';

const ASSENZA_SUBTYPE_LABEL: Record<AssenzaSubtype, string> = {
  lutto: 'Lutto',
  donazione_sangue: 'Donazione sangue',
  permesso_studio: 'Permesso studio',
  permesso_elettorale: 'Permesso elettorale',
  matrimonio: 'Matrimonio',
  allattamento: 'Allattamento',
  congedo_parentale: 'Congedo parentale',
  legge_104: 'Legge 104',
  assemblea_sindacale: 'Assemblea sindacale',
  visita_medica: 'Visita medica',
  motivi_personali: 'Motivi personali',
};
type LeaveStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'cancellation_pending'
  | 'cancelled_post_approval'
  | 'superseded_by_malattia';

interface LeaveRequest {
  id: string;
  user_id: string;
  user_email: string;
  user_display_name: string | null;
  type: LeaveType;
  status: LeaveStatus;
  from_ts: string;
  to_ts: string;
  duration_hours: number;
  inps_protocol: string | null;
  user_note: string | null;
  title: string | null;
  rejection_reason: string | null;
  cancellation_reason: string | null;
  assenza_subtype: AssenzaSubtype | null;
  is_paid: boolean | null;
  decided_by_display_name: string | null;
  decided_by_email: string | null;
  decided_at: string | null;
  created_at: string;
}

interface Template {
  id: string;
  name: string;
  type: 'ferie' | 'permessi';
  hours_default: number;
  accrual_amount: number;
  accrual_frequency: 'monthly' | 'yearly';
  accrual_day_of_month: number;
  accrual_month: number | null;
  active: boolean;
}

interface Assignment {
  id: string;
  user_id: string;
  user_email: string;
  user_display_name: string | null;
  template_id: string;
  template_name: string;
  type: 'ferie' | 'permessi';
  initial_balance: number;
  started_on: string;
  ended_on: string | null;
  last_accrual_on: string | null;
  accrual_amount: number;
  accrual_frequency: 'monthly' | 'yearly';
  accrual_day_of_month: number;
  accrual_month: number | null;
  accrued_total: number;
  used_approved: number;
  used_pending: number;
}

interface UserRow {
  user_id: string;
  email: string;
  display_name: string | null;
}

interface QuotaSummary {
  type: 'ferie' | 'permessi';
  assignment_id: string | null;
  template_id: string | null;
  template_name: string | null;
  initial_balance: number;
  accrued_total: number;
  used_approved: number;
  used_pending: number;
  residual_strict: number;
  residual_with_pending: number;
  last_accrual_on: string | null;
  accrual_amount: number;
  accrual_frequency: 'monthly' | 'yearly';
  accrual_day_of_month: number;
  accrual_month: number | null;
}

const TYPE_LABEL: Record<LeaveType, string> = {
  ferie: 'Ferie',
  permessi: 'Permesso',
  malattia: 'Malattia',
  assenza: 'Assenza',
};

const STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: 'In attesa',
  approved: 'Approvata',
  rejected: 'Rifiutata',
  cancelled: 'Annullata',
  cancellation_pending: 'Annullamento richiesto',
  cancelled_post_approval: 'Annullata',
  superseded_by_malattia: 'Sostituita da malattia',
};

function fmtRange(from: string, to: string, type: LeaveType): string {
  const f = new Date(from);
  const t = new Date(to);
  const sameDay = f.toDateString() === t.toDateString();
  const d: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };
  const h: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  if (type === 'permessi' && sameDay) {
    return `${f.toLocaleDateString('it-IT', d)} ${f.toLocaleTimeString('it-IT', h)}–${t.toLocaleTimeString('it-IT', h)}`;
  }
  if (sameDay) return f.toLocaleDateString('it-IT', d);
  return `${f.toLocaleDateString('it-IT', d)} → ${t.toLocaleDateString('it-IT', d)}`;
}

export function Leaves() {
  const [tab, setTab] = useState<'requests' | 'calendar' | 'quotas' | 'templates'>('requests');
  return (
    <div className="space-y-5">
      <h1 className="sr-only">Ferie & Permessi</h1>
      <div className="card p-0">
        <div className="flex border-b" style={{ borderColor: 'var(--color-border, #e5e7eb)' }}>
          <TabButton active={tab === 'requests'} onClick={() => setTab('requests')}>
            Richieste
          </TabButton>
          <TabButton active={tab === 'calendar'} onClick={() => setTab('calendar')}>
            Calendario
          </TabButton>
          <TabButton active={tab === 'quotas'} onClick={() => setTab('quotas')}>
            Quote
          </TabButton>
          <TabButton active={tab === 'templates'} onClick={() => setTab('templates')}>
            Modelli
          </TabButton>
        </div>
        <div className="p-4">
          {tab === 'requests' && <RequestsTab />}
          {tab === 'calendar' && <CalendarTab />}
          {tab === 'quotas' && <QuotasTab />}
          {tab === 'templates' && <TemplatesTab />}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`px-4 py-2 text-sm border-b-2 ${active ? 'font-semibold' : 'opacity-70'}`}
      style={{
        borderColor: active ? 'var(--color-primary, #2563eb)' : 'transparent',
      }}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/* ---------- Requests ---------- */

function RequestsTab() {
  const [rows, setRows] = useState<LeaveRequest[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<LeaveRequest | null>(null);
  const [cancelTarget, setCancelTarget] = useState<LeaveRequest | null>(null);

  async function load() {
    try {
      const r = await api<LeaveRequest[]>(`/api/v1/leaves?scope=all`);
      setRows(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    }
  }
  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  async function approve(r: LeaveRequest) {
    setErr(null);
    try {
      await api(`/api/v1/leaves/${r.id}/approve`, { method: 'POST' });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    }
  }

  async function decideCancel(r: LeaveRequest, approveCancel: boolean) {
    setErr(null);
    try {
      await api(`/api/v1/leaves/${r.id}/decide-cancellation`, {
        method: 'POST',
        json: { approve: approveCancel },
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    }
  }

  return (
    <div className="space-y-3">
      {err && (
        <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>
      )}
      <RequestsDataGrid
        rows={rows}
        onApprove={approve}
        onReject={setRejectTarget}
        onDecideCancel={decideCancel}
        onCancelApproved={setCancelTarget}
      />
      {rejectTarget && (
        <ReasonDialog
          title="Rifiuta richiesta"
          label="Motivo del rifiuto"
          onClose={() => setRejectTarget(null)}
          onSubmit={async (reason) => {
            try {
              await api(`/api/v1/leaves/${rejectTarget.id}/reject`, {
                method: 'POST',
                json: { rejection_reason: reason },
              });
              setRejectTarget(null);
              await load();
            } catch (e) {
              setErr(e instanceof Error ? e.message : 'errore');
            }
          }}
        />
      )}
      {cancelTarget && (
        <ReasonDialog
          title="Revoca richiesta approvata"
          label="Motivo della revoca"
          onClose={() => setCancelTarget(null)}
          onSubmit={async (reason) => {
            try {
              await api(`/api/v1/leaves/${cancelTarget.id}/admin-revoke`, {
                method: 'POST',
                json: { reason },
              });
              setCancelTarget(null);
              await load();
            } catch (e) {
              setErr(e instanceof Error ? e.message : 'errore');
            }
          }}
        />
      )}
    </div>
  );
}

/* ---------- Calendar (admin: all users, with per-user filter) ---------- */

function toCalEvent(r: LeaveRequest): CalendarEvent {
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    from_ts: r.from_ts,
    to_ts: r.to_ts,
    user_label: r.user_display_name || r.user_email,
    title: r.title,
  };
}

function CalendarTab() {
  const [all, setAll] = useState<LeaveRequest[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showBulk, setShowBulk] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<UserRow[]>('/api/v1/users')
      .then(setUsers)
      .catch(() => undefined);
  }, []);

  const load = useCallback(async (from: string, to: string) => {
    try {
      const r = await api<LeaveRequest[]>(`/api/v1/leaves?scope=all&from=${from}&to=${to}`);
      setAll(r);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    }
  }, []);

  const events = useMemo(
    () => all.filter((r) => !hidden.has(r.user_id)).map(toCalEvent),
    [all, hidden]
  );

  // Only users that actually appear in the loaded range are worth filtering.
  const presentUsers = useMemo(() => {
    const ids = new Set(all.map((r) => r.user_id));
    return users.filter((u) => ids.has(u.user_id));
  }, [all, users]);

  function toggle(id: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}
      <div className="flex items-center justify-between gap-2">
        <p className="muted text-sm">Calendario di tutte le assenze aziendali.</p>
        <button type="button" className="btn btn-primary" onClick={() => setShowBulk(true)}>
          + Inserisci evento
        </button>
      </div>

      {presentUsers.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setHidden(new Set())}
          >
            Tutti
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setHidden(new Set(presentUsers.map((u) => u.user_id)))}
          >
            Nessuno
          </button>
          {presentUsers.map((u) => {
            const on = !hidden.has(u.user_id);
            return (
              <button
                key={u.user_id}
                type="button"
                onClick={() => toggle(u.user_id)}
                className="rounded-full border px-2 py-0.5 text-xs"
                style={{
                  borderColor: 'var(--color-border, #e5e7eb)',
                  opacity: on ? 1 : 0.4,
                  background: on ? 'var(--color-surface-variant, #f3f4f6)' : 'transparent',
                }}
                title={on ? 'Clicca per nascondere' : 'Clicca per mostrare'}
              >
                {u.display_name || u.email}
              </button>
            );
          })}
        </div>
      )}

      <LeaveCalendar events={events} onRangeChange={load} />

      {showBulk && (
        <BulkEventModal
          users={users}
          onClose={() => setShowBulk(false)}
          onDone={() => {
            setShowBulk(false);
            // Reload current year so the new event appears immediately.
            const y = new Date().getFullYear();
            void load(`${y}-01-01`, `${y}-12-31`);
          }}
        />
      )}
    </div>
  );
}

function BulkEventModal({
  users,
  onClose,
  onDone,
}: {
  users: UserRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [deduct, setDeduct] = useState(false);
  const [allUsers, setAllUsers] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggleUser(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    setErr(null);
    if (!title.trim()) return setErr('Inserisci un titolo.');
    if (!from || !to) return setErr('Inserisci le date.');
    if (to < from) return setErr('La data di fine precede quella di inizio.');
    if (!allUsers && selected.size === 0) return setErr('Seleziona almeno un utente.');
    setBusy(true);
    try {
      await api('/api/v1/leaves/bulk', {
        method: 'POST',
        json: {
          title: title.trim(),
          from_ts: new Date(`${from}T00:00:00`).toISOString(),
          to_ts: new Date(`${to}T23:59:00`).toISOString(),
          deduct_ferie: deduct,
          user_ids: allUsers ? undefined : [...selected],
          user_note: note.trim() || undefined,
        },
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50" onClick={onClose}>
      <div className="card w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="section-title mb-3">Inserisci evento aziendale</h2>
        <div className="space-y-3">
          <div>
            <label className="label">Titolo</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Chiusura aziendale agosto" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Dal</label>
              <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="label">Al</label>
              <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={deduct} onChange={(e) => setDeduct(e.target.checked)} />
            Conteggia come ferie (scala dal monte ore). Lascia deselezionato per chiusura non retributiva.
          </label>
          <div>
            <label className="label">Destinatari</label>
            <div className="flex gap-3 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={allUsers} onChange={() => setAllUsers(true)} /> Tutti
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={!allUsers} onChange={() => setAllUsers(false)} /> Seleziona
              </label>
            </div>
            {!allUsers && (
              <div className="mt-2 max-h-40 overflow-auto rounded border p-2" style={{ borderColor: 'var(--color-border, #e5e7eb)' }}>
                {users.map((u) => (
                  <label key={u.user_id} className="flex items-center gap-2 py-0.5 text-sm">
                    <input type="checkbox" checked={selected.has(u.user_id)} onChange={() => toggleUser(u.user_id)} />
                    {u.display_name || u.email}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="label">Nota (facoltativa)</label>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Annulla</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? 'Invio…' : 'Crea e notifica'}
          </button>
        </div>
      </div>
    </div>
  );
}

function badgeForStatus(s: LeaveStatus): string {
  if (s === 'approved') return 'badge-ok';
  if (s === 'rejected' || s === 'superseded_by_malattia') return 'badge-error';
  if (s === 'pending' || s === 'cancellation_pending') return 'badge-warn';
  return 'badge-muted';
}

function ReasonDialog({
  title,
  label,
  onClose,
  onSubmit,
}: {
  title: string;
  label: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void> | void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await onSubmit(reason.trim());
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <form onSubmit={submit} className="card w-full max-w-md space-y-3">
        <h2 className="section-title">{title}</h2>
        <div>
          <label className="label">{label}</label>
          <textarea
            className="input"
            rows={3}
            required
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Annulla
          </button>
          <button type="submit" className="btn btn-danger" disabled={busy || !reason.trim()}>
            {busy ? 'Salvataggio…' : 'Conferma'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------- Quotas ---------- */

function QuotasTab() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editor, setEditor] = useState<{
    user: UserRow;
    type: 'ferie' | 'permessi';
    existing?: Assignment;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const [a, u, t] = await Promise.all([
        api<Assignment[]>('/api/v1/leave-quotas/assignments'),
        api<UserRow[]>('/api/v1/users'),
        api<Template[]>('/api/v1/leave-quotas/templates'),
      ]);
      setAssignments(a);
      setUsers(
        u.map((row) => ({
          user_id: row.user_id,
          email: row.email,
          display_name: row.display_name,
        }))
      );
      setTemplates(t);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    }
  }
  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  const grid = useMemo(() => {
    const byUser = new Map<string, { ferie?: Assignment; permessi?: Assignment }>();
    for (const a of assignments) {
      const cell = byUser.get(a.user_id) ?? {};
      cell[a.type] = a;
      byUser.set(a.user_id, cell);
    }
    return users.map((u) => ({
      user: u,
      ferie: byUser.get(u.user_id)?.ferie,
      permessi: byUser.get(u.user_id)?.permessi,
    }));
  }, [assignments, users]);

  return (
    <div className="space-y-3">
      {err && (
        <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>
      )}
      {templates.length === 0 && (
        <div className="text-sm muted">
          Crea prima un modello quota nella tab <strong>Modelli</strong>.
        </div>
      )}
      <QuotasDataGrid grid={grid} onEdit={(u, type, existing) => setEditor({ user: u, type, existing })} />
      {editor && (
        <AssignmentEditor
          user={editor.user}
          type={editor.type}
          existing={editor.existing}
          templates={templates.filter((t) => t.type === editor.type && t.active)}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function fmtAccrual(t: { accrual_amount: number; accrual_frequency: 'monthly' | 'yearly'; accrual_day_of_month: number; accrual_month: number | null }): string {
  const amt = `${t.accrual_amount}h`;
  if (t.accrual_amount === 0) return 'Nessun accredito';
  if (t.accrual_frequency === 'monthly') {
    return `${amt} ogni mese il giorno ${t.accrual_day_of_month}`;
  }
  return `${amt} ogni anno il ${t.accrual_day_of_month}/${t.accrual_month}`;
}

function balance(a: Assignment): number {
  return a.initial_balance + a.accrued_total - a.used_approved;
}

function AssignmentEditor({
  user,
  type,
  existing,
  templates,
  onClose,
  onSaved,
}: {
  user: UserRow;
  type: 'ferie' | 'permessi';
  existing?: Assignment;
  templates: Template[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const confirm = useConfirm();
  const [templateId, setTemplateId] = useState<string>(
    existing?.template_id ?? templates[0]?.id ?? ''
  );
  const [initialBalance, setInitialBalance] = useState<number>(
    existing?.initial_balance ?? 0
  );
  const [startedOn, setStartedOn] = useState<string>(
    existing?.started_on ?? new Date().toISOString().slice(0, 10)
  );
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pickedTpl = templates.find((t) => t.id === templateId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!templateId) {
      setErr('Seleziona un modello');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      if (existing) {
        await api(`/api/v1/leave-quotas/assignments/${existing.id}`, {
          method: 'PATCH',
          json: { initial_balance: initialBalance, template_id: templateId },
        });
      } else {
        await api('/api/v1/leave-quotas/assignments', {
          method: 'POST',
          json: {
            user_id: user.user_id,
            template_id: templateId,
            initial_balance: initialBalance,
            started_on: startedOn,
          },
        });
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing) return;
    if (!(await confirm({ title: 'Chiudere assegnazione?', message: 'Lo storico accrediti resta visibile.', confirmLabel: 'Chiudi' }))) return;
    try {
      await api(`/api/v1/leave-quotas/assignments/${existing.id}`, { method: 'DELETE' });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <form onSubmit={submit} className="card w-full max-w-md space-y-3">
        <h2 className="section-title">
          Quota {type === 'ferie' ? 'ferie' : 'permessi'} — {user.display_name || user.email}
        </h2>
        <div>
          <label className="label">Modello</label>
          <select
            className="input"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            <option value="">— scegli —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} — {fmtAccrual(t)}
              </option>
            ))}
          </select>
          {pickedTpl && (
            <p className="text-xs muted mt-1">{fmtAccrual(pickedTpl)}</p>
          )}
        </div>
        <div>
          <label className="label">Bilancio iniziale (ore)</label>
          <input
            type="number"
            step="0.25"
            className="input"
            value={initialBalance}
            onChange={(e) => setInitialBalance(Number(e.target.value))}
          />
          <p className="text-xs muted mt-1">
            Saldo di partenza, prima di accrediti e richieste. Può essere negativo.
          </p>
        </div>
        {!existing && (
          <div>
            <label className="label">Attivo dal</label>
            <input
              type="date"
              className="input"
              value={startedOn}
              onChange={(e) => setStartedOn(e.target.value)}
            />
          </div>
        )}
        {existing && (
          <div className="text-xs muted">
            <div>Accrediti accumulati: <strong>{existing.accrued_total}h</strong></div>
            <div>Usate (approvate): <strong>{existing.used_approved}h</strong></div>
            <div>Saldo attuale: <strong>{balance(existing).toFixed(2)}h</strong></div>
            {existing.last_accrual_on && (
              <div>Ultimo accredito: <strong>{existing.last_accrual_on}</strong></div>
            )}
          </div>
        )}
        {err && (
          <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>
        )}
        <div className="flex gap-2 justify-end">
          {existing && (
            <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
              Chiudi
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Annulla
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------- Templates ---------- */

function TemplatesTab() {
  const [rows, setRows] = useState<Template[]>([]);
  const [editor, setEditor] = useState<Partial<Template> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const confirm = useConfirm();

  async function load() {
    try {
      const r = await api<Template[]>('/api/v1/leave-quotas/templates');
      setRows(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    }
  }
  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() =>
            setEditor({
              name: '',
              type: 'ferie',
              hours_default: 176,
              accrual_amount: 176,
              accrual_frequency: 'yearly',
              accrual_day_of_month: 1,
              accrual_month: 1,
              active: true,
            })
          }
        >
          Nuovo modello
        </button>
      </div>
      {err && (
        <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>
      )}
      <TemplatesDataGrid
        rows={rows}
        onEdit={setEditor}
        onDelete={async (r) => {
          if (!(await confirm({ title: 'Eliminare modello?', danger: true, confirmLabel: 'Elimina' }))) return;
          try {
            await api(`/api/v1/leave-quotas/templates/${r.id}`, { method: 'DELETE' });
            await load();
          } catch (e) {
            setErr(e instanceof Error ? e.message : 'errore');
          }
        }}
      />
      {editor && (
        <TemplateEditor
          initial={editor}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function TemplateEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial: Partial<Template>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial.name ?? '');
  const [type, setType] = useState<'ferie' | 'permessi'>(initial.type ?? 'ferie');
  const [hoursDefault, setHoursDefault] = useState(initial.hours_default ?? 176);
  const [accrualAmount, setAccrualAmount] = useState(
    initial.accrual_amount ?? initial.hours_default ?? 176
  );
  const [frequency, setFrequency] = useState<'monthly' | 'yearly'>(
    initial.accrual_frequency ?? 'yearly'
  );
  const [dayOfMonth, setDayOfMonth] = useState(initial.accrual_day_of_month ?? 1);
  const [month, setMonth] = useState<number>(initial.accrual_month ?? 1);
  const [unit, setUnit] = useState<'hours' | 'days'>('hours');
  const [hoursPerDay, setHoursPerDay] = useState<number>(8);
  const [active, setActive] = useState(initial.active ?? true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function effectiveAccrualHours(): number {
    return unit === 'days' ? accrualAmount * hoursPerDay : accrualAmount;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const body = {
        name,
        type,
        hours_default: hoursDefault,
        accrual_amount: effectiveAccrualHours(),
        accrual_frequency: frequency,
        accrual_day_of_month: dayOfMonth,
        accrual_month: frequency === 'yearly' ? month : null,
        active,
      };
      if (initial.id) {
        await api(`/api/v1/leave-quotas/templates/${initial.id}`, {
          method: 'PATCH',
          json: body,
        });
      } else {
        await api('/api/v1/leave-quotas/templates', {
          method: 'POST',
          json: body,
        });
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    } finally {
      setBusy(false);
    }
  }

  const monthNames = [
    '— mese —',
    'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
  ];

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <form onSubmit={submit} className="card w-full max-w-lg space-y-3">
        <h2 className="section-title">
          {initial.id ? 'Modifica modello quota' : 'Nuovo modello quota'}
        </h2>
        <div>
          <label className="label">Nome</label>
          <input
            type="text"
            className="input"
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Tipo</label>
            <select
              className="input"
              value={type}
              onChange={(e) => setType(e.target.value as 'ferie' | 'permessi')}
              disabled={!!initial.id}
            >
              <option value="ferie">Ferie</option>
              <option value="permessi">Permessi</option>
            </select>
          </div>
          <div>
            <label className="label">Ore di riferimento annuali</label>
            <input
              type="number"
              step="0.25"
              min={0}
              className="input"
              value={hoursDefault}
              onChange={(e) => setHoursDefault(Number(e.target.value))}
            />
          </div>
        </div>

        <fieldset className="border rounded p-3 space-y-3" style={{ borderColor: 'var(--color-border, #e5e7eb)' }}>
          <legend className="text-xs muted px-1">Accredito automatico</legend>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="label">Quantità per accredito</label>
              <input
                type="number"
                step="0.25"
                min={0}
                className="input"
                value={accrualAmount}
                onChange={(e) => setAccrualAmount(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Unità</label>
              <select
                className="input"
                value={unit}
                onChange={(e) => setUnit(e.target.value as 'hours' | 'days')}
              >
                <option value="hours">ore</option>
                <option value="days">giorni</option>
              </select>
            </div>
          </div>
          {unit === 'days' && (
            <div>
              <label className="label">Ore per giorno (conversione)</label>
              <input
                type="number"
                step="0.25"
                min={1}
                className="input"
                value={hoursPerDay}
                onChange={(e) => setHoursPerDay(Number(e.target.value))}
              />
              <p className="text-xs muted mt-1">
                Verranno salvate {effectiveAccrualHours()}h per accredito.
              </p>
            </div>
          )}
          <div>
            <label className="label">Frequenza</label>
            <div className="flex gap-3">
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="radio"
                  name="freq"
                  checked={frequency === 'monthly'}
                  onChange={() => setFrequency('monthly')}
                />
                Mensile
              </label>
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="radio"
                  name="freq"
                  checked={frequency === 'yearly'}
                  onChange={() => setFrequency('yearly')}
                />
                Annuale
              </label>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Giorno del mese</label>
              <input
                type="number"
                min={1}
                max={28}
                className="input"
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(Number(e.target.value))}
              />
              <p className="text-xs muted mt-1">1–28 (per sicurezza in mesi corti).</p>
            </div>
            {frequency === 'yearly' && (
              <div>
                <label className="label">Mese</label>
                <select
                  className="input"
                  value={month}
                  onChange={(e) => setMonth(Number(e.target.value))}
                >
                  {monthNames.slice(1).map((n, i) => (
                    <option key={i + 1} value={i + 1}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <p className="text-xs muted">
            {frequency === 'monthly'
              ? `Ogni mese il giorno ${dayOfMonth} verranno aggiunti ${effectiveAccrualHours()}h.`
              : `Ogni anno il ${dayOfMonth} ${monthNames[month] ?? ''} verranno aggiunti ${effectiveAccrualHours()}h.`}
          </p>
        </fieldset>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          Attivo
        </label>
        {err && (
          <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Annulla
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      </form>
    </div>
  );
}

export type { QuotaSummary };

interface RequestsDataGridProps {
  rows: LeaveRequest[];
  onApprove: (r: LeaveRequest) => void;
  onReject: (r: LeaveRequest) => void;
  onDecideCancel: (r: LeaveRequest, approveCancel: boolean) => void;
  onCancelApproved: (r: LeaveRequest) => void;
}

function RequestsDataGrid({
  rows,
  onApprove,
  onReject,
  onDecideCancel,
  onCancelApproved,
}: RequestsDataGridProps) {
  const columns = useMemo<GridColDef<LeaveRequest>[]>(
    () => [
      {
        field: 'user',
        headerName: 'Utente',
        flex: 1.2,
        minWidth: 180,
        valueGetter: (_v: unknown, row: LeaveRequest) => row.user_display_name || row.user_email,
      },
      {
        field: 'type',
        headerName: 'Tipo',
        width: 130,
        type: 'singleSelect',
        valueOptions: [
          { value: 'ferie', label: 'Ferie' },
          { value: 'permessi', label: 'Permesso' },
          { value: 'malattia', label: 'Malattia' },
          { value: 'assenza', label: 'Assenza' },
        ],
        renderCell: (p: GridRenderCellParams<LeaveRequest>) => TYPE_LABEL[p.row.type as LeaveType],
      },
      {
        field: 'period',
        headerName: 'Periodo',
        flex: 1.2,
        minWidth: 200,
        sortable: false,
        valueGetter: (_v: unknown, row: LeaveRequest) => row.from_ts,
        renderCell: (p: GridRenderCellParams<LeaveRequest>) => (
          <span className="text-xs">{fmtRange(p.row.from_ts, p.row.to_ts, p.row.type)}</span>
        ),
      },
      {
        field: 'duration_hours',
        headerName: 'Ore',
        width: 90,
        type: 'number',
        align: 'left',
        headerAlign: 'left',
      },
      {
        field: 'status',
        headerName: 'Stato',
        width: 180,
        type: 'singleSelect',
        valueOptions: (Object.keys(STATUS_LABEL) as LeaveStatus[]).map((k) => ({
          value: k,
          label: STATUS_LABEL[k],
        })),
        renderCell: (p: GridRenderCellParams<LeaveRequest>) => (
          <span className={`badge ${badgeForStatus(p.row.status as LeaveStatus)}`}>
            {STATUS_LABEL[p.row.status as LeaveStatus]}
          </span>
        ),
      },
      {
        field: 'note',
        headerName: 'Note / motivo',
        flex: 1.2,
        minWidth: 200,
        sortable: false,
        valueGetter: (_v: unknown, row: LeaveRequest) =>
          [
            row.inps_protocol ? `INPS: ${row.inps_protocol}` : '',
            row.type === 'assenza' && row.assenza_subtype
              ? `${ASSENZA_SUBTYPE_LABEL[row.assenza_subtype]} (${row.is_paid ? 'retribuita' : 'non retribuita'})`
              : '',
            row.user_note ?? '',
            row.rejection_reason ? `Rifiuto: ${row.rejection_reason}` : '',
            row.cancellation_reason ? `Annullamento: ${row.cancellation_reason}` : '',
          ]
            .filter(Boolean)
            .join(' · '),
        renderCell: (p: GridRenderCellParams<LeaveRequest>) => {
          const r = p.row;
          return (
            <div className="text-xs">
              {r.type === 'malattia' && r.inps_protocol ? (
                <span>INPS: <strong>{r.inps_protocol}</strong></span>
              ) : null}
              {r.type === 'assenza' && r.assenza_subtype ? (
                <div>
                  <strong>{ASSENZA_SUBTYPE_LABEL[r.assenza_subtype]}</strong>{' '}
                  · {r.is_paid ? 'retribuita' : 'non retribuita'}
                </div>
              ) : null}
              {r.user_note ? <div className="muted">{r.user_note}</div> : null}
              {r.rejection_reason ? (
                <div style={{ color: 'var(--color-error)' }}>{r.rejection_reason}</div>
              ) : null}
              {r.cancellation_reason ? (
                <div className="muted">Annullamento: {r.cancellation_reason}</div>
              ) : null}
            </div>
          );
        },
      },
      {
        field: 'decided_by',
        headerName: 'Decisa da',
        flex: 0.8,
        minWidth: 140,
        valueGetter: (_v: unknown, row: LeaveRequest) => row.decided_by_display_name || row.decided_by_email || '',
        renderCell: (p: GridRenderCellParams<LeaveRequest>) => <span className="text-xs">{p.value || '—'}</span>,
      },
      {
        field: 'actions',
        headerName: 'Azioni',
        width: 130,
        sortable: false,
        filterable: false,
        renderCell: (p: GridRenderCellParams<LeaveRequest>) => {
          const r = p.row;
          return (
            <div className="flex gap-1">
              {r.status === 'pending' && (
                <>
                  <IconButton kind="approve" title="Approva" onClick={() => onApprove(r)} />
                  <IconButton kind="reject" title="Rifiuta" onClick={() => onReject(r)} />
                </>
              )}
              {r.status === 'cancellation_pending' && (
                <>
                  <IconButton
                    kind="approve"
                    title="Accetta annullamento"
                    onClick={() => onDecideCancel(r, true)}
                  />
                  <IconButton
                    kind="reject"
                    title="Rifiuta annullamento"
                    onClick={() => onDecideCancel(r, false)}
                  />
                </>
              )}
              {r.status === 'approved' && (
                <IconButton
                  kind="revoke"
                  title="Revoca"
                  onClick={() => onCancelApproved(r)}
                />
              )}
            </div>
          );
        },
      },
    ],
    [onApprove, onReject, onDecideCancel, onCancelApproved]
  );

  return (
    <DataGrid<LeaveRequest>
      rows={rows}
      columns={columns}
      getRowId={(r: LeaveRequest) => r.id}
      sx={dataGridSx}
      {...dataGridDefaults}
    />
  );
}

interface QuotaRow {
  user: UserRow;
  ferie?: Assignment;
  permessi?: Assignment;
}

function QuotasDataGrid({
  grid,
  onEdit,
}: {
  grid: QuotaRow[];
  onEdit: (user: UserRow, type: 'ferie' | 'permessi', existing?: Assignment) => void;
}) {
  const columns = useMemo<GridColDef<QuotaRow>[]>(
    () => [
      {
        field: 'user',
        headerName: 'Utente',
        flex: 1.2,
        minWidth: 200,
        valueGetter: (_v: unknown, row: QuotaRow) => row.user.display_name || row.user.email,
      },
      {
        field: 'ferie_balance',
        headerName: 'Saldo ferie',
        width: 160,
        sortable: true,
        valueGetter: (_v: unknown, row: QuotaRow) => (row.ferie ? balance(row.ferie) : null),
        renderCell: (p: GridRenderCellParams<QuotaRow>) => (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onEdit(p.row.user, 'ferie', p.row.ferie)}
          >
            {p.row.ferie ? `${balance(p.row.ferie).toFixed(2)}h` : 'Assegna'}
          </button>
        ),
      },
      {
        field: 'ferie_accrual',
        headerName: 'Accredito ferie',
        flex: 1,
        minWidth: 200,
        sortable: false,
        valueGetter: (_v: unknown, row: QuotaRow) => (row.ferie ? fmtAccrual(row.ferie) : ''),
        renderCell: (p: GridRenderCellParams<QuotaRow>) => (
          <span className="text-xs muted">{p.row.ferie ? fmtAccrual(p.row.ferie) : '—'}</span>
        ),
      },
      {
        field: 'permessi_balance',
        headerName: 'Saldo permessi',
        width: 170,
        sortable: true,
        valueGetter: (_v: unknown, row: QuotaRow) => (row.permessi ? balance(row.permessi) : null),
        renderCell: (p: GridRenderCellParams<QuotaRow>) => (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onEdit(p.row.user, 'permessi', p.row.permessi)}
          >
            {p.row.permessi ? `${balance(p.row.permessi).toFixed(2)}h` : 'Assegna'}
          </button>
        ),
      },
      {
        field: 'permessi_accrual',
        headerName: 'Accredito permessi',
        flex: 1,
        minWidth: 200,
        sortable: false,
        valueGetter: (_v: unknown, row: QuotaRow) => (row.permessi ? fmtAccrual(row.permessi) : ''),
        renderCell: (p: GridRenderCellParams<QuotaRow>) => (
          <span className="text-xs muted">{p.row.permessi ? fmtAccrual(p.row.permessi) : '—'}</span>
        ),
      },
    ],
    [onEdit]
  );

  return (
    <DataGrid<QuotaRow>
      rows={grid}
      columns={columns}
      getRowId={(r: QuotaRow) => r.user.user_id}
      sx={dataGridSx}
      {...dataGridDefaults}
    />
  );
}

function TemplatesDataGrid({
  rows,
  onEdit,
  onDelete,
}: {
  rows: Template[];
  onEdit: (r: Template) => void;
  onDelete: (r: Template) => void;
}) {
  const columns = useMemo<GridColDef<Template>[]>(
    () => [
      { field: 'name', headerName: 'Nome', flex: 1.2, minWidth: 180 },
      {
        field: 'type',
        headerName: 'Tipo',
        width: 130,
        type: 'singleSelect',
        valueOptions: [
          { value: 'ferie', label: 'Ferie' },
          { value: 'permessi', label: 'Permessi' },
        ],
        renderCell: (p: GridRenderCellParams<Template>) => (p.row.type === 'ferie' ? 'Ferie' : 'Permessi'),
      },
      {
        field: 'hours_default',
        headerName: 'Riferimento annuo',
        width: 160,
        type: 'number',
        align: 'left',
        headerAlign: 'left',
        renderCell: (p: GridRenderCellParams<Template>) => (
          <span className="num text-xs">{p.row.hours_default}h</span>
        ),
      },
      {
        field: 'accrual',
        headerName: 'Accredito',
        flex: 1.2,
        minWidth: 240,
        sortable: false,
        valueGetter: (_v: unknown, row: Template) => fmtAccrual(row),
        renderCell: (p: GridRenderCellParams<Template>) => (
          <span className="text-xs">{fmtAccrual(p.row)}</span>
        ),
      },
      {
        field: 'active',
        headerName: 'Stato',
        width: 130,
        type: 'boolean',
        align: 'left',
        headerAlign: 'left',
        renderCell: (p: GridRenderCellParams<Template>) =>
          p.row.active ? (
            <span className="badge badge-ok">Attivo</span>
          ) : (
            <span className="badge badge-muted">Disattivato</span>
          ),
      },
      {
        field: 'actions',
        headerName: 'Azioni',
        width: 130,
        sortable: false,
        filterable: false,
        renderCell: (p: GridRenderCellParams<Template>) => (
          <div className="flex gap-1">
            <IconButton kind="edit" title="Modifica modello" onClick={() => onEdit(p.row)} />
            <IconButton kind="delete" title="Elimina modello" onClick={() => onDelete(p.row)} />
          </div>
        ),
      },
    ],
    [onEdit, onDelete]
  );

  return (
    <DataGrid<Template>
      rows={rows}
      columns={columns}
      getRowId={(r: Template) => r.id}
      sx={dataGridSx}
      {...dataGridDefaults}
    />
  );
}
