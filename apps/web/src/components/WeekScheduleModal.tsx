import { useTranslation } from 'react-i18next';
import { useEscapeKey } from '../hooks/useEscapeKey.ts';
import { localeTag } from '../i18n/format.ts';
import { formatDuration } from '@sonoqui/shared';
import type { ActiveAssignment } from '@sonoqui/shared';

const ISO_DAYS = [1, 2, 3, 4, 5, 6, 7];

// Locale-derived full weekday name for an ISO weekday (1=Mon..7=Sun). Jan 1
// 2024 is a Monday, so day-of-month `iso` lands on the matching weekday.
// Mirrors apps/web/src/pages/Shifts.tsx dayLabel so labels stay in sync.
function dayLabel(iso: number): string {
  const s = new Date(Date.UTC(2024, 0, iso)).toLocaleDateString(localeTag(), { weekday: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Minutes between two "HH:MM" slot bounds (same day, end ≥ start).
function slotMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number) as [number, number];
  const [eh, em] = end.split(':').map(Number) as [number, number];
  return Math.max(0, eh * 60 + em - (sh * 60 + sm));
}

export function WeekScheduleModal({
  assignment,
  todayDow,
  onClose,
}: {
  assignment: ActiveAssignment;
  /** ISO weekday of "today" (1 = Mon … 7 = Sun), highlighted in the list. */
  todayDow: number;
  onClose: () => void;
}) {
  const { t } = useTranslation(['timbrature', 'common']);
  useEscapeKey(onClose);
  return (
    <div
      className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-md space-y-3 max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-label={t('schedule.weekTitle')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="section-title m-0">{t('schedule.weekTitle')}</h2>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onClose}
            aria-label={t('common:btn.close')}
          >
            ✕
          </button>
        </div>

        <ul className="space-y-1.5">
          {ISO_DAYS.map((iso) => {
            const slots = assignment.slots
              .filter((s) => s.day_of_week === iso)
              .sort((a, b) => a.start_time.localeCompare(b.start_time));
            const totalMin = slots.reduce(
              (acc, s) => acc + slotMinutes(s.start_time, s.end_time),
              0
            );
            const isToday = iso === todayDow;
            return (
              <li
                key={iso}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 border"
                style={{
                  borderColor: isToday ? 'var(--color-primary)' : 'transparent',
                  background: isToday
                    ? 'var(--color-primary-container)'
                    : 'var(--color-surface-variant)',
                }}
              >
                <span
                  className="w-24 shrink-0 text-sm font-semibold"
                  style={isToday ? { color: 'var(--color-primary)' } : undefined}
                >
                  {dayLabel(iso)}
                </span>
                <div className="flex-1 flex flex-wrap gap-1.5">
                  {slots.length > 0 ? (
                    slots.map((s, i) => (
                      <span
                        key={i}
                        className="text-xs font-semibold num rounded-full px-2.5 py-1"
                        style={{ background: 'var(--color-surface)', color: 'var(--color-primary)' }}
                      >
                        {s.start_time}–{s.end_time}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm muted">{t('schedule.rest')}</span>
                  )}
                </div>
                <span
                  className="w-14 shrink-0 text-right text-sm font-semibold num"
                  style={{
                    color: slots.length > 0
                      ? 'var(--color-primary)'
                      : 'var(--color-on-surface-variant)',
                  }}
                >
                  {slots.length > 0 ? formatDuration(totalMin * 60_000) : '—'}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
