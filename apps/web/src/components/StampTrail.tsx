// Contestation surface: the badge that says a punch was touched, the modal with
// one punch's full trail, and the day dossier that puts a whole day's evidence
// (punches, edits, deletions, anomaly notes, correction requests) on one page.
//
// All three read the append-only stamps_history through the API — nothing here
// reconstructs history from the current row, so what an admin sees is what the
// database actually recorded at the time.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, apiUrl, getTenantId, getToken } from '../lib/api.ts';
import { fmtDate, fmtDateTime } from '../i18n/format.ts';
import { useEscapeKey } from '../hooks/useEscapeKey.ts';
import { isEdited, sourceLabel, type StampProvenance } from '../lib/stamp-types.ts';

/* ---------------- API shapes ---------------- */

export type StampChangeKind =
  | 'employee_stamp'
  | 'employee_undo'
  | 'employee_correction'
  | 'admin_create'
  | 'admin_edit'
  | 'admin_delete'
  | 'anomaly_fix'
  | 'bulk_apply'
  | 'auto_clockout'
  | 'unknown';

type TrackedField = 'event_type' | 'occurred_at' | 'branch_id' | 'notes' | 'source' | 'deleted_at';

export interface StampHistoryEvent {
  id: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  recorded_at: string;
  kind: StampChangeKind;
  justification: string | null;
  correction_request_id: string | null;
  actor_name: string | null;
  changes: Array<{ field: TrackedField; before: string | null; after: string | null }>;
  snapshot: Record<string, string | null> | null;
}

interface StampHead {
  id: string;
  event_type: string;
  occurred_at: string;
  source: string;
  notes: string | null;
  original_occurred_at: string | null;
  original_event_type: string | null;
  edited_at: string | null;
  edit_count: number;
  edited_by_name: string | null;
  deleted_at: string | null;
  deletion_reason: string | null;
  deleted_by_name: string | null;
}

export interface DossierStamp extends StampHead {
  branch_name: string | null;
  device_platform: string | null;
  device_app_version: string | null;
  suspicious_mock_location: boolean;
  out_of_geofence: boolean;
  history: StampHistoryEvent[];
}

export interface DayDossier {
  date: string;
  tenant_name: string;
  user: { user_id: string; name: string; email: string | null; external_id: string | null };
  stamps: DossierStamp[];
  justifications: Array<{
    anomaly_kind: string;
    note: string;
    created_at: string;
    created_by_name: string | null;
  }>;
  corrections: Array<{
    id: string;
    claimed_event_type: string;
    claimed_occurred_at: string;
    justification: string;
    status: string;
    resolution_note: string | null;
    resolved_at: string | null;
    resolved_by_name: string | null;
  }>;
}

/* ---------------- shared bits ---------------- */

const DT: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

type TFn = (key: string, opts?: Record<string, unknown>) => string;

function fieldValue(field: TrackedField, raw: string | null, t: TFn): string {
  if (raw === null) return '—';
  switch (field) {
    case 'occurred_at':
    case 'deleted_at':
      return fmtDateTime(raw, DT);
    case 'event_type':
      return t(`common:stampEvent.${raw}`);
    case 'source':
      return sourceLabel(raw, t);
    default:
      return raw;
  }
}

/** Amber pill on any punch whose time or event an admin changed. */
export function EditedBadge({ stamp }: { stamp: StampProvenance }) {
  const { t } = useTranslation(['stamps', 'common']);
  if (!isEdited(stamp)) return null;
  const tip = [
    stamp.original_occurred_at
      ? t('trail.badgeTipTime', { time: fmtDateTime(stamp.original_occurred_at, DT) })
      : null,
    stamp.edited_by_name ? t('trail.badgeTipBy', { who: stamp.edited_by_name }) : null,
    stamp.edited_at ? fmtDateTime(stamp.edited_at, DT) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <span className="badge badge-warn" data-testid="edited-badge" title={tip}>
      {t('trail.edited')}
    </span>
  );
}

/** Red pill on a soft-deleted punch, with the reason in the tooltip. */
export function DeletedBadge({ stamp }: { stamp: StampProvenance }) {
  const { t } = useTranslation(['stamps', 'common']);
  if (!stamp.deleted_at) return null;
  const tip = [stamp.deleted_by_name, stamp.deletion_reason, fmtDateTime(stamp.deleted_at, DT)]
    .filter(Boolean)
    .join(' · ');
  return (
    <span
      className="badge"
      data-testid="deleted-badge"
      title={tip}
      style={{ background: 'var(--color-error-tint)', color: 'var(--color-error)' }}
    >
      {t('trail.deleted')}
    </span>
  );
}

