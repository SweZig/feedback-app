import defaultLogo from '../logo.png';
import './Navigation.css';

function Navigation({ currentPage, onNavigate, activeCustomer }) {
  const logoSrc = activeCustomer?.customLogo || defaultLogo;

  return (
    <nav className="nav">
      <div className="nav-inner">
        <img src={logoSrc} alt="Logo" className="nav-logo" />
        <div className="nav-buttons">
          <button
            className={`nav-btn ${currentPage === 'survey' ? 'nav-btn--active' : ''}`}
            onClick={() => onNavigate('survey')}
          >
            Enkät
          </button>
          <button
            className={`nav-btn ${currentPage === 'report' ? 'nav-btn--active' : ''}`}
            onClick={() => onNavigate('report')}
          >
            Rapport
          </button>
          <button
            className={`nav-btn ${currentPage === 'settings' ? 'nav-btn--active' : ''}`}
            onClick={() => onNavigate('settings')}
          >
            Inställningar
          </button>
        </div>
      </div>
    </nav>
  );
}

export default Navigation;
