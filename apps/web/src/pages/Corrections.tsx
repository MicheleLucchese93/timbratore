import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import { useSession } from '../store/session.ts';
import { NewCorrectionModal } from '../components/NewCorrectionModal.tsx';
import { fmtDateTime } from '../i18n/format.ts';

interface CorrectionRequest {
  id: string;
  user_id: string;
  user_email: string;
  user_display_name: string | null;
  original_stamp_id: string | null;
  original_event_type: string | null;
  original_occurred_at: string | null;
  original_branch_id: string | null;
  original_branch_name: string | null;
  claimed_event_type: string;
  claimed_occurred_at: string;
  claimed_branch_id: string | null;
  claimed_branch_name: string | null;
  justification: string;
  resolution_note: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'superseded';
  created_at: string;
}

export function Corrections() {
  const { t } = useTranslation(['corrections', 'common']);
  const { me } = useSession();
  const isAdmin = me?.user.role === 'admin';
  const myId = me?.user.id;
  const [list, setList] = useState<CorrectionRequest[]>([]);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [err, setErr] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  async function load() {
    const q = filter === 'pending' ? '?status=pending' : '';
    setList(await api<CorrectionRequest[]>(`/api/v1/correction-requests${q}`));
  }
  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, [filter]);

  // You never decide your own request. Admins decide everyone's (incl. their
  // own — the request→approve audit trail); an employee-approver decides the
  // assignees' requests the backend hands them (cr.user_id !== myId).
  const canDecide = (cr: CorrectionRequest) =>
    cr.status === 'pending' && (isAdmin || cr.user_id !== myId);

  async function approve(cr: CorrectionRequest) {
    try {
      await api(`/api/v1/correction-requests/${cr.id}/approve`, { method: 'POST', json: {} });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common:state.error'));
    }
  }
  async function reject(cr: CorrectionRequest) {
    const note = prompt(t('rejectPrompt')) ?? '';
    try {
      await api(`/api/v1/correction-requests/${cr.id}/reject`, {
        method: 'POST',
        json: { resolution_note: note },
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common:state.error'));
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="sr-only">{t('heading')}</h1>
        <button type="button" className="btn btn-primary" onClick={() => setShowNew(true)}>
          {t('newRequest')}
        </button>
        <select
          className="input max-w-xs"
          value={filter}
          onChange={(e) => setFilter(e.target.value as 'pending' | 'all')}
        >
          <option value="pending">{t('filter.pendingOnly')}</option>
          <option value="all">{t('common:state.all')}</option>
        </select>
      </header>
      {err && <div className="card text-sm text-[color:var(--color-error)]">{err}</div>}
      {list.length === 0 ? (
        <div className="card text-sm text-neutral-600">{t('empty')}</div>
      ) : (
        <ul className="space-y-3">
          {list.map((cr) => (
            <li key={cr.id} className="card space-y-3">
              <div className="flex justify-between items-start gap-3">
                <div className="space-y-1">
                  <div className="font-medium">{cr.user_display_name || cr.user_email}</div>
                  <div className="text-xs muted">
                    {t('submittedAt', { date: fmtDateTime(cr.created_at) })}
                  </div>
                </div>
                {canDecide(cr) ? (
                  <div className="flex gap-2 shrink-0">
                    <button className="btn btn-primary btn-sm" onClick={() => approve(cr)}>
                      {t('common:btn.approve')}
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => reject(cr)}>
                      {t('common:btn.reject')}
                    </button>
                  </div>
                ) : (
                  <span
                    className={`badge ${
                      cr.status === 'approved'
                        ? 'badge-ok'
                        : cr.status === 'rejected'
                        ? 'badge-err'
                        : 'badge-muted'
                    }`}
                  >
                    {statusLabel(cr.status, t)}
                  </span>
                )}
              </div>

              <DiffBlock cr={cr} />

              <div>
                <div className="text-xs muted font-semibold uppercase tracking-wide">
                  {t('justification')}
                </div>
                <div className="text-sm mt-1">{cr.justification}</div>
              </div>

              {cr.resolution_note?.trim() && (
                <div
                  className="rounded-md p-2 text-sm"
                  style={{
                    background: cr.status === 'rejected' ? '#fde4e4' : '#e8f3ec',
                  }}
                >
                  <div className="text-xs muted font-semibold uppercase tracking-wide">
                    {t('decisionNote')}
                  </div>
                  <div className="mt-1">{cr.resolution_note}</div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {showNew && (
        <NewCorrectionModal
          branches={me?.branches ?? []}
          onClose={() => setShowNew(false)}
          onDone={() => {
            setShowNew(false);
            load().catch((e) => setErr(e instanceof Error ? e.message : t('common:state.error')));
          }}
        />
      )}
    </div>
  );
}

function DiffBlock({ cr }: { cr: CorrectionRequest }) {
  const { t } = useTranslation(['corrections', 'common']);
  const isEdit = cr.original_stamp_id != null && cr.original_occurred_at != null;
  if (!isEdit) {
    return (
      <div className="rounded-md p-2 text-sm" style={{ background: 'var(--color-surface-variant)' }}>
        <div className="text-xs muted font-semibold uppercase tracking-wide">
          {t('missingStamp')}
        </div>
        <div className="mt-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Field label={t('field.event')} value={labelEvent(cr.claimed_event_type, t)} />
          <Field
            label={t('field.dateTime')}
            value={fmtDateTime(cr.claimed_occurred_at)}
          />
          <Field label={t('field.branch')} value={cr.claimed_branch_name ?? '—'} />
        </div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      <div className="rounded-md p-2 text-sm" style={{ background: '#fde4e4' }}>
        <div className="text-xs muted font-semibold uppercase tracking-wide">
          {t('currentValues')}
        </div>
        <div className="mt-1 space-y-1">
          <Field label={t('field.event')} value={labelEvent(cr.original_event_type ?? '', t)} />
          <Field
            label={t('field.dateTime')}
            value={
              cr.original_occurred_at
                ? fmtDateTime(cr.original_occurred_at)
                : '—'
            }
          />
          <Field label={t('field.branch')} value={cr.original_branch_name ?? '—'} />
        </div>
      </div>
      <div className="rounded-md p-2 text-sm" style={{ background: '#e8f3ec' }}>
        <div className="text-xs muted font-semibold uppercase tracking-wide">
          {t('requestedValues')}
        </div>
        <div className="mt-1 space-y-1">
          <Field
            label={t('field.event')}
            value={labelEvent(cr.claimed_event_type, t)}
            changed={cr.claimed_event_type !== cr.original_event_type}
          />
          <Field
            label={t('field.dateTime')}
            value={fmtDateTime(cr.claimed_occurred_at)}
            changed={
              cr.original_occurred_at == null ||
              new Date(cr.claimed_occurred_at).getTime() !==
                new Date(cr.original_occurred_at).getTime()
            }
          />
          <Field
            label={t('field.branch')}
            value={cr.claimed_branch_name ?? '—'}
            changed={cr.claimed_branch_id !== cr.original_branch_id}
          />
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  changed,
}: {
  label: string;
  value: string;
  changed?: boolean;
}) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="muted min-w-[5.5rem]">{label}:</span>
      <span style={{ fontWeight: changed ? 700 : 400 }}>{value}</span>
    </div>
  );
}

function labelEvent(e: string, t: (k: string) => string): string {
  switch (e) {
    case 'clock_in':
    case 'clock_out':
    case 'break_start':
    case 'break_end':
    case 'lunch_start':
    case 'lunch_end':
      return t(`common:stampEvent.${e}`);
    default:
      return e || '—';
  }
}

function statusLabel(s: string, t: (k: string) => string): string {
  switch (s) {
    case 'pending':
      return t('common:status.pending');
    case 'approved':
      return t('common:status.approved');
    case 'rejected':
      return t('common:status.rejected');
    case 'superseded':
      return t('status.superseded');
    default:
      return s;
  }
}
