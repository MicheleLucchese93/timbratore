import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { api, type ApiError } from '../lib/api.ts';
import { useSession, type PartnerCaps } from '../store/session.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmProvider.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { Modal } from '../components/Modal.tsx';

interface TenantRow {
  id: string;
  ragione_sociale: string;
  language: 'it' | 'en';
  max_admins: number;
  max_users: number;
  max_documentali: number;
  max_branches: number;
  suspended_at: string | null;
  created_at: string;
  created_by_partner: string | null;
  owner_email: string | null;
  admin_email: string | null;
  admin_count: number;
  used_members: number;
  used_admins: number;
  used_documentali: number;
  used_branches: number;
}

function errMsg(t: (k: string, o?: Record<string, unknown>) => string, e: unknown): string {
  const code = (e as ApiError | null)?.code;
  return t(`errors.${code ?? 'default'}`, { defaultValue: t('errors.default') });
}

export function Tenants() {
  const { t } = useTranslation();
  const me = useSession((s) => s.me);
  const toast = useToast();
  const confirm = useConfirm();
  const isAdmin = me?.role === 'admin';
  const caps = me?.caps;

  const [rows, setRows] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TenantRow | null>(null);
  const [managingAdmins, setManagingAdmins] = useState<TenantRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ tenants: TenantRow[] }>('/api/v1/partnership/tenants');
      setRows(r.tenants);
    } catch (e) {
      toast(errMsg(t, e), true);
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (path: string, doneKey: string, extra?: Record<string, unknown>) => {
      try {
        const res = await api<Record<string, unknown>>(path, { method: 'POST' });
        toast(t(doneKey, { ...extra, ...res }));
        await load();
      } catch (e) {
        toast(errMsg(t, e), true);
      }
    },
    [t, toast, load]
  );

  const columns: GridColDef<TenantRow>[] = [
    { field: 'ragione_sociale', headerName: t('tenants.col.name'), flex: 1.4, minWidth: 170 },
    {
      field: 'admin_email',
      headerName: t('tenants.col.admin_email'),
      flex: 1.2,
      minWidth: 190,
      sortable: false,
      renderCell: (p) =>
        p.row.admin_email ? (
          <span>
            {p.row.admin_email}
            {p.row.admin_count > 1 && (
              <span style={{ color: 'var(--color-on-surface-variant)' }}> +{p.row.admin_count - 1}</span>
            )}
          </span>
        ) : (
          t('common.none')
        ),
    },
    ...(isAdmin
      ? [{
          field: 'owner_email',
          headerName: t('tenants.col.owner'),
          flex: 1,
          minWidth: 150,
          valueGetter: (_v: unknown, row: TenantRow) => row.owner_email ?? t('tenants.platform'),
        } as GridColDef<TenantRow>]
      : []),
    {
      field: 'used_members',
      headerName: t('tenants.col.users'),
      width: 100,
      renderCell: (p) => `${p.row.used_members}/${p.row.max_users}`,
    },
    {
      field: 'used_admins',
      headerName: t('tenants.col.admins'),
      width: 90,
      renderCell: (p) => `${p.row.used_admins}/${p.row.max_admins}`,
    },
    {
      field: 'used_documentali',
      headerName: t('tenants.col.documentali'),
      width: 110,
      renderCell: (p) => `${p.row.used_documentali}/${p.row.max_documentali}`,
    },
    {
      field: 'used_branches',
      headerName: t('tenants.col.branches'),
      width: 90,
      renderCell: (p) => `${p.row.used_branches}/${p.row.max_branches}`,
    },
    {
      field: 'suspended_at',
      headerName: t('tenants.col.status'),
      width: 120,
      renderCell: (p) => (
        <span className="cell-badge">
          {p.row.suspended_at ? (
            <span className="badge badge-warn">{t('tenants.status.suspended')}</span>
          ) : (
            <span className="badge badge-ok">{t('tenants.status.active')}</span>
          )}
        </span>
      ),
    },
    {
      field: 'actions',
      headerName: t('tenants.col.actions'),
      width: 320,
      sortable: false,
      filterable: false,
      renderCell: (p) => (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', height: '100%' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setEditing(p.row)}>
            {t('actions.edit')}
          </button>
          {p.row.suspended_at ? (
            <button
              className="btn btn-secondary btn-sm"
              data-testid="resume"
              onClick={async () => {
                const okToResume = await confirm({
                  message: t('tenants.resume.confirm'),
                  confirmLabel: t('tenants.resume.label'),
                });
                if (okToResume) await act(`/api/v1/partnership/tenants/${p.row.id}/resume`, 'tenants.resume.done');
              }}
            >
              {t('tenants.resume.label')}
            </button>
          ) : (
            <button
              className="btn btn-ghost btn-sm"
              data-testid="suspend"
              onClick={async () => {
                const okToSuspend = await confirm({
                  message: t('tenants.suspend.confirm'),
                  confirmLabel: t('tenants.suspend.label'),
                  danger: true,
                });
                if (okToSuspend) await act(`/api/v1/partnership/tenants/${p.row.id}/suspend`, 'tenants.suspend.done');
              }}
            >
              {t('tenants.suspend.label')}
            </button>
          )}
          <button className="btn btn-ghost btn-sm" data-testid="manage-admins" onClick={() => setManagingAdmins(p.row)}>
            {t('admins.label')}
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('tenants.title')}
        subtitle={isAdmin ? t('tenants.subtitle_admin') : t('tenants.subtitle_partner')}
        actions={
          <button className="btn btn-primary" data-testid="new-tenant" onClick={() => setCreating(true)}>
            {t('tenants.new')}
          </button>
        }
      />
      <div className="grid-wrap card">
        <DataGrid
          rows={rows}
          columns={columns}
          loading={loading}
          disableRowSelectionOnClick
          disableVirtualization
          density="compact"
          initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
          pageSizeOptions={[25, 50, 100]}
          sx={{ border: 0 }}
        />
      </div>

      {creating && (
        <CreateTenant
          caps={caps}
          onClose={() => setCreating(false)}
          onDone={async () => {
            setCreating(false);
            await load();
          }}
        />
      )}
      {editing && (
        <EditLimits
          tenant={editing}
          caps={caps}
          onClose={() => setEditing(null)}
          onDone={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
      {managingAdmins && (
        <ManageAdmins
          tenant={managingAdmins}
          onClose={() => setManagingAdmins(null)}
          onChanged={load}
        />
      )}
    </>
  );
}

function clampDefault(def: number, cap: number | null | undefined): number {
  return cap != null ? Math.min(def, cap) : def;
}

function CreateTenant({
  caps,
  onClose,
  onDone,
}: {
  caps: PartnerCaps | undefined;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [ragione, setRagione] = useState('');
  const [email, setEmail] = useState('');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [language, setLanguage] = useState<'it' | 'en'>('it');
  const [maxUsers, setMaxUsers] = useState(clampDefault(20, caps?.cap_users_per_tenant));
  const [maxAdmins, setMaxAdmins] = useState(clampDefault(2, caps?.cap_admins_per_tenant));
  const [maxDoc, setMaxDoc] = useState(clampDefault(1, caps?.cap_documentali_per_tenant));
  const [maxBranches, setMaxBranches] = useState(clampDefault(3, caps?.cap_branches_per_tenant));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await api<{ invited: boolean }>('/api/v1/partnership/tenants', {
        method: 'POST',
        json: {
          ragione_sociale: ragione.trim(),
          admin_email: email.trim().toLowerCase(),
          admin_first_name: first.trim() || undefined,
          admin_last_name: last.trim() || undefined,
          language,
          max_users: maxUsers,
          max_admins: maxAdmins,
          max_documentali: maxDoc,
          max_branches: maxBranches,
        },
      });
      toast(t(res.invited ? 'tenants.create.created' : 'tenants.create.created_existing'));
      await onDone();
    } catch (e2) {
      setErr(errMsg(t, e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t('tenants.create.title')} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <div>
            <label className="label" htmlFor="t-ragione">{t('tenants.create.ragione_sociale')}</label>
            <input id="t-ragione" className="input" required value={ragione} onChange={(e) => setRagione(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="t-email">{t('tenants.create.admin_email')}</label>
            <input id="t-email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid-2">
            <div>
              <label className="label" htmlFor="t-first">{t('tenants.create.admin_first_name')}</label>
              <input id="t-first" className="input" value={first} onChange={(e) => setFirst(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="t-last">{t('tenants.create.admin_last_name')}</label>
              <input id="t-last" className="input" value={last} onChange={(e) => setLast(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="t-lang">{t('tenants.create.language')}</label>
            <select id="t-lang" className="input" value={language} onChange={(e) => setLanguage(e.target.value as 'it' | 'en')}>
              <option value="it">Italiano</option>
              <option value="en">English</option>
            </select>
          </div>
          <div className="grid-2">
            <NumField id="t-users" label={t('tenants.create.max_users')} value={maxUsers} max={caps?.cap_users_per_tenant} onChange={setMaxUsers} min={1} />
            <NumField id="t-admins" label={t('tenants.create.max_admins')} value={maxAdmins} max={caps?.cap_admins_per_tenant} onChange={setMaxAdmins} min={1} />
            <NumField id="t-doc" label={t('tenants.create.max_documentali')} value={maxDoc} max={caps?.cap_documentali_per_tenant} onChange={setMaxDoc} min={0} />
            <NumField id="t-branches" label={t('tenants.create.max_branches')} value={maxBranches} max={caps?.cap_branches_per_tenant} onChange={setMaxBranches} min={1} />
          </div>
          {err && <div className="form-err">{err}</div>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('actions.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="create-tenant-submit">
            {busy ? t('common.saving') : t('tenants.create.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditLimits({
  tenant,
  caps,
  onClose,
  onDone,
}: {
  tenant: TenantRow;
  caps: PartnerCaps | undefined;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [maxUsers, setMaxUsers] = useState(tenant.max_users);
  const [maxAdmins, setMaxAdmins] = useState(tenant.max_admins);
  const [maxDoc, setMaxDoc] = useState(tenant.max_documentali);
  const [maxBranches, setMaxBranches] = useState(tenant.max_branches);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/v1/partnership/tenants/${tenant.id}/limits`, {
        method: 'PATCH',
        json: { max_users: maxUsers, max_admins: maxAdmins, max_documentali: maxDoc, max_branches: maxBranches },
      });
      toast(t('tenants.edit.saved'));
      await onDone();
    } catch (e2) {
      setErr(errMsg(t, e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`${t('tenants.edit.title')} · ${tenant.ragione_sociale}`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <div className="grid-2">
            <NumField id="e-users" label={t('tenants.create.max_users')} value={maxUsers} max={caps?.cap_users_per_tenant} min={tenant.used_members} onChange={setMaxUsers} />
            <NumField id="e-admins" label={t('tenants.create.max_admins')} value={maxAdmins} max={caps?.cap_admins_per_tenant} min={Math.max(1, tenant.used_admins)} onChange={setMaxAdmins} />
            <NumField id="e-doc" label={t('tenants.create.max_documentali')} value={maxDoc} max={caps?.cap_documentali_per_tenant} min={tenant.used_documentali} onChange={setMaxDoc} />
            <NumField id="e-branches" label={t('tenants.create.max_branches')} value={maxBranches} max={caps?.cap_branches_per_tenant} min={Math.max(1, tenant.used_branches)} onChange={setMaxBranches} />
          </div>
          {err && <div className="form-err">{err}</div>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('actions.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="edit-limits-submit">
            {busy ? t('common.saving') : t('tenants.edit.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface AdminRow {
  user_id: string;
  email: string;
  created_at: string;
}

function ManageAdmins({
  tenant,
  onClose,
  onChanged,
}: {
  tenant: TenantRow;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [maxAdmins, setMaxAdmins] = useState(tenant.max_admins);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ admins: AdminRow[]; max_admins: number }>(
        `/api/v1/partnership/tenants/${tenant.id}/admins`
      );
      setAdmins(r.admins);
      setMaxAdmins(r.max_admins);
    } catch (e) {
      setErr(errMsg(t, e));
    } finally {
      setLoading(false);
    }
  }, [t, tenant.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const atLimit = admins.length >= maxAdmins;

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await api<{ invited: boolean }>(`/api/v1/partnership/tenants/${tenant.id}/admins`, {
        method: 'POST',
        json: { email: email.trim().toLowerCase() },
      });
      toast(t(res.invited ? 'admins.added' : 'admins.added_existing'));
      setEmail('');
      await load();
      await onChanged();
    } catch (e2) {
      setErr(errMsg(t, e2));
    } finally {
      setBusy(false);
    }
  }

  async function reinvite(a: AdminRow) {
    try {
      await api(`/api/v1/partnership/tenants/${tenant.id}/admins/${a.user_id}/reinvite`, { method: 'POST' });
      toast(t('admins.reinvited', { email: a.email }));
    } catch (e) {
      toast(errMsg(t, e), true);
    }
  }

  async function remove(a: AdminRow) {
    if (!(await confirm({ message: t('admins.remove_confirm', { email: a.email }), confirmLabel: t('admins.remove'), danger: true }))) {
      return;
    }
    try {
      await api(`/api/v1/partnership/tenants/${tenant.id}/admins/${a.user_id}`, { method: 'DELETE' });
      toast(t('admins.removed'));
      await load();
      await onChanged();
    } catch (e) {
      toast(errMsg(t, e), true);
    }
  }

  return (
    <Modal title={`${t('admins.title')} · ${tenant.ragione_sociale}`} onClose={onClose}>
      <div className="modal-body">
        <div className="label">{t('admins.count', { count: admins.length, max: maxAdmins })}</div>
        <div className="admin-list">
          {loading ? (
            <div className="muted">{t('common.loading')}</div>
          ) : (
            admins.map((a) => (
              <div className="admin-row" key={a.user_id}>
                <span className="admin-row-email">{a.email}</span>
                <span className="admin-row-actions">
                  <button type="button" className="btn btn-ghost btn-sm" data-testid="admin-reinvite" onClick={() => reinvite(a)}>
                    {t('admins.reinvite')}
                  </button>
                  {admins.length > 1 && (
                    <button type="button" className="btn btn-ghost btn-sm" data-testid="admin-remove" onClick={() => remove(a)}>
                      {t('admins.remove')}
                    </button>
                  )}
                </span>
              </div>
            ))
          )}
        </div>
        <form onSubmit={add} className="admin-add">
          <input
            className="input"
            type="email"
            required
            placeholder={t('admins.add_placeholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={atLimit}
            data-testid="admin-add-email"
          />
          <button type="submit" className="btn btn-primary" disabled={busy || atLimit} data-testid="admin-add-submit">
            {t('admins.add')}
          </button>
        </form>
        {atLimit && <div className="muted">{t('admins.limit_reached')}</div>}
        {err && <div className="form-err">{err}</div>}
      </div>
      <div className="modal-foot">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {t('actions.close')}
        </button>
      </div>
    </Modal>
  );
}

function NumField({
  id,
  label,
  value,
  onChange,
  min,
  max,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number | null;
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
        {max != null && <span style={{ fontWeight: 400 }}> (max {max})</span>}
      </label>
      <input
        id={id}
        className="input"
        type="number"
        value={value}
        min={min}
        {...(max != null ? { max } : {})}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
