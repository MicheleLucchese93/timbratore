import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { useMediaQuery } from '@mui/material';
import { api, type ApiError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { useConfirm } from '../components/ConfirmProvider.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { MCard, MCardList } from '../components/MobileCards.tsx';
import { Modal } from '../components/Modal.tsx';
import { IconButton } from '../components/IconButton.tsx';
import { IconEdit, IconMail, IconCheck, IconBan, IconPlus } from '../components/icons.tsx';
import { MODULES, moduleFlag } from '../lib/modules.ts';

interface PartnerRow {
  user_id: string;
  email: string;
  partner_name: string | null;
  note: string | null;
  active: boolean;
  cap_tenants: number | null;
  cap_users_per_tenant: number | null;
  cap_admins_per_tenant: number | null;
  cap_documentali_per_tenant: number | null;
  cap_branches_per_tenant: number | null;
  may_enable_cantieri: boolean;
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
  | 'may_enable_cantieri'
>;

// Numeric ceilings only — the may_enable_cantieri boolean gets its own checkbox.
const CAP_KEYS: Exclude<keyof Caps, 'may_enable_cantieri'>[] = [
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

// Comma-joined names of the modules a partner may enable (mobile card).
function capModuleNames(t: (k: string) => string, row: PartnerRow): string {
  const names = MODULES.filter((m) => moduleFlag(row, m.capField)).map((m) => t(`modules.${m.key}.name`));
  return names.length ? names.join(', ') : '—';
}

// Grid cell: a chip per module the partner may enable, muted dash when none.
function ModuleCapChips({ row }: { row: PartnerRow }) {
  const { t } = useTranslation();
  const allowed = MODULES.filter((m) => moduleFlag(row, m.capField));
  if (allowed.length === 0) return <span className="muted">—</span>;
  return (
    <span className="cell-badge" style={{ gap: 4, flexWrap: 'wrap' }}>
      {allowed.map((m) => (
        <span key={m.key} className="badge badge-ok">
          {t(`modules.${m.key}.name`)}
        </span>
      ))}
    </span>
  );
}

export function Partners() {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const isMobile = useMediaQuery('(max-width: 768px)', { noSsr: true });
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
      const ok = await confirm({
        message: t(row.active ? 'partners.deactivate.confirm' : 'partners.activate.confirm'),
        confirmLabel: t(row.active ? 'partners.deactivate.label' : 'partners.activate.label'),
        danger: row.active,
      });
      if (!ok) return;
      try {
        await api(`/api/v1/partnership/partners/${row.user_id}/${path}`, { method: 'POST' });
        toast(t(row.active ? 'partners.deactivate.done' : 'partners.activate.done'));
        await load();
      } catch (e) {
        toast(errMsg(t, e), true);
      }
    },
    [t, toast, load, confirm]
  );

  const resend = useCallback(
    async (row: PartnerRow) => {
      const ok = await confirm({
        message: t('partners.resend.confirm', { email: row.email }),
        confirmLabel: t('partners.resend.label'),
      });
      if (!ok) return;
      try {
        const res = await api<{ email_type: 'invite' | 'recovery' | 'none' }>(
          `/api/v1/partnership/partners/${row.user_id}/resend`,
          { method: 'POST' }
        );
        toast(t(`partners.resend.done_${res.email_type}`, { email: row.email }));
      } catch (e) {
        toast(errMsg(t, e), true);
      }
    },
    [t, toast, confirm]
  );

  const capCell = (v: number | null) => (v == null ? t('common.unlimited') : String(v));

  // Shared by the DataGrid actions column (desktop) and the mobile card list.
  const renderActions = (row: PartnerRow) => (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', height: '100%' }}>
      <IconButton label={t('actions.edit')} icon={<IconEdit />} onClick={() => setEditing(row)} />
      <IconButton label={t('partners.resend.label')} testId="resend" icon={<IconMail />} onClick={() => resend(row)} />
      {row.active ? (
        <IconButton label={t('partners.deactivate.label')} testId="deactivate" danger icon={<IconBan />} onClick={() => toggle(row)} />
      ) : (
        <IconButton label={t('partners.activate.label')} testId="activate" icon={<IconCheck />} onClick={() => toggle(row)} />
      )}
    </div>
  );

  const columns: GridColDef<PartnerRow>[] = [
    {
      field: 'partner_name',
      headerName: t('partners.col.partner_name'),
      flex: 1,
      minWidth: 150,
      renderCell: (p) =>
        p.row.partner_name ? p.row.partner_name : <span className="muted">{t('common.none')}</span>,
    },
    { field: 'email', headerName: t('partners.col.email'), flex: 1.4, minWidth: 200 },
    { field: 'tenant_count', headerName: t('partners.col.tenants'), width: 100 },
    { field: 'cap_tenants', headerName: t('partners.col.cap_tenants'), width: 120, renderCell: (p) => capCell(p.row.cap_tenants) },
    { field: 'cap_users_per_tenant', headerName: t('partners.col.cap_users'), width: 140, renderCell: (p) => capCell(p.row.cap_users_per_tenant) },
    { field: 'cap_admins_per_tenant', headerName: t('partners.col.cap_admins'), width: 140, renderCell: (p) => capCell(p.row.cap_admins_per_tenant) },
    { field: 'cap_documentali_per_tenant', headerName: t('partners.col.cap_documentali'), width: 160, renderCell: (p) => capCell(p.row.cap_documentali_per_tenant) },
    { field: 'cap_branches_per_tenant', headerName: t('partners.col.cap_branches'), width: 150, renderCell: (p) => capCell(p.row.cap_branches_per_tenant) },
    {
      field: 'modules',
      headerName: t('modules.col'),
      width: 150,
      sortable: false,
      filterable: false,
      renderCell: (p) => <ModuleCapChips row={p.row} />,
    },
    {
      field: 'active',
      headerName: t('partners.col.status'),
      width: 120,
      renderCell: (p) => (
        <span className="cell-badge">
          {p.row.active ? (
            <span className="badge badge-ok">{t('partners.status.active')}</span>
          ) : (
            <span className="badge badge-warn">{t('partners.status.inactive')}</span>
          )}
        </span>
      ),
    },
    {
      field: 'note',
      headerName: t('partners.col.note'),
      flex: 1.2,
      minWidth: 160,
      sortable: false,
      renderCell: (p) =>
        p.row.note ? (
          <span title={p.row.note} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.row.note}
          </span>
        ) : (
          <span className="muted">—</span>
        ),
    },
    {
      field: 'actions',
      headerName: t('partners.col.actions'),
      width: 150,
      sortable: false,
      filterable: false,
      renderCell: (p) => renderActions(p.row),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('partners.title')}
        subtitle={t('partners.subtitle')}
        actions={
          <IconButton label={t('partners.new')} testId="new-partner" primary icon={<IconPlus />} onClick={() => setCreating(true)} />
        }
      />
      {isMobile ? (
        <MCardList loading={loading} empty={!loading && rows.length === 0}>
          {rows.map((r) => (
            <MCard
              key={r.user_id}
              title={r.partner_name || r.email}
              badge={
                r.active ? (
                  <span className="badge badge-ok">{t('partners.status.active')}</span>
                ) : (
                  <span className="badge badge-warn">{t('partners.status.inactive')}</span>
                )
              }
              fields={[
                ...(r.partner_name ? [{ label: t('partners.col.email'), value: r.email }] : []),
                { label: t('partners.col.tenants'), value: String(r.tenant_count) },
                { label: t('partners.col.cap_tenants'), value: capCell(r.cap_tenants) },
                { label: t('partners.col.cap_users'), value: capCell(r.cap_users_per_tenant) },
                { label: t('partners.col.cap_admins'), value: capCell(r.cap_admins_per_tenant) },
                { label: t('partners.col.cap_documentali'), value: capCell(r.cap_documentali_per_tenant) },
                { label: t('partners.col.cap_branches'), value: capCell(r.cap_branches_per_tenant) },
                { label: t('modules.col'), value: capModuleNames(t, r) },
                ...(r.note ? [{ label: t('partners.col.note'), value: r.note }] : []),
              ]}
              actions={renderActions(r)}
            />
          ))}
        </MCardList>
      ) : (
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
      )}

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

function CapInputs({
  caps,
  set,
}: {
  caps: Caps;
  set: <K extends keyof Caps>(k: K, v: Caps[K]) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
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
      <div className="label" style={{ marginTop: '0.25rem' }}>
        {t('caps.modules')} <span style={{ fontWeight: 400 }}>— {t('caps.modules_hint')}</span>
      </div>
      {MODULES.map((m) => {
        const capKey = m.capField as keyof Caps;
        return (
          <label key={m.key} className="checkbox-row" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="checkbox"
              data-testid={`cap-module-${m.key}`}
              checked={caps[capKey] === true}
              onChange={(e) => set(capKey, e.target.checked)}
            />
            <span>{t(`modules.${m.key}.name`)}</span>
          </label>
        );
      })}
    </>
  );
}

function CreatePartner({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [note, setNote] = useState('');
  const [sendInvite, setSendInvite] = useState(true);
  const [caps, setCaps] = useState<Caps>({
    cap_tenants: null,
    cap_users_per_tenant: null,
    cap_admins_per_tenant: null,
    cap_documentali_per_tenant: null,
    cap_branches_per_tenant: null,
    may_enable_cantieri: false,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await api<{ email_type: 'invite' | 'recovery' | 'none' }>(
        '/api/v1/partnership/partners',
        {
          method: 'POST',
          json: {
            email: email.trim().toLowerCase(),
            partner_name: name.trim() || undefined,
            first_name: first.trim() || undefined,
            last_name: last.trim() || undefined,
            note: note.trim() || undefined,
            send_invite: sendInvite,
            ...caps,
          },
        }
      );
      toast(t(`partners.create.done_${res.email_type}`));
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
          <div>
            <label className="label" htmlFor="p-name">{t('partners.create.partner_name')}</label>
            <input id="p-name" className="input" data-testid="partner-name" value={name} onChange={(e) => setName(e.target.value)} />
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
          <div>
            <label className="label" htmlFor="p-note">{t('partners.create.note')}</label>
            <textarea id="p-note" className="input" rows={2} data-testid="partner-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <label className="checkbox-row" style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              data-testid="partner-send-invite"
              checked={sendInvite}
              onChange={(e) => setSendInvite(e.target.checked)}
            />
            <span>
              {t('partners.create.send_invite')}
              <span className="muted" style={{ display: 'block', fontWeight: 400 }}>
                {t('partners.create.send_invite_hint')}
              </span>
            </span>
          </label>
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
  const [name, setName] = useState(partner.partner_name ?? '');
  const [note, setNote] = useState(partner.note ?? '');
  const [caps, setCaps] = useState<Caps>({
    cap_tenants: partner.cap_tenants,
    cap_users_per_tenant: partner.cap_users_per_tenant,
    cap_admins_per_tenant: partner.cap_admins_per_tenant,
    cap_documentali_per_tenant: partner.cap_documentali_per_tenant,
    cap_branches_per_tenant: partner.cap_branches_per_tenant,
    may_enable_cantieri: partner.may_enable_cantieri,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/v1/partnership/partners/${partner.user_id}/caps`, { method: 'PATCH', json: caps });
      const nextName = name.trim() || null;
      const nextNote = note.trim() || null;
      if (nextName !== (partner.partner_name ?? null) || nextNote !== (partner.note ?? null)) {
        await api(`/api/v1/partnership/partners/${partner.user_id}`, {
          method: 'PATCH',
          json: { partner_name: nextName, note: nextNote },
        });
      }
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
          <div>
            <label className="label" htmlFor="e-name">{t('partners.create.partner_name')}</label>
            <input id="e-name" className="input" data-testid="edit-partner-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="e-note">{t('partners.create.note')}</label>
            <textarea id="e-note" className="input" rows={2} data-testid="edit-partner-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
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
