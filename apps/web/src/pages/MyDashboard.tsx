import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import { useSession } from '../store/session.ts';
import { fmtDateTime } from '../i18n/format.ts';
import { StampPanel } from '../components/StampPanel.tsx';
import { PageHeader } from '../components/PageHeader.tsx';
import { BachecaSection } from '../components/BachecaSection.tsx';

interface Stamp {
  id: string;
  event_type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end' | 'lunch_start' | 'lunch_end';
  occurred_at: string;
}

export function MyDashboard() {
  const { t } = useTranslation(['myDashboard', 'common']);
  const me = useSession((s) => s.me);
  const [recent, setRecent] = useState<Stamp[]>([]);

  async function loadRecent() {
    const r = await api<Stamp[]>('/api/v1/stamps/me');
    setRecent(r.slice(0, 8));
  }
  useEffect(() => {
    loadRecent().catch(() => {});
  }, []);

  if (!me) return null;

  return (
    <div className="space-y-4">
      <PageHeader title={t('greeting', { name: me.user.email.split('@')[0] })} />

      <BachecaSection />

      <StampPanel onStamped={() => loadRecent().catch(() => {})} />

      <section className="card p-0">
        <header className="flex items-center justify-between p-4 border-b border-neutral-100">
          <h2 className="section-title">{t('recentTitle')}</h2>
          <Link to="/me/stamps" className="btn btn-secondary btn-sm">{t('viewAll')}</Link>
        </header>
        {recent.length === 0 ? (
          <div className="p-6 text-sm muted text-center">{t('empty')}</div>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {recent.map((s) => (
              <li key={s.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span>{t(`common:stampEvent.${s.event_type}`)}</span>
                <span className="num muted text-xs">{fmtDateTime(s.occurred_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
