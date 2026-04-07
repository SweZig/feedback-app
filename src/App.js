// src/App.js
import { useState, useCallback, useEffect, useRef } from 'react';
import {
  getActiveChainId,
  setActiveChainId,
  updateChain,
} from './utils/settings';
import {
  onAuthStateChange,
  signOut,
  getAssembledCustomers,
} from './utils/storageAdapter';
import { RoleProvider, useRole } from './contexts/RoleContext';
import Navigation from './components/Navigation';
import SurveyPage from './components/SurveyPage';
import ReportPage from './components/ReportPage';
import SettingsPage from './components/SettingsPage';
import AdminPage from './components/AdminPage';
import LoginPage from './components/LoginPage';
import './App.css';

// Läs av invite-flaggan från sessionStorage (satt av inline script i index.html
// innan Supabase JS hann rensa URL-hashen)
const IS_INVITE_FLOW = sessionStorage.getItem('supabase_auth_type') === 'invite';

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
function AppInner({ user, activeCustomer, onRefresh }) {
  const [page, setPage]             = useState('survey');
  const [refreshKey, setRefreshKey] = useState(0);
  const { can, simulatedRole }      = useRole();
  const urlHandledRef               = useRef(false);

  // Hantera ?tp=<id> i URL — kör bara en gång när activeCustomer finns
  useEffect(() => {
    if (!activeCustomer || urlHandledRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const tpId = params.get('tp');
    if (tpId) {
      const tp = (activeCustomer.touchpoints || []).find(t => t.id === tpId);
      if (tp) {
        setActiveChainId(activeCustomer.id);
        updateChain(activeCustomer.id, { activeTouchpointId: tpId });
        setPage('survey');
        onRefresh();
      }
      urlHandledRef.current = true;
    }
  }, [activeCustomer, onRefresh]);

  // Rollsimulering — styra om från skyddade sidor
  useEffect(() => {
    if (!simulatedRole) return;
    if (page === 'settings' && !can('manage_chains')) setPage('survey');
    if (page === 'admin'    && !can('view_admin'))    setPage('survey');
  }, [simulatedRole, page, can]);

  const handleSettingsChange = useCallback(() => {
    onRefresh();                          // Ladda om activeCustomer från Supabase
    setRefreshKey(v => v + 1);           // Tvinga omrendering av sidor
  }, [onRefresh]);

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
  const [user, setUser]                   = useState(undefined);
  const [authLoading, setAuthLoading]     = useState(true);
  const [orgId, setOrgId]                 = useState(null);
  const [activeCustomer, setActiveCustomer] = useState(null);

  /**
   * Laddar alla kedjor för organisationen från Supabase,
   * väljer den aktiva kedjan (från localStorage UI-state eller första i listan)
   * och bevarar activeTouchpointId från localStorage.
   *
   * Faller tillbaka till localStorage (settings.js) om Supabase
   * inte har någon data ännu — t.ex. innan migrering körts.
   */
  const loadActiveCustomer = useCallback(async (currentOrgId) => {
    if (!currentOrgId) return;

    try {
      const customers = await getAssembledCustomers(currentOrgId);

      if (customers.length === 0) {
        // Fallback — ingen Supabase-data ännu, läs från localStorage
        const { getActiveCustomer } = await import('./utils/settings');
        setActiveCustomer(getActiveCustomer());
        return;
      }

      // Hitta aktiv kedja baserat på localStorage UI-state
      const activeId = getActiveChainId();
      const active   = customers.find(c => c.id === activeId) || customers[0];

      // Bevara activeTouchpointId från localStorage (ren UI-state)
      const localChains  = JSON.parse(localStorage.getItem('npsCustomers') || '[]');
      const localChain   = localChains.find(c => c.id === active.id);
      active.activeTouchpointId = localChain?.activeTouchpointId || null;

      setActiveCustomer(active);
    } catch (e) {
      console.error('[App] loadActiveCustomer:', e);
      // Fallback vid fel
      const { getActiveCustomer } = await import('./utils/settings');
      setActiveCustomer(getActiveCustomer());
    }
  }, []);

  // Auth state — körs en gång vid mount
  useEffect(() => {
    const { data: { subscription } } = onAuthStateChange(async (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);

      if (currentUser && !IS_INVITE_FLOW) {
        try {
          const { supabase } = await import('./utils/supabaseClient');
          const { data } = await supabase
            .from('org_members')
            .select('organization_id')
            .eq('user_id', currentUser.id)
            .limit(1)
            .single();

          const id = data?.organization_id || null;
          setOrgId(id);
          await loadActiveCustomer(id);
        } catch {
          // Ingen org_members-rad — visa localStorage-data
          const { getActiveCustomer } = await import('./utils/settings');
          setActiveCustomer(getActiveCustomer());
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [loadActiveCustomer]);

  // Callback som komponenter anropar efter ändringar
  const handleRefresh = useCallback(() => {
    loadActiveCustomer(orgId);
  }, [orgId, loadActiveCustomer]);

  // ── Laddningsskärm ──
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

  // Visa LoginPage om ingen inloggad användare, eller om invite-flöde pågår
  if (!user || IS_INVITE_FLOW) return <LoginPage />;

  return (
    <RoleProvider organizationId={orgId}>
      <AppInner
        user={user}
        activeCustomer={activeCustomer}
        onRefresh={handleRefresh}
      />
    </RoleProvider>
  );
}

export default App;
