import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from './EmptyState.tsx';
import type { EmptyArtName } from './EmptyArt.tsx';

export interface MCardField {
  label: string;
  value: ReactNode;
}

/** One record rendered as a card: title (+ optional status badge), a
 *  label/value list, and an optional action row. The phone-width replacement
 *  for a DataGrid row — see each page's useMediaQuery switch. */
export function MCard({
  title,
  badge,
  fields,
  actions,
}: {
  title: ReactNode;
  badge?: ReactNode;
  fields: MCardField[];
  actions?: ReactNode;
}) {
  return (
    <div className="m-card">
      <div className="m-card-head">
        <div className="m-card-title">{title}</div>
        {badge}
      </div>
      <dl className="m-card-fields">
        {fields.map((f, i) => (
          <div className="m-card-field" key={i}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
      {actions != null && <div className="m-card-actions">{actions}</div>}
    </div>
  );
}

/**
 * Wraps the card list with shared loading / empty states.
 *
 * The empty branch is the same illustrated block the desktop DataGrid shows
 * through `GridEmptyOverlay`, so a phone and a laptop say the same thing about
 * the same nothing. Pass the same `art` / copy to both.
 */
export function MCardList({
  loading,
  empty,
  art,
  emptyTitle,
  emptyHint,
  children,
}: {
  loading?: boolean;
  empty?: boolean;
  art?: EmptyArtName;
  emptyTitle?: ReactNode;
  emptyHint?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (loading) return <div className="m-card-status muted">{t('common.loading')}</div>;
  if (empty) {
    return (
      <EmptyState fill art={art ?? 'search'} title={emptyTitle ?? t('common.empty')} hint={emptyHint} />
    );
  }
  return <div className="m-card-list">{children}</div>;
}
