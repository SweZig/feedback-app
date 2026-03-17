import { useState, useCallback, useEffect } from 'react';
import {
  getActiveCustomer,
  getChains,
  setActiveChainId,
  updateChain,
} from './utils/settings';
import Navigation from './components/Navigation';
import SurveyPage from './components/SurveyPage';
import ReportPage from './components/ReportPage';
import SettingsPage from './components/SettingsPage';
import './App.css';

function App() {
  const [page, setPage] = useState('survey');
  const [refreshKey, setRefreshKey] = useState(0);

  const activeCustomer = getActiveCustomer();

  const handleSettingsChange = useCallback(() => {
    setRefreshKey((v) => v + 1);
  }, []);

  // Read ?tp= from URL and set active touchpoint + chain
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tpId = params.get('tp');
    if (tpId) {
      const chains = getChains();
      const chain = chains.find((c) =>
        (c.touchpoints || []).some((t) => t.id === tpId)
      );
      if (chain) {
        setActiveChainId(chain.id);
        updateChain(chain.id, { activeTouchpointId: tpId });
        setPage('survey');
        setRefreshKey((v) => v + 1);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app">
      <Navigation
        currentPage={page}
        onNavigate={setPage}
        activeCustomer={activeCustomer}
      />
      <main className="app-main">
        {page === 'survey' && (
          <SurveyPage
            key={refreshKey}
            activeCustomer={activeCustomer}
          />
        )}
        {page === 'report' && (
          <ReportPage
            key={refreshKey}
            activeCustomer={activeCustomer}
          />
        )}
        {page === 'settings' && (
          <SettingsPage onSettingsChange={handleSettingsChange} />
        )}
      </main>
    </div>
  );
}

export default App;
