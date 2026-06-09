import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import {
  ASSENZA_SUBTYPE_LABEL,
  estimateLeaveHours,
  formatDuration,
  type ActiveAssignment,
} from '@sonoqui/shared';

type LeaveType = 'ferie' | 'permessi' | 'malattia' | 'assenza';

const ASSENZA_SUBTYPES = Object.keys(ASSENZA_SUBTYPE_LABEL);

/**
 * Self-service leave-request form, at parity with the mobile "Nuova richiesta"
 * flow. Shared between the employee page (MyLeaves) and the admin page (Leaves)
 * so an admin can also submit a request for themselves — the backend accepts a
 * POST /api/v1/leaves from any authenticated user.
 */
export function NewLeaveModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation(['newLeaveModal', 'common']);
  const [type, setType] = useState<LeaveType>('ferie');
  const [allDay, setAllDay] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [inps, setInps] = useState('');
  const [subtype, setSubtype] = useState(ASSENZA_SUBTYPES[0]!);
  const [isPaid, setIsPaid] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [assignment, setAssignment] = useState<ActiveAssignment | null>(null);

  // Specific start/end times only for a ferie/permesso with "all day" unticked.
  // malattia / assenza always cover the full day(s).
  const timeMode = (type === 'ferie' || type === 'permessi') && !allDay;

  // Active shift assignment drives the hours preview (mirrors StampPanel).
  useEffect(() => {
    api<ActiveAssignment | null>('/api/v1/shifts/assignments/me')
      .then(setAssignment)
      .catch(() => setAssignment(null));
  }, []);

  // Hours the request will claim — mirrors the backend's duration_hours. null
  // while the period is incomplete/invalid; 0 = covers no working hours.
  const estimatedHours = useMemo<number | null>(() => {
    if (!from || !to) return null;
    const tm = (type === 'ferie' || type === 'permessi') && !allDay;
    const fromTs = tm ? new Date(from).toISOString() : new Date(`${from}T00:00:00`).toISOString();
    const toTs = tm ? new Date(to).toISOString() : new Date(`${to}T23:59:00`).toISOString();
    if (new Date(toTs).getTime() <= new Date(fromTs).getTime()) return null;
    return estimateLeaveHours(type, fromTs, toTs, assignment);
  }, [type, allDay, from, to, assignment]);

  async function submit() {
    setErr(null);
    if (!from || !to) return setErr(t('validation.datesRequired'));
    const fromTs = timeMode ? new Date(from).toISOString() : new Date(`${from}T00:00:00`).toISOString();
    const toTs = timeMode ? new Date(to).toISOString() : new Date(`${to}T23:59:00`).toISOString();
    if (new Date(toTs).getTime() <= new Date(fromTs).getTime()) return setErr(t('validation.endBeforeStart'));
    if (type === 'malattia' && !inps.trim()) return setErr(t('validation.inpsRequired'));
    if (type === 'assenza' && !note.trim()) return setErr(t('validation.noteRequired'));
    // Block requests entirely outside the working schedule (e.g. ferie only on
    // a Sunday). The backend rejects these too — this is the friendly guard.
    if (estimateLeaveHours(type, fromTs, toTs, assignment) === 0) return setErr(t('noWorkingHours'));
    setBusy(true);
    try {
      await api('/api/v1/leaves', {
        method: 'POST',
        json: {
          type,
          from_ts: fromTs,
          to_ts: toTs,
          all_day: type === 'ferie' || type === 'permessi' ? allDay : true,
          user_note: note.trim() || undefined,
          inps_protocol: type === 'malattia' ? inps.trim() : undefined,
          assenza_subtype: type === 'assenza' ? subtype : undefined,
          is_paid: type === 'assenza' ? isPaid : undefined,
        },
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common:state.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50" onClick={onClose}>
      <div className="card w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
        <h2 className="section-title">{t('title')}</h2>
        <div>
          <label className="label">{t('field.type')}</label>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as LeaveType)}>
            <option value="ferie">{t('common:leaveType.ferie')}</option>
            <option value="permessi">{t('common:leaveType.permessi')}</option>
            <option value="malattia">{t('common:leaveType.malattia')}</option>
            <option value="assenza">{t('common:leaveType.assenza')}</option>
          </select>
        </div>
        {(type === 'ferie' || type === 'permessi') && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> {t('field.allDay')}
          </label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">{t('field.from')}</label>
            <input type={timeMode ? 'datetime-local' : 'date'} step={timeMode ? 900 : undefined} className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">{t('field.to')}</label>
            <input type={timeMode ? 'datetime-local' : 'date'} step={timeMode ? 900 : undefined} className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        {type === 'malattia' && (
          <div>
            <label className="label">{t('field.inpsProtocol')}</label>
            <input className="input" value={inps} onChange={(e) => setInps(e.target.value)} />
          </div>
        )}
        {type === 'assenza' && (
          <>
            <div>
              <label className="label">{t('field.assenzaSubtype')}</label>
              <select className="input" value={subtype} onChange={(e) => setSubtype(e.target.value)}>
                {ASSENZA_SUBTYPES.map((s) => (
                  <option key={s} value={s}>{t(`common:assenzaSubtype.${s}`)}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isPaid} onChange={(e) => setIsPaid(e.target.checked)} /> {t('field.isPaid')}
            </label>
          </>
        )}
        <div>
          <label className="label">{t('field.note')}{type === 'assenza' ? t('field.noteRequiredSuffix') : ''}</label>
          <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {estimatedHours !== null && estimatedHours > 0 && (
          <div className="text-sm font-semibold">
            {t('estimatedTotal', { hours: formatDuration(estimatedHours * 3_600_000) })}
          </div>
        )}
        {estimatedHours === 0 && (
          <div className="text-sm" style={{ color: 'var(--color-error)' }}>{t('noWorkingHours')}</div>
        )}
        {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>{t('common:btn.cancel')}</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? t('btn.submitting') : t('btn.submit')}</button>
        </div>
      </div>
    </div>
  );
}
