import { useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { api, type ApiError } from '../lib/api.ts';
import { fmtDate as fmtDateI18n, fmtTime as fmtTimeI18n } from '../i18n/format.ts';
import { PageHeader } from '../components/PageHeader.tsx';

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
    | 'lunch_outside_window'
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
  lunch_outside_window: '#0369a1',
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
  return fmtTimeI18n(iso, { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(d: string): string {
  return fmtDateI18n(d + 'T00:00:00', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  });
}

export function Anomalies() {
  const { t } = useTranslation(['anomalies', 'common']);
  const def = defaultRange();
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);
  const [userId, setUserId] = useState<string>('');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [rows, setRows] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notDeployed, setNotDeployed] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

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
      else setErr(e instanceof Error ? e.message : t('common:state.error'));
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

  // Drop selection keys no longer in the list. After a refetch the resolved
  // rows disappear, so a bulk retry only re-hits rows that still fail — this
  // also neutralizes the non-idempotent leave endpoints on retry.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const present = new Set(rows.map(keyOf));
      let changed = false;
      const next = new Set<string>();
      for (const k of prev) {
        if (present.has(k)) next.add(k);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [rows]);

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(keyOf(r))),
    [rows, selected]
  );
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(keyOf(r)));

  function toggleOne(k: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  }
  function toggleAll() {
    setSelected(() => (allSelected ? new Set() : new Set(rows.map(keyOf))));
  }
  function toggleDay(items: Anomaly[]) {
    setSelected((prev) => {
      const n = new Set(prev);
      const allDay = items.every((a) => n.has(keyOf(a)));
      for (const a of items) {
        if (allDay) n.delete(keyOf(a));
        else n.add(keyOf(a));
      }
      return n;
    });
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t('heading')} />

      <div className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label">{t('filter.from')}</label>
          <input
            type="date"
            className="input"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="label">{t('filter.to')}</label>
          <input
            type="date"
            className="input"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div>
          <label className="label">{t('filter.user')}</label>
          <select
            className="input"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          >
            <option value="">{t('filter.allUsers')}</option>
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
          {loading ? t('common:state.loading') : t('common:btn.refresh')}
        </button>
      </div>

      {notDeployed && (
        <div className="card text-sm" style={{ color: 'var(--color-on-tertiary-container, #92400e)', background: 'var(--color-tertiary-container, #fef3c7)' }}>
          {t('notDeployed')}
        </div>
      )}
      {err && (
        <div className="card text-sm" style={{ color: 'var(--color-error)' }}>
          {err}
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="card text-sm muted">
          {t('empty')}
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            <span>{t('bulk.selectAllVisible', { n: rows.length })}</span>
          </label>
          {selected.size > 0 && (
            <span className="muted">· {t('bulk.selected', { n: selected.size })}</span>
          )}
        </div>
      )}

      <div className="space-y-4">
        {grouped.map(([day, items]) => (
          <div key={day} className="card">
            <label className="flex items-center gap-2 font-medium mb-2 w-fit cursor-pointer">
              <input
                type="checkbox"
                checked={items.every((a) => selected.has(keyOf(a)))}
                onChange={() => toggleDay(items)}
              />
              {fmtDate(day)}
            </label>
            <ul className="space-y-2">
              {items.map((a) => (
                <AnomalyItem
                  key={keyOf(a)}
                  a={a}
                  selected={selected.has(keyOf(a))}
                  onToggle={() => toggleOne(keyOf(a))}
                  onDone={() => {
                    load().catch(() => {});
                  }}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>

      {selectedRows.length > 0 && (
        <BulkCorrectBar
          items={selectedRows}
          onDone={() => {
            load().catch(() => {});
          }}
          onClear={() => setSelected(new Set())}
        />
      )}
    </div>
  );
}

/* ----------------------- Correction menu per anomaly ----------------------- */

type CorrectionAction = 'standard' | 'ferie' | 'permesso' | 'note';

const ACTION_LABEL_KEY: Record<CorrectionAction, string> = {
  standard: 'action.standard',
  ferie: 'action.ferie',
  permesso: 'action.permesso',
  note: 'action.note',
};

const QUARTER_MS = 15 * 60 * 1000;

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

type TFn = (key: string, options?: Record<string, unknown>) => string;

// Stable identity of a computed anomaly (there is no server id): user + day +
// kind. Used as the React key and as the selection key for bulk operations.
function keyOf(a: Anomaly): string {
  return `${a.user_id}|${a.date}|${a.kind}`;
}

// Single source of truth for applying one correction to one anomaly. Both the
// per-row Correggi panel and the bulk bar call this, so the two paths never
// diverge. The payload is always derived from the anomaly's own fields.
async function applyCorrection(
  action: CorrectionAction,
  a: Anomaly,
  opts: { note?: string; pFrom?: string | null; pTo?: string | null; t: TFn }
): Promise<void> {
  const { t } = opts;
  const note = (opts.note ?? '').trim();
  if (action === 'standard') {
    const toAdd = missingEvents(a);
    if (toAdd.length === 0) throw new Error(t('errors.noMissingStamp'));
    await api('/api/v1/admin/stamps/fix-anomaly', {
      method: 'POST',
      json: {
        user_id: a.user_id,
        events: toAdd,
        justification: t('justificationStandard', { kind: t(`common:anomaly.${a.kind}`) }),
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
        user_note: note || undefined,
      },
    });
  } else if (action === 'permesso') {
    if (!opts.pFrom || !opts.pTo) throw new Error(t('errors.invalidPermWindow'));
    const permMin = Math.round(
      (new Date(opts.pTo).getTime() - new Date(opts.pFrom).getTime()) / 60_000
    );
    if (permMin < 15) throw new Error(t('errors.permMinDuration'));
    await api('/api/v1/leaves/admin-create', {
      method: 'POST',
      json: {
        user_id: a.user_id,
        type: 'permessi',
        from_ts: opts.pFrom,
        to_ts: opts.pTo,
        user_note: note || undefined,
      },
    });
  } else {
    if (note.length < 1) throw new Error(t('errors.noteRequired'));
    await api('/api/v1/shifts/anomalies/justify', {
      method: 'POST',
      json: { user_id: a.user_id, date: a.date, kind: a.kind, note },
    });
  }
}

// Actions offered for a bulk selection: those available for EVERY selected
// anomaly, minus 'permesso' (its window is inherently per-row, so one shared
// correction can't be applied safely). 'note' is always available, so a
// mixed-kind selection collapses to note-only — that is how "select similar
// anomalies" is enforced without a hard same-kind gate.
function bulkActions(items: Anomaly[]): CorrectionAction[] {
  if (items.length === 0) return [];
  let acc: CorrectionAction[] | null = null;
  for (const a of items) {
    const avail: CorrectionAction[] = availableActions(a).filter((x) => x !== 'permesso');
    acc = acc === null ? avail : acc.filter((x) => avail.includes(x));
  }
  return acc ?? [];
}

// Run fn over items with bounded concurrency; never rejects (per-item outcome
// captured like Promise.allSettled) so the bulk bar can report which rows failed.
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (x: T, i: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let idx = 0;
  async function worker(): Promise<void> {
    while (idx < items.length) {
      const i = idx++;
      const item = items[i]!;
      try {
        results[i] = { status: 'fulfilled', value: await fn(item, i) };
      } catch (e) {
        results[i] = { status: 'rejected', reason: e };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function AnomalyItem({
  a,
  selected,
  onToggle,
  onDone,
}: {
  a: Anomaly;
  selected: boolean;
  onToggle: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation(['anomalies', 'common']);
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
      await applyCorrection(action, a, { note, pFrom, pTo, t });
      setOpen(false);
      setNote('');
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common:state.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="border-t border-neutral-100 first:border-t-0 pt-2 first:pt-0">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 shrink-0"
          checked={selected}
          onChange={onToggle}
          aria-label={t('bulk.selectRow')}
        />
        <span
          className="badge"
          style={{ background: KIND_COLOR[a.kind] + '22', color: KIND_COLOR[a.kind] }}
        >
          {t(`common:anomaly.${a.kind}`)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">{a.user_display_name || a.user_email}</div>
          <div className="text-xs muted">
            {t('row.scheduleLabel')} {a.shift_template_name ?? '—'} · {t('row.expected')}{' '}
            {fmtTime(a.expected_start_at)}–{fmtTime(a.expected_end_at)} · {t('row.actual')}{' '}
            {fmtTime(a.actual_start_at)}–{fmtTime(a.actual_end_at)}
            {a.delta_minutes !== null && ` · ${t('row.deltaShort', { minutes: a.delta_minutes })}`}
            {a.break_total_min !== null && ` · ${t('row.breakShort', { minutes: a.break_total_min })}`}
          </div>
          {a.details && <div className="text-xs muted mt-0.5">{a.details}</div>}
          {a.justification_note && (
            <div
              className="text-xs mt-1 rounded-md px-2 py-1"
              style={{ background: 'var(--color-success-tint)', color: 'var(--color-success)' }}
            >
              {t('row.justified', { note: a.justification_note })}
            </div>
          )}
        </div>
        <button
          className="btn btn-secondary btn-sm shrink-0"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? t('common:btn.close') : t('correct')}
        </button>
      </div>

      {open && (
        <div
          className="mt-2 rounded-md p-3 space-y-3"
          style={{ background: 'var(--color-surface-variant, #f5f5f4)' }}
        >
          <div>
            <label className="label">{t('action.label')}</label>
            <select
              className="input"
              value={action}
              onChange={(e) => setAction(e.target.value as CorrectionAction)}
            >
              {actions.map((act) => (
                <option key={act} value={act}>
                  {t(ACTION_LABEL_KEY[act])}
                </option>
              ))}
            </select>
          </div>

          {/* Recap of what will change */}
          {action === 'standard' && (
            <div className="text-sm">
              <div className="muted text-xs font-semibold uppercase tracking-wide mb-1">
                {t('recap.title')}
              </div>
              {toAdd.length === 0 ? (
                <div className="muted">{t('recap.noMissingStamp')}</div>
              ) : (
                <ul className="space-y-0.5">
                  {toAdd.map((ev) => (
                    <li key={ev.event_type}>
                      <Trans
                        t={t}
                        i18nKey="recap.addsEvent"
                        values={{
                          event: t(`common:stampEvent.${ev.event_type}`),
                          time: fmtTime(ev.occurred_at),
                        }}
                        components={{ strong: <strong /> }}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {action === 'ferie' && (
            <div className="text-sm space-y-2">
              <div className="muted text-xs font-semibold uppercase tracking-wide">{t('recap.title')}</div>
              <div>
                <Trans
                  t={t}
                  i18nKey="recap.ferieFor"
                  values={{
                    date: fmtDate(a.date),
                    from: fmtTime(a.expected_start_at),
                    to: fmtTime(a.expected_end_at),
                  }}
                  components={{ strong: <strong /> }}
                />
              </div>
              <NoteField value={note} onChange={setNote} optional />
            </div>
          )}

          {action === 'permesso' && (
            <div className="text-sm space-y-2">
              <div className="muted text-xs font-semibold uppercase tracking-wide">{t('recap.title')}</div>
              <div className="flex flex-wrap items-center gap-4">
                <TimeStepper
                  label={t('recap.permFrom')}
                  value={pFrom}
                  onStep={(d) => stepPerm('from', d)}
                />
                <TimeStepper label={t('recap.permTo')} value={pTo} onStep={(d) => stepPerm('to', d)} />
                <div>
                  <div className="label">{t('recap.duration')}</div>
                  <div className="font-medium">{permMin > 0 ? fmtMins(permMin) : '—'}</div>
                </div>
              </div>
              <NoteField value={note} onChange={setNote} optional />
            </div>
          )}

          {action === 'note' && (
            <div className="text-sm space-y-1">
              <div className="muted text-xs font-semibold uppercase tracking-wide">
                {t('noteSection.title')}
              </div>
              <NoteField value={note} onChange={setNote} />
              <div className="text-xs muted">
                {t('noteSection.hint')}
              </div>
            </div>
          )}

          {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}

          <div className="flex gap-2">
            <button className="btn btn-primary btn-sm" onClick={confirm} disabled={busy}>
              {busy ? t('common:state.saving') : t('common:btn.confirm')}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              {t('common:btn.cancel')}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/* ------------------------- Bulk correction bar ------------------------- */

function BulkCorrectBar({
  items,
  onDone,
  onClear,
}: {
  items: Anomaly[];
  onDone: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation(['anomalies', 'common']);
  const actions = useMemo(() => bulkActions(items), [items]);
  const [action, setAction] = useState<CorrectionAction>(actions[0] ?? 'note');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    ok: number;
    failed: { name: string; date: string; reason: string }[];
  } | null>(null);

  // Keep the chosen action valid as the selection (and its intersection) changes.
  useEffect(() => {
    if (!actions.includes(action)) setAction(actions[0] ?? 'note');
  }, [actions, action]);

  const needsNote = action === 'note';
  const noteEmpty = note.trim().length === 0;

  async function apply() {
    setBusy(true);
    setResult(null);
    const res = await mapLimit(items, 4, (a) => applyCorrection(action, a, { note, t }));
    const ok = res.filter((r) => r.status === 'fulfilled').length;
    const failed = res
      .map((r, i) => ({ r, a: items[i]! }))
      .filter((x) => x.r.status === 'rejected')
      .map((x) => {
        const reason = (x.r as PromiseRejectedResult).reason;
        return {
          name: x.a.user_display_name || x.a.user_email,
          date: x.a.date,
          reason: reason instanceof Error ? reason.message : String(reason),
        };
      });
    setBusy(false);
    setResult({ ok, failed });
    setNote('');
    onDone();
    if (failed.length === 0) onClear();
  }

  return (
    <div
      className="sticky bottom-0 z-10 card shadow-lg space-y-3"
      style={{ borderColor: 'var(--color-primary)' }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="font-medium">{t('bulk.selected', { n: items.length })}</div>
        <div>
          <label className="label">{t('action.label')}</label>
          <select
            className="input"
            value={action}
            onChange={(e) => setAction(e.target.value as CorrectionAction)}
          >
            {actions.map((act) => (
              <option key={act} value={act}>
                {t(ACTION_LABEL_KEY[act])}
              </option>
            ))}
          </select>
        </div>
        {(action === 'ferie' || action === 'note') && (
          <div className="flex-1 min-w-[12rem]">
            <label className="label">{t('noteSection.title')}</label>
            <input
              className="input"
              maxLength={1000}
              placeholder={
                needsNote ? t('noteField.placeholder') : t('noteField.optionalPlaceholder')
              }
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        )}
        <button
          className="btn btn-primary"
          onClick={() => {
            apply().catch(() => {});
          }}
          disabled={busy || actions.length === 0 || (needsNote && noteEmpty)}
        >
          {busy ? t('common:state.saving') : t('bulk.apply', { n: items.length })}
        </button>
        <button className="btn btn-secondary" onClick={onClear} disabled={busy}>
          {t('bulk.clear')}
        </button>
      </div>

      <div className="text-xs muted">{t('bulk.hint')}</div>

      {result && (
        <div className="text-sm space-y-1">
          <div
            style={{
              color: result.failed.length === 0 ? 'var(--color-success)' : 'inherit',
            }}
          >
            {t('bulk.result', { ok: result.ok, fail: result.failed.length })}
          </div>
          {result.failed.length > 0 && (
            <ul className="space-y-0.5" style={{ color: 'var(--color-error)' }}>
              {result.failed.map((f, i) => (
                <li key={i}>
                  {f.name} · {fmtDate(f.date)} — {f.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
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
  const { t } = useTranslation(['anomalies', 'common']);
  return (
    <textarea
      className="input"
      rows={2}
      maxLength={1000}
      placeholder={optional ? t('noteField.optionalPlaceholder') : t('noteField.placeholder')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
