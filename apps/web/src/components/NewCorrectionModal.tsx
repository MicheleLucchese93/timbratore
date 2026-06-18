import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { StampEventType } from '@sonoqui/shared';
import { useEscapeKey } from '../hooks/useEscapeKey.ts';
import { api } from '../lib/api.ts';
import { fmtDate, fmtTime } from '../i18n/format.ts';

/**
 * Self-service correction-request form, at parity with the mobile
 * "Nuova richiesta" flow (CorrezioniScreen.NewRequestModal). Shared between the
 * employee page (/me/corrections) and the admin page (/corrections) so an admin
 * can also file a request for their own stamps — the backend accepts a
 * POST /api/v1/correction-requests from any authenticated user.
 *
 * Three steps:
 *   'date'      → pick the day to correct
 *   'pickStamp' → load that day's own stamps; edit one, or add a missing one
 *   'edit'      → event type / time / (branch) / justification → submit
 */

type Step = 'date' | 'pickStamp' | 'edit';

interface DayStamp {
  id: string;
  event_type: StampEventType;
  occurred_at: string;
  branch_id: string | null;
}

const EVENT_TYPES: StampEventType[] = [
  'clock_in',
  'clock_out',
  'break_start',
  'break_end',
  'lunch_start',
  'lunch_end',
];

