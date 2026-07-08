import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  CantieriCustomValue,
  CantieriCustomValues,
  CantieriFieldDef,
  CantieriFieldScope,
  CantieriFieldType,
} from '@sonoqui/shared';
import {
  CANTIERI_FIELD_LABEL_MAX,
  CANTIERI_FIELD_OPTION_MAX,
  CANTIERI_FIELD_OPTIONS_MAX,
  CANTIERI_FIELDS_PER_SCOPE_MAX,
  CANTIERI_FIELD_TYPES,
} from '@sonoqui/shared';
import { api } from '../lib/api.ts';
import { useConfirm } from './ConfirmDialog.tsx';
import { useEscapeKey } from '../hooks/useEscapeKey.ts';

/* Shared building blocks of the Cantieri module: the tenant-wide custom-field
   definitions manager (used by both the Cantieri page, scope 'entry', and the
   Mezzi page, scope 'mezzo') and the dynamic inputs rendered from those defs. */

/** Payload of custom values from the modal inputs: only keys of active defs are
 *  sent; empty inputs are dropped (booleans always sent — false is a value). */
export function buildCustomValues(
  defs: CantieriFieldDef[],
  values: CantieriCustomValues
): CantieriCustomValues {
  const out: CantieriCustomValues = {};
  for (const d of defs) {
    const v = values[d.key];
    if (d.field_type === 'boolean') {
      out[d.key] = v === true;
    } else if (v !== undefined && v !== null && v !== '') {
      out[d.key] = v;
    }
  }
  return out;
}

/** First required def left empty, or null when all required values are set.
 *  The backend re-validates; this only gives a friendly pre-submit message. */
export function missingRequiredDef(
  defs: CantieriFieldDef[],
  values: CantieriCustomValues
): CantieriFieldDef | null {
  for (const d of defs) {
    if (!d.required) continue;
    const v = values[d.key];
    if (d.field_type === 'boolean') continue; // false is a valid answer
    if (v === undefined || v === null || v === '') return d;
  }
  return null;
}

/** Dynamic inputs rendered from the field defs of a scope. Controlled: the
 *  caller owns the values map and receives per-key updates. */
