import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  BulletinAdminItem,
  BulletinRecipientOption,
  BulletinRecipient,
} from '@sonoqui/shared';
import { BULLETIN_TITLE_MAX } from '@sonoqui/shared';
import { api } from '../lib/api.ts';
import { useEscapeKey } from '../hooks/useEscapeKey.ts';
import { useConfirm } from '../components/ConfirmDialog.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { RichTextEditor } from '../components/RichTextEditor.tsx';
import { fmtDate, fmtDateTime } from '../i18n/format.ts';

type BulletinStatus = 'scheduled' | 'live' | 'expired';

function statusOf(b: { start_at: string | null; end_at: string | null }): BulletinStatus {
  const now = Date.now();
  if (b.start_at && new Date(b.start_at).getTime() > now) return 'scheduled';
  if (b.end_at && new Date(b.end_at).getTime() <= now) return 'expired';
  return 'live';
}

export function Bacheca() {
  const { t } = useTranslation(['bacheca', 'common']);
  const confirm = useConfirm();
  const [items, setItems] = useState<BulletinAdminItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<BulletinAdminItem | null>(null);
  const [composing, setComposing] = useState(false);
  const [readsFor, setReadsFor] = useState<BulletinAdminItem | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await api<BulletinAdminItem[]>('/api/v1/bulletins'));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common:state.error'));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(b: BulletinAdminItem) {
    const ok = await confirm({
      title: t('delete'),
      message: t('deleteConfirm'),
      confirmLabel: t('delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/v1/bulletins/${b.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common:state.error'));
    }
  }

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

      {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}

      {items.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">{t('emptyAdmin')}</div>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((b) => {
            const status = statusOf(b);
            return (
              <li key={b.id} className="card bacheca-admin-row">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm truncate" title={b.title}>{b.title}</span>
                    <StatusBadge status={status} />
                  </div>
                  <div className="text-xs muted mt-1 flex items-center gap-3 flex-wrap num">
                    <span>{fmtDate(b.created_at, { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                    <span>
                      {b.target_all ? t('form.allUsers') : t('form.selectedCount', { count: b.recipient_count })}
                    </span>
                    <button
                      type="button"
                      className="bacheca-reads-link"
                      onClick={() => setReadsFor(b)}
                      title={t('reads.title')}
                    >
                      {t('reads.summary', { read: b.read_count, total: b.recipient_count })}
                    </button>
                    {b.end_at && <span>{t('expiresOn', { date: fmtDate(b.end_at, { day: '2-digit', month: '2-digit', year: 'numeric' }) })}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditing(b)}>{t('edit')}</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => remove(b)} style={{ color: 'var(--color-error)' }}>{t('delete')}</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {(composing || editing) && (
        <ComposeModal
          existing={editing}
          onClose={() => {
            setComposing(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setComposing(false);
            setEditing(null);
            await load();
          }}
        />
      )}

      {readsFor && <ReadsModal bulletin={readsFor} onClose={() => setReadsFor(null)} />}
    </div>
  );
}

function StatusBadge({ status }: { status: BulletinStatus }) {
  const { t } = useTranslation(['bacheca']);
  const cls = status === 'live' ? 'badge-ok' : status === 'scheduled' ? 'badge-muted' : 'badge-warn';
  return <span className={`badge ${cls}`}>{t(`status.${status}`)}</span>;
}

/* ---------------- Compose / edit modal ---------------- */

function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function ComposeModal({
  existing,
  onClose,
  onSaved,
}: {
  existing: BulletinAdminItem | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { t } = useTranslation(['bacheca', 'common']);
  useEscapeKey(onClose);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body_html ?? '');
  const [targetAll, setTargetAll] = useState(existing ? existing.target_all : true);
  const [userIds, setUserIds] = useState<string[]>([]);
  const [startAt, setStartAt] = useState(isoToLocalInput(existing?.start_at ?? null));
  const [endAt, setEndAt] = useState(isoToLocalInput(existing?.end_at ?? null));
  const [notifyEmail, setNotifyEmail] = useState(existing ? existing.notify_email : true);
  const [notifyPush, setNotifyPush] = useState(existing ? existing.notify_push : true);
  const [options, setOptions] = useState<BulletinRecipientOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<BulletinRecipientOption[]>('/api/v1/bulletins/recipients')
      .then(setOptions)
      .catch(() => {});
  }, []);

  // Preload the current explicit recipients when editing a targeted message.
  useEffect(() => {
    if (existing && !existing.target_all) {
      api<BulletinRecipient[]>(`/api/v1/bulletins/${existing.id}/reads`)
        .then((rows) => setUserIds(rows.map((r) => r.user_id)))
        .catch(() => {});
    }
  }, [existing]);

  function toggleUser(id: string) {
    setUserIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!title.trim()) return setErr(t('form.errorTitleRequired'));
    const plain = body.replace(/<[^>]*>/g, '').trim();
    if (!plain) return setErr(t('form.errorBodyRequired'));
    if (!targetAll && userIds.length === 0) return setErr(t('form.errorRecipientsRequired'));
    const startIso = localInputToIso(startAt);
    const endIso = localInputToIso(endAt);
    if (startIso && endIso && new Date(endIso) <= new Date(startIso)) {
      return setErr(t('form.errorEndBeforeStart'));
    }
    setBusy(true);
    try {
      const payload = {
        title: title.trim(),
        body_html: body,
        target_all: targetAll,
        user_ids: targetAll ? [] : userIds,
        start_at: startIso,
        end_at: endIso,
        notify_email: notifyEmail,
        notify_push: notifyPush,
      };
      if (existing) {
        await api(`/api/v1/bulletins/${existing.id}`, { method: 'PATCH', json: payload });
      } else {
        await api('/api/v1/bulletins', { method: 'POST', json: payload });
      }
      await onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t('common:state.error'));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50 overflow-y-auto">
      <form onSubmit={submit} className="card w-full max-w-3xl space-y-4 my-4">
        <h2 className="section-title">{existing ? t('form.editTitle') : t('form.createTitle')}</h2>

        {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}

        <div>
          <label className="label">{t('form.messageTitle')}</label>
          <input
            className="input"
            value={title}
            maxLength={BULLETIN_TITLE_MAX}
            placeholder={t('form.messageTitlePlaceholder')}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>

        <div>
          <label className="label">{t('form.body')}</label>
          <RichTextEditor value={body} onChange={setBody} placeholder={t('form.bodyPlaceholder')} />
        </div>

        <div>
          <label className="label">{t('form.recipients')}</label>
          <div className="flex gap-4 text-sm mb-2">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" checked={targetAll} onChange={() => setTargetAll(true)} />
              {t('form.allUsers')}
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" checked={!targetAll} onChange={() => setTargetAll(false)} />
              {t('form.someUsers')}
            </label>
          </div>
          {!targetAll && (
            <div className="bacheca-recipient-list">
              {options.map((o) => (
                <label key={o.user_id} className="bacheca-recipient-item">
                  <input
                    type="checkbox"
                    checked={userIds.includes(o.user_id)}
                    onChange={() => toggleUser(o.user_id)}
                  />
                  <span className="truncate">{o.display_name || o.email}</span>
                </label>
              ))}
              <div className="text-xs muted mt-1">{t('form.selectedCount', { count: userIds.length })}</div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">{t('form.startAt')}</label>
            <input type="datetime-local" className="input" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
            <div className="text-xs muted mt-1">{t('form.startAtHint')}</div>
          </div>
          <div>
            <label className="label">{t('form.endAt')}</label>
            <input type="datetime-local" className="input" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
            <div className="text-xs muted mt-1">{t('form.endAtHint')}</div>
          </div>
        </div>

        <div>
          <label className="label">{t('form.notifications')}</label>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={notifyEmail} onChange={(e) => setNotifyEmail(e.target.checked)} />
              {t('form.notifyEmail')}
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={notifyPush} onChange={(e) => setNotifyPush(e.target.checked)} />
              {t('form.notifyPush')}
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {t('common:btn.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t('common:state.saving') : existing ? t('form.saveEdit') : t('form.save')}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------------- Reads (who read) modal ---------------- */

function ReadsModal({ bulletin, onClose }: { bulletin: BulletinAdminItem; onClose: () => void }) {
  const { t } = useTranslation(['bacheca', 'common']);
  useEscapeKey(onClose);
  const [rows, setRows] = useState<BulletinRecipient[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api<BulletinRecipient[]>(`/api/v1/bulletins/${bulletin.id}/reads`)
      .then(setRows)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [bulletin.id]);

  const readCount = useMemo(() => rows.filter((r) => r.read_at).length, [rows]);

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
      <div className="card w-full max-w-md space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="section-title">{t('reads.title')}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>{t('common:btn.close')}</button>
        </div>
        <div className="text-sm muted">{t('reads.summary', { read: readCount, total: rows.length })}</div>
        {loaded && rows.length === 0 ? (
          <div className="text-sm muted">{t('reads.empty')}</div>
        ) : (
          <ul className="space-y-1 max-h-80 overflow-y-auto">
            {rows.map((r) => (
              <li key={r.user_id} className="flex items-center justify-between gap-2 text-sm py-1">
                <span className="truncate">{r.display_name || r.email}</span>
                {r.read_at ? (
                  <span className="text-xs num" style={{ color: 'var(--color-success, #16a34a)' }}>
                    {fmtDateTime(r.read_at)}
                  </span>
                ) : (
                  <span className="badge badge-muted">{t('reads.notRead')}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
