import { useEffect, useState } from 'react';
import type { StampEventType } from '@sonoqui/shared';
import { api } from '../lib/api.ts';

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

const EVENT_OPTIONS: Array<{ value: StampEventType; label: string }> = [
  { value: 'clock_in', label: 'Ingresso' },
  { value: 'clock_out', label: 'Uscita' },
  { value: 'break_start', label: 'Inizio pausa' },
  { value: 'break_end', label: 'Fine pausa' },
  { value: 'lunch_start', label: 'Inizio pausa pranzo' },
  { value: 'lunch_end', label: 'Fine pausa pranzo' },
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
      setErr(e instanceof Error ? e.message : 'errore');
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
      setErr('Spiega la motivazione in almeno 5 caratteri.');
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
      setErr(e instanceof Error ? e.message : 'errore');
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
      ? 'Quale giorno?'
      : step === 'pickStamp'
      ? formatDateLong(targetDate)
      : originalStampId
      ? 'Modifica timbratura'
      : 'Nuova timbratura';

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50" onClick={onClose}>
      <div
        className="card w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-label="Nuova richiesta di correzione"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={back}
            aria-label={step === 'date' ? 'Chiudi' : 'Indietro'}
          >
            {step === 'date' ? '✕' : '←'}
          </button>
          <h2 className="section-title flex-1 truncate m-0">{title}</h2>
        </div>

        {err && <div className="text-sm" style={{ color: 'var(--color-error)' }}>{err}</div>}

        {step === 'date' && (
          <div className="space-y-3">
            <p className="muted text-sm">
              Scegli la data per cui vuoi richiedere una correzione. Caricheremo le tue timbrature di
              quel giorno: potrai modificarne una o aggiungerne una mancante.
            </p>
            <div>
              <label className="label" htmlFor="corr-date">Data</label>
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
                {loadingDay ? 'Carico…' : 'Continua'}
              </button>
            </div>
          </div>
        )}

        {step === 'pickStamp' && (
          <div className="space-y-3">
            <p className="muted text-sm">
              Seleziona una timbratura da correggere, oppure aggiungi una timbratura mancante.
            </p>
            {dayStamps && dayStamps.length === 0 && (
              <div className="card text-sm text-neutral-600">Nessuna timbratura in questa data.</div>
            )}
            <ul className="space-y-2">
              {dayStamps?.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="w-full flex items-center justify-between gap-3 rounded border p-2.5 text-left"
                    style={{ borderColor: 'var(--color-border, #e5e7eb)' }}
                    onClick={() => chooseExisting(s)}
                  >
                    <span className="text-sm font-medium">{labelEvent(s.event_type)}</span>
                    <span className="text-sm tabular-nums">
                      {new Date(s.occurred_at).toLocaleTimeString('it-IT', {
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
                  style={{ borderColor: 'var(--color-primary, #2563eb)', color: 'var(--color-primary, #2563eb)' }}
                  onClick={chooseMissing}
                >
                  + Aggiungi una timbratura mancante
                </button>
              </li>
            </ul>
          </div>
        )}

        {step === 'edit' && (
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="corr-event">Tipo evento</label>
              <select
                id="corr-event"
                className="input"
                value={eventType}
                onChange={(e) => setEventType(e.target.value as StampEventType)}
              >
                {EVENT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Data</label>
                <div className="input flex items-center" aria-readonly="true">{formatDateLong(targetDate)}</div>
              </div>
              <div>
                <label className="label" htmlFor="corr-time">Ora</label>
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
                <label className="label" htmlFor="corr-branch">Sede</label>
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
              <label className="label" htmlFor="corr-just">Motivazione</label>
              <textarea
                id="corr-just"
                className="input"
                rows={3}
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="Es. avevo dimenticato di timbrare l'uscita"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
                Annulla
              </button>
              <button type="button" className="btn btn-primary" onClick={submit} disabled={submitting}>
                {submitting ? 'Invio…' : 'Invia richiesta'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function labelEvent(e: StampEventType): string {
  switch (e) {
    case 'clock_in': return 'Ingresso';
    case 'clock_out': return 'Uscita';
    case 'break_start': return 'Inizio pausa';
    case 'break_end': return 'Fine pausa';
    case 'lunch_start': return 'Inizio pausa pranzo';
    case 'lunch_end': return 'Fine pausa pranzo';
    default: return e;
  }
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
  return new Date(y!, (mo ?? 1) - 1, d ?? 1).toLocaleDateString('it-IT', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}
