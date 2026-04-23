import defaultLogo from '../logo.png';
import { useRole } from '../contexts/RoleContext';
import './Navigation.css';

// Tabbarna och deras permission-nycklar. Order = visningsordning.
const NAV_TABS = [
  { key: 'survey',   label: 'Enkät',         perm: 'view_tab_survey'   },
  { key: 'report',   label: 'Rapport',       perm: 'view_tab_report'   },
  { key: 'settings', label: 'Inställningar', perm: 'view_tab_settings' },
  { key: 'admin',    label: 'Användare',     perm: 'view_tab_admin'    },
];

function Navigation({ currentPage, onNavigate, activeCustomer, user, onSignOut }) {
  const logoSrc = activeCustomer?.customLogo || defaultLogo;
  const { can, loading } = useRole();

  // Under initial load (innan roll/permissions hunnit läsa in) visar vi alla
  // tabbar för att undvika en "flash" där nav-fältet är tomt. När loading är
  // klar filtrerar vi enligt faktisk behörighet.
  const visibleTabs = NAV_TABS.filter((t) => loading || can(t.perm));

  return (
    <nav className="nav">
      <div className="nav-inner">
        <img src={logoSrc} alt="Logo" className="nav-logo" />
        <div className="nav-buttons">
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              className={`nav-btn ${currentPage === t.key ? 'nav-btn--active' : ''}`}
              onClick={() => onNavigate(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="nav-user">
          {user?.email && <span className="nav-user-email">{user.email}</span>}
          <button className="nav-signout" onClick={onSignOut}>Logga ut</button>
        </div>
      </div>
    </nav>
  );
}

export default Navigation;
