import { type FormEvent, useEffect, useState } from 'react';
import { api, type ApiError } from '../lib/api.ts';

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

export function Shifts() {
  const [list, setList] = useState<ShiftTemplate[]>([]);
  const [editing, setEditing] = useState<ShiftTemplate | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notDeployed, setNotDeployed] = useState(false);

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
    if (!confirm(`Eliminare l'orario "${t.name}"?`)) return;
    try {
      await api(`/api/v1/shifts/templates/${t.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'errore');
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Orari di lavoro</h1>
          <p className="muted text-sm mt-0.5">
            Modelli settimanali assegnabili agli utenti. Le anomalie vengono calcolate confrontando le timbrature con questi orari.
          </p>
        </div>
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
                  pausa {t.expected_break_min_min}–{t.expected_break_max_min}min
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
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
    slots: initial?.slots ?? [],
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function addSlot(day: number) {
    setState((s) => ({
      ...s,
      slots: [...s.slots, { day_of_week: day, start_time: '09:00', end_time: '13:00' }],
    }));
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
        className="card w-full max-w-3xl max-h-[90vh] overflow-y-auto"
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
            </div>
          </fieldset>

          <fieldset className="border border-neutral-200 rounded p-3 space-y-2">
            <legend className="text-sm font-medium px-1">Settimana</legend>
            <p className="text-xs text-neutral-500">
              Aggiungi più fasce nello stesso giorno per i turni spezzati (es. 09:00–13:00 + 14:00–18:00).
            </p>
            {DAYS.map((d) => {
              const daySlots = state.slots
                .map((s, idx) => ({ s, idx }))
                .filter(({ s }) => s.day_of_week === d.iso);
              return (
                <div key={d.iso} className="flex items-start gap-3 py-1">
                  <div className="w-24 text-sm font-medium pt-1">{d.label}</div>
                  <div className="flex-1 space-y-1">
                    {daySlots.length === 0 && (
                      <div className="text-xs text-neutral-400 italic">riposo</div>
                    )}
                    {daySlots.map(({ s, idx }) => (
                      <div key={idx} className="flex items-center gap-2 text-sm">
                        <input
                          type="time"
                          className="input"
                          style={{ width: 110 }}
                          value={s.start_time}
                          onChange={(e) => updateSlot(idx, { start_time: e.target.value })}
                        />
                        <span>–</span>
                        <input
                          type="time"
                          className="input"
                          style={{ width: 110 }}
                          value={s.end_time}
                          onChange={(e) => updateSlot(idx, { end_time: e.target.value })}
                        />
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => removeSlot(idx)}
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
                  </div>
                </div>
              );
            })}
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
