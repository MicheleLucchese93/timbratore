import type { ReactNode } from 'react';

/** Sticky page header: title (+ optional subtitle) left, action(s) right. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-title">
        <h1>{title}</h1>
        {subtitle != null && subtitle !== '' && <p>{subtitle}</p>}
      </div>
      {actions != null && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}
