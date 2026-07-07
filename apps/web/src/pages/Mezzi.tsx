import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { CantieriCustomValues, CantieriFieldDef, MezzoRecord } from '@sonoqui/shared';
import { MEZZO_NAME_MAX } from '@sonoqui/shared';
import { api } from '../lib/api.ts';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { CantieriTabs } from '../components/CantieriTabs.tsx';
import {
  buildCustomValues,
  CantieriCustomInputs,
  CantieriFieldDefsSection,
  missingRequiredDef,
} from '../components/CantieriFields.tsx';
import { useEscapeKey } from '../hooks/useEscapeKey.ts';

interface MezzoRow extends MezzoRecord {
  assigned_user_ids: string[];
}

// Assignment-picker row from GET /api/v1/cantieri/members.
interface MemberOption {
  user_id: string;
  email: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
}

function memberLabel(m: MemberOption): string {
  return (
    m.display_name || [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email
  );
}

export function Mezzi() {
  const { t } = useTranslation(['cantieri', 'common']);
  const confirm = useConfirm();
  const [mezzi, setMezzi] = useState<MezzoRow[]>([]);
  const [fields, setFields] = useState<CantieriFieldDef[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<MezzoRow | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, f, u] = await Promise.all([
        api<{ mezzi: MezzoRow[] }>('/api/v1/cantieri/mezzi'),
        api<{ fields: CantieriFieldDef[] }>('/api/v1/cantieri/fields?scope=mezzo'),
        api<{ members: MemberOption[] }>('/api/v1/cantieri/members'),
      ]);
      setMezzi(m.mezzi);
      setFields(f.fields);
      setMembers(u.members);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common:state.error'));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const loadFields = useCallback(async () => {
    const f = await api<{ fields: CantieriFieldDef[] }>('/api/v1/cantieri/fields?scope=mezzo');
    setFields(f.fields);
  }, []);

  async function remove(m: MezzoRow) {
    const ok = await confirm({
      title: t('mezzi.deleteTitle'),
      message: t('mezzi.deleteConfirm', { name: m.name }),
      confirmLabel: t('common:btn.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/v1/cantieri/mezzi/${m.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common:state.error'));
    }
  }

  // One-line preview of a vehicle's custom values, in field order.
  function customSummary(m: MezzoRow): string {
    return fields
      .map((d) => {
        const v = m.custom_values[d.key];
        if (v === undefined || v === null || v === '') return null;
        const text = d.field_type === 'boolean' ? (v === true ? t('common:btn.yes') : t('common:btn.no')) : String(v);
        return `${d.label}: ${text}`;
      })
      .filter((x): x is string => x !== null)
      .join(' · ');
  }

  return (
    <div className="space-y-5">
      <CantieriTabs />
      <PageHeader
        title={t('mezzi.title')}
        subtitle={t('mezzi.subtitle')}
        actions={
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            {t('mezzi.new')}
          </button>
        }
      />

      {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}

      {mezzi.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">{t('mezzi.empty')}</div>
          <div className="empty-state-hint">{t('mezzi.emptyHint')}</div>
          <button
            type="button"
            className="btn btn-primary btn-sm mt-2"
            onClick={() => setCreating(true)}
          >
            {t('mezzi.new')}
          </button>
        </div>
      ) : (
        <ul className="space-y-2">
          {mezzi.map((m) => (
            <li key={m.id} className="card flex items-center gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm truncate" title={m.name}>{m.name}</div>
                <div className="text-xs muted mt-1 flex items-center gap-3 flex-wrap">
                  <span className="num">
                    {t('sites.assignedCount', { count: m.assigned_user_ids.length })}
                  </span>
                  {customSummary(m) && <span className="truncate">{customSummary(m)}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button className="btn btn-secondary btn-sm" onClick={() => setEditing(m)}>
                  {t('common:btn.edit')}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ color: 'var(--color-error)' }}
                  onClick={() => remove(m)}
                >
                  {t('common:btn.delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <CantieriFieldDefsSection scope="mezzo" defs={fields} onChanged={loadFields} />

      {(creating || editing) && (
        <MezzoModal
          existing={editing}
          fields={fields}
          members={members}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setCreating(false);
            setEditing(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

/* ---------------- Create / edit modal ---------------- */

function MezzoModal({
  existing,
  fields,
  members,
  onClose,
  onSaved,
}: {
  existing: MezzoRow | null;
  fields: CantieriFieldDef[];
  members: MemberOption[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { t } = useTranslation(['cantieri', 'common']);
  useEscapeKey(onClose);
  const [name, setName] = useState(existing?.name ?? '');
  const [values, setValues] = useState<CantieriCustomValues>(existing?.custom_values ?? {});
  const [userIds, setUserIds] = useState<Set<string>>(
    new Set(existing?.assigned_user_ids ?? [])
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggleUser(id: string) {
    setUserIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!name.trim()) return setErr(t('form.errorNameRequired'));
    const missing = missingRequiredDef(fields, values);
    if (missing) return setErr(t('form.errorFieldRequired', { label: missing.label }));
    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        custom_values: buildCustomValues(fields, values),
      };
      let mezzoId = existing?.id;
      if (existing) {
        await api(`/api/v1/cantieri/mezzi/${existing.id}`, { method: 'PATCH', json: payload });
      } else {
        const created = await api<MezzoRecord>('/api/v1/cantieri/mezzi', {
          method: 'POST',
          json: payload,
        });
        mezzoId = created.id;
      }
      await api(`/api/v1/cantieri/mezzi/${mezzoId}/assignments`, {
        method: 'PUT',
        json: { user_ids: Array.from(userIds) },
      });
      await onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t('common:state.error'));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50 overflow-y-auto">
      <form onSubmit={submit} className="card w-full max-w-lg space-y-3 my-4">
        <h2 className="section-title">
          {existing ? t('mezzi.form.editTitle') : t('mezzi.form.createTitle')}
        </h2>

        {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}

        <div>
          <label className="label">{t('mezzi.form.name')}</label>
          <input
            className="input"
            value={name}
            maxLength={MEZZO_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>

        <CantieriCustomInputs
          defs={fields}
          values={values}
          onChange={(key, v) => setValues((cur) => ({ ...cur, [key]: v }))}
        />

        <div>
          <label className="label">{t('mezzi.form.assignees')}</label>
          {members.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--color-error)' }}>{t('form.noUsers')}</p>
          ) : (
            <ul
              className="space-y-1 max-h-56 overflow-auto"
              style={{ paddingLeft: 0, listStyle: 'none' }}
            >
              {members.map((m) => (
                <li key={m.user_id}>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={userIds.has(m.user_id)}
                      onChange={() => toggleUser(m.user_id)}
                    />
                    <span className="truncate">{memberLabel(m)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs muted mt-1">{t('mezzi.form.assigneesHint')}</p>
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
