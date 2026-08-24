import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  TICKET_ATTACHMENT_MAX_BYTES,
  TICKET_ATTACHMENT_MAX_FILES,
  TICKET_ATTACHMENT_MIME_TYPES,
  TICKET_BODY_MAX,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_SUBJECT_MAX,
  isTicketAttachmentMime,
  replyReopens,
  type TicketDetail,
  type TicketFeedItem,
  type TicketHandlingStatus,
} from '@sonoqui/shared';
import { api, apiUrl, getTenantId, getToken } from '../lib/api.ts';
import { useEscapeKey } from '../hooks/useEscapeKey.ts';
import { PageHeader } from '../components/PageHeader.tsx';
import { fmtDateTime } from '../i18n/format.ts';

/**
 * Assistenza: the company's support requests to us, and our answers.
 *
 * ADMIN-ONLY SURFACE (the route is registered only for role=admin, and the API
 * refuses everyone else twice — `requireAdmin` and an RLS policy). A ticket is
 * the company's request about sonoQui, not an employee's question about their own
 * timesheet: those are Rettifiche and Richieste, and the person who answers a
 * ticket is a reseller with no relationship to an individual employee.
 *
 * TWO STATES ARE SHOWN, and they are not the same thing. `handling_status` is
 * what WE are doing about it, read-only here; `status` is the company's own
 * "non mi serve più una risposta", which this page can set and unset and which
 * notifies nobody. A list showing only one of them would be lying by omission in
 * both directions.
 *
 * WHO ANSWERED IS NOT SHOWN. The API deliberately does not send the operator's
 * name: the reply comes from «l'assistenza», because naming an individual invites
 * the next request to be addressed to that person.
 */

type StatusFilter = 'aperte' | 'tutte';

const MB = Math.round(TICKET_ATTACHMENT_MAX_BYTES / (1024 * 1024));

