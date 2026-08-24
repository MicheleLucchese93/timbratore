import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { useMediaQuery } from '@mui/material';
import {
  TICKET_ATTACHMENT_MAX_BYTES,
  TICKET_ATTACHMENT_MAX_FILES,
  TICKET_ATTACHMENT_MIME_TYPES,
  TICKET_BODY_MAX,
  TICKET_HANDLING_STATUSES,
  TICKET_NOTE_MAX,
  isTicketAttachmentMime,
  type ConsoleAssignee,
  type ConsoleTicket,
  type TicketAssignmentFilter,
  type TicketHandlingFilter,
  type TicketHandlingStatus,
  type TicketMessage,
} from '@sonoqui/shared';
import { api, apiUrl, getToken, type ApiError } from '../lib/api.ts';
import { useSession } from '../store/session.ts';
import { useToast } from '../components/Toast.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { MCard, MCardList } from '../components/MobileCards.tsx';
import { Modal } from '../components/Modal.tsx';
import { IconButton } from '../components/IconButton.tsx';
import { IconRefresh } from '../components/icons.tsx';

/**
 * Richieste: the support queue, from the side that answers it.
 *
 * WHO SEES WHAT. A platform admin manages every ticket on the platform; a partner
 * manages the tickets of the tenants they provisioned. The selection is made by
 * the API in every single query — there is no security filter on this page, and it
 * must not look as though there is one.
 *
 * THE WHOLE REQUEST IS HERE, attachments included. That is a product decision (a
 * reseller answers their own customers) and it is why every write from this page
 * lands in the Registro attività: status, assignment, note and reply are four
 * separate audited actions.
 *
 * TWO STATES, ONLY ONE OF THEM OURS. `status` is the customer's own tick — "non
 * mi serve più una risposta" — and nothing on this page can touch it. It is shown
 * because it is useful information (a request the customer considers closed is
 * worked with less urgency), not because it is ours to change.
 */

const MB = Math.round(TICKET_ATTACHMENT_MAX_BYTES / (1024 * 1024));

const HANDLING_FILTERS: TicketHandlingFilter[] = [
  'aperti',
  'in_attesa_cliente',
  'risolto',
  'tutti',
];
const ASSIGNMENT_FILTERS: TicketAssignmentFilter[] = ['tutte', 'mie', 'non_assegnate'];

function toneOf(s: TicketHandlingStatus): string {
  switch (s) {
    case 'nuovo':
      return 'badge-warn';
    case 'in_lavorazione':
      return 'badge-ok';
    case 'in_attesa_cliente':
      return 'badge-warn';
    case 'risolto':
      return 'badge-ok';
    default:
      return 'badge-muted';
  }
}

