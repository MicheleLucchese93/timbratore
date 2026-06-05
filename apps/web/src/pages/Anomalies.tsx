import { useEffect, useMemo, useState } from 'react';
import { api, type ApiError } from '../lib/api.ts';

interface Anomaly {
  date: string;
  user_id: string;
  user_email: string;
  user_display_name: string | null;
  shift_template_id: string | null;
  shift_template_name: string | null;
  kind:
    | 'missing_clock_in'
    | 'missing_clock_out'
    | 'late_clock_in'
    | 'early_clock_out'
    | 'short_hours'
    | 'worked_on_rest_day'
    | 'break_too_short'
    | 'break_too_long'
    | 'lunch_too_short'
    | 'lunch_too_long'
    | 'clock_out_out_of_area';
  expected_start_at: string | null;
  expected_end_at: string | null;
  actual_start_at: string | null;
  actual_end_at: string | null;
  delta_minutes: number | null;
  break_total_min: number | null;
  lunch_total_min: number | null;
  details: string | null;
  justification_note: string | null;
  justified_at: string | null;
}

interface UserRow {
  user_id: string;
  email: string;
  display_name: string | null;
}

const KIND_LABEL: Record<Anomaly['kind'], string> = {
  missing_clock_in: 'Entrata mancante',
  missing_clock_out: 'Uscita mancante',
  late_clock_in: 'Entrata in ritardo',
  early_clock_out: 'Uscita anticipata',
  short_hours: 'Ore giornaliere insufficienti',
  worked_on_rest_day: 'Lavoro in giorno di riposo',
  break_too_short: 'Pausa troppo breve',
  break_too_long: 'Pausa troppo lunga',
  lunch_too_short: 'Pausa pranzo troppo breve',
  lunch_too_long: 'Pausa pranzo troppo lunga',
  clock_out_out_of_area: 'Uscita fuori area',
};

const KIND_COLOR: Record<Anomaly['kind'], string> = {
  missing_clock_in: '#b91c1c',
  missing_clock_out: '#b91c1c',
  late_clock_in: '#d97706',
  early_clock_out: '#d97706',
  short_hours: '#d97706',
  worked_on_rest_day: '#7c3aed',
  break_too_short: '#0369a1',
  break_too_long: '#0369a1',
  lunch_too_short: '#0369a1',
  lunch_too_long: '#0369a1',
  clock_out_out_of_area: '#7c3aed',
};

const JUSTIFIABLE_KINDS: Anomaly['kind'][] = [
  'short_hours',
  'missing_clock_in',
  'missing_clock_out',
  'late_clock_in',
  'early_clock_out',
];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 30);
  return { from: isoDate(start), to: isoDate(today) };
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('it-IT', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  });
}

