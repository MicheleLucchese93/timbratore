import { type FormEvent, useEffect, useState } from 'react';
import { api, type ApiError } from '../lib/api.ts';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { IconButton } from '../components/IconButton.tsx';

interface Slot {
  id?: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
}

interface ShiftTemplate {
  id: string;
  name: string;
  description: string | null;
  tolerance_in_min: number;
  tolerance_out_min: number;
  expected_break_min_min: number;
  expected_break_max_min: number;
  expected_lunch_min_min: number;
  expected_lunch_max_min: number;
  extraordinary_threshold_min: 15 | 30 | 60;
  count_extraordinary: boolean;
  tolerance_in_breach_deduct_min: number;
  tolerance_out_breach_deduct_min: number;
  tolerance_break_breach_deduct_min: number;
  active: boolean;
  slots: Slot[];
}

const DAYS = [
  { iso: 1, label: 'Lunedì' },
  { iso: 2, label: 'Martedì' },
  { iso: 3, label: 'Mercoledì' },
  { iso: 4, label: 'Giovedì' },
  { iso: 5, label: 'Venerdì' },
  { iso: 6, label: 'Sabato' },
  { iso: 7, label: 'Domenica' },
];

// Allowed penalty deduction values (minutes). Coarse buckets aligned to typical
// CCNL rounding rules so admins pick rather than typing arbitrary numbers.
const PENALTY_OPTIONS = [0, 15, 30, 60] as const;