export function CantieriCustomInputs({
  defs,
  values,
  onChange,
}: {
  defs: CantieriFieldDef[];
  values: CantieriCustomValues;
  onChange: (key: string, value: CantieriCustomValue) => void;
}) {
  if (defs.length === 0) return null;
  return (
    <div className="space-y-3">
      {defs.map((d) => (
        <div key={d.id}>
          {d.field_type === 'boolean' ? (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={values[d.key] === true}
                onChange={(e) => onChange(d.key, e.target.checked)}
              />
              <span>{d.label}</span>
            </label>
          ) : (
            <>
              <label className="label">
                {d.label}
                {d.required && <span style={{ color: 'var(--color-error)' }}> *</span>}
              </label>
              {d.field_type === 'select' ? (
                <select
                  className="input"
                  value={String(values[d.key] ?? '')}
                  onChange={(e) => onChange(d.key, e.target.value || null)}
                >
                  <option value="">—</option>
                  {(d.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : d.field_type === 'number' ? (
                <input
                  type="number"
                  className="input num"
                  value={values[d.key] == null ? '' : String(values[d.key])}
                  onChange={(e) =>
                    onChange(d.key, e.target.value === '' ? null : Number(e.target.value))
                  }
                />
              ) : (
                <input
                  type={d.field_type === 'date' ? 'date' : d.field_type === 'time' ? 'time' : 'text'}
                  className="input"
                  value={String(values[d.key] ?? '')}
                  onChange={(e) => onChange(d.key, e.target.value || null)}
                />
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------------- Field definitions manager ---------------- */

/** "Campi personalizzati" card: list of the defs of one scope with add/edit/
 *  delete. The parent owns the defs (it also needs them for its own forms) and
 *  reloads them via `onChanged` after every mutation. */
export function CantieriFieldDefsSection({
  scope,
  defs,
  sites,
  onChanged,
}: {
  scope: CantieriFieldScope;
  defs: CantieriFieldDef[];
  /** Entry scope: the tenant's sites, enabling per-cantiere association. */
  sites?: Array<{ id: string; name: string }>;
  onChanged: () => Promise<void> | void;
}) {
  const { t } = useTranslation(['cantieri', 'common']);
  const confirm = useConfirm();
  const showAssoc = scope === 'entry' && sites !== undefined;
  const siteName = (id: string): string =>
    sites?.find((s) => s.id === id)?.name ?? '…';
  const [editing, setEditing] = useState<CantieriFieldDef | null>(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const atLimit = defs.length >= CANTIERI_FIELDS_PER_SCOPE_MAX;

  async function remove(d: CantieriFieldDef) {
    const ok = await confirm({
      title: t('fields.deleteTitle'),
      message: t('fields.deleteConfirm', { label: d.label }),
      confirmLabel: t('common:btn.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/v1/cantieri/fields/${d.id}`, { method: 'DELETE' });
      setErr(null);
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common:state.error'));
    }
  }

  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="section-title">{t('fields.title')}</h2>
          <p className="text-xs muted">{t(`fields.hint.${scope}`)}</p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={atLimit}
          title={atLimit ? t('fields.limitReached', { max: CANTIERI_FIELDS_PER_SCOPE_MAX }) : undefined}
          onClick={() => setCreating(true)}
        >
          {t('fields.add')}
        </button>
      </div>

      {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}

      {defs.length === 0 ? (
        <div className="text-sm muted">{t('fields.empty')}</div>
      ) : (
        <ul className="space-y-1">
          {defs.map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-2 flex-wrap text-sm py-1.5"
              style={{ borderTop: '1px solid var(--color-outline-variant)' }}
            >
              <span className="font-medium">{d.label}</span>
              <span className="badge badge-muted">{t(`fields.type.${d.field_type}`)}</span>
              {d.required && <span className="badge badge-warn">{t('fields.required')}</span>}
              {d.field_type === 'select' && (
                <span className="text-xs muted truncate" style={{ maxWidth: '18rem' }}>
                  {(d.options ?? []).join(', ')}
                </span>
              )}
              {showAssoc && (
                <span
                  className="badge badge-muted truncate"
                  style={{ maxWidth: '20rem' }}
                  title={
                    d.cantiere_ids.length === 0
                      ? t('fields.allCantieri')
                      : d.cantiere_ids.map(siteName).join(', ')
                  }
                >
                  {d.cantiere_ids.length === 0
                    ? t('fields.allCantieri')
                    : d.cantiere_ids.map(siteName).join(', ')}
                </span>
              )}
              <span className="flex-1" />
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(d)}>
                {t('common:btn.edit')}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--color-error)' }}
                onClick={() => remove(d)}
              >
                {t('common:btn.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <FieldDefModal
          scope={scope}
          existing={editing}
          sites={showAssoc ? sites : undefined}
          nextPosition={defs.reduce((max, d) => Math.max(max, d.position), 0) + 1}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setCreating(false);
            setEditing(null);
            setErr(null);
            await onChanged();
          }}
        />
      )}
    </section>
  );
}

function FieldDefModal({
  scope,
  existing,
  sites,
  nextPosition,
  onClose,
  onSaved,
}: {
  scope: CantieriFieldScope;
  existing: CantieriFieldDef | null;
  sites?: Array<{ id: string; name: string }>;
  nextPosition: number;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { t } = useTranslation(['cantieri', 'common']);
  useEscapeKey(onClose);
  const [label, setLabel] = useState(existing?.label ?? '');
  const [fieldType, setFieldType] = useState<CantieriFieldType>(existing?.field_type ?? 'text');
  // Options editor for the select type: one option per line.
  const [optionsText, setOptionsText] = useState((existing?.options ?? []).join('\n'));
  const [required, setRequired] = useState(existing?.required ?? false);
  const [position, setPosition] = useState<number>(existing?.position ?? nextPosition);
  // Per-cantiere association (entry scope). Empty set = all cantieri.
  const [cantiereIds, setCantiereIds] = useState<Set<string>>(
    new Set(existing?.cantiere_ids ?? [])
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const showAssoc = sites !== undefined;

  function toggleCantiere(id: string) {
    setCantiereIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!label.trim()) return setErr(t('fields.form.errorLabelRequired'));
    const options = optionsText
      .split('\n')
      .map((o) => o.trim().slice(0, CANTIERI_FIELD_OPTION_MAX))
      .filter((o) => o.length > 0)
      .slice(0, CANTIERI_FIELD_OPTIONS_MAX);
    if (fieldType === 'select' && options.length === 0) {
      return setErr(t('fields.form.errorOptionsRequired'));
    }
    const cantiere_ids = showAssoc ? Array.from(cantiereIds) : undefined;
    setBusy(true);
    try {
      if (existing) {
        await api(`/api/v1/cantieri/fields/${existing.id}`, {
          method: 'PATCH',
          json: {
            label: label.trim(),
            ...(existing.field_type === 'select' ? { options } : {}),
            required,
            position,
            ...(cantiere_ids ? { cantiere_ids } : {}),
          },
        });
      } else {
        await api('/api/v1/cantieri/fields', {
          method: 'POST',
          json: {
            scope,
            label: label.trim(),
            field_type: fieldType,
            ...(fieldType === 'select' ? { options } : {}),
            required,
            position,
            ...(cantiere_ids ? { cantiere_ids } : {}),
          },
        });
      }
      await onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t('common:state.error'));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <form onSubmit={submit} className="card w-full max-w-md space-y-3">
        <h2 className="section-title">
          {existing ? t('fields.form.editTitle') : t('fields.form.createTitle')}
        </h2>

        {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}

        <div>
          <label className="label">{t('fields.form.label')}</label>
          <input
            className="input"
            value={label}
            maxLength={CANTIERI_FIELD_LABEL_MAX}
            onChange={(e) => setLabel(e.target.value)}
            autoFocus
          />
        </div>

        <div>
          <label className="label">{t('fields.form.fieldType')}</label>
          <select
            className="input"
            value={fieldType}
            disabled={!!existing}
            onChange={(e) => setFieldType(e.target.value as CantieriFieldType)}
          >
            {CANTIERI_FIELD_TYPES.map((ft) => (
              <option key={ft} value={ft}>
                {t(`fields.type.${ft}`)}
              </option>
            ))}
          </select>
          {existing && <p className="text-xs muted mt-1">{t('fields.form.fieldTypeImmutable')}</p>}
        </div>

        {fieldType === 'select' && (
          <div>
            <label className="label">{t('fields.form.options')}</label>
            <textarea
              className="input"
              rows={5}
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
            />
            <p className="text-xs muted mt-1">
              {t('fields.form.optionsHint', { max: CANTIERI_FIELD_OPTIONS_MAX })}
            </p>
          </div>
        )}

        <div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={required}
              onChange={(e) => setRequired(e.target.checked)}
            />
            <span>{t('fields.form.required')}</span>
          </label>
        </div>

        {showAssoc && (
          <div>
            <label className="label">{t('fields.form.cantieri')}</label>
            {sites!.length === 0 ? (
              <p className="text-sm muted">{t('fields.form.cantieriNoSites')}</p>
            ) : (
              <ul
                className="space-y-1 max-h-48 overflow-auto"
                style={{ paddingLeft: 0, listStyle: 'none' }}
              >
                {sites!.map((s) => (
                  <li key={s.id}>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cantiereIds.has(s.id)}
                        onChange={() => toggleCantiere(s.id)}
                      />
                      <span className="truncate">{s.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs muted mt-1">{t('fields.form.cantieriHint')}</p>
          </div>
        )}

        <div>
          <label className="label">{t('fields.form.position')}</label>
          <input
            type="number"
            className="input num"
            min={0}
            value={position}
            onChange={(e) => setPosition(Number(e.target.value))}
            style={{ maxWidth: '8rem' }}
          />
          <p className="text-xs muted mt-1">{t('fields.form.positionHint')}</p>
        </div>

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
