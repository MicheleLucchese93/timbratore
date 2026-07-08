import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DataGrid,
  type GridColDef,
  type GridRenderCellParams,
  type GridRowSelectionModel,
} from '@mui/x-data-grid';
import { api } from '../lib/api.ts';
import { dataGridDefaults, dataGridSx } from '../lib/data-grid-style.ts';
import { fmtDate, fmtTime, localeTag } from '../i18n/format.ts';
import { IconButton } from '../components/IconButton.tsx';
import { LeaveCalendar, type CalendarEvent } from '../components/LeaveCalendar.tsx';
import { NewLeaveModal } from '../components/NewLeaveModal.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { useEscapeKey } from '../hooks/useEscapeKey.ts';
import { AdminResidui } from './Residui.tsx';

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

interface Accrual {
  id: number;
  type: 'ferie' | 'permessi';
  hours: number;
  accrued_on: string;
  source: 'cron' | 'manual' | 'adjustment';
  note: string | null;
  created_at: string;
  created_by: string | null;
  created_by_display_name: string | null;
  created_by_email: string | null;
}

const ACCRUAL_SOURCE_KEY: Record<Accrual['source'], string> = {
  cron: 'accrualSource.cron',
  manual: 'accrualSource.manual',
  adjustment: 'accrualSource.adjustment',
};

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

type Translate = (key: string, opts?: Record<string, unknown>) => string;

function statusLabel(s: LeaveStatus, t: Translate): string {
  switch (s) {
    case 'pending':
      return t('common:status.pending');
    case 'approved':
      return t('common:status.approved');
    case 'rejected':
      return t('common:status.rejected');
    case 'cancellation_pending':
      return t('common:status.cancel_requested');
    case 'cancelled':
    case 'cancelled_post_approval':
      return t('status.cancelled');
    case 'superseded_by_malattia':
      return t('status.superseded_by_malattia');
  }
}

const ALL_STATUSES: LeaveStatus[] = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
  'cancellation_pending',
  'cancelled_post_approval',
  'superseded_by_malattia',
];

function fmtRange(from: string, to: string, type: LeaveType): string {
  const f = new Date(from);
  const t = new Date(to);
  const sameDay = f.toDateString() === t.toDateString();
  const d: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };
  const h: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  if (type === 'permessi' && sameDay) {
    return `${fmtDate(f, d)} ${fmtTime(f, h)}–${fmtTime(t, h)}`;
  }
  if (sameDay) return fmtDate(f, d);
  return `${fmtDate(f, d)} → ${fmtDate(t, d)}`;
}

export function Leaves() {
  const { t } = useTranslation(['leaves', 'common']);
  const [tab, setTab] = useState<'requests' | 'calendar' | 'quotas' | 'templates' | 'residui'>(
    'requests'
  );
  return (
    <div className="space-y-5">
      <PageHeader title={t('heading')} />
      <div className="card p-0">
        <div className="flex border-b" style={{ borderColor: 'var(--color-border, #e5e7eb)' }}>
          <TabButton active={tab === 'requests'} onClick={() => setTab('requests')}>
            {t('tab.requests')}
          </TabButton>
          <TabButton active={tab === 'calendar'} onClick={() => setTab('calendar')}>
            {t('tab.calendar')}
          </TabButton>
          <TabButton active={tab === 'quotas'} onClick={() => setTab('quotas')}>
            {t('tab.quotas')}
          </TabButton>
          <TabButton active={tab === 'templates'} onClick={() => setTab('templates')}>
            {t('tab.templates')}
          </TabButton>
          <TabButton active={tab === 'residui'} onClick={() => setTab('residui')}>
            {t('tab.residui')}
          </TabButton>
        </div>
        <div className="p-4">
          {tab === 'requests' && <RequestsTab />}
          {tab === 'calendar' && <CalendarTab />}
          {tab === 'quotas' && <QuotasTab />}
          {tab === 'templates' && <TemplatesTab />}
          {tab === 'residui' && <AdminResidui embedded />}
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
        borderColor: active ? 'var(--color-primary)' : 'transparent',
      }}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/* ---------- Requests ---------- */