export function NewCorrectionModal({
  onClose,
  onDone,
  branches,
}: {
  onClose: () => void;
  onDone: () => void;
  branches: Array<{ id: string; name: string }>;
}) {
  const { t } = useTranslation(['newCorrectionModal', 'common']);
  useEscapeKey(onClose);
  const [step, setStep] = useState<Step>('date');
  const [targetDate, setTargetDate] = useState(() => isoLocalDate(new Date()));
  const [dayStamps, setDayStamps] = useState<DayStamp[] | null>(null);
  const [loadingDay, setLoadingDay] = useState(false);

  const [originalStampId, setOriginalStampId] = useState<string | null>(null);
  const [eventType, setEventType] = useState<StampEventType>('clock_in');
  const [time, setTime] = useState(() => isoTime(new Date()));
  const [branchId, setBranchId] = useState<string | null>(branches[0]?.id ?? null);
  const [justification, setJustification] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setBranchId((cur) => cur ?? branches[0]?.id ?? null);
  }, [branches]);

  const today = isoLocalDate(new Date());

  async function goToPickStamp() {
    setErr(null);
    setLoadingDay(true);
    try {
      const rows = await api<DayStamp[]>(`/api/v1/stamps/me?from=${targetDate}&to=${targetDate}`);
      // Backend returns DESC by occurred_at — flip to chronological for the picker.
      rows.sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : 1));
      setDayStamps(rows);
      setStep('pickStamp');
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('error.generic'));
    } finally {
      setLoadingDay(false);
    }
  }

  function chooseExisting(s: DayStamp) {
    setOriginalStampId(s.id);
    setEventType(s.event_type);
    setTime(isoTime(new Date(s.occurred_at)));
    setBranchId(s.branch_id ?? branches[0]?.id ?? null);
    setStep('edit');
  }

  function chooseMissing() {
    setOriginalStampId(null);
    setEventType('clock_in');
    setTime(isoTime(new Date()));
    setBranchId(branches[0]?.id ?? null);
    setStep('edit');
  }

  async function submit() {
    setErr(null);
    if (justification.trim().length < 5) {
      setErr(t('error.justificationTooShort'));
      return;
    }
    setSubmitting(true);
    try {
      await api('/api/v1/correction-requests', {
        method: 'POST',
        json: {
          original_stamp_id: originalStampId,
          claimed_event_type: eventType,
          claimed_occurred_at: combineLocalDateTime(targetDate, time),
          claimed_branch_id: branchId,
          justification: justification.trim(),
        },
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('error.generic'));
    } finally {
      setSubmitting(false);
    }
  }

  function back() {
    setErr(null);
    if (step === 'edit') setStep('pickStamp');
    else if (step === 'pickStamp') setStep('date');
    else onClose();
  }

  const title =
    step === 'date'
      ? t('title.date')
      : step === 'pickStamp'
      ? formatDateLong(targetDate)
      : originalStampId
      ? t('title.edit')
      : t('title.new');

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50" onClick={onClose}>
      <div
        className="card w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-label={t('ariaLabel')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={back}
            aria-label={step === 'date' ? t('aria.close') : t('aria.back')}
          >
            {step === 'date' ? '✕' : '←'}
          </button>
          <h2 className="section-title flex-1 truncate m-0">{title}</h2>
        </div>

        {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}

        {step === 'date' && (
          <div className="space-y-3">
            <p className="muted text-sm">
              {t('date.intro')}
            </p>
            <div>
              <label className="label" htmlFor="corr-date">{t('date.label')}</label>
              <input
                id="corr-date"
                type="date"
                className="input"
                value={targetDate}
                max={today}
                onChange={(e) => setTargetDate(e.target.value)}
              />
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                className="btn btn-primary"
                onClick={goToPickStamp}
                disabled={loadingDay}
              >
                {loadingDay ? t('date.loading') : t('common:btn.continue')}
              </button>
            </div>
          </div>
        )}

        {step === 'pickStamp' && (
          <div className="space-y-3">
            <p className="muted text-sm">
              {t('pickStamp.intro')}
            </p>
            {dayStamps && dayStamps.length === 0 && (
              <div className="card text-sm text-neutral-600">{t('pickStamp.empty')}</div>
            )}
            <ul className="space-y-2">
              {dayStamps?.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="w-full flex items-center justify-between gap-3 rounded border p-2.5 text-left"
                    style={{ borderColor: 'var(--color-border)' }}
                    onClick={() => chooseExisting(s)}
                  >
                    <span className="text-sm font-medium">{t(`common:stampEvent.${s.event_type}`)}</span>
                    <span className="text-sm tabular-nums">
                      {fmtTime(new Date(s.occurred_at), {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </button>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  className="w-full rounded border border-dashed p-2.5 text-sm font-medium"
                  style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
                  onClick={chooseMissing}
                >
                  {t('pickStamp.addMissing')}
                </button>
              </li>
            </ul>
          </div>
        )}

        {step === 'edit' && (
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="corr-event">{t('edit.eventType')}</label>
              <select
                id="corr-event"
                className="input"
                value={eventType}
                onChange={(e) => setEventType(e.target.value as StampEventType)}
              >
                {EVENT_TYPES.map((value) => (
                  <option key={value} value={value}>{t(`common:stampEvent.${value}`)}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">{t('edit.date')}</label>
                <div className="input flex items-center" aria-readonly="true">{formatDateLong(targetDate)}</div>
              </div>
              <div>
                <label className="label" htmlFor="corr-time">{t('edit.time')}</label>
                <input
                  id="corr-time"
                  type="time"
                  className="input"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </div>
            </div>
            {branches.length > 1 && (
              <div>
                <label className="label" htmlFor="corr-branch">{t('edit.branch')}</label>
                <select
                  id="corr-branch"
                  className="input"
                  value={branchId ?? ''}
                  onChange={(e) => setBranchId(e.target.value || null)}
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="label" htmlFor="corr-just">{t('edit.justification')}</label>
              <textarea
                id="corr-just"
                className="input"
                rows={3}
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder={t('edit.justificationPlaceholder')}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
                {t('common:btn.cancel')}
              </button>
              <button type="button" className="btn btn-primary" onClick={submit} disabled={submitting}>
                {submitting ? t('edit.submitting') : t('edit.submit')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function isoLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isoTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function combineLocalDateTime(date: string, time: string): string {
  const [y, mo, d] = date.split('-').map((s) => parseInt(s, 10));
  const [h, mi] = time.split(':').map((s) => parseInt(s, 10));
  return new Date(y!, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, 0, 0).toISOString();
}

function formatDateLong(date: string): string {
  const [y, mo, d] = date.split('-').map((s) => parseInt(s, 10));
  return fmtDate(new Date(y!, (mo ?? 1) - 1, d ?? 1), {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}