function errMsg(t: (k: string, o?: Record<string, unknown>) => string, e: unknown): string {
  const code = (e as ApiError | null)?.code;
  return t(`errors.${code ?? 'default'}`, { defaultValue: t('errors.default') });
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Raw bytes, metadata in the query string — the shape both apps upload with. */
async function uploadAttachment(ticketId: string, messageId: string, file: File): Promise<void> {
  const params = new URLSearchParams({ filename: file.name, mime: file.type });
  const r = await fetch(
    apiUrl(
      `/api/v1/partnership/tickets/${ticketId}/messages/${messageId}/attachments?${params}`
    ),
    {
      method: 'POST',
      // octet-stream, not the file's own type: express.json() is mounted
      // globally on the API, so a .json attachment sent as application/json
      // would be parsed away before the raw handler saw it. The real mime rides
      // the query string.
      headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${getToken()}` },
      body: file,
    }
  );
  if (!r.ok) throw new Error('upload failed');
}

/** Authenticated download: an <a href> carries no bearer token. */
async function downloadAttachment(
  ticketId: string,
  attachment: { id: string; filename: string }
): Promise<void> {
  const r = await fetch(
    apiUrl(`/api/v1/partnership/tickets/${ticketId}/attachments/${attachment.id}`),
    { headers: { Authorization: `Bearer ${getToken()}` } }
  );
  if (!r.ok) throw new Error('download failed');
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = attachment.filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function Tickets() {
  const { t } = useTranslation();
  const toast = useToast();
  const isMobile = useMediaQuery('(max-width: 768px)', { noSsr: true });
  const [rows, setRows] = useState<ConsoleTicket[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [handling, setHandling] = useState<TicketHandlingFilter>('aperti');
  const [assignment, setAssignment] = useState<TicketAssignmentFilter>('tutte');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ handling, assignment, limit: '200' });
      if (q.trim()) params.set('q', q.trim());
      const r = await api<{ items: ConsoleTicket[]; total: number }>(
        `/api/v1/partnership/tickets?${params}`
      );
      setRows(r.items);
      setTotal(r.total);
    } catch (e) {
      toast(errMsg(t, e), true);
    } finally {
      setLoading(false);
    }
  }, [handling, assignment, q, t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Deep link from the operator notice email: ?ticket=<uuid> opens it straight
  // away. The parameter is dropped from the address bar so a reload does not
  // reopen a ticket the operator has since closed.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('ticket');
    if (id) {
      setOpenId(id);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  const columns: GridColDef<ConsoleTicket>[] = [
    {
      field: 'created_at',
      headerName: t('tickets.col.when'),
      width: 150,
      renderCell: (p) => new Date(p.row.created_at).toLocaleString(),
    },
    { field: 'ref', headerName: t('tickets.col.ref'), width: 150 },
    { field: 'tenant_name', headerName: t('tickets.col.company'), flex: 1, minWidth: 160 },
    { field: 'subject', headerName: t('tickets.col.subject'), flex: 1.4, minWidth: 200 },
    {
      field: 'handling_status',
      headerName: t('tickets.col.state'),
      width: 170,
      renderCell: (p) => (
        <span className={`badge ${toneOf(p.row.handling_status)}`}>
          {t(`tickets.handling.${p.row.handling_status}`)}
        </span>
      ),
    },
    {
      field: 'assignee_label',
      headerName: t('tickets.col.assignee'),
      width: 170,
      renderCell: (p) => p.row.assignee_label ?? <span className="muted">—</span>,
    },
    {
      field: 'unread_count',
      headerName: t('tickets.col.unread'),
      width: 110,
      renderCell: (p) =>
        p.row.unread_count > 0 ? (
          <span className="badge badge-warn">{p.row.unread_count}</span>
        ) : (
          <span className="muted">—</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('tickets.title')}
        subtitle={t('tickets.subtitle', { count: total })}
        actions={
          <IconButton label={t('actions.refresh')} icon={<IconRefresh />} onClick={() => load()} />
        }
      />

      <div className="filter-bar" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {HANDLING_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={`btn btn-sm ${handling === f ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setHandling(f)}
            data-testid={`filter-${f}`}
          >
            {t(`tickets.filter.${f}`)}
          </button>
        ))}
        <span style={{ width: 12 }} />
        {ASSIGNMENT_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={`btn btn-sm ${assignment === f ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setAssignment(f)}
          >
            {t(`tickets.assignment.${f}`)}
          </button>
        ))}
        <input
          className="input"
          style={{ maxWidth: 240 }}
          placeholder={t('tickets.searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="ticket-search"
        />
      </div>

      {isMobile ? (
        <MCardList loading={loading} empty={!loading && rows.length === 0}>
          {rows.map((r) => (
            <MCard
              key={r.id}
              title={r.subject}
              badge={
                <span className={`badge ${toneOf(r.handling_status)}`}>
                  {t(`tickets.handling.${r.handling_status}`)}
                </span>
              }
              fields={[
                { label: t('tickets.col.ref'), value: r.ref },
                { label: t('tickets.col.company'), value: r.tenant_name ?? '—' },
                { label: t('tickets.col.when'), value: new Date(r.created_at).toLocaleString() },
                { label: t('tickets.col.assignee'), value: r.assignee_label ?? '—' },
              ]}
              actions={
                <button className="btn btn-secondary btn-sm" onClick={() => setOpenId(r.id)}>
                  {t('tickets.open')}
                </button>
              }
            />
          ))}
        </MCardList>
      ) : (
        <div className="grid-wrap card">
          <DataGrid
            rows={rows}
            columns={columns}
            loading={loading}
            disableRowSelectionOnClick
            density="compact"
            onRowClick={(p) => setOpenId(String(p.id))}
            initialState={{ pagination: { paginationModel: { pageSize: 50 } } }}
            pageSizeOptions={[50, 100]}
            sx={{ border: 0, '& .MuiDataGrid-row': { cursor: 'pointer' } }}
          />
        </div>
      )}

      {openId && (
        <TicketModal
          ticketId={openId}
          onClose={() => {
            setOpenId(null);
            void load();
          }}
        />
      )}
    </>
  );
}

/* ---------------- One ticket ---------------- */

interface Detail {
  ticket: ConsoleTicket;
  messages: (TicketMessage & { author_label: string | null })[];
}

function TicketModal({ ticketId, onClose }: { ticketId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { me } = useSession();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState('');
  const [nextStatus, setNextStatus] = useState<TicketHandlingStatus | ''>('');
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState('');
  const [assignees, setAssignees] = useState<ConsoleAssignee[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<Detail>(`/api/v1/partnership/tickets/${ticketId}`);
      setDetail(d);
      setNote(d.ticket.internal_note ?? '');
    } catch (e) {
      toast(errMsg(t, e), true);
      onClose();
    }
  }, [ticketId, t, toast, onClose]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (me?.role !== 'admin') return;
    api<ConsoleAssignee[]>('/api/v1/partnership/tickets/meta/assignees')
      .then(setAssignees)
      .catch(() => {});
  }, [me?.role]);

  async function patch(body: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    try {
      await api(`/api/v1/partnership/tickets/${ticketId}`, { method: 'PATCH', json: body });
      toast(okMsg);
      await load();
    } catch (e) {
      toast(errMsg(t, e), true);
    } finally {
      setBusy(false);
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (reply.trim().length < 2) return;
    setBusy(true);
    try {
      const sent = await api<{ message: { id: string } }>(
        `/api/v1/partnership/tickets/${ticketId}/messages`,
        {
          method: 'POST',
          json: { body: reply.trim(), ...(nextStatus ? { next_status: nextStatus } : {}) },
        }
      );
      for (const f of files) {
        try {
          await uploadAttachment(ticketId, sent.message.id, f);
        } catch {
          toast(t('tickets.files.uploadFailed', { name: f.name }), true);
        }
      }
      setReply('');
      setFiles([]);
      setNextStatus('');
      toast(t('tickets.replied'));
      await load();
    } catch (e2) {
      toast(errMsg(t, e2), true);
    } finally {
      setBusy(false);
    }
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const picked = Array.from(list);
    const bad = picked.find((f) => !isTicketAttachmentMime(f.type));
    if (bad) return toast(t('tickets.files.badType', { name: bad.name }), true);
    const big = picked.find((f) => f.size > TICKET_ATTACHMENT_MAX_BYTES);
    if (big) return toast(t('tickets.files.tooBig', { name: big.name, mb: MB }), true);
    setFiles((prev) => [...prev, ...picked].slice(0, TICKET_ATTACHMENT_MAX_FILES));
    if (fileInput.current) fileInput.current.value = '';
  }

  const ticket = detail?.ticket;
  const mine = ticket?.assigned_to === me?.user_id;

  return (
    <Modal
      title={ticket ? `${ticket.ref} · ${ticket.tenant_name ?? '—'}` : t('common.loading')}
      onClose={onClose}
      wide
    >
      {!ticket ? (
        <div className="modal-body">
          <p className="muted">{t('common.loading')}</p>
        </div>
      ) : (
        <>
          <div className="modal-body" data-testid="ticket-detail">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong>{ticket.subject}</strong>
              <span className={`badge ${toneOf(ticket.handling_status)}`}>
                {t(`tickets.handling.${ticket.handling_status}`)}
              </span>
              {ticket.status === 'resolved' && (
                <span className="badge badge-muted">{t('tickets.customerClosed')}</span>
              )}
              {ticket.unread_count > 0 && (
                <span className="badge badge-warn">
                  {t('tickets.unread', { count: ticket.unread_count })}
                </span>
              )}
            </div>

            <dl className="m-card-fields" style={{ marginTop: 8 }}>
              <div className="m-card-field">
                <dt>{t('tickets.col.when')}</dt>
                <dd>{new Date(ticket.created_at).toLocaleString()}</dd>
              </div>
              <div className="m-card-field">
                <dt>{t('tickets.openedBy')}</dt>
                <dd>{ticket.opened_by_name ?? ticket.opened_by_email ?? '—'}</dd>
              </div>
              <div className="m-card-field">
                <dt>{t('tickets.category')}</dt>
                <dd>
                  {[
                    ticket.category
                      ? t(`tickets.categoryLabel.${ticket.category}`, {
                          defaultValue: ticket.category,
                        })
                      : null,
                    ticket.priority
                      ? t(`tickets.priorityLabel.${ticket.priority}`, {
                          defaultValue: ticket.priority,
                        })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </dd>
              </div>
              <div className="m-card-field">
                <dt>{t('tickets.partner')}</dt>
                <dd>{ticket.partner_email ?? t('tickets.noPartner')}</dd>
              </div>
            </dl>

            {/* --- taking it, moving it --- */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              <button
                className="btn btn-secondary btn-sm"
                disabled={busy}
                onClick={() =>
                  patch({ assigned_to: mine ? null : 'me' }, t(mine ? 'tickets.released' : 'tickets.claimed'))
                }
                data-testid="ticket-claim"
              >
                {mine ? t('tickets.release') : t('tickets.claim')}
              </button>
              <select
                className="input"
                style={{ maxWidth: 220 }}
                value={ticket.handling_status}
                disabled={busy}
                onChange={(e) =>
                  patch({ handling_status: e.target.value }, t('tickets.statusChanged'))
                }
                data-testid="ticket-status"
              >
                {TICKET_HANDLING_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`tickets.handling.${s}`)}
                  </option>
                ))}
              </select>
              {me?.role === 'admin' && assignees.length > 0 && (
                <select
                  className="input"
                  style={{ maxWidth: 220 }}
                  value={ticket.assigned_to ?? ''}
                  disabled={busy}
                  onChange={(e) =>
                    patch(
                      { assigned_to: e.target.value === '' ? null : e.target.value },
                      t('tickets.assigned')
                    )
                  }
                >
                  <option value="">{t('tickets.unassigned')}</option>
                  {assignees.map((a) => (
                    <option key={a.user_id} value={a.user_id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* --- the thread --- */}
            <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'grid', gap: 8 }}>
              {detail!.messages.map((m) => (
                <li
                  key={m.id}
                  style={{
                    background:
                      m.author === 'operator'
                        ? 'var(--color-primary-container)'
                        : 'var(--color-surface-variant)',
                    borderRadius: 8,
                    padding: '10px 12px',
                  }}
                >
                  <div className="muted" style={{ fontSize: 12, display: 'flex', gap: 8 }}>
                    <strong>
                      {m.author === 'operator'
                        ? m.author_label ?? t('tickets.thread.operator')
                        : t('tickets.thread.customer')}
                    </strong>
                    <span>{new Date(m.created_at).toLocaleString()}</span>
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{m.body}</div>
                  {m.attachments.length > 0 && (
                    <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {m.attachments.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() =>
                            downloadAttachment(ticketId, a).catch(() =>
                              toast(t('tickets.files.downloadFailed'), true)
                            )
                          }
                        >
                          {a.filename} <span className="muted">({fmtBytes(a.size_bytes)})</span>
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>

            {/* --- triage note: ours only, never shown to the customer --- */}
            <div style={{ marginTop: 12 }}>
              <label className="label" htmlFor="tk-note">
                {t('tickets.note')}
              </label>
              <textarea
                id="tk-note"
                className="input"
                rows={2}
                maxLength={TICKET_NOTE_MAX}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('tickets.notePlaceholder')}
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ marginTop: 6 }}
                disabled={busy || note === (ticket.internal_note ?? '')}
                onClick={() => patch({ internal_note: note }, t('tickets.noteSaved'))}
              >
                {t('tickets.saveNote')}
              </button>
            </div>

            {/* --- the reply --- */}
            <form onSubmit={send} style={{ marginTop: 12 }}>
              <label className="label" htmlFor="tk-reply">
                {t('tickets.reply')}
              </label>
              <textarea
                id="tk-reply"
                className="input"
                rows={5}
                maxLength={TICKET_BODY_MAX}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={t('tickets.replyPlaceholder')}
                data-testid="ticket-reply"
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
                <select
                  className="input"
                  style={{ maxWidth: 240 }}
                  value={nextStatus}
                  onChange={(e) => setNextStatus(e.target.value as TicketHandlingStatus | '')}
                  data-testid="ticket-next-status"
                >
                  <option value="">{t('tickets.keepStatus')}</option>
                  {TICKET_HANDLING_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`tickets.thenStatus.${s}`)}
                    </option>
                  ))}
                </select>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  accept={TICKET_ATTACHMENT_MIME_TYPES.join(',')}
                  onChange={(e) => addFiles(e.target.files)}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={files.length >= TICKET_ATTACHMENT_MAX_FILES}
                  onClick={() => fileInput.current?.click()}
                >
                  {t('tickets.files.add')}
                </button>
                {files.map((f, i) => (
                  <span key={`${f.name}-${i}`} className="badge badge-muted">
                    {f.name}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setFiles(files.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="modal-foot" style={{ paddingInline: 0 }}>
                <button type="button" className="btn btn-ghost" onClick={onClose}>
                  {t('actions.close')}
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy || reply.trim().length < 2}
                  data-testid="ticket-send"
                >
                  {busy ? t('common.saving') : t('tickets.send')}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </Modal>
  );
}