function RequestsTab() {
  const { t } = useTranslation(['leaves', 'common']);
  const [rows, setRows] = useState<LeaveRequest[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<LeaveRequest | null>(null);
  const [cancelTarget, setCancelTarget] = useState<LeaveRequest | null>(null);
  const [showNew, setShowNew] = useState(false);

  async function load() {
    try {
      const r = await api<LeaveRequest[]>(`/api/v1/leaves?scope=all`);
      setRows(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common:state.error'));
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
      setErr(e instanceof Error ? e.message : t('common:state.error'));
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
      setErr(e instanceof Error ? e.message : t('common:state.error'));
    }
  }

  return (
    <div className="space-y-3">
      {err && (
        <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>
      )}
      <div className="flex justify-end">
        <button type="button" className="btn btn-primary" onClick={() => setShowNew(true)}>
          {t('requests.new')}
        </button>
      </div>
      <RequestsDataGrid
        rows={rows}
        onApprove={approve}
        onReject={setRejectTarget}
        onDecideCancel={decideCancel}
        onCancelApproved={setCancelTarget}
      />
      {showNew && (
        <NewLeaveModal
          onClose={() => setShowNew(false)}
          onDone={() => { setShowNew(false); void load(); }}
        />
      )}
      {rejectTarget && (
        <ReasonDialog
          title={t('reject.title')}
          label={t('reject.label')}
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
              setErr(e instanceof Error ? e.message : t('common:state.error'));
            }
          }}
        />
      )}
      {cancelTarget && (
        <ReasonDialog
          title={t('revoke.title')}
          label={t('revoke.label')}
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
              setErr(e instanceof Error ? e.message : t('common:state.error'));
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
  const { t } = useTranslation(['leaves', 'common']);
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
      setErr(e instanceof Error ? e.message : t('common:state.error'));
    }
  }, [t]);

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
        <p className="muted text-sm">{t('calendar.intro')}</p>
        <button type="button" className="btn btn-primary" onClick={() => setShowBulk(true)}>
          {t('calendar.addEvent')}
        </button>
      </div>

      {presentUsers.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setHidden(new Set())}
          >
            {t('common:state.all')}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setHidden(new Set(presentUsers.map((u) => u.user_id)))}
          >
            {t('common:state.none')}
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
                title={on ? t('calendar.clickToHide') : t('calendar.clickToShow')}
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
  const { t } = useTranslation(['leaves', 'common']);
  useEscapeKey(onClose);
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
    if (!title.trim()) return setErr(t('bulk.errTitle'));
    if (!from || !to) return setErr(t('bulk.errDates'));
    if (to < from) return setErr(t('bulk.errOrder'));
    if (!allUsers && selected.size === 0) return setErr(t('bulk.errSelect'));
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
      setErr(e instanceof Error ? e.message : t('common:state.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50" onClick={onClose}>
      <div className="card w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="section-title mb-3">{t('bulk.title')}</h2>
        <div className="space-y-3">
          <div>
            <label className="label">{t('bulk.titleLabel')}</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('bulk.titlePlaceholder')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('bulk.from')}</label>
              <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="label">{t('bulk.to')}</label>
              <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={deduct} onChange={(e) => setDeduct(e.target.checked)} />
            {t('bulk.deduct')}
          </label>
          <div>
            <label className="label">{t('bulk.recipients')}</label>
            <div className="flex gap-3 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={allUsers} onChange={() => setAllUsers(true)} /> {t('bulk.allUsers')}
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={!allUsers} onChange={() => setAllUsers(false)} /> {t('bulk.select')}
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
            <label className="label">{t('bulk.note')}</label>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>{t('common:btn.cancel')}</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? t('bulk.sending') : t('bulk.createNotify')}
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
  const { t } = useTranslation(['leaves', 'common']);
  useEscapeKey(onClose);
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
            {t('common:btn.cancel')}
          </button>
          <button type="submit" className="btn btn-danger" disabled={busy || !reason.trim()}>
            {busy ? t('common:state.saving') : t('common:btn.confirm')}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------- Quotas ---------- */

function QuotasTab() {
  const { t } = useTranslation(['leaves', 'common']);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editor, setEditor] = useState<{
    user: UserRow;
    type: 'ferie' | 'permessi';
    existing?: Assignment;
  } | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<QuotaRow | null>(null);
  const [historyTarget, setHistoryTarget] = useState<UserRow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rowSelection, setRowSelection] = useState<GridRowSelectionModel>({
    type: 'include',
    ids: new Set<string>(),
  });
  const [bulkOpen, setBulkOpen] = useState(false);
  function clearSelection() {
    setRowSelection({ type: 'include', ids: new Set() });
  }

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
      setErr(e instanceof Error ? e.message : t('common:state.error'));
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

  // MUI's "select all" header returns an exclude-model ({type:'exclude', ids:∅}),
  // so resolve the selection against the row list to cover both modes.
  const selectedIds = useMemo(() => {
    const all = grid.map((r) => r.user.user_id);
    return rowSelection.type === 'exclude'
      ? all.filter((id) => !rowSelection.ids.has(id))
      : all.filter((id) => rowSelection.ids.has(id));
  }, [grid, rowSelection]);
  const selectedCount = selectedIds.length;

  return (
    <div className="space-y-3">
      {err && (
        <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>
      )}
      {templates.length === 0 && (
        <div className="text-sm muted">
          {t('quotas.noTemplatesPre')}<strong>{t('tab.templates')}</strong>{t('quotas.noTemplatesPost')}
        </div>
      )}
      <div className="card" style={{ padding: 0 }}>
        {selectedCount > 0 && (
          <div className="bulk-bar">
            <div>
              <strong>{selectedCount}</strong> {t('quotas.selected', { count: selectedCount })}
            </div>
            <div className="bulk-bar-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={templates.length === 0}
                onClick={() => setBulkOpen(true)}
              >
                {t('quotas.bulkAssign')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={clearSelection}>
                {t('common:btn.cancel')}
              </button>
            </div>
          </div>
        )}
        <QuotasDataGrid
          grid={grid}
          rowSelection={rowSelection}
          onRowSelectionChange={setRowSelection}
          onEdit={(u, type, existing) => setEditor({ user: u, type, existing })}
          onAdjust={setAdjustTarget}
          onHistory={setHistoryTarget}
        />
      </div>
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
      {adjustTarget && (
        <ManualAdjustModal
          row={adjustTarget}
          onClose={() => setAdjustTarget(null)}
          onSaved={async () => {
            setAdjustTarget(null);
            await load();
          }}
        />
      )}
      {historyTarget && (
        <AuditLogModal user={historyTarget} onClose={() => setHistoryTarget(null)} />
      )}
      {bulkOpen && (
        <BulkAssignQuotaModal
          userIds={selectedIds}
          templates={templates.filter((tpl) => tpl.active)}
          onClose={() => setBulkOpen(false)}
          onSaved={async () => {
            setBulkOpen(false);
            clearSelection();
            await load();
          }}
        />
      )}
    </div>
  );
}