function Timeline({ events }: { events: StampHistoryEvent[] }) {
  const { t } = useTranslation(['stamps', 'common']);
  if (events.length === 0) {
    return <p className="text-sm muted">{t('trail.emptyTrail')}</p>;
  }
  return (
    <ol className="space-y-2" data-testid="stamp-trail">
      {events.map((ev) => (
        <li
          key={ev.id}
          className="text-sm"
          style={{ borderLeft: '2px solid var(--color-outline-variant)', paddingLeft: 10 }}
        >
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="num text-xs muted">{fmtDateTime(ev.recorded_at, DT)}</span>
            <span style={{ fontWeight: 600 }}>{t(`trail.kind.${ev.kind}`)}</span>
            <span className="text-xs muted">{ev.actor_name ?? '—'}</span>
          </div>
          {ev.justification && (
            <div className="text-xs" style={{ color: 'var(--color-on-surface-variant)' }}>
              {t('trail.reason')}: {ev.justification}
            </div>
          )}
          {ev.changes.map((ch) => (
            <div key={ch.field} className="text-xs">
              {t(`trail.field.${ch.field}`)}:{' '}
              <span className="num" style={{ textDecoration: 'line-through', opacity: 0.7 }}>
                {fieldValue(ch.field, ch.before, t)}
              </span>{' '}
              <span aria-hidden="true">→</span>{' '}
              <span className="num" style={{ fontWeight: 600 }}>
                {fieldValue(ch.field, ch.after, t)}
              </span>
            </div>
          ))}
        </li>
      ))}
    </ol>
  );
}

