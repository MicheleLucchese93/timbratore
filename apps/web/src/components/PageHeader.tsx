import type { ReactNode } from 'react';

/**
 * Canonical sticky page header: visible title (+ optional subtitle/count) on the
 * left, primary action(s) on the right. Replaces the per-page ad-hoc
 * `<header className="flex justify-end">` + `sr-only` h1 pattern so every page
 * shares one title treatment and one action slot. Styled by `.page-header*`
 * in index.css.
 */
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