/* ---------- Bulk quota assignment ---------- */

function BulkAssignQuotaModal({
  userIds,
  templates,
  onClose,
  onSaved,
}: {
  userIds: string[];
  templates: Template[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation(['leaves', 'common']);
  useEscapeKey(onClose);
  const [type, setType] = useState<'ferie' | 'permessi'>('ferie');
  const byType = useMemo(() => templates.filter((tpl) => tpl.type === type), [templates, type]);
  const [templateId, setTemplateId] = useState<string>('');
  const [initialBalance, setInitialBalance] = useState<number>(0);
  const [startedOn, setStartedOn] = useState<string>(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Keep the picked template valid when the type filter changes.
  useEffect(() => {
    setTemplateId((prev) => (byType.some((tpl) => tpl.id === prev) ? prev : byType[0]?.id ?? ''));
  }, [byType]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!templateId) {
      setErr(t('editor.errTemplate'));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await Promise.all(
        userIds.map((uid) =>
          api('/api/v1/leave-quotas/assignments', {
            method: 'POST',
            json: {
              user_id: uid,
              template_id: templateId,
              initial_balance: initialBalance,
              started_on: startedOn,
            },
          })
        )
      );
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common:state.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <form onSubmit={submit} className="card w-full max-w-2xl space-y-3">
        <h2 className="section-title">{t('quotas.bulkTitle', { count: userIds.length })}</h2>
        <div>
          <label className="label">{t('adjust.type')}</label>
          <select
            className="input"
            value={type}
            onChange={(e) => setType(e.target.value as 'ferie' | 'permessi')}
          >
            <option value="ferie">{t('common:leaveType.ferie')}</option>
            <option value="permessi">{t('quotas.permessiPlural')}</option>
          </select>
        </div>
        <div>
          <label className="label">{t('editor.template')}</label>
          <select
            className="input"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            <option value="">{t('editor.choose')}</option>
            {byType.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name} — {fmtAccrual(tpl, t)}
              </option>
            ))}
          </select>
          {byType.length === 0 && (
            <p className="text-xs muted mt-1">{t('quotas.bulkNoTemplates')}</p>
          )}
        </div>
        <div>
          <label className="label">{t('editor.initialBalance')}</label>
          <input
            type="number"
            step="0.25"
            className="input"
            value={initialBalance}
            onChange={(e) => setInitialBalance(Number(e.target.value))}
          />
          <p className="text-xs muted mt-1">{t('editor.initialBalanceHint')}</p>
        </div>
        <div>
          <label className="label">{t('editor.activeFrom')}</label>
          <input
            type="date"
            className="input"
            value={startedOn}
            onChange={(e) => setStartedOn(e.target.value)}
          />
        </div>
        <div className="callout callout-warn text-sm">{t('quotas.bulkOverwrite')}</div>
        {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {t('common:btn.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !templateId}>
            {busy ? t('common:state.saving') : t('common:btn.save')}
          </button>
        </div>
      </form>
    </div>
  );
}

function fmtAccrual(
  t: { accrual_amount: number; accrual_frequency: 'monthly' | 'yearly'; accrual_day_of_month: number; accrual_month: number | null },
  tr: Translate
): string {
  if (t.accrual_amount === 0) return tr('accrual.none');
  if (t.accrual_frequency === 'monthly') {
    return tr('accrual.monthly', { amount: t.accrual_amount, day: t.accrual_day_of_month });
  }
  return tr('accrual.yearly', { amount: t.accrual_amount, day: t.accrual_day_of_month, month: t.accrual_month });
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
  const { t } = useTranslation(['leaves', 'common']);
  useEscapeKey(onClose);
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
      setErr(t('editor.errTemplate'));
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
      setErr(e instanceof Error ? e.message : t('common:state.error'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing) return;
    if (!(await confirm({ title: t('editor.closeTitle'), message: t('editor.closeMessage'), confirmLabel: t('editor.closeConfirm') }))) return;
    try {
      await api(`/api/v1/leave-quotas/assignments/${existing.id}`, { method: 'DELETE' });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common:state.error'));
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <form onSubmit={submit} className="card w-full max-w-2xl space-y-3">
        <h2 className="section-title">
          {t('editor.title', {
            type: type === 'ferie' ? t('common:leaveType.ferie') : t('quotas.permessiPlural'),
            user: user.display_name || user.email,
          })}
        </h2>
        <div>
          <label className="label">{t('editor.template')}</label>
          <select
            className="input"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            <option value="">{t('editor.choose')}</option>
            {templates.map((t2) => (
              <option key={t2.id} value={t2.id}>
                {t2.name} — {fmtAccrual(t2, t)}
              </option>
            ))}
          </select>
          {pickedTpl && (
            <p className="text-xs muted mt-1">{fmtAccrual(pickedTpl, t)}</p>
          )}
        </div>
        <div>
          <label className="label">{t('editor.initialBalance')}</label>
          <input
            type="number"
            step="0.25"
            className="input"
            value={initialBalance}
            onChange={(e) => setInitialBalance(Number(e.target.value))}
          />
          <p className="text-xs muted mt-1">
            {t('editor.initialBalanceHint')}
          </p>
        </div>
        {!existing && (
          <div>
            <label className="label">{t('editor.activeFrom')}</label>
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
            <div>{t('editor.accruedTotal')}: <strong>{existing.accrued_total}h</strong></div>
            <div>{t('editor.usedApproved')}: <strong>{existing.used_approved}h</strong></div>
            <div>{t('editor.currentBalance')}: <strong>{balance(existing).toFixed(2)}h</strong></div>
            {existing.last_accrual_on && (
              <div>{t('editor.lastAccrual')}: <strong>{existing.last_accrual_on}</strong></div>
            )}
          </div>
        )}
        {err && (
          <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>
        )}
        <div className="flex gap-2 justify-end">
          {existing && (
            <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
              {t('common:btn.close')}
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {t('common:btn.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t('common:state.saving') : t('common:btn.save')}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------- Manual hours adjustment + audit log ---------- */

function ManualAdjustModal({
  row,
  onClose,
  onSaved,
}: {
  row: QuotaRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation(['leaves', 'common']);
  useEscapeKey(onClose);
  const available = useMemo(
    () =>
      (['ferie', 'permessi'] as const).filter(
        (t) => (t === 'ferie' ? row.ferie : row.permessi) !== undefined
      ),
    [row]
  );
  const [type, setType] = useState<'ferie' | 'permessi'>(available[0] ?? 'ferie');
  const [direction, setDirection] = useState<'add' | 'remove'>('add');
  const [hours, setHours] = useState<number>(0);
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const assignment = type === 'ferie' ? row.ferie : row.permessi;
  const userLabel = row.user.display_name || row.user.email;
  const typeLabel = type === 'ferie' ? t('common:leaveType.ferie') : t('quotas.permessiPlural');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!assignment) {
      setErr(t('adjust.errNoQuota'));
      return;
    }
    if (!(hours > 0)) {
      setErr(t('adjust.errHours'));
      return;
    }
    const signed = direction === 'remove' ? -hours : hours;
    setBusy(true);
    try {
      await api(`/api/v1/leave-quotas/assignments/${assignment.id}/accruals`, {
        method: 'POST',
        json: { hours: signed, accrued_on: date, note: note.trim() || undefined, source: 'manual' },
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common:state.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <form onSubmit={submit} className="card w-full max-w-2xl space-y-3">
        <h2 className="section-title">{t('adjust.title', { user: userLabel })}</h2>
        <p className="text-xs muted">
          {t('adjust.intro')}
        </p>
        {available.length > 1 ? (
          <div>
            <label className="label">{t('adjust.type')}</label>
            <select
              className="input"
              aria-label={t('adjust.type')}
              value={type}
              onChange={(e) => setType(e.target.value as 'ferie' | 'permessi')}
            >
              <option value="ferie">{t('common:leaveType.ferie')}</option>
              <option value="permessi">{t('quotas.permessiPlural')}</option>
            </select>
          </div>
        ) : (
          <div className="text-sm">
            {t('adjust.type')}: <strong>{typeLabel}</strong>
          </div>
        )}
        <div>
          <label className="label">{t('adjust.operation')}</label>
          <div className="flex gap-3">
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="direction"
                checked={direction === 'add'}
                onChange={() => setDirection('add')}
              />
              {t('adjust.add')}
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="direction"
                checked={direction === 'remove'}
                onChange={() => setDirection('remove')}
              />
              {t('adjust.remove')}
            </label>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">{t('common:unit.hours')}</label>
            <input
              type="number"
              step="0.25"
              min={0}
              className="input"
              aria-label={t('common:unit.hours')}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              autoFocus
            />
          </div>
          <div>
            <label className="label">{t('adjust.date')}</label>
            <input
              type="date"
              className="input"
              aria-label={t('adjust.date')}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="label">{t('adjust.note')}</label>
          <input
            className="input"
            aria-label={t('adjust.noteAria')}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('adjust.notePlaceholder')}
          />
        </div>
        {assignment && (
          <p className="text-xs muted">
            {t('adjust.currentBalance', { type: typeLabel })}: <strong>{balance(assignment).toFixed(2)}h</strong>
            {hours > 0 && (
              <>
                {' → '}
                <strong>{(balance(assignment) + (direction === 'remove' ? -hours : hours)).toFixed(2)}h</strong>
              </>
            )}
          </p>
        )}
        {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {t('common:btn.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t('common:state.saving') : t('common:btn.save')}
          </button>
        </div>
      </form>
    </div>
  );
}

function fmtSignedHours(h: number): string {
  return `${h > 0 ? '+' : ''}${h.toFixed(2)}h`;
}

function AuditLogModal({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const { t } = useTranslation(['leaves', 'common']);
  useEscapeKey(onClose);
  const [rows, setRows] = useState<Accrual[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<Accrual[]>(`/api/v1/leave-quotas/users/${user.user_id}/accruals`)
      .then(setRows)
      .catch((e) => setErr(e instanceof Error ? e.message : t('common:state.error')));
  }, [user.user_id, t]);

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50" onClick={onClose}>
      <div className="card w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="section-title mb-3">
          {t('audit.title', { user: user.display_name || user.email })}
        </h2>
        {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}
        {rows && rows.length === 0 && (
          <p className="text-sm muted">{t('audit.empty')}</p>
        )}
        {rows && rows.length > 0 && (
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left muted text-xs">
                  <th className="py-1 pr-3">{t('audit.colDate')}</th>
                  <th className="py-1 pr-3">{t('audit.colType')}</th>
                  <th className="py-1 pr-3">{t('audit.colChange')}</th>
                  <th className="py-1 pr-3">{t('audit.colSource')}</th>
                  <th className="py-1 pr-3">{t('audit.colNote')}</th>
                  <th className="py-1 pr-3">{t('audit.colBy')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t" style={{ borderColor: 'var(--color-border, #e5e7eb)' }}>
                    <td className="py-1 pr-3 whitespace-nowrap">{r.accrued_on}</td>
                    <td className="py-1 pr-3">{r.type === 'ferie' ? t('common:leaveType.ferie') : t('quotas.permessiPlural')}</td>
                    <td
                      className="py-1 pr-3 num whitespace-nowrap"
                      style={{ color: r.hours < 0 ? 'var(--color-error)' : 'var(--color-success, #16a34a)' }}
                    >
                      {fmtSignedHours(r.hours)}
                    </td>
                    <td className="py-1 pr-3">{t(`leaves:${ACCRUAL_SOURCE_KEY[r.source]}`)}</td>
                    <td className="py-1 pr-3 muted">{r.note || '—'}</td>
                    <td className="py-1 pr-3">
                      {r.source === 'cron'
                        ? t('audit.system')
                        : r.created_by_display_name || r.created_by_email || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('common:btn.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Templates ---------- */

function TemplatesTab() {
  const { t } = useTranslation(['leaves', 'common']);
  const [rows, setRows] = useState<Template[]>([]);
  const [editor, setEditor] = useState<Partial<Template> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const confirm = useConfirm();

  async function load() {
    try {
      const r = await api<Template[]>('/api/v1/leave-quotas/templates');
      setRows(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common:state.error'));
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
          className="btn btn-primary"
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
          {t('templates.new')}
        </button>
      </div>
      {err && (
        <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>
      )}
      <TemplatesDataGrid
        rows={rows}
        onEdit={setEditor}
        onDelete={async (r) => {
          if (!(await confirm({ title: t('templates.deleteTitle'), danger: true, confirmLabel: t('common:btn.delete') }))) return;
          try {
            await api(`/api/v1/leave-quotas/templates/${r.id}`, { method: 'DELETE' });
            await load();
          } catch (e) {
            setErr(e instanceof Error ? e.message : t('common:state.error'));
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
  const { t } = useTranslation(['leaves', 'common']);
  useEscapeKey(onClose);
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
      setErr(e instanceof Error ? e.message : t('common:state.error'));
    } finally {
      setBusy(false);
    }
  }

  // Month names derived from the active locale (index 0 = unselected placeholder).
  const monthNames = useMemo(() => {
    const names = ['', ...Array.from({ length: 12 }, (_, i) =>
      new Date(2000, i, 1).toLocaleDateString(localeTag(), { month: 'long' })
    )];
    names[0] = t('templateForm.monthPlaceholder');
    return names;
  }, [t]);

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <form onSubmit={submit} className="card w-full max-w-3xl space-y-3">
        <h2 className="section-title">
          {initial.id ? t('templateForm.editTitle') : t('templateForm.newTitle')}
        </h2>
        <div>
          <label className="label">{t('templateForm.name')}</label>
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
            <label className="label">{t('adjust.type')}</label>
            <select
              className="input"
              value={type}
              onChange={(e) => setType(e.target.value as 'ferie' | 'permessi')}
              disabled={!!initial.id}
            >
              <option value="ferie">{t('common:leaveType.ferie')}</option>
              <option value="permessi">{t('quotas.permessiPlural')}</option>
            </select>
          </div>
          <div>
            <label className="label">{t('templateForm.annualHours')}</label>
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
          <legend className="text-xs muted px-1">{t('templateForm.autoAccrual')}</legend>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="label">{t('templateForm.amountPer')}</label>
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
              <label className="label">{t('templateForm.unit')}</label>
              <select
                className="input"
                value={unit}
                onChange={(e) => setUnit(e.target.value as 'hours' | 'days')}
              >
                <option value="hours">{t('templateForm.unitHours')}</option>
                <option value="days">{t('templateForm.unitDays')}</option>
              </select>
            </div>
          </div>
          {unit === 'days' && (
            <div>
              <label className="label">{t('templateForm.hoursPerDay')}</label>
              <input
                type="number"
                step="0.25"
                min={1}
                className="input"
                value={hoursPerDay}
                onChange={(e) => setHoursPerDay(Number(e.target.value))}
              />
              <p className="text-xs muted mt-1">
                {t('templateForm.willSave', { hours: effectiveAccrualHours() })}
              </p>
            </div>
          )}
          <div>
            <label className="label">{t('templateForm.frequency')}</label>
            <div className="flex gap-3">
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="radio"
                  name="freq"
                  checked={frequency === 'monthly'}
                  onChange={() => setFrequency('monthly')}
                />
                {t('templateForm.monthly')}
              </label>
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="radio"
                  name="freq"
                  checked={frequency === 'yearly'}
                  onChange={() => setFrequency('yearly')}
                />
                {t('templateForm.yearly')}
              </label>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">{t('templateForm.dayOfMonth')}</label>
              <input
                type="number"
                min={1}
                max={28}
                className="input"
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(Number(e.target.value))}
              />
              <p className="text-xs muted mt-1">{t('templateForm.dayHint')}</p>
            </div>
            {frequency === 'yearly' && (
              <div>
                <label className="label">{t('templateForm.month')}</label>
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
              ? t('templateForm.summaryMonthly', { day: dayOfMonth, hours: effectiveAccrualHours() })
              : t('templateForm.summaryYearly', { day: dayOfMonth, month: monthNames[month] ?? '', hours: effectiveAccrualHours() })}
          </p>
        </fieldset>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          {t('templateForm.active')}
        </label>
        {err && (
          <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {t('common:btn.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t('common:state.saving') : t('common:btn.save')}
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
  const { t } = useTranslation(['leaves', 'common']);
  const columns = useMemo<GridColDef<LeaveRequest>[]>(
    () => [
      {
        field: 'user',
        headerName: t('col.user'),
        flex: 1.2,
        minWidth: 180,
        valueGetter: (_v: unknown, row: LeaveRequest) => row.user_display_name || row.user_email,
      },
      {
        field: 'type',
        headerName: t('col.type'),
        width: 130,
        type: 'singleSelect',
        valueOptions: [
          { value: 'ferie', label: t('common:leaveType.ferie') },
          { value: 'permessi', label: t('common:leaveType.permessi') },
          { value: 'malattia', label: t('common:leaveType.malattia') },
          { value: 'assenza', label: t('common:leaveType.assenza') },
        ],
        renderCell: (p: GridRenderCellParams<LeaveRequest>) => t(`common:leaveType.${p.row.type as LeaveType}`),
      },
      {
        field: 'period',
        headerName: t('col.period'),
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
        headerName: t('common:unit.hours'),
        width: 90,
        type: 'number',
        align: 'left',
        headerAlign: 'left',
      },
      {
        field: 'status',
        headerName: t('col.status'),
        width: 180,
        type: 'singleSelect',
        valueOptions: ALL_STATUSES.map((k) => ({
          value: k,
          label: statusLabel(k, t),
        })),
        renderCell: (p: GridRenderCellParams<LeaveRequest>) => (
          <span className={`badge ${badgeForStatus(p.row.status as LeaveStatus)}`}>
            {statusLabel(p.row.status as LeaveStatus, t)}
          </span>
        ),
      },
      {
        field: 'note',
        headerName: t('col.notes'),
        flex: 1.2,
        minWidth: 200,
        sortable: false,
        valueGetter: (_v: unknown, row: LeaveRequest) =>
          [
            row.inps_protocol ? `${t('note.inps')}: ${row.inps_protocol}` : '',
            row.type === 'assenza' && row.assenza_subtype
              ? `${t(`common:assenzaSubtype.${row.assenza_subtype}`)} (${row.is_paid ? t('note.paid') : t('note.unpaid')})`
              : '',
            row.user_note ?? '',
            row.rejection_reason ? `${t('note.rejection')}: ${row.rejection_reason}` : '',
            row.cancellation_reason ? `${t('note.cancellation')}: ${row.cancellation_reason}` : '',
          ]
            .filter(Boolean)
            .join(' · '),
        renderCell: (p: GridRenderCellParams<LeaveRequest>) => {
          const r = p.row;
          return (
            <div className="text-xs">
              {r.type === 'malattia' && r.inps_protocol ? (
                <span>{t('note.inps')}: <strong>{r.inps_protocol}</strong></span>
              ) : null}
              {r.type === 'assenza' && r.assenza_subtype ? (
                <div>
                  <strong>{t(`common:assenzaSubtype.${r.assenza_subtype}`)}</strong>{' '}
                  · {r.is_paid ? t('note.paid') : t('note.unpaid')}
                </div>
              ) : null}
              {r.user_note ? <div className="muted">{r.user_note}</div> : null}
              {r.rejection_reason ? (
                <div style={{ color: 'var(--color-error)' }}>{r.rejection_reason}</div>
              ) : null}
              {r.cancellation_reason ? (
                <div className="muted">{t('note.cancellation')}: {r.cancellation_reason}</div>
              ) : null}
            </div>
          );
        },
      },
      {
        field: 'decided_by',
        headerName: t('col.decidedBy'),
        flex: 0.8,
        minWidth: 140,
        valueGetter: (_v: unknown, row: LeaveRequest) => row.decided_by_display_name || row.decided_by_email || '',
        renderCell: (p: GridRenderCellParams<LeaveRequest>) => <span className="text-xs">{p.value || '—'}</span>,
      },
      {
        field: 'actions',
        headerName: t('col.actions'),
        width: 130,
        sortable: false,
        filterable: false,
        renderCell: (p: GridRenderCellParams<LeaveRequest>) => {
          const r = p.row;
          return (
            <div className="flex gap-1">
              {r.status === 'pending' && (
                <>
                  <IconButton kind="approve" title={t('common:btn.approve')} onClick={() => onApprove(r)} />
                  <IconButton kind="reject" title={t('common:btn.reject')} onClick={() => onReject(r)} />
                </>
              )}
              {r.status === 'cancellation_pending' && (
                <>
                  <IconButton
                    kind="approve"
                    title={t('action.acceptCancel')}
                    onClick={() => onDecideCancel(r, true)}
                  />
                  <IconButton
                    kind="reject"
                    title={t('action.rejectCancel')}
                    onClick={() => onDecideCancel(r, false)}
                  />
                </>
              )}
              {r.status === 'approved' && (
                <IconButton
                  kind="revoke"
                  title={t('action.revoke')}
                  onClick={() => onCancelApproved(r)}
                />
              )}
            </div>
          );
        },
      },
    ],
    [t, onApprove, onReject, onDecideCancel, onCancelApproved]
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
  rowSelection,
  onRowSelectionChange,
  onEdit,
  onAdjust,
  onHistory,
}: {
  grid: QuotaRow[];
  rowSelection: GridRowSelectionModel;
  onRowSelectionChange: (model: GridRowSelectionModel) => void;
  onEdit: (user: UserRow, type: 'ferie' | 'permessi', existing?: Assignment) => void;
  onAdjust: (row: QuotaRow) => void;
  onHistory: (user: UserRow) => void;
}) {
  const { t } = useTranslation(['leaves', 'common']);
  const columns = useMemo<GridColDef<QuotaRow>[]>(
    () => [
      {
        field: 'user',
        headerName: t('col.user'),
        flex: 1.2,
        minWidth: 200,
        valueGetter: (_v: unknown, row: QuotaRow) => row.user.display_name || row.user.email,
      },
      {
        field: 'ferie_balance',
        headerName: t('quotas.ferieBalance'),
        width: 160,
        sortable: true,
        valueGetter: (_v: unknown, row: QuotaRow) => (row.ferie ? balance(row.ferie) : null),
        renderCell: (p: GridRenderCellParams<QuotaRow>) => (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onEdit(p.row.user, 'ferie', p.row.ferie)}
          >
            {p.row.ferie ? `${balance(p.row.ferie).toFixed(2)}h` : t('quotas.assign')}
          </button>
        ),
      },
      {
        field: 'ferie_accrual',
        headerName: t('quotas.ferieAccrual'),
        flex: 1,
        minWidth: 200,
        sortable: false,
        valueGetter: (_v: unknown, row: QuotaRow) => (row.ferie ? fmtAccrual(row.ferie, t) : ''),
        renderCell: (p: GridRenderCellParams<QuotaRow>) => (
          <span className="text-xs muted">{p.row.ferie ? fmtAccrual(p.row.ferie, t) : '—'}</span>
        ),
      },
      {
        field: 'permessi_balance',
        headerName: t('quotas.permessiBalance'),
        width: 170,
        sortable: true,
        valueGetter: (_v: unknown, row: QuotaRow) => (row.permessi ? balance(row.permessi) : null),
        renderCell: (p: GridRenderCellParams<QuotaRow>) => (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onEdit(p.row.user, 'permessi', p.row.permessi)}
          >
            {p.row.permessi ? `${balance(p.row.permessi).toFixed(2)}h` : t('quotas.assign')}
          </button>
        ),
      },
      {
        field: 'permessi_accrual',
        headerName: t('quotas.permessiAccrual'),
        flex: 1,
        minWidth: 200,
        sortable: false,
        valueGetter: (_v: unknown, row: QuotaRow) => (row.permessi ? fmtAccrual(row.permessi, t) : ''),
        renderCell: (p: GridRenderCellParams<QuotaRow>) => (
          <span className="text-xs muted">{p.row.permessi ? fmtAccrual(p.row.permessi, t) : '—'}</span>
        ),
      },
      {
        field: 'actions',
        headerName: t('col.actions'),
        width: 110,
        sortable: false,
        filterable: false,
        renderCell: (p: GridRenderCellParams<QuotaRow>) => {
          const hasQuota = Boolean(p.row.ferie || p.row.permessi);
          return (
            <div className="flex gap-1">
              <IconButton
                kind="adjust"
                title={hasQuota ? t('quotas.adjustHours') : t('quotas.assignFirst')}
                disabled={!hasQuota}
                onClick={() => onAdjust(p.row)}
              />
              <IconButton
                kind="history"
                title={t('quotas.manualHistory')}
                onClick={() => onHistory(p.row.user)}
              />
            </div>
          );
        },
      },
    ],
    [t, onEdit, onAdjust, onHistory]
  );

  return (
    <DataGrid<QuotaRow>
      rows={grid}
      columns={columns}
      getRowId={(r: QuotaRow) => r.user.user_id}
      checkboxSelection
      rowSelectionModel={rowSelection}
      onRowSelectionModelChange={onRowSelectionChange}
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
  const { t } = useTranslation(['leaves', 'common']);
  const columns = useMemo<GridColDef<Template>[]>(
    () => [
      { field: 'name', headerName: t('templateForm.name'), flex: 1.2, minWidth: 180 },
      {
        field: 'type',
        headerName: t('col.type'),
        width: 130,
        type: 'singleSelect',
        valueOptions: [
          { value: 'ferie', label: t('common:leaveType.ferie') },
          { value: 'permessi', label: t('quotas.permessiPlural') },
        ],
        renderCell: (p: GridRenderCellParams<Template>) => (p.row.type === 'ferie' ? t('common:leaveType.ferie') : t('quotas.permessiPlural')),
      },
      {
        field: 'hours_default',
        headerName: t('templates.annualRef'),
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
        headerName: t('templates.accrual'),
        flex: 1.2,
        minWidth: 240,
        sortable: false,
        valueGetter: (_v: unknown, row: Template) => fmtAccrual(row, t),
        renderCell: (p: GridRenderCellParams<Template>) => (
          <span className="text-xs">{fmtAccrual(p.row, t)}</span>
        ),
      },
      {
        field: 'active',
        headerName: t('col.status'),
        width: 130,
        type: 'boolean',
        align: 'left',
        headerAlign: 'left',
        renderCell: (p: GridRenderCellParams<Template>) =>
          p.row.active ? (
            <span className="badge badge-ok">{t('templates.active')}</span>
          ) : (
            <span className="badge badge-muted">{t('templates.inactive')}</span>
          ),
      },
      {
        field: 'actions',
        headerName: t('col.actions'),
        width: 130,
        sortable: false,
        filterable: false,
        renderCell: (p: GridRenderCellParams<Template>) => (
          <div className="flex gap-1">
            <IconButton kind="edit" title={t('templates.editTemplate')} onClick={() => onEdit(p.row)} />
            <IconButton kind="delete" title={t('templates.deleteTemplate')} onClick={() => onDelete(p.row)} />
          </div>
        ),
      },
    ],
    [t, onEdit, onDelete]
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
