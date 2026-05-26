import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.ts';

type LeaveType = 'ferie' | 'permessi' | 'malattia';
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
  rejection_reason: string | null;
  cancellation_reason: string | null;
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
  year: number;
  hours_total: number;
  hours_carried_in: number;
}

interface UserRow {
  user_id: string;
  email: string;
  display_name: string | null;
}

interface QuotaSummary {
  type: 'ferie' | 'permessi';
  year: number;
  total: number;
  carry_in: number;
  used_approved: number;
  used_pending: number;
  residual_strict: number;
  residual_with_pending: number;
}

const TYPE_LABEL: Record<LeaveType, string> = {
  ferie: 'Ferie',
  permessi: 'Permesso',
  malattia: 'Malattia',
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
  const [tab, setTab] = useState<'requests' | 'quotas' | 'templates'>('requests');
  return (
    <div className="space-y-5">
      <header>
        <h1 className="page-title">Ferie & Permessi</h1>
        <p className="muted text-sm mt-0.5">
          Richieste di ferie, permessi e malattia; quote e modelli.
        </p>
      </header>
      <div className="card p-0">
        <div className="flex border-b" style={{ borderColor: 'var(--color-border, #e5e7eb)' }}>
          <TabButton active={tab === 'requests'} onClick={() => setTab('requests')}>
            Richieste
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
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<LeaveRequest | null>(null);
  const [cancelTarget, setCancelTarget] = useState<LeaveRequest | null>(null);

  async function load() {
    try {
      const qs = new URLSearchParams({ scope: 'all' });
      if (statusFilter) qs.set('status', statusFilter);
      if (typeFilter) qs.set('type', typeFilter);
      const r = await api<LeaveRequest[]>(`/api/v1/leaves?${qs}`);
      setRows(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    }
  }
  useEffect(() => {
    load().catch(() => undefined);
  }, [statusFilter, typeFilter]);

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
      <div className="flex gap-2 flex-wrap items-end">
        <div>
          <label className="label">Stato</label>
          <select
            className="input"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">Tutti</option>
            <option value="pending">In attesa</option>
            <option value="approved">Approvate</option>
            <option value="rejected">Rifiutate</option>
            <option value="cancellation_pending">Annullamento richiesto</option>
            <option value="cancelled">Annullate</option>
            <option value="cancelled_post_approval">Annullate post-approvazione</option>
            <option value="superseded_by_malattia">Sostituite da malattia</option>
          </select>
        </div>
        <div>
          <label className="label">Tipo</label>
          <select
            className="input"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">Tutti</option>
            <option value="ferie">Ferie</option>
            <option value="permessi">Permesso</option>
            <option value="malattia">Malattia</option>
          </select>
        </div>
      </div>
      {err && (
        <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Utente</th>
              <th>Tipo</th>
              <th>Periodo</th>
              <th>Ore</th>
              <th>Stato</th>
              <th>Note / motivo</th>
              <th>Decisa da</th>
              <th>Azioni</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.user_display_name || r.user_email}</td>
                <td>{TYPE_LABEL[r.type]}</td>
                <td className="text-xs">{fmtRange(r.from_ts, r.to_ts, r.type)}</td>
                <td className="num">{r.duration_hours}</td>
                <td>
                  <span className={`badge ${badgeForStatus(r.status)}`}>
                    {STATUS_LABEL[r.status]}
                  </span>
                </td>
                <td className="text-xs">
                  {r.type === 'malattia' && r.inps_protocol ? (
                    <span>INPS: <strong>{r.inps_protocol}</strong></span>
                  ) : null}
                  {r.user_note ? <div className="muted">{r.user_note}</div> : null}
                  {r.rejection_reason ? (
                    <div style={{ color: 'var(--color-error)' }}>{r.rejection_reason}</div>
                  ) : null}
                  {r.cancellation_reason ? (
                    <div className="muted">Annullamento: {r.cancellation_reason}</div>
                  ) : null}
                </td>
                <td className="text-xs">
                  {r.decided_by_display_name || r.decided_by_email || '—'}
                </td>
                <td>
                  <div className="flex gap-1 flex-wrap">
                    {r.status === 'pending' && (
                      <>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => approve(r)}
                        >
                          Approva
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => setRejectTarget(r)}
                        >
                          Rifiuta
                        </button>
                      </>
                    )}
                    {r.status === 'cancellation_pending' && (
                      <>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => decideCancel(r, true)}
                        >
                          Accetta annullamento
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => decideCancel(r, false)}
                        >
                          Rifiuta annullamento
                        </button>
                      </>
                    )}
                    {r.status === 'approved' && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setCancelTarget(r)}
                      >
                        Revoca
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
  const [year, setYear] = useState<number>(new Date().getFullYear());
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
        api<Assignment[]>(`/api/v1/leave-quotas/assignments?year=${year}`),
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
  }, [year]);

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
      <div className="flex gap-2 items-end">
        <div>
          <label className="label">Anno</label>
          <input
            type="number"
            className="input"
            value={year}
            min={2024}
            max={2100}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </div>
      </div>
      {err && (
        <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>
      )}
      {templates.length === 0 && (
        <div className="text-sm muted">
          Crea prima un modello quota nella tab <strong>Modelli</strong>.
        </div>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Utente</th>
              <th>Ferie (ore)</th>
              <th>Carry ferie</th>
              <th>Permessi (ore)</th>
              <th>Carry permessi</th>
            </tr>
          </thead>
          <tbody>
            {grid.map(({ user, ferie, permessi }) => (
              <tr key={user.user_id}>
                <td>{user.display_name || user.email}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setEditor({ user, type: 'ferie', existing: ferie })}
                  >
                    {ferie ? `${ferie.hours_total}h` : 'Assegna'}
                  </button>
                </td>
                <td className="num text-xs">{ferie ? `${ferie.hours_carried_in}h` : '—'}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      setEditor({ user, type: 'permessi', existing: permessi })
                    }
                  >
                    {permessi ? `${permessi.hours_total}h` : 'Assegna'}
                  </button>
                </td>
                <td className="num text-xs">
                  {permessi ? `${permessi.hours_carried_in}h` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editor && (
        <AssignmentEditor
          year={year}
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

function AssignmentEditor({
  year,
  user,
  type,
  existing,
  templates,
  onClose,
  onSaved,
}: {
  year: number;
  user: UserRow;
  type: 'ferie' | 'permessi';
  existing?: Assignment;
  templates: Template[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [templateId, setTemplateId] = useState<string>(
    existing?.template_id ?? templates[0]?.id ?? ''
  );
  const [hours, setHours] = useState<number>(
    existing?.hours_total ?? templates[0]?.hours_default ?? 0
  );
  const [carry, setCarry] = useState<number>(existing?.hours_carried_in ?? 0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!templateId) {
      setErr('Seleziona un modello');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api('/api/v1/leave-quotas/assignments', {
        method: 'POST',
        json: {
          user_id: user.user_id,
          template_id: templateId,
          year,
          hours_total: hours,
          hours_carried_in: carry,
        },
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing) return;
    if (!confirm('Eliminare la quota?')) return;
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
        <p className="text-xs muted">Anno {year}</p>
        <div>
          <label className="label">Modello</label>
          <select
            className="input"
            value={templateId}
            onChange={(e) => {
              setTemplateId(e.target.value);
              const t = templates.find((x) => x.id === e.target.value);
              if (t) setHours(t.hours_default);
            }}
          >
            <option value="">— scegli —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.hours_default}h)
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Ore totali</label>
            <input
              type="number"
              step="0.25"
              min={0}
              className="input"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="label">Carry-in</label>
            <input
              type="number"
              step="0.25"
              min={0}
              className="input"
              value={carry}
              onChange={(e) => setCarry(Number(e.target.value))}
            />
          </div>
        </div>
        {err && (
          <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>
        )}
        <div className="flex gap-2 justify-end">
          {existing && (
            <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
              Elimina
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
            setEditor({ name: '', type: 'ferie', hours_default: 176, active: true })
          }
        >
          Nuovo modello
        </button>
      </div>
      {err && (
        <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Ore default</th>
              <th>Stato</th>
              <th>Azioni</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.type === 'ferie' ? 'Ferie' : 'Permessi'}</td>
                <td className="num">{r.hours_default}</td>
                <td>
                  {r.active ? (
                    <span className="badge badge-ok">Attivo</span>
                  ) : (
                    <span className="badge badge-muted">Disattivato</span>
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setEditor(r)}
                  >
                    Modifica
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={async () => {
                      if (!confirm('Eliminare modello?')) return;
                      try {
                        await api(`/api/v1/leave-quotas/templates/${r.id}`, { method: 'DELETE' });
                        await load();
                      } catch (e) {
                        setErr(e instanceof Error ? e.message : 'errore');
                      }
                    }}
                  >
                    Elimina
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
  const [hours, setHours] = useState(initial.hours_default ?? 176);
  const [active, setActive] = useState(initial.active ?? true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (initial.id) {
        await api(`/api/v1/leave-quotas/templates/${initial.id}`, {
          method: 'PATCH',
          json: { name, type, hours_default: hours, active },
        });
      } else {
        await api('/api/v1/leave-quotas/templates', {
          method: 'POST',
          json: { name, type, hours_default: hours, active },
        });
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <form onSubmit={submit} className="card w-full max-w-md space-y-3">
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
            <label className="label">Ore default</label>
            <input
              type="number"
              step="0.25"
              min={0}
              className="input"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            />
          </div>
        </div>
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
