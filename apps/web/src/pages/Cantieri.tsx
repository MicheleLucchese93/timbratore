import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { CantiereRecord, CantiereStatus, CantieriFieldDef } from '@sonoqui/shared';
import { CANTIERE_ADDRESS_MAX, CANTIERE_NAME_MAX } from '@sonoqui/shared';
import { api } from '../lib/api.ts';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { CantieriFieldDefsSection } from '../components/CantieriFields.tsx';
import { useEscapeKey } from '../hooks/useEscapeKey.ts';

interface SiteRow extends CantiereRecord {
  assigned_user_ids: string[];
  entries_count: number;
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

export function Cantieri() {
  const { t } = useTranslation(['cantieri', 'common']);
  const confirm = useConfirm();
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [fields, setFields] = useState<CantieriFieldDef[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SiteRow | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, f, u] = await Promise.all([
        api<{ sites: SiteRow[] }>('/api/v1/cantieri/sites'),
        api<{ fields: CantieriFieldDef[] }>('/api/v1/cantieri/fields?scope=entry'),
        api<{ members: MemberOption[] }>('/api/v1/cantieri/members'),
      ]);
      setSites(s.sites);
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
    const f = await api<{ fields: CantieriFieldDef[] }>('/api/v1/cantieri/fields?scope=entry');
    setFields(f.fields);
  }, []);

  async function remove(s: SiteRow) {
    const ok = await confirm({
      title: t('sites.deleteTitle'),
      message: t('sites.deleteConfirm', { name: s.name }),
      confirmLabel: t('common:btn.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/v1/cantieri/sites/${s.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common:state.error'));
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('sites.title')}
        subtitle={t('sites.subtitle')}
        actions={
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            {t('sites.new')}
          </button>
        }
      />

      {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}

      {sites.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">{t('sites.empty')}</div>
        </div>
      ) : (
        <ul className="space-y-2">
          {sites.map((s) => (
            <li key={s.id} className="card flex items-center gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm truncate" title={s.name}>{s.name}</span>
                  <StatusBadge status={s.status} />
                </div>
                <div className="text-xs muted mt-1 flex items-center gap-3 flex-wrap">
                  {s.address && <span className="truncate">{s.address}</span>}
                  <span className="num">{t('sites.assignedCount', { count: s.assigned_user_ids.length })}</span>
                  <span className="num">{t('sites.entriesCount', { count: s.entries_count })}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button className="btn btn-secondary btn-sm" onClick={() => setEditing(s)}>
                  {t('common:btn.edit')}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ color: 'var(--color-error)' }}
                  onClick={() => remove(s)}
                >
                  {t('common:btn.delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <CantieriFieldDefsSection scope="entry" defs={fields} onChanged={loadFields} />

      {(creating || editing) && (
        <SiteModal
          existing={editing}
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

function StatusBadge({ status }: { status: CantiereStatus }) {
  const { t } = useTranslation(['cantieri']);
  return (
    <span className={`badge ${status === 'open' ? 'badge-ok' : 'badge-muted'}`}>
      {t(`status.${status}`)}
    </span>
  );
}

/* ---------------- Create / edit modal ---------------- */

function SiteModal({
  existing,
  members,
  onClose,
  onSaved,
}: {
  existing: SiteRow | null;
  members: MemberOption[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { t } = useTranslation(['cantieri', 'common']);
  useEscapeKey(onClose);
  const [name, setName] = useState(existing?.name ?? '');
  const [address, setAddress] = useState(existing?.address ?? '');
  const [status, setStatus] = useState<CantiereStatus>(existing?.status ?? 'open');
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
    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        address: address.trim() || null,
        status,
      };
      let siteId = existing?.id;
      if (existing) {
        await api(`/api/v1/cantieri/sites/${existing.id}`, { method: 'PATCH', json: payload });
      } else {
        const created = await api<CantiereRecord>('/api/v1/cantieri/sites', {
          method: 'POST',
          json: payload,
        });
        siteId = created.id;
      }
      await api(`/api/v1/cantieri/sites/${siteId}/assignments`, {
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
          {existing ? t('form.editTitle') : t('form.createTitle')}
        </h2>

        {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}

        <div>
          <label className="label">{t('form.name')}</label>
          <input
            className="input"
            value={name}
            maxLength={CANTIERE_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>

        <div>
          <label className="label">{t('form.address')}</label>
          <input
            className="input"
            value={address}
            maxLength={CANTIERE_ADDRESS_MAX}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>

        <div>
          <label className="label">{t('status.label')}</label>
          <select
            className="input"
            value={status}
            onChange={(e) => setStatus(e.target.value as CantiereStatus)}
          >
            <option value="open">{t('status.open')}</option>
            <option value="closed">{t('status.closed')}</option>
          </select>
          <p className="text-xs muted mt-1">{t('form.statusHint')}</p>
        </div>

        <div>
          <label className="label">{t('form.assignees')}</label>
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
          <p className="text-xs muted mt-1">{t('form.assigneesHint')}</p>
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