export function Shifts() {
  const [list, setList] = useState<ShiftTemplate[]>([]);
  const [editing, setEditing] = useState<ShiftTemplate | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notDeployed, setNotDeployed] = useState(false);
  const confirm = useConfirm();

  async function load() {
    setList(await api<ShiftTemplate[]>('/api/v1/shifts/templates'));
    setNotDeployed(false);
  }
  useEffect(() => {
    load().catch((e: ApiError) => {
      if (e.status === 404) setNotDeployed(true);
      else setErr(e.message);
    });
  }, []);

  async function remove(t: ShiftTemplate) {
    if (!(await confirm({ title: `Eliminare l'orario "${t.name}"?`, danger: true, confirmLabel: 'Elimina' }))) return;
    try {
      await api(`/api/v1/shifts/templates/${t.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    }
  }

  // Clone a template (all settings + slots) under a "Copia di …" name, then
  // reload so the admin can open the copy and tweak its fasce. The new name is
  // deduped against existing ones to dodge the UNIQUE(tenant_id, name) constraint.
  async function duplicate(t: ShiftTemplate) {
    setErr(null);
    try {
      await api('/api/v1/shifts/templates', {
        method: 'POST',
        json: {
          name: copyName(t.name, list.map((x) => x.name)),
          description: t.description,
          tolerance_in_min: t.tolerance_in_min,
          tolerance_out_min: t.tolerance_out_min,
          expected_break_min_min: t.expected_break_min_min,
          expected_break_max_min: t.expected_break_max_min,
          expected_lunch_min_min: t.expected_lunch_min_min,
          expected_lunch_max_min: t.expected_lunch_max_min,
          extraordinary_threshold_min: t.extraordinary_threshold_min,
          count_extraordinary: t.count_extraordinary,
          tolerance_in_breach_deduct_min: t.tolerance_in_breach_deduct_min,
          tolerance_out_breach_deduct_min: t.tolerance_out_breach_deduct_min,
          tolerance_break_breach_deduct_min: t.tolerance_break_breach_deduct_min,
          slots: t.slots.map((s) => ({
            day_of_week: s.day_of_week,
            start_time: s.start_time,
            end_time: s.end_time,
          })),
        },
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-end gap-4 flex-wrap">
        <h1 className="sr-only">Orari di lavoro</h1>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          Nuovo orario
        </button>
      </header>

      {notDeployed && (
        <div className="card text-sm" style={{ color: 'var(--color-on-tertiary-container, #92400e)', background: 'var(--color-tertiary-container, #fef3c7)' }}>
          La funzione "Orari di lavoro" è disponibile dopo l'aggiornamento del backend. Riprova quando il deploy sarà completato.
        </div>
      )}
      {err && (
        <div className="card text-sm" style={{ color: 'var(--color-error)' }}>
          {err}
        </div>
      )}

      <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {list.map((t) => (
          <li key={t.id} className="card flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium">{t.name}</div>
                {t.description && (
                  <div className="text-xs text-neutral-600">{t.description}</div>
                )}
                <div className="text-xs text-neutral-500 mt-1">
                  Tolleranza entrata ±{t.tolerance_in_min}min · uscita ±{t.tolerance_out_min}min ·
                  pausa {t.expected_break_min_min}–{t.expected_break_max_min}min ·
                  pausa pranzo {t.expected_lunch_min_min}–{t.expected_lunch_max_min}min
                </div>
                <div className="text-xs text-neutral-500 mt-0.5">
                  Totale settimanale: {formatWeeklyTotal(t.slots)}
                </div>
              </div>
              <div className="flex gap-2 shrink-0 items-center">
                <IconButton kind="duplicate" title="Duplica" onClick={() => duplicate(t)} />
                <button className="btn btn-secondary btn-sm" onClick={() => setEditing(t)}>
                  Modifica
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => remove(t)}>
                  Elimina
                </button>
              </div>
            </div>
            <WeeklyPreview slots={t.slots} />
          </li>
        ))}
        {list.length === 0 && (
          <li className="card text-sm text-neutral-500">
            Nessun orario configurato. Crea il primo per iniziare ad assegnarlo agli utenti.
          </li>
        )}
      </ul>

      {(showCreate || editing) && (
        <ShiftForm
          initial={editing ?? undefined}
          onClose={() => {
            setShowCreate(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setShowCreate(false);
            setEditing(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function slotsMinutes(slots: Slot[]): number {
  let totalMin = 0;
  for (const s of slots) {
    const [sh, sm] = s.start_time.split(':').map(Number);
    const [eh, em] = s.end_time.split(':').map(Number);
    if (sh === undefined || sm === undefined || eh === undefined || em === undefined) continue;
    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    if (end > start) totalMin += end - start;
  }
  return totalMin;
}

function formatMinutes(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

function formatWeeklyTotal(slots: Slot[]): string {
  return formatMinutes(slotsMinutes(slots));
}

// Build a unique "Copia di <name>" within the 120-char name limit, appending
// " (2)", " (3)"… when a copy with that name already exists. The base is
// trimmed (not the suffix) so the counter is never truncated away.
function copyName(base: string, existing: string[]): string {
  const MAX = 120;
  const prefix = 'Copia di ';
  const taken = new Set(existing);
  const make = (suffix: string) =>
    prefix + base.slice(0, Math.max(0, MAX - prefix.length - suffix.length)) + suffix;
  let candidate = make('');
  let n = 2;
  while (taken.has(candidate)) {
    candidate = make(` (${n})`);
    n++;
  }
  return candidate;
}

function WeeklyPreview({ slots }: { slots: Slot[] }) {
  return (
    <div className="text-xs grid grid-cols-7 gap-1">
      {DAYS.map((d) => {
        const ds = slots.filter((s) => s.day_of_week === d.iso);
        return (
          <div key={d.iso} className="border border-neutral-200 rounded p-1">
            <div className="font-medium text-neutral-700">{d.label.slice(0, 3)}</div>
            {ds.length === 0 ? (
              <div className="text-neutral-400">—</div>
            ) : (
              ds.map((s, i) => (
                <div key={i} className="text-neutral-600">
                  {s.start_time}–{s.end_time}
                </div>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

interface FormState {
  name: string;
  description: string;
  tolerance_in_min: number;
  tolerance_out_min: number;
  expected_break_min_min: number;
  expected_break_max_min: number;
  expected_lunch_min_min: number;
  expected_lunch_max_min: number;
  extraordinary_threshold_min: 15 | 30 | 60;
  count_extraordinary: boolean;
  tolerance_in_breach_deduct_min: number;
  tolerance_out_breach_deduct_min: number;
  tolerance_break_breach_deduct_min: number;
  slots: Slot[];
}

function ShiftForm({
  initial,
  onClose,
  onSaved,
}: {
  initial?: ShiftTemplate;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [state, setState] = useState<FormState>({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    tolerance_in_min: initial?.tolerance_in_min ?? 10,
    tolerance_out_min: initial?.tolerance_out_min ?? 10,
    expected_break_min_min: initial?.expected_break_min_min ?? 0,
    expected_break_max_min: initial?.expected_break_max_min ?? 90,
    expected_lunch_min_min: initial?.expected_lunch_min_min ?? 0,
    expected_lunch_max_min: initial?.expected_lunch_max_min ?? 90,
    extraordinary_threshold_min: initial?.extraordinary_threshold_min ?? 15,
    count_extraordinary: initial?.count_extraordinary ?? false,
    tolerance_in_breach_deduct_min: initial?.tolerance_in_breach_deduct_min ?? 0,
    tolerance_out_breach_deduct_min: initial?.tolerance_out_breach_deduct_min ?? 0,
    tolerance_break_breach_deduct_min: initial?.tolerance_break_breach_deduct_min ?? 0,
    slots: initial?.slots ?? [],
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function addSlot(day: number) {
    setState((s) => {
      const daySlots = s.slots.filter((sl) => sl.day_of_week === day);
      const prev = daySlots[daySlots.length - 1];
      const newSlot: Slot = prev
        ? { day_of_week: day, start_time: prev.start_time, end_time: prev.end_time }
        : { day_of_week: day, start_time: '09:00', end_time: '13:00' };
      return { ...s, slots: [...s.slots, newSlot] };
    });
  }
  function updateSlot(idx: number, patch: Partial<Slot>) {
    setState((s) => ({
      ...s,
      slots: s.slots.map((sl, i) => (i === idx ? { ...sl, ...patch } : sl)),
    }));
  }
  function removeSlot(idx: number) {
    setState((s) => ({ ...s, slots: s.slots.filter((_, i) => i !== idx) }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const body = {
        name: state.name.trim(),
        description: state.description.trim() || null,
        tolerance_in_min: state.tolerance_in_min,
        tolerance_out_min: state.tolerance_out_min,
        expected_break_min_min: state.expected_break_min_min,
        expected_break_max_min: state.expected_break_max_min,
        expected_lunch_min_min: state.expected_lunch_min_min,
        expected_lunch_max_min: state.expected_lunch_max_min,
        extraordinary_threshold_min: state.extraordinary_threshold_min,
        count_extraordinary: state.count_extraordinary,
        tolerance_in_breach_deduct_min: state.tolerance_in_breach_deduct_min,
        tolerance_out_breach_deduct_min: state.tolerance_out_breach_deduct_min,
        tolerance_break_breach_deduct_min: state.tolerance_break_breach_deduct_min,
        slots: state.slots.map((s) => ({
          day_of_week: s.day_of_week,
          start_time: s.start_time,
          end_time: s.end_time,
        })),
      };
      if (initial) {
        await api(`/api/v1/shifts/templates/${initial.id}`, { method: 'PATCH', json: body });
      } else {
        await api('/api/v1/shifts/templates', { method: 'POST', json: body });
      }
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-4xl max-h-[95vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={submit} className="space-y-4">
          <h2 className="text-lg font-semibold">
            {initial ? 'Modifica orario' : 'Nuovo orario'}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="label">Nome</span>
              <input
                className="input"
                required
                maxLength={120}
                value={state.name}
                onChange={(e) => setState({ ...state, name: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="label">Descrizione (opzionale)</span>
              <input
                className="input"
                maxLength={500}
                value={state.description}
                onChange={(e) => setState({ ...state, description: e.target.value })}
              />
            </label>
          </div>

          <fieldset className="border border-neutral-200 rounded p-3 space-y-2">
            <legend className="text-sm font-medium px-1">Tolleranze (minuti)</legend>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <label>
                <span className="label">Entrata ±</span>
                <input
                  type="number"
                  min={0}
                  max={240}
                  className="input"
                  value={state.tolerance_in_min}
                  onChange={(e) =>
                    setState({ ...state, tolerance_in_min: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                <span className="label">Uscita ±</span>
                <input
                  type="number"
                  min={0}
                  max={240}
                  className="input"
                  value={state.tolerance_out_min}
                  onChange={(e) =>
                    setState({ ...state, tolerance_out_min: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                <span className="label">Pausa min</span>
                <input
                  type="number"
                  min={0}
                  max={480}
                  className="input"
                  value={state.expected_break_min_min}
                  onChange={(e) =>
                    setState({ ...state, expected_break_min_min: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                <span className="label">Pausa max</span>
                <input
                  type="number"
                  min={0}
                  max={480}
                  className="input"
                  value={state.expected_break_max_min}
                  onChange={(e) =>
                    setState({ ...state, expected_break_max_min: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                <span className="label">Pausa pranzo min</span>
                <input
                  type="number"
                  min={0}
                  max={480}
                  className="input"
                  value={state.expected_lunch_min_min}
                  onChange={(e) =>
                    setState({ ...state, expected_lunch_min_min: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                <span className="label">Pausa pranzo max</span>
                <input
                  type="number"
                  min={0}
                  max={480}
                  className="input"
                  value={state.expected_lunch_max_min}
                  onChange={(e) =>
                    setState({ ...state, expected_lunch_max_min: Number(e.target.value) })
                  }
                />
              </label>
            </div>
          </fieldset>

          <fieldset className="border border-neutral-200 rounded p-3 space-y-2">
            <legend className="text-sm font-medium px-1">Penalità tolleranza (minuti)</legend>
            <p className="text-xs text-neutral-500 mb-2">
              Minuti sottratti dal tempo lavorato quando la tolleranza è superata.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label>
                <span className="label">Entrata oltre tolleranza</span>
                <select
                  className="input"
                  value={state.tolerance_in_breach_deduct_min}
                  onChange={(e) =>
                    setState({ ...state, tolerance_in_breach_deduct_min: Number(e.target.value) })
                  }
                >
                  {PENALTY_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {v === 0 ? 'Nessuna penalità' : `${v} minuti`}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="label">Uscita oltre tolleranza</span>
                <select
                  className="input"
                  value={state.tolerance_out_breach_deduct_min}
                  onChange={(e) =>
                    setState({ ...state, tolerance_out_breach_deduct_min: Number(e.target.value) })
                  }
                >
                  {PENALTY_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {v === 0 ? 'Nessuna penalità' : `${v} minuti`}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="label">Pausa oltre tolleranza</span>
                <select
                  className="input"
                  value={state.tolerance_break_breach_deduct_min}
                  onChange={(e) =>
                    setState({ ...state, tolerance_break_breach_deduct_min: Number(e.target.value) })
                  }
                >
                  {PENALTY_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {v === 0 ? 'Nessuna penalità' : `${v} minuti`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </fieldset>

          <fieldset className="border border-neutral-200 rounded p-3 space-y-3">
            <legend className="text-sm font-medium px-1">Straordinario</legend>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={state.count_extraordinary}
                onChange={(e) =>
                  setState({ ...state, count_extraordinary: e.target.checked })
                }
              />
              <span className="text-sm">Considera le ore straordinarie in questo orario</span>
            </label>
            {state.count_extraordinary && (
              <label className="block">
                <span className="label">Conteggio straordinario a blocchi di</span>
                <select
                  className="input"
                  value={state.extraordinary_threshold_min}
                  onChange={(e) =>
                    setState({
                      ...state,
                      extraordinary_threshold_min: Number(e.target.value) as 15 | 30 | 60,
                    })
                  }
                >
                  <option value={15}>15 minuti</option>
                  <option value={30}>30 minuti</option>
                  <option value={60}>60 minuti</option>
                </select>
                <p className="text-xs text-neutral-500 mt-1">
                  Lo straordinario oltre l'orario previsto è conteggiato in blocchi interi: un blocco non completo non viene contato. Es. uscita prevista 18:00, uscita reale 18:28 → con blocchi da 30 min nessuno straordinario, da 15 min conta 15 min.
                </p>
              </label>
            )}
          </fieldset>

          <fieldset className="border border-neutral-200 rounded p-3">
            <legend className="text-sm font-medium px-1">Settimana</legend>
            <p className="text-xs text-neutral-500 mb-2">
              Aggiungi più fasce nello stesso giorno per i turni spezzati (es. 09:00–13:00 + 14:00–18:00).
            </p>
            <div className="divide-y divide-neutral-100">
              {DAYS.map((d) => {
                const daySlots = state.slots
                  .map((s, idx) => ({ s, idx }))
                  .filter(({ s }) => s.day_of_week === d.iso);
                const dayMin = slotsMinutes(daySlots.map(({ s }) => s));
                return (
                  <div
                    key={d.iso}
                    className="flex items-center gap-3 py-2 flex-wrap"
                  >
                    <div className="w-20 text-sm font-medium shrink-0">{d.label}</div>
                    <div className="flex items-center gap-2 flex-wrap flex-1">
                      {daySlots.length === 0 && (
                        <span className="text-xs text-neutral-400 italic mr-2">riposo</span>
                      )}
                      {daySlots.map(({ s, idx }) => (
                        <div
                          key={idx}
                          className="flex items-center gap-1 bg-neutral-50 border border-neutral-200 rounded px-1.5 py-0.5"
                        >
                          <input
                            type="time"
                            className="input"
                            style={{ width: 92, padding: '0.2rem 0.4rem', minHeight: 0 }}
                            value={s.start_time}
                            onChange={(e) => updateSlot(idx, { start_time: e.target.value })}
                          />
                          <span className="text-neutral-400">–</span>
                          <input
                            type="time"
                            className="input"
                            style={{ width: 92, padding: '0.2rem 0.4rem', minHeight: 0 }}
                            value={s.end_time}
                            onChange={(e) => updateSlot(idx, { end_time: e.target.value })}
                          />
                          <button
                            type="button"
                            className="text-neutral-400 hover:text-red-600 ml-1 leading-none"
                            style={{ fontSize: '1.1rem' }}
                            onClick={() => removeSlot(idx)}
                            aria-label="Rimuovi fascia"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => addSlot(d.iso)}
                      >
                        + fascia
                      </button>
                      {dayMin > 0 && (
                        <span className="text-xs text-neutral-500 ml-auto tabular-nums">
                          {formatMinutes(dayMin)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between pt-2 mt-2 border-t border-neutral-200 text-sm">
              <span className="font-medium">Totale settimanale</span>
              <span className="font-medium tabular-nums">
                {formatWeeklyTotal(state.slots)}
              </span>
            </div>
          </fieldset>

          {err && (
            <div className="text-sm" style={{ color: 'var(--color-error)' }}>
              {err}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Annulla
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Salvataggio…' : 'Salva'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
