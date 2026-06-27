import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { BulletinFeedItem } from '@sonoqui/shared';
import { api } from '../lib/api.ts';
import { fmtDate } from '../i18n/format.ts';

/**
 * Member-facing Bacheca feed, shown on the admin Dashboard (above "Da
 * approvare") and on the employee MyDashboard. Lists live messages addressed to
 * the caller, with an unread filter and an explicit "mark as read" action. Body
 * HTML is server-sanitized (allowlist), so rendering it raw is safe.
 */
export function BachecaSection({ manageHref }: { manageHref?: string }) {
  const { t } = useTranslation(['bacheca', 'common']);
  const [items, setItems] = useState<BulletinFeedItem[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<BulletinFeedItem[]>('/api/v1/bulletins/me');
      setItems(r);
    } catch {
      /* degrade silently — a dashboard section must not break the page */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const unreadCount = useMemo(() => items.filter((i) => !i.read).length, [items]);
  const visible = unreadOnly ? items.filter((i) => !i.read) : items;

  async function markRead(id: string) {
    // Optimistic: flip locally, then persist.
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, read: true } : i)));
    try {
      await api(`/api/v1/bulletins/${id}/read`, { method: 'POST', json: {} });
    } catch {
      load();
    }
  }

  // Nothing to show and nothing pending — keep the dashboard clean. Admins still
  // get the section (with manage link) so they can reach the management page.
  if (loaded && items.length === 0 && !manageHref) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <h2 className="section-title">{t('sectionTitle')}</h2>
          {unreadCount > 0 && (
            <span className="badge badge-warn">{t('unreadCount', { count: unreadCount })}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <label className="text-xs muted flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(e) => setUnreadOnly(e.target.checked)}
              />
              {t('showUnreadOnly')}
            </label>
          )}
          {manageHref && (
            <Link to={manageHref} className="btn btn-ghost btn-sm">
              {t('title')}
            </Link>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">{t('empty')}</div>
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((b) => (
            <BulletinCard key={b.id} item={b} onMarkRead={() => markRead(b.id)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function BulletinCard({
  item,
  onMarkRead,
}: {
  item: BulletinFeedItem;
  onMarkRead: () => void;
}) {
  const { t } = useTranslation(['bacheca', 'common']);
  return (
    <li className={`card bacheca-card ${item.read ? '' : 'bacheca-card-unread'}`}>
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          {!item.read && <span className="bacheca-dot" aria-hidden="true" />}
          <h3 className="font-semibold text-sm truncate" title={item.title}>{item.title}</h3>
        </div>
        <span className="text-xs muted num shrink-0">
          {fmtDate(item.created_at, { day: '2-digit', month: '2-digit', year: 'numeric' })}
        </span>
      </div>
      <div
        className="bacheca-content text-sm"
        dangerouslySetInnerHTML={{ __html: item.body_html }}
      />
      <div className="flex justify-end mt-2">
        {item.read ? (
          <span className="badge badge-ok">{t('read')}</span>
        ) : (
          <button className="btn btn-secondary btn-sm" onClick={onMarkRead}>
            {t('markRead')}
          </button>
        )}
      </div>
    </li>
  );
}
