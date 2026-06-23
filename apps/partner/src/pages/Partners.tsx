import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { api, type ApiError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { Modal } from '../components/Modal.tsx';

interface PartnerRow {
  user_id: string;
  email: string;
  active: boolean;
  cap_tenants: number | null;
  cap_users_per_tenant: number | null;
  cap_admins_per_tenant: number | null;
  cap_documentali_per_tenant: number | null;
  cap_branches_per_tenant: number | null;
  created_at: string;
  tenant_count: number;
}

type Caps = Pick<
  PartnerRow,
  | 'cap_tenants'
  | 'cap_users_per_tenant'
  | 'cap_admins_per_tenant'
  | 'cap_documentali_per_tenant'
  | 'cap_branches_per_tenant'
>;

const CAP_KEYS: (keyof Caps)[] = [
  'cap_tenants',
  'cap_users_per_tenant',
  'cap_admins_per_tenant',
  'cap_documentali_per_tenant',
  'cap_branches_per_tenant',
];

function errMsg(t: (k: string, o?: Record<string, unknown>) => string, e: unknown): string {
  const code = (e as ApiError | null)?.code;
  return t(`errors.${code ?? 'default'}`, { defaultValue: t('errors.default') });
}

export function Partners() {
  const { t } = useTranslation();
  const toast = useToast();
  const [rows, setRows] = useState<PartnerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PartnerRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ partners: PartnerRow[] }>('/api/v1/partnership/partners');
      setRows(r.partners);
    } catch (e) {
      toast(errMsg(t, e), true);
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(
    async (row: PartnerRow) => {
      const path = row.active ? 'deactivate' : 'activate';
      if (row.active && !window.confirm(t('partners.deactivate.confirm'))) return;
      try {
        await api(`/api/v1/partnership/partners/${row.user_id}/${path}`, { method: 'POST' });
        toast(t(row.active ? 'partners.deactivate.done' : 'partners.activate.done'));
        await load();
      } catch (e) {
        toast(errMsg(t, e), true);
      }
    },
    [t, toast, load]
  );

  const capCell = (v: number | null) => (v == null ? t('common.unlimited') : String(v));

  const columns: GridColDef<PartnerRow>[] = [
    { field: 'email', headerName: t('partners.col.email'), flex: 1.4, minWidth: 200 },
    { field: 'tenant_count', headerName: t('partners.col.tenants'), width: 100 },
    { field: 'cap_tenants', headerName: t('partners.col.cap_tenants'), width: 120, renderCell: (p) => capCell(p.row.cap_tenants) },
    { field: 'cap_users_per_tenant', headerName: t('partners.col.cap_users'), width: 140, renderCell: (p) => capCell(p.row.cap_users_per_tenant) },
    { field: 'cap_admins_per_tenant', headerName: t('partners.col.cap_admins'), width: 140, renderCell: (p) => capCell(p.row.cap_admins_per_tenant) },
    { field: 'cap_documentali_per_tenant', headerName: t('partners.col.cap_documentali'), width: 160, renderCell: (p) => capCell(p.row.cap_documentali_per_tenant) },
    { field: 'cap_branches_per_tenant', headerName: t('partners.col.cap_branches'), width: 150, renderCell: (p) => capCell(p.row.cap_branches_per_tenant) },
    {
      field: 'active',
      headerName: t('partners.col.status'),
      width: 120,
      renderCell: (p) =>
        p.row.active ? (
          <span className="badge badge-ok">{t('partners.status.active')}</span>
        ) : (
          <span className="badge badge-warn">{t('partners.status.inactive')}</span>
        ),
    },
    {
      field: 'actions',
      headerName: t('partners.col.actions'),
      width: 220,
      sortable: false,
      filterable: false,
      renderCell: (p) => (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', height: '100%' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setEditing(p.row)}>
            {t('actions.edit')}
          </button>
          <button
            className={p.row.active ? 'btn btn-ghost btn-sm' : 'btn btn-secondary btn-sm'}
            data-testid={p.row.active ? 'deactivate' : 'activate'}
            onClick={() => toggle(p.row)}
          >
            {p.row.active ? t('partners.deactivate.label') : t('partners.activate.label')}
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('partners.title')}
        subtitle={t('partners.subtitle')}
        actions={
          <button className="btn btn-primary" data-testid="new-partner" onClick={() => setCreating(true)}>
            {t('partners.new')}
          </button>
        }
      />
      <div className="grid-wrap card">
        <DataGrid
          rows={rows}
          columns={columns}
          loading={loading}
          getRowId={(r) => r.user_id}
          disableRowSelectionOnClick
          disableVirtualization
          density="compact"
          initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
          pageSizeOptions={[25, 50, 100]}
          sx={{ border: 0 }}
        />
      </div>

      {creating && (
        <CreatePartner
          onClose={() => setCreating(false)}
          onDone={async () => {
            setCreating(false);
            await load();
          }}
        />
      )}
      {editing && (
        <EditCaps
          partner={editing}
          onClose={() => setEditing(null)}
          onDone={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </>
  );
}

function CapInputs({ caps, set }: { caps: Caps; set: (k: keyof Caps, v: number | null) => void }) {
  const { t } = useTranslation();
  return (
    <div className="grid-2">
      {CAP_KEYS.map((k) => (
        <div key={k}>
          <label className="label" htmlFor={`cap-${k}`}>{t(`caps.${k}`)}</label>
          <input
            id={`cap-${k}`}
            data-testid={`cap-${k}`}
            className="input"
            type="number"
            min={0}
            placeholder={t('common.unlimited')}
            value={caps[k] ?? ''}
            onChange={(e) => set(k, e.target.value === '' ? null : Number(e.target.value))}
          />
        </div>
      ))}
    </div>
  );
}

function CreatePartner({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [caps, setCaps] = useState<Caps>({
    cap_tenants: null,
    cap_users_per_tenant: null,
    cap_admins_per_tenant: null,
    cap_documentali_per_tenant: null,
    cap_branches_per_tenant: null,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await api<{ invited: boolean }>('/api/v1/partnership/partners', {
        method: 'POST',
        json: {
          email: email.trim().toLowerCase(),
          first_name: first.trim() || undefined,
          last_name: last.trim() || undefined,
          ...caps,
        },
      });
      toast(t(res.invited ? 'partners.create.created' : 'partners.create.created_existing'));
      await onDone();
    } catch (e2) {
      setErr(errMsg(t, e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t('partners.create.title')} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <div>
            <label className="label" htmlFor="p-email">{t('partners.create.email')}</label>
            <input id="p-email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid-2">
            <div>
              <label className="label" htmlFor="p-first">{t('partners.create.first_name')}</label>
              <input id="p-first" className="input" value={first} onChange={(e) => setFirst(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="p-last">{t('partners.create.last_name')}</label>
              <input id="p-last" className="input" value={last} onChange={(e) => setLast(e.target.value)} />
            </div>
          </div>
          <div className="label" style={{ marginTop: '0.25rem' }}>
            {t('partners.create.caps')} <span style={{ fontWeight: 400 }}>— {t('partners.create.caps_hint')}</span>
          </div>
          <CapInputs caps={caps} set={(k, v) => setCaps((c) => ({ ...c, [k]: v }))} />
          {err && <div className="form-err">{err}</div>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('actions.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="create-partner-submit">
            {busy ? t('common.saving') : t('partners.create.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditCaps({
  partner,
  onClose,
  onDone,
}: {
  partner: PartnerRow;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [caps, setCaps] = useState<Caps>({
    cap_tenants: partner.cap_tenants,
    cap_users_per_tenant: partner.cap_users_per_tenant,
    cap_admins_per_tenant: partner.cap_admins_per_tenant,
    cap_documentali_per_tenant: partner.cap_documentali_per_tenant,
    cap_branches_per_tenant: partner.cap_branches_per_tenant,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/v1/partnership/partners/${partner.user_id}/caps`, { method: 'PATCH', json: caps });
      toast(t('partners.edit.saved'));
      await onDone();
    } catch (e2) {
      setErr(errMsg(t, e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`${t('partners.edit.title')} · ${partner.email}`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <CapInputs caps={caps} set={(k, v) => setCaps((c) => ({ ...c, [k]: v }))} />
          {err && <div className="form-err">{err}</div>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('actions.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="edit-caps-submit">
            {busy ? t('common.saving') : t('partners.edit.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