function toneOf(s: TicketHandlingStatus): string {
  switch (s) {
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

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Upload one file onto a message.
 *
 * Raw bytes in the body, metadata in the query string — the same shape the
 * documents upload uses, and for the same reason: custom X-* headers are not in
 * the gateway's CORS allow-list, so a preflight with them fails. `api()` is
 * bypassed because the body is not JSON.
 */
async function uploadAttachment(
  ticketId: string,
  messageId: string,
  file: File
): Promise<void> {
  const params = new URLSearchParams({ filename: file.name, mime: file.type });
  const headers: Record<string, string> = {
    // ALWAYS octet-stream, never the file's own type. The API mounts
    // express.json() globally, so a .json export sent as application/json is
    // parsed into an object (and capped at 1mb) before the raw handler ever sees
    // the bytes. The real mime travels in the query string, which is also what
    // the server validates and stores.
    'Content-Type': 'application/octet-stream',
    Authorization: `Bearer ${getToken()}`,
  };
  const tid = getTenantId();
  // Without the tenant header a multi-company admin uploads into whichever
  // company the server picks — the same trap the document export hit.
  if (tid) headers['X-Tenant-Id'] = tid;
  const r = await fetch(
    apiUrl(`/api/v1/tickets/${ticketId}/messages/${messageId}/attachments?${params}`),
    { method: 'POST', headers, body: file }
  );
  if (!r.ok) {
    let msg = 'upload failed';
    try {
      const parsed = (await r.json()) as { error?: { message?: string } };
      if (parsed?.error?.message) msg = parsed.error.message;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
}

/**
 * Download an attachment.
 *
 * Not an <a href>: the bytes come from an authenticated API route (an anchor
 * carries no bearer token and no tenant header), so the blob is fetched and
 * handed to a synthetic link.
 */
async function downloadAttachment(
  ticketId: string,
  attachment: { id: string; filename: string }
): Promise<void> {
  const headers: Record<string, string> = { Authorization: `Bearer ${getToken()}` };
  const tid = getTenantId();
  if (tid) headers['X-Tenant-Id'] = tid;
  const r = await fetch(
    apiUrl(`/api/v1/tickets/${ticketId}/attachments/${attachment.id}`),
    { headers }
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
  const { t } = useTranslation(['tickets', 'common']);
  const [items, setItems] = useState<TicketFeedItem[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('aperte');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await api<TicketFeedItem[]>('/api/v1/tickets'));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common:state.error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown =
    filter === 'aperte'
      ? items.filter((i) => i.status === 'open' && i.handling_status !== 'chiuso')
      : items;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <button className="btn btn-primary" onClick={() => setComposing(true)}>
            {t('new')}
          </button>
        }
      />

      {err && (
        <div className="text-sm" style={{ color: 'var(--color-error)' }}>
          {err}
        </div>
      )}

      <div className="flex gap-2">
        {(['aperte', 'tutte'] as StatusFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilter(f)}
          >
            {t(`filter.${f}`)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="muted text-sm">{t('common:state.loading')}</div>
      ) : shown.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">{t(filter === 'aperte' ? 'emptyOpen' : 'empty')}</div>
          <p className="muted text-sm">{t('emptyHint')}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {shown.map((it) => (
            <li key={it.id} className="card">
              <button
                type="button"
                className="w-full text-left"
                onClick={() => setOpenId(it.id)}
                data-testid="ticket-row"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="num text-xs muted">{it.ref}</span>
                  <span className="font-semibold text-sm truncate" title={it.subject}>
                    {it.subject}
                  </span>
                  <span className={`badge ${toneOf(it.handling_status)}`}>
                    {t(`handling.${it.handling_status}`)}
                  </span>
                  {it.status === 'resolved' && (
                    <span className="badge badge-muted">{t('mine.resolved')}</span>
                  )}
                  {it.unread_count > 0 && (
                    <span className="badge badge-ok">
                      {t('unread', { count: it.unread_count })}
                    </span>
                  )}
                </div>
                <div className="text-xs muted mt-1 flex items-center gap-3 flex-wrap num">
                  <span>{fmtDateTime(it.created_at)}</span>
                  {it.category && <span>{t(`category.${it.category}`, { defaultValue: it.category })}</span>}
                  {it.opened_by_name && <span>{it.opened_by_name}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {composing && (
        <NewTicketModal
          onClose={() => setComposing(false)}
          onCreated={async (id) => {
            setComposing(false);
            await load();
            setOpenId(id);
          }}
        />
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
    </div>
  );
}

/* ---------------- New request ---------------- */

function FilePicker({
  files,
  onChange,
  disabled,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation(['tickets']);
  const inputRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);

  function add(list: FileList | null) {
    if (!list) return;
    const picked = Array.from(list);
    const rejected = picked.find((f) => !isTicketAttachmentMime(f.type));
    if (rejected) return setErr(t('files.badType', { name: rejected.name }));
    const tooBig = picked.find((f) => f.size > TICKET_ATTACHMENT_MAX_BYTES);
    if (tooBig) return setErr(t('files.tooBig', { name: tooBig.name, mb: MB }));
    const next = [...files, ...picked].slice(0, TICKET_ATTACHMENT_MAX_FILES);
    setErr(next.length < files.length + picked.length ? t('files.max', { n: TICKET_ATTACHMENT_MAX_FILES }) : null);
    onChange(next);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="space-y-1">
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        accept={TICKET_ATTACHMENT_MIME_TYPES.join(',')}
        onChange={(e) => add(e.target.files)}
      />
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={disabled || files.length >= TICKET_ATTACHMENT_MAX_FILES}
          onClick={() => inputRef.current?.click()}
        >
          {t('files.add')}
        </button>
        <span className="text-xs muted">{t('files.hint', { n: TICKET_ATTACHMENT_MAX_FILES, mb: MB })}</span>
      </div>
      {files.length > 0 && (
        <ul className="text-xs space-y-1">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2">
              <span className="truncate">{f.name}</span>
              <span className="muted num">{fmtBytes(f.size)}</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
              >
                {t('files.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {err && <div className="text-xs" style={{ color: 'var(--color-error)' }}>{err}</div>}
    </div>
  );
}

function NewTicketModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (ticketId: string) => Promise<void> | void;
}) {
  const { t } = useTranslation(['tickets', 'common']);
  useEscapeKey(onClose);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<string>('problema');
  const [priority, setPriority] = useState<string>('media');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (subject.trim().length < 3) return setErr(t('form.subjectRequired'));
    if (body.trim().length < 10) return setErr(t('form.bodyRequired'));
    setBusy(true);
    try {
      const created = await api<TicketFeedItem>('/api/v1/tickets', {
        method: 'POST',
        json: { subject: subject.trim(), body: body.trim(), category, priority },
      });
      // Files ride a second call each, onto message #1 — which IS the request.
      // A failed upload must not lose the request itself, so it is reported and
      // the ticket still opens.
      const messageId = created.first_message_id;
      if (messageId) {
        for (const f of files) {
          try {
            await uploadAttachment(created.id, messageId, f);
          } catch (e) {
            setErr(t('files.uploadFailed', { name: f.name }));
          }
        }
      }
      await onCreated(created.id);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t('common:state.error'));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50 overflow-y-auto">
      <form onSubmit={submit} className="card w-full max-w-2xl space-y-4 my-4">
        <h2 className="section-title">{t('form.title')}</h2>
        <p className="muted text-sm">{t('form.intro')}</p>

        <label className="block space-y-1">
          <span className="label">{t('form.subject')}</span>
          <input
            className="input w-full"
            value={subject}
            maxLength={TICKET_SUBJECT_MAX}
            onChange={(e) => setSubject(e.target.value)}
            data-testid="ticket-subject"
            autoFocus
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="label">{t('form.category')}</span>
            <select className="input w-full" value={category} onChange={(e) => setCategory(e.target.value)}>
              {TICKET_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`category.${c}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="label">{t('form.priority')}</span>
            <select className="input w-full" value={priority} onChange={(e) => setPriority(e.target.value)}>
              {TICKET_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`priority.${p}`)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block space-y-1">
          <span className="label">{t('form.body')}</span>
          <textarea
            className="input w-full"
            rows={8}
            value={body}
            maxLength={TICKET_BODY_MAX}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('form.bodyPlaceholder')}
            data-testid="ticket-body"
          />
        </label>

        <FilePicker files={files} onChange={setFiles} disabled={busy} />

        {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {t('common:btn.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="ticket-send">
            {busy ? t('common:state.saving') : t('form.send')}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------------- One request, with its thread ---------------- */

function TicketModal({ ticketId, onClose }: { ticketId: string; onClose: () => void }) {
  const { t } = useTranslation(['tickets', 'common']);
  useEscapeKey(onClose);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [reply, setReply] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await api<TicketDetail>(`/api/v1/tickets/${ticketId}`));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common:state.error'));
    }
  }, [ticketId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (reply.trim().length < 2) return;
    setBusy(true);
    setErr(null);
    try {
      const sent = await api<{ message: { id: string } }>(
        `/api/v1/tickets/${ticketId}/messages`,
        { method: 'POST', json: { body: reply.trim() } }
      );
      for (const f of files) {
        try {
          await uploadAttachment(ticketId, sent.message.id, f);
        } catch {
          setErr(t('files.uploadFailed', { name: f.name }));
        }
      }
      setReply('');
      setFiles([]);
      await load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t('common:state.error'));
    } finally {
      setBusy(false);
    }
  }

  /**
   * The customer's own flag: «Risolto» when the answer settled it, «Riapri» to
   * take that back.
   *
   * Marking it resolved also CLOSES the dialog. The click means "I am done with
   * this", and leaving the reader parked on a request they just finished with —
   * on a list filtered to «Aperte», where the row has already gone — is the
   * moment they wonder whether the button did anything. Reopening keeps the
   * dialog open, because that click means the opposite: they are back to needing
   * an answer and want to type one more line.
   */
  async function toggleResolved() {
    if (!detail) return;
    const resolving = detail.ticket.status !== 'resolved';
    setBusy(true);
    try {
      await api(`/api/v1/tickets/${ticketId}`, {
        method: 'PATCH',
        json: { status: resolving ? 'resolved' : 'open' },
      });
      if (resolving) {
        onClose();
        return;
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common:state.error'));
    } finally {
      setBusy(false);
    }
  }

  const ticket = detail?.ticket;

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50 overflow-y-auto">
      <div className="card w-full max-w-3xl space-y-4 my-4" data-testid="ticket-detail">
        {!ticket ? (
          <div className="muted text-sm">{err ?? t('common:state.loading')}</div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="num text-xs muted">{ticket.ref}</span>
                  <span className={`badge ${toneOf(ticket.handling_status)}`}>
                    {t(`handling.${ticket.handling_status}`)}
                  </span>
                  {ticket.status === 'resolved' && (
                    <span className="badge badge-muted">{t('mine.resolved')}</span>
                  )}
                </div>
                <h2 className="section-title mt-1">{ticket.subject}</h2>
                <div className="text-xs muted num">{fmtDateTime(ticket.created_at)}</div>
              </div>
              <div className="flex items-center gap-2">
                {/* «Risolto» is the primary action: on a request the support team
                    has already answered, saying so is what the reader came here
                    to do. The dismiss control next to it is an ✕ and not a
                    «Chiudi» button on purpose — two text buttons side by side,
                    one closing the REQUEST and one closing the WINDOW, is a trap
                    that reads the same either way. */}
                <button
                  className={`btn btn-sm ${ticket.status === 'resolved' ? 'btn-secondary' : 'btn-primary'}`}
                  onClick={toggleResolved}
                  disabled={busy}
                  title={t(ticket.status === 'resolved' ? 'mine.reopenHint' : 'mine.resolveHint')}
                  data-testid="ticket-resolve"
                >
                  {ticket.status === 'resolved' ? t('mine.reopen') : t('mine.resolve')}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={onClose}
                  title={t('common:btn.close')}
                  aria-label={t('common:btn.close')}
                  data-testid="ticket-dismiss"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* The team's state explained in one line, because a status word on
                its own reads as a decision taken about you rather than something
                you can act on. */}
            <p className="muted text-sm">{t(`handlingHint.${ticket.handling_status}`)}</p>

            <ul className="space-y-3">
              {detail!.messages.map((m) => (
                <li
                  key={m.id}
                  className="rounded-lg p-3"
                  style={{
                    background:
                      m.author === 'operator'
                        ? 'var(--color-primary-container)'
                        : 'var(--color-surface-variant)',
                  }}
                >
                  <div className="text-xs muted flex items-center gap-2">
                    <strong>{t(m.author === 'operator' ? 'thread.support' : 'thread.you')}</strong>
                    <span className="num">{fmtDateTime(m.created_at)}</span>
                  </div>
                  <div className="text-sm mt-1" style={{ whiteSpace: 'pre-wrap' }}>
                    {m.body}
                  </div>
                  {m.attachments.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {m.attachments.map((a) => (
                        <li key={a.id} className="text-xs flex items-center gap-2">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() =>
                              downloadAttachment(ticketId, a).catch(() =>
                                setErr(t('files.downloadFailed'))
                              )
                            }
                          >
                            {a.filename}
                          </button>
                          <span className="muted num">{fmtBytes(a.size_bytes)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>

            <form onSubmit={send} className="space-y-2">
              {replyReopens(ticket.handling_status) && (
                <div className="text-xs" style={{ color: 'var(--color-warning)' }}>
                  {t('thread.reopenWarning')}
                </div>
              )}
              <textarea
                className="input w-full"
                rows={4}
                value={reply}
                maxLength={TICKET_BODY_MAX}
                onChange={(e) => setReply(e.target.value)}
                placeholder={t('thread.replyPlaceholder')}
                data-testid="ticket-reply"
              />
              <FilePicker files={files} onChange={setFiles} disabled={busy} />
              {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}
              <div className="flex justify-end">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy || reply.trim().length < 2}
                  data-testid="ticket-reply-send"
                >
                  {busy ? t('common:state.saving') : t('thread.send')}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
