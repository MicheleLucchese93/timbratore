import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type ApiError } from '../lib/api.ts';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { IconButton } from '../components/IconButton.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { localeTag } from '../i18n/format.ts';

interface Slot {
  id?: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
}

interface DayLunch {
  day_of_week: number;
  lunch_min: number;
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
  flexible_enabled: boolean;
  flex_in_before_min: number;
  flex_in_after_min: number;
  flex_out_before_min: number;
  flex_out_after_min: number;
  flex_lunch_before_min: number;
  flex_lunch_after_min: number;
  active: boolean;
  slots: Slot[];
  day_lunch: DayLunch[];
}

// ISO weekday numbers (1 = Monday … 7 = Sunday). Names are derived from the
// active locale at render via `dayLabel`, so they stay in sync with the UI
// language instead of being hardcoded.
const DAYS = [{ iso: 1 }, { iso: 2 }, { iso: 3 }, { iso: 4 }, { iso: 5 }, { iso: 6 }, { iso: 7 }];

// Locale-derived full weekday name for an ISO weekday. Jan 1 2024 is a Monday,
// so day-of-month `iso` (1..7) lands on the matching weekday (Mon..Sun).
function dayLabel(iso: number): string {
  // Italian locale yields lowercase weekday names ("lunedì"); capitalize the
  // first letter so standalone day labels read "Lunedì" / "Lun" as before.
  const s = new Date(Date.UTC(2024, 0, iso)).toLocaleDateString(localeTag(), { weekday: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Allowed penalty deduction values (minutes). Coarse buckets aligned to typical
// CCNL rounding rules so admins pick rather than typing arbitrary numbers.
const PENALTY_OPTIONS = [0, 15, 30, 60] as const;

export function Shifts() {
  const { t } = useTranslation(['shifts', 'common']);
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

  async function remove(tpl: ShiftTemplate) {
    if (
      !(await confirm({
        title: t('deleteConfirm', { name: tpl.name }),
        danger: true,
        confirmLabel: t('common:btn.delete'),
      }))
    )
      return;
    try {
      await api(`/api/v1/shifts/templates/${tpl.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common:state.error'));
    }
  }

  // Clone a template (all settings + slots) under a "Copia di …" name, then
  // reload so the admin can open the copy and tweak its fasce. The new name is
  // deduped against existing ones to dodge the UNIQUE(tenant_id, name) constraint.
  async function duplicate(tpl: ShiftTemplate) {
    setErr(null);
    try {
      await api('/api/v1/shifts/templates', {
        method: 'POST',
        json: {
          name: copyName(tpl.name, list.map((x) => x.name), t('copyPrefix')),
          description: tpl.description,
          tolerance_in_min: tpl.tolerance_in_min,
          tolerance_out_min: tpl.tolerance_out_min,
          expected_break_min_min: tpl.expected_break_min_min,
          expected_break_max_min: tpl.expected_break_max_min,
          expected_lunch_min_min: tpl.expected_lunch_min_min,
          expected_lunch_max_min: tpl.expected_lunch_max_min,
          extraordinary_threshold_min: tpl.extraordinary_threshold_min,
          count_extraordinary: tpl.count_extraordinary,
          tolerance_in_breach_deduct_min: tpl.tolerance_in_breach_deduct_min,
          tolerance_out_breach_deduct_min: tpl.tolerance_out_breach_deduct_min,
          tolerance_break_breach_deduct_min: tpl.tolerance_break_breach_deduct_min,
          flexible_enabled: tpl.flexible_enabled,
          flex_in_before_min: tpl.flex_in_before_min,
          flex_in_after_min: tpl.flex_in_after_min,
          flex_out_before_min: tpl.flex_out_before_min,
          flex_out_after_min: tpl.flex_out_after_min,
          flex_lunch_before_min: tpl.flex_lunch_before_min,
          flex_lunch_after_min: tpl.flex_lunch_after_min,
          slots: tpl.slots.map((s) => ({
            day_of_week: s.day_of_week,
            start_time: s.start_time,
            end_time: s.end_time,
          })),
          day_lunch: (tpl.day_lunch ?? []).map((d) => ({
            day_of_week: d.day_of_week,
            lunch_min: d.lunch_min,
          })),
        },
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common:state.error'));
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('heading')}
        actions={
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            {t('new')}
          </button>
        }
      />

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

      <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {list.map((tpl) => (
          <li key={tpl.id} className="card flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium">{tpl.name}</div>
                {tpl.description && (
                  <div className="text-xs muted">{tpl.description}</div>
                )}
                <div className="text-xs muted mt-1">
                  {t('summary', {
                    toleranceIn: tpl.tolerance_in_min,
                    toleranceOut: tpl.tolerance_out_min,
                    breakMin: tpl.expected_break_min_min,
                    breakMax: tpl.expected_break_max_min,
                    lunchMin: tpl.expected_lunch_min_min,
                    lunchMax: tpl.expected_lunch_max_min,
                  })}
                </div>
                <div className="text-xs muted mt-0.5">
                  {t('weeklyTotal', { total: formatWeeklyTotal(tpl.slots) })}
                </div>
              </div>
              <div className="flex gap-2 shrink-0 items-center">
                <IconButton kind="duplicate" title={t('duplicate')} onClick={() => duplicate(tpl)} />
                <IconButton kind="edit" title={t('edit')} onClick={() => setEditing(tpl)} />
                <IconButton kind="delete" title={t('common:btn.delete')} onClick={() => remove(tpl)} />
              </div>
            </div>
            <WeeklyPreview slots={tpl.slots} />
          </li>
        ))}
        {list.length === 0 && (
          <li className="card text-sm muted">
            {t('empty')}
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

// Compact minutes input used in the "Orario flessibile" grid.
function FlexNum({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input
        type="number"
        min={0}
        max={240}
        className="input"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

// Build a unique "Copia di <name>" within the 120-char name limit, appending
// " (2)", " (3)"… when a copy with that name already exists. The base is
// trimmed (not the suffix) so the counter is never truncated away.
function copyName(base: string, existing: string[], prefix: string): string {
  const MAX = 120;
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
  // Subscribe to i18n so weekday names re-resolve when the language changes.
  useTranslation('shifts');
  return (
    <div className="text-xs grid grid-cols-7 gap-1">
      {DAYS.map((d) => {
        const ds = slots.filter((s) => s.day_of_week === d.iso);
        return (
          <div key={d.iso} className="border border-neutral-200 rounded p-1">
            <div className="font-medium text-neutral-700">{dayLabel(d.iso).slice(0, 3)}</div>
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
  flexible_enabled: boolean;
  flex_in_before_min: number;
  flex_in_after_min: number;
  flex_out_before_min: number;
  flex_out_after_min: number;
  flex_lunch_before_min: number;
  flex_lunch_after_min: number;
  slots: Slot[];
  // dow (1..7) → auto-deduct lunch minutes. 0/absent = none.
  dayLunch: Record<number, number>;
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
  const { t } = useTranslation(['shifts', 'common']);
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
    flexible_enabled: initial?.flexible_enabled ?? false,
    flex_in_before_min: initial?.flex_in_before_min ?? 0,
    flex_in_after_min: initial?.flex_in_after_min ?? 0,
    flex_out_before_min: initial?.flex_out_before_min ?? 0,
    flex_out_after_min: initial?.flex_out_after_min ?? 0,
    flex_lunch_before_min: initial?.flex_lunch_before_min ?? 0,
    flex_lunch_after_min: initial?.flex_lunch_after_min ?? 0,
    slots: initial?.slots ?? [],
    dayLunch: Object.fromEntries(
      (initial?.day_lunch ?? []).map((d) => [d.day_of_week, d.lunch_min])
    ),
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
  function setDayLunch(day: number, minutes: number) {
    setState((s) => ({ ...s, dayLunch: { ...s.dayLunch, [day]: minutes } }));
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
        flexible_enabled: state.flexible_enabled,
        flex_in_before_min: state.flexible_enabled ? state.flex_in_before_min : 0,
        flex_in_after_min: state.flexible_enabled ? state.flex_in_after_min : 0,
        flex_out_before_min: state.flexible_enabled ? state.flex_out_before_min : 0,
        flex_out_after_min: state.flexible_enabled ? state.flex_out_after_min : 0,
        flex_lunch_before_min: state.flexible_enabled ? state.flex_lunch_before_min : 0,
        flex_lunch_after_min: state.flexible_enabled ? state.flex_lunch_after_min : 0,
        slots: state.slots.map((s) => ({
          day_of_week: s.day_of_week,
          start_time: s.start_time,
          end_time: s.end_time,
        })),
        // Auto-lunch only applies to single-fascia days (backend enforces this
        // too); never send it for split or rest days.
        day_lunch: Object.entries(state.dayLunch)
          .map(([dow, min]) => ({ day_of_week: Number(dow), lunch_min: Number(min) }))
          .filter(
            (d) =>
              d.lunch_min > 0 &&
              state.slots.filter((s) => s.day_of_week === d.day_of_week).length === 1
          ),
      };
      if (initial) {
        await api(`/api/v1/shifts/templates/${initial.id}`, { method: 'PATCH', json: body });
      } else {
        await api('/api/v1/shifts/templates', { method: 'POST', json: body });
      }
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common:state.error'));
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
            {initial ? t('form.editTitle') : t('form.createTitle')}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="label">{t('form.name')}</span>
              <input
                className="input"
                required
                maxLength={120}
                value={state.name}
                onChange={(e) => setState({ ...state, name: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="label">{t('form.description')}</span>
              <input
                className="input"
                maxLength={500}
                value={state.description}
                onChange={(e) => setState({ ...state, description: e.target.value })}
              />
            </label>
          </div>

          <fieldset className="border border-neutral-200 rounded p-3 space-y-2">
            <legend className="text-sm font-medium px-1">{t('form.tolerances')}</legend>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <label>
                <span className="label">{t('form.toleranceIn')}</span>
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
                <span className="label">{t('form.toleranceOut')}</span>
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
                <span className="label">{t('form.breakMin')}</span>
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
                <span className="label">{t('form.breakMax')}</span>
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
                <span className="label">{t('form.lunchMin')}</span>
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
                <span className="label">{t('form.lunchMax')}</span>
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
            <legend className="text-sm font-medium px-1">{t('form.penalties')}</legend>
            <p className="text-xs muted mb-2">
              {t('form.penaltiesHint')}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label>
                <span className="label">{t('form.penaltyIn')}</span>
                <select
                  className="input"
                  value={state.tolerance_in_breach_deduct_min}
                  onChange={(e) =>
                    setState({ ...state, tolerance_in_breach_deduct_min: Number(e.target.value) })
                  }
                >
                  {PENALTY_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {v === 0 ? t('form.noPenalty') : t('form.minutesValue', { count: v })}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="label">{t('form.penaltyOut')}</span>
                <select
                  className="input"
                  value={state.tolerance_out_breach_deduct_min}
                  onChange={(e) =>
                    setState({ ...state, tolerance_out_breach_deduct_min: Number(e.target.value) })
                  }
                >
                  {PENALTY_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {v === 0 ? t('form.noPenalty') : t('form.minutesValue', { count: v })}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="label">{t('form.penaltyBreak')}</span>
                <select
                  className="input"
                  value={state.tolerance_break_breach_deduct_min}
                  onChange={(e) =>
                    setState({ ...state, tolerance_break_breach_deduct_min: Number(e.target.value) })
                  }
                >
                  {PENALTY_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {v === 0 ? t('form.noPenalty') : t('form.minutesValue', { count: v })}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </fieldset>

          <fieldset className="border border-neutral-200 rounded p-3 space-y-2">
            <legend className="text-sm font-medium px-1">{t('form.flexible')}</legend>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={state.flexible_enabled}
                onChange={(e) => setState({ ...state, flexible_enabled: e.target.checked })}
              />
              <span className="text-sm">{t('form.flexibleEnable')}</span>
            </label>
            {state.flexible_enabled && (
              <>
                <p className="text-xs muted">{t('form.flexibleHint')}</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-2">
                  <FlexNum
                    label={t('form.flexInBefore')}
                    value={state.flex_in_before_min}
                    onChange={(v) => setState({ ...state, flex_in_before_min: v })}
                  />
                  <FlexNum
                    label={t('form.flexOutBefore')}
                    value={state.flex_out_before_min}
                    onChange={(v) => setState({ ...state, flex_out_before_min: v })}
                  />
                  <FlexNum
                    label={t('form.flexLunchBefore')}
                    value={state.flex_lunch_before_min}
                    onChange={(v) => setState({ ...state, flex_lunch_before_min: v })}
                  />
                  <FlexNum
                    label={t('form.flexInAfter')}
                    value={state.flex_in_after_min}
                    onChange={(v) => setState({ ...state, flex_in_after_min: v })}
                  />
                  <FlexNum
                    label={t('form.flexOutAfter')}
                    value={state.flex_out_after_min}
                    onChange={(v) => setState({ ...state, flex_out_after_min: v })}
                  />
                  <FlexNum
                    label={t('form.flexLunchAfter')}
                    value={state.flex_lunch_after_min}
                    onChange={(v) => setState({ ...state, flex_lunch_after_min: v })}
                  />
                </div>
              </>
            )}
          </fieldset>

          <fieldset className="border border-neutral-200 rounded p-3 space-y-3">
            <legend className="text-sm font-medium px-1">{t('form.extraordinary')}</legend>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={state.count_extraordinary}
                onChange={(e) =>
                  setState({ ...state, count_extraordinary: e.target.checked })
                }
              />
              <span className="text-sm">{t('form.countExtraordinary')}</span>
            </label>
            {state.count_extraordinary && (
              <label className="block">
                <span className="label">{t('form.extraordinaryBlock')}</span>
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
                  <option value={15}>{t('form.minutesValue', { count: 15 })}</option>
                  <option value={30}>{t('form.minutesValue', { count: 30 })}</option>
                  <option value={60}>{t('form.minutesValue', { count: 60 })}</option>
                </select>
                <p className="text-xs muted mt-1">
                  {t('form.extraordinaryHint')}
                </p>
              </label>
            )}
          </fieldset>

          <fieldset className="border border-neutral-200 rounded p-3">
            <legend className="text-sm font-medium px-1">{t('form.week')}</legend>
            <p className="text-xs muted mb-2">
              {t('form.weekHint')}
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
                    <div className="w-20 text-sm font-medium shrink-0">{dayLabel(d.iso)}</div>
                    <div className="flex items-center gap-2 flex-wrap flex-1">
                      {daySlots.length === 0 && (
                        <span className="text-xs text-neutral-400 italic mr-2">{t('form.rest')}</span>
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
                            aria-label={t('form.removeSlot')}
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
                        {t('form.addSlot')}
                      </button>
                      {daySlots.length === 1 && (
                        <label
                          className="flex items-center gap-1 text-xs muted"
                          title={t('form.autoLunchHint')}
                        >
                          <span>{t('form.autoLunch')}</span>
                          <input
                            type="number"
                            min={0}
                            max={480}
                            className="input"
                            style={{ width: 64, padding: '0.2rem 0.4rem', minHeight: 0 }}
                            value={state.dayLunch[d.iso] ?? 0}
                            onChange={(e) => setDayLunch(d.iso, Number(e.target.value))}
                          />
                        </label>
                      )}
                      {dayMin > 0 && (
                        <span className="text-xs muted ml-auto tabular-nums">
                          {formatMinutes(dayMin)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between pt-2 mt-2 border-t border-neutral-200 text-sm">
              <span className="font-medium">{t('form.weeklyTotalLabel')}</span>
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
              {t('common:btn.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? t('common:state.saving') : t('common:btn.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
