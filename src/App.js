// src/App.js
import { useState, useCallback, useEffect } from 'react';
import {
  getActiveCustomer,
  getChains,
  setActiveChainId,
  updateChain,
} from './utils/settings';
import { onAuthStateChange, signOut } from './utils/storageAdapter';
import { RoleProvider, useRole } from './contexts/RoleContext';
import Navigation from './components/Navigation';
import SurveyPage from './components/SurveyPage';
import ReportPage from './components/ReportPage';
import SettingsPage from './components/SettingsPage';
import AdminPage from './components/AdminPage';
import LoginPage from './components/LoginPage';
import './App.css';

// ── Simulerings-banner ────────────────────────────────────────
function SimulationBanner() {
  const { simulatedRole, stopSimulation } = useRole();
  const ROLE_LABELS = { admin: 'Administratör', manager: 'Manager', analytiker: 'Analytiker' };
  if (!simulatedRole) return null;
  return (
    <div style={{
      background: '#fff8e1',
      borderBottom: '2px solid #ffe082',
      padding: '0.5rem 1rem',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '1rem',
      fontSize: '0.875rem',
      color: '#7a5a00',
      fontWeight: 600,
    }}>
      🎭 Rollsimulering aktiv — du ser appen som <strong>{ROLE_LABELS[simulatedRole]}</strong>
      <button onClick={stopSimulation} style={{
        background: '#e74c3c', color: '#fff', border: 'none',
        borderRadius: '5px', padding: '0.25rem 0.75rem',
        fontSize: '0.8rem', cursor: 'pointer', fontWeight: 600,
      }}>
        Avsluta
      </button>
    </div>
  );
}

// ── Inre app (kräver RoleContext) ─────────────────────────────
function AppInner({ user }) {
  const [page, setPage]             = useState('survey');
  const [refreshKey, setRefreshKey] = useState(0);
  const { can, simulatedRole }      = useRole();

  const activeCustomer = getActiveCustomer();

  const handleSettingsChange = useCallback(() => {
    setRefreshKey((v) => v + 1);
  }, []);

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

  // Om simulering är aktiv och vi är på en sida vi inte har access till
  // — navigera till survey
  useEffect(() => {
    if (!simulatedRole) return;
    if (page === 'settings' && !can('manage_chains')) setPage('survey');
    if (page === 'admin'    && !can('view_admin'))    setPage('survey');
  }, [simulatedRole, page, can]);

  return (
    <div className="app">
      <SimulationBanner />
      <Navigation
        currentPage={page}
        onNavigate={setPage}
        activeCustomer={activeCustomer}
        user={user}
        onSignOut={signOut}
        canSettings={can('manage_chains')}
        canAdmin={can('view_admin')}
      />
      <main className="app-main">
        {page === 'survey' && (
          <SurveyPage key={refreshKey} activeCustomer={activeCustomer} />
        )}
        {page === 'report' && (
          <ReportPage key={refreshKey} activeCustomer={activeCustomer} />
        )}
        {page === 'settings' && can('manage_chains') && (
          <SettingsPage onSettingsChange={handleSettingsChange} />
        )}
        {page === 'settings' && !can('manage_chains') && (
          <div style={{ padding: '2rem', color: '#7a9aaa' }}>
            Du har inte behörighet att se inställningar.
          </div>
        )}
        {page === 'admin' && can('view_admin') && (
          <AdminPage />
        )}
        {page === 'admin' && !can('view_admin') && (
          <div style={{ padding: '2rem', color: '#7a9aaa' }}>
            Du har inte behörighet att se användarhantering.
          </div>
        )}
      </main>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────
function App() {
  const [user, setUser]               = useState(undefined);
  const [authLoading, setAuthLoading] = useState(true);
  const [orgId, setOrgId]             = useState(null);

  useEffect(() => {
    const { data: { subscription } } = onAuthStateChange(async (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);

      // Hämta organisationsid för RoleProvider
      if (currentUser) {
        try {
          const { supabase } = await import('./utils/supabaseClient');
          const { data } = await supabase
            .from('org_members')
            .select('organization_id')
            .eq('user_id', currentUser.id)
            .limit(1)
            .single();
          setOrgId(data?.organization_id || null);
        } catch { /* ignorera */ }
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  if (authLoading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#f0f4f7',
        color: '#1e3a4f', fontSize: '1rem',
      }}>
        Laddar...
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return (
    <RoleProvider organizationId={orgId}>
      <AppInner user={user} />
    </RoleProvider>
  );
}

export default App;