/** "Timbrato dal dipendente" vs "Valore attuale" — the two lines that matter. */
function OriginalVsCurrent({ s }: { s: StampHead }) {
  const { t } = useTranslation(['stamps', 'common']);
  if (!isEdited(s)) {
    return <p className="text-xs muted">{t('trail.unchanged')}</p>;
  }
  const origEvent = s.original_event_type ?? s.event_type;
  return (
    <div className="text-sm" data-testid="original-vs-current">
      <div style={{ color: 'var(--color-warn, #b45309)' }}>
        {t('trail.originalValue')}:{' '}
        <span className="num">
          {fmtDateTime(s.original_occurred_at ?? s.occurred_at, DT)}
        </span>{' '}
        — {t(`common:stampEvent.${origEvent}`)}
      </div>
      <div>
        {t('trail.currentValue')}:{' '}
        <span className="num" style={{ fontWeight: 600 }}>
          {fmtDateTime(s.occurred_at, DT)}
        </span>{' '}
        — {t(`common:stampEvent.${s.event_type}`)}
        {s.edited_by_name && (
          <span className="text-xs muted">
            {' '}
            ({s.edited_by_name}
            {s.edited_at ? `, ${fmtDateTime(s.edited_at, DT)}` : ''})
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------------- one punch ---------------- */

export function StampHistoryModal({ stampId, onClose }: { stampId: string; onClose: () => void }) {
  const { t } = useTranslation(['stamps', 'common']);
  useEscapeKey(onClose);
  const [data, setData] = useState<{ stamp: StampHead; events: StampHistoryEvent[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<{ stamp: StampHead; events: StampHistoryEvent[] }>(`/api/v1/stamps/${stampId}/history`)
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : 'error'));
  }, [stampId]);

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50" onClick={onClose}>
      <div
        data-testid="stamp-history-modal"
        className="card w-full max-w-2xl space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="section-title">{t('trail.historyTitle')}</h2>
        {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}
        {data && (
          <>
            <OriginalVsCurrent s={data.stamp} />
            {data.stamp.deleted_at && (
              <p className="text-sm" style={{ color: 'var(--color-error)' }}>
                {t('trail.deletedBy', {
                  who: data.stamp.deleted_by_name ?? '—',
                  when: fmtDateTime(data.stamp.deleted_at, DT),
                })}
                {data.stamp.deletion_reason ? ` — ${data.stamp.deletion_reason}` : ''}
              </p>
            )}
            <div className="pt-1" style={{ borderTop: '1px solid var(--color-outline-variant)' }}>
              <h3 className="label mt-2">{t('trail.trailTitle')}</h3>
              <Timeline events={data.events} />
            </div>
          </>
        )}
        <div className="flex justify-end pt-1">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('common:btn.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- one day ---------------- */

export function DayDossierModal({
  userId,
  date,
  onClose,
}: {
  /** Omit to read your own day — the employee-facing use of the same modal. */
  userId?: string;
  date: string;
  onClose: () => void;
}) {
  const { t } = useTranslation(['stamps', 'common']);
  useEscapeKey(onClose);
  const [d, setD] = useState<DayDossier | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const query = `${userId ? `user_id=${userId}&` : ''}date=${date}`;

  useEffect(() => {
    api<DayDossier>(`/api/v1/stamps/day-dossier?${query}`)
      .then(setD)
      .catch((e) => setErr(e instanceof Error ? e.message : 'error'));
  }, [query]);

  async function downloadPdf() {
    setDownloading(true);
    setErr(null);
    try {
      // Raw fetch (blob response): must carry Authorization + X-Tenant-Id by
      // hand — the api helper only covers JSON, and without the tenant header a
      // multi-company admin would export from the wrong company.
      const headers: Record<string, string> = { Authorization: `Bearer ${getToken()}` };
      const tid = getTenantId();
      if (tid) headers['X-Tenant-Id'] = tid;
      const r = await fetch(apiUrl(`/api/v1/stamps/day-dossier.pdf?${query}`), { headers });
      if (!r.ok) throw new Error(t('trail.downloadFailed'));
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dossier-${date}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('trail.downloadFailed'));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50" onClick={onClose}>
      <div
        data-testid="day-dossier"
        className="card w-full max-w-3xl space-y-3"
        style={{ maxHeight: '88vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="section-title">{t('trail.dossierTitle')}</h2>
            {d && (
              <p className="text-sm muted">
                {d.user.name} · {fmtDate(date, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
              </p>
            )}
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={downloadPdf}
            disabled={downloading || !d}
          >
            {downloading ? t('common:state.loading') : t('trail.downloadPdf')}
          </button>
        </div>

        {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}

        {d && d.stamps.length === 0 && <p className="text-sm muted">{t('trail.noStamps')}</p>}

        {d?.stamps.map((s) => (
          <div
            key={s.id}
            className="space-y-1 pt-2"
            data-dossier-stamp={s.id}
            style={{ borderTop: '1px solid var(--color-outline-variant)' }}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className="num" style={{ fontWeight: 600 }}>
                {fmtDateTime(s.occurred_at, { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="badge badge-muted">{t(`common:stampEvent.${s.event_type}`)}</span>
              <EditedBadge stamp={s} />
              <DeletedBadge stamp={s} />
              {s.branch_name && <span className="text-xs muted">{s.branch_name}</span>}
              {s.device_platform && (
                <span className="text-xs muted">
                  {s.device_platform}
                  {s.device_app_version ? ` ${s.device_app_version}` : ''}
                </span>
              )}
            </div>
            <OriginalVsCurrent s={s} />
            {s.notes && <p className="text-xs muted">{s.notes}</p>}
            <Timeline events={s.history} />
          </div>
        ))}

        {d && d.justifications.length > 0 && (
          <div className="pt-2" style={{ borderTop: '1px solid var(--color-outline-variant)' }}>
            <h3 className="label">{t('trail.justifications')}</h3>
            {d.justifications.map((j) => (
              <p key={j.anomaly_kind} className="text-sm">
                <strong>{t(`common:anomaly.${j.anomaly_kind}`)}</strong> — {j.note}{' '}
                <span className="text-xs muted">
                  ({j.created_by_name ?? '—'}, {fmtDateTime(j.created_at, DT)})
                </span>
              </p>
            ))}
          </div>
        )}

        {d && d.corrections.length > 0 && (
          <div className="pt-2" style={{ borderTop: '1px solid var(--color-outline-variant)' }}>
            <h3 className="label">{t('trail.corrections')}</h3>
            {d.corrections.map((c) => (
              <p key={c.id} className="text-sm">
                <strong>{t(`common:stampEvent.${c.claimed_event_type}`)}</strong>{' '}
                <span className="num">{fmtDateTime(c.claimed_occurred_at, DT)}</span> —{' '}
                {c.justification}{' '}
                <span className="badge badge-muted">{t(`trail.correctionStatus.${c.status}`)}</span>
                {c.resolved_by_name && (
                  <span className="text-xs muted">
                    {' '}
                    ({c.resolved_by_name}
                    {c.resolved_at ? `, ${fmtDateTime(c.resolved_at, DT)}` : ''})
                  </span>
                )}
              </p>
            ))}
          </div>
        )}

        <div className="flex justify-end pt-1">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('common:btn.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