export function Anomalies() {
  const def = defaultRange();
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);
  const [userId, setUserId] = useState<string>('');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [rows, setRows] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notDeployed, setNotDeployed] = useState(false);

  useEffect(() => {
    api<UserRow[]>('/api/v1/users')
      .then((u) => setUsers(u))
      .catch(() => {});
  }, []);

  async function load() {
    setLoading(true);
    setErr(null);
    setNotDeployed(false);
    try {
      const q = new URLSearchParams({ from, to });
      if (userId) q.set('user_id', userId);
      const data = await api<Anomaly[]>(`/api/v1/shifts/anomalies?${q.toString()}`);
      setRows(data);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 404) setNotDeployed(true);
      else setErr(e instanceof Error ? e.message : 'errore');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = useMemo(() => {
    const m = new Map<string, Anomaly[]>();
    for (const r of rows) {
      const key = r.date;
      const arr = m.get(key) ?? [];
      arr.push(r);
      m.set(key, arr);
    }
    return [...m.entries()].sort(([a], [b]) => (a < b ? 1 : -1));
  }, [rows]);

  return (
    <div className="space-y-5">
      <h1 className="sr-only">Anomalie orario</h1>

      <div className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Dal</label>
          <input
            type="date"
            className="input"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Al</label>
          <input
            type="date"
            className="input"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Utente</label>
          <select
            className="input"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          >
            <option value="">Tutti</option>
            {users.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {u.display_name || u.email}
              </option>
            ))}
          </select>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            load().catch(() => {});
          }}
          disabled={loading}
        >
          {loading ? 'Caricamento…' : 'Aggiorna'}
        </button>
      </div>

      {notDeployed && (
        <div className="card text-sm" style={{ color: 'var(--color-on-tertiary-container, #92400e)', background: 'var(--color-tertiary-container, #fef3c7)' }}>
          La funzione "Anomalie orario" è disponibile dopo l'aggiornamento del backend. Riprova quando il deploy sarà completato.
        </div>
      )}
      {err && (
        <div className="card text-sm" style={{ color: 'var(--color-error)' }}>
          {err}
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="card text-sm text-neutral-500">
          Nessuna anomalia nel periodo selezionato.
        </div>
      )}

      <div className="space-y-4">
        {grouped.map(([day, items]) => (
          <div key={day} className="card">
            <div className="font-medium mb-2">{fmtDate(day)}</div>
            <ul className="space-y-2">
              {items.map((a, i) => (
                <AnomalyItem
                  key={i}
                  a={a}
                  onDone={() => {
                    load().catch(() => {});
                  }}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ----------------------- Correction menu per anomaly ----------------------- */

type CorrectionAction = 'standard' | 'ferie' | 'permesso' | 'note';

const ACTION_LABEL: Record<CorrectionAction, string> = {
  standard: 'Timbratura standard (orari del giorno)',
  ferie: 'Inserisci ferie',
  permesso: 'Inserisci permesso',
  note: 'Giustifica con nota',
};

const QUARTER_MS = 15 * 60 * 1000;

function eventLabel(e: 'clock_in' | 'clock_out'): string {
  return e === 'clock_in' ? 'Ingresso' : 'Uscita';
}

// The clock events that are absent for the day, to be added at the scheduled
// times. Additive only — present punches are never touched.
function missingEvents(a: Anomaly): { event_type: 'clock_in' | 'clock_out'; occurred_at: string }[] {
  const ev: { event_type: 'clock_in' | 'clock_out'; occurred_at: string }[] = [];
  if (!a.actual_start_at && a.expected_start_at)
    ev.push({ event_type: 'clock_in', occurred_at: a.expected_start_at });
  if (!a.actual_end_at && a.expected_end_at)
    ev.push({ event_type: 'clock_out', occurred_at: a.expected_end_at });
  return ev;
}

function floor15(ms: number): number {
  return Math.floor(ms / QUARTER_MS) * QUARTER_MS;
}
function ceil15(ms: number): number {
  return Math.ceil(ms / QUARTER_MS) * QUARTER_MS;
}

// Default permesso window = the uncovered part of the scheduled day ("copri il
// gap mancante"), snapped to a 15-minute grid. Admin can fine-tune in the recap.
function proposeGap(a: Anomaly): { from: string; to: string } | null {
  const es = a.expected_start_at ? new Date(a.expected_start_at).getTime() : null;
  const ee = a.expected_end_at ? new Date(a.expected_end_at).getTime() : null;
  const as = a.actual_start_at ? new Date(a.actual_start_at).getTime() : null;
  const ae = a.actual_end_at ? new Date(a.actual_end_at).getTime() : null;
  let from: number | null = null;
  let to: number | null = null;
  switch (a.kind) {
    case 'missing_clock_in':
    case 'late_clock_in':
      from = es;
      to = as ?? ee;
      break;
    case 'missing_clock_out':
    case 'early_clock_out':
      from = ae ?? es;
      to = ee;
      break;
    case 'short_hours':
      if (ee != null && a.delta_minutes) {
        from = ee - Math.abs(a.delta_minutes) * 60_000;
        to = ee;
      } else {
        from = es;
        to = ee;
      }
      break;
    default:
      from = es;
      to = ee;
  }
  if (from == null || to == null) return null;
  from = floor15(from);
  to = ceil15(to);
  if (to <= from) to = from + QUARTER_MS;
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

function availableActions(a: Anomaly): CorrectionAction[] {
  const acts: CorrectionAction[] = [];
  if (missingEvents(a).length > 0) acts.push('standard');
  if (JUSTIFIABLE_KINDS.includes(a.kind) && a.expected_start_at && a.expected_end_at) {
    acts.push('ferie', 'permesso');
  }
  acts.push('note');
  return acts;
}

function fmtMins(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function AnomalyItem({ a, onDone }: { a: Anomaly; onDone: () => void }) {
  const actions = useMemo(() => availableActions(a), [a]);
  const gap0 = useMemo(() => proposeGap(a), [a]);
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<CorrectionAction>(actions[0] ?? 'note');
  const [pFrom, setPFrom] = useState<string | null>(gap0?.from ?? null);
  const [pTo, setPTo] = useState<string | null>(gap0?.to ?? null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toAdd = useMemo(() => missingEvents(a), [a]);
  const permMin =
    pFrom && pTo
      ? Math.round((new Date(pTo).getTime() - new Date(pFrom).getTime()) / 60_000)
      : 0;

  function stepPerm(which: 'from' | 'to', dir: -1 | 1) {
    const cur = which === 'from' ? pFrom : pTo;
    if (!cur) return;
    const next = new Date(new Date(cur).getTime() + dir * QUARTER_MS).toISOString();
    if (which === 'from') setPFrom(next);
    else setPTo(next);
  }

  async function confirm() {
    setBusy(true);
    setErr(null);
    try {
      if (action === 'standard') {
        if (toAdd.length === 0) throw new Error('Nessun timbro mancante da aggiungere.');
        await api('/api/v1/admin/stamps/fix-anomaly', {
          method: 'POST',
          json: {
            user_id: a.user_id,
            events: toAdd,
            justification: `Timbratura standard: ${KIND_LABEL[a.kind]}`,
          },
        });
      } else if (action === 'ferie') {
        await api('/api/v1/leaves/admin-create', {
          method: 'POST',
          json: {
            user_id: a.user_id,
            type: 'ferie',
            from_ts: a.expected_start_at,
            to_ts: a.expected_end_at,
            user_note: note.trim() || undefined,
          },
        });
      } else if (action === 'permesso') {
        if (!pFrom || !pTo) throw new Error('Finestra del permesso non valida.');
        if (permMin < 15) throw new Error('Durata minima del permesso: 15 minuti.');
        await api('/api/v1/leaves/admin-create', {
          method: 'POST',
          json: {
            user_id: a.user_id,
            type: 'permessi',
            from_ts: pFrom,
            to_ts: pTo,
            user_note: note.trim() || undefined,
          },
        });
      } else {
        if (note.trim().length < 1) throw new Error('Inserisci una nota di giustificazione.');
        await api('/api/v1/shifts/anomalies/justify', {
          method: 'POST',
          json: { user_id: a.user_id, date: a.date, kind: a.kind, note: note.trim() },
        });
      }
      setOpen(false);
      setNote('');
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="border-t border-neutral-100 first:border-t-0 pt-2 first:pt-0">
      <div className="flex items-start gap-3">
        <span
          className="badge"
          style={{ background: KIND_COLOR[a.kind] + '22', color: KIND_COLOR[a.kind] }}
        >
          {KIND_LABEL[a.kind]}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">{a.user_display_name || a.user_email}</div>
          <div className="text-xs text-neutral-500">
            Orario: {a.shift_template_name ?? '—'} · Atteso{' '}
            {fmtTime(a.expected_start_at)}–{fmtTime(a.expected_end_at)} · Effettivo{' '}
            {fmtTime(a.actual_start_at)}–{fmtTime(a.actual_end_at)}
            {a.delta_minutes !== null && ` · Δ ${a.delta_minutes}min`}
            {a.break_total_min !== null && ` · Pausa ${a.break_total_min}min`}
          </div>
          {a.details && <div className="text-xs text-neutral-600 mt-0.5">{a.details}</div>}
          {a.justification_note && (
            <div
              className="text-xs mt-1 rounded-md px-2 py-1"
              style={{ background: '#e8f3ec', color: '#166534' }}
            >
              Giustificata: {a.justification_note}
            </div>
          )}
        </div>
        <button
          className="btn btn-secondary btn-sm shrink-0"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? 'Chiudi' : 'Correggi ▾'}
        </button>
      </div>

      {open && (
        <div
          className="mt-2 rounded-md p-3 space-y-3"
          style={{ background: 'var(--color-surface-variant, #f5f5f4)' }}
        >
          <div>
            <label className="label">Azione</label>
            <select
              className="input"
              value={action}
              onChange={(e) => setAction(e.target.value as CorrectionAction)}
            >
              {actions.map((act) => (
                <option key={act} value={act}>
                  {ACTION_LABEL[act]}
                </option>
              ))}
            </select>
          </div>

          {/* Recap of what will change */}
          {action === 'standard' && (
            <div className="text-sm">
              <div className="muted text-xs font-semibold uppercase tracking-wide mb-1">
                Riepilogo
              </div>
              {toAdd.length === 0 ? (
                <div className="text-neutral-600">Nessun timbro mancante.</div>
              ) : (
                <ul className="space-y-0.5">
                  {toAdd.map((ev) => (
                    <li key={ev.event_type}>
                      Aggiunge <strong>{eventLabel(ev.event_type)}</strong> alle{' '}
                      <strong>{fmtTime(ev.occurred_at)}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {action === 'ferie' && (
            <div className="text-sm space-y-2">
              <div className="muted text-xs font-semibold uppercase tracking-wide">Riepilogo</div>
              <div>
                Ferie per <strong>{fmtDate(a.date)}</strong> ({fmtTime(a.expected_start_at)}–
                {fmtTime(a.expected_end_at)}). Le ore vengono calcolate dall'orario assegnato.
              </div>
              <NoteField value={note} onChange={setNote} optional />
            </div>
          )}

          {action === 'permesso' && (
            <div className="text-sm space-y-2">
              <div className="muted text-xs font-semibold uppercase tracking-wide">Riepilogo</div>
              <div className="flex flex-wrap items-center gap-4">
                <TimeStepper
                  label="Dalle"
                  value={pFrom}
                  onStep={(d) => stepPerm('from', d)}
                />
                <TimeStepper label="Alle" value={pTo} onStep={(d) => stepPerm('to', d)} />
                <div>
                  <div className="label">Durata</div>
                  <div className="font-medium">{permMin > 0 ? fmtMins(permMin) : '—'}</div>
                </div>
              </div>
              <NoteField value={note} onChange={setNote} optional />
            </div>
          )}

          {action === 'note' && (
            <div className="text-sm space-y-1">
              <div className="muted text-xs font-semibold uppercase tracking-wide">
                Nota di giustificazione
              </div>
              <NoteField value={note} onChange={setNote} />
              <div className="text-xs muted">
                L'anomalia resta visibile ma annotata; la nota compare nelle esportazioni.
              </div>
            </div>
          )}

          {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}

          <div className="flex gap-2">
            <button className="btn btn-primary btn-sm" onClick={confirm} disabled={busy}>
              {busy ? 'Salvataggio…' : 'Conferma'}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Annulla
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function TimeStepper({
  label,
  value,
  onStep,
}: {
  label: string;
  value: string | null;
  onStep: (dir: -1 | 1) => void;
}) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="flex items-center gap-1">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onStep(-1)}>
          −
        </button>
        <span className="font-medium min-w-[3.5rem] text-center">{fmtTime(value)}</span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onStep(1)}>
          +
        </button>
      </div>
    </div>
  );
}

function NoteField({
  value,
  onChange,
  optional,
}: {
  value: string;
  onChange: (v: string) => void;
  optional?: boolean;
}) {
  return (
    <textarea
      className="input"
      rows={2}
      maxLength={1000}
      placeholder={optional ? 'Nota per il dipendente (opzionale)' : 'Motivazione…'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
