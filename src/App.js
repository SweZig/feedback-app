// src/App.js
import { useState, useCallback, useEffect } from 'react';
import {
  getActiveCustomer,
  getChains,
  setActiveChainId,
  updateChain,
} from './utils/settings';
import { onAuthStateChange, signOut } from './utils/storageAdapter';
import Navigation from './components/Navigation';
import SurveyPage from './components/SurveyPage';
import ReportPage from './components/ReportPage';
import SettingsPage from './components/SettingsPage';
import LoginPage from './components/LoginPage';
import './App.css';

function App() {
  const [page, setPage]           = useState('survey');
  const [refreshKey, setRefreshKey] = useState(0);
  const [user, setUser]           = useState(undefined); // undefined = laddar, null = ej inloggad
  const [authLoading, setAuthLoading] = useState(true);

  // Lyssna på auth-state från Supabase
  useEffect(() => {
    const { data: { subscription } } = onAuthStateChange((currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  const activeCustomer = getActiveCustomer();

  const handleSettingsChange = useCallback(() => {
    setRefreshKey((v) => v + 1);
  }, []);

  // Läs ?tp= från URL och sätt aktiv mätpunkt + kedja
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

  // Visa ingenting medan auth-state laddas
  if (authLoading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f0f4f7',
        color: '#1e3a4f',
        fontSize: '1rem',
      }}>
        Laddar...
      </div>
    );
  }

  // Visa login om användaren inte är inloggad
  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className="app">
      <Navigation
        currentPage={page}
        onNavigate={setPage}
        activeCustomer={activeCustomer}
        user={user}
        onSignOut={signOut}
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
