import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// Section sub-navigation for the Cantieri module. The module used to explode
// into three top-level sidebar rows; instead it now has a single sidebar entry
// and this in-page segmented tab bar (mirroring how the Manual keeps its own
// navigation inside the page). Dashboard leads — it's the module overview.
const TABS: Array<{ to: string; key: string }> = [
  { to: '/cantieri/dashboard', key: 'cantieri_dashboard' },
  { to: '/cantieri/sites', key: 'cantieri' },
  { to: '/cantieri/campi', key: 'cantieri_fields' },
  { to: '/cantieri/mezzi', key: 'cantieri_mezzi' },
];

export function CantieriTabs() {
  const { t } = useTranslation(['nav']);
  return (
    <nav className="cal-seg" role="tablist" aria-label={t('cantieri')}>
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          role="tab"
          className={({ isActive }) => `cal-seg-btn ${isActive ? 'is-active' : ''}`}
        >
          {t(tab.key)}
        </NavLink>
      ))}
    </nav>
  );
}
