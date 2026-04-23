// src/App.js
import React, { useState, useCallback, useEffect, useRef } from 'react';
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
import KioskPage from './components/KioskPage';
import './App.css';

const IS_INVITE_FLOW = sessionStorage.getItem('supabase_auth_type') === 'invite';

// Tabbar + deras permission-nycklar. Ordningen styr både Navigation-visning
// och vilken flik som blir "första tillåtna" vid fallback.
// Måste hållas i synk med NAV_TABS i src/components/Navigation.js.
const NAV_PAGES = [
  { key: 'survey',   perm: 'view_tab_survey'   },
  { key: 'report',   perm: 'view_tab_report'   },
  { key: 'settings', perm: 'view_tab_settings' },
  { key: 'admin',    perm: 'view_tab_admin'    },
];

// Kiosk-läge: om ?tp=<access_token> finns i URL — visa enkät utan inloggning
// access_token är ett UUID genererat per touchpoint i Supabase
const KIOSK_TOKEN = (() => {
  const params = new URLSearchParams(window.location.search);
  const tp = params.get('tp');
  // Acceptera UUID med bindestreck (8-4-4-4-12) ELLER 32-char hex utan bindestreck
  if (tp && /^([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(tp)) {
    return tp;
  }
  return null;
})();

function SimulationBanner() {
  const { simulatedRole, stopSimulation } = useRole();
  const ROLE_LABELS = { admin: 'Administratör', manager: 'Manager', analytiker: 'Analytiker' };
  if (!simulatedRole) return null;
  return (
    <div style={{
      background: '#fff8e1', borderBottom: '2px solid #ffe082',
      padding: '0.5rem 1rem', display: 'flex', alignItems: 'center',
      justifyContent: 'center', gap: '1rem', fontSize: '0.875rem',
      color: '#7a5a00', fontWeight: 600,
    }}>
      🎭 Rollsimulering aktiv — du ser appen som <strong>{ROLE_LABELS[simulatedRole]}</strong>
      <button onClick={stopSimulation} style={{
        background: '#e74c3c', color: '#fff', border: 'none',
        borderRadius: '5px', padding: '0.25rem 0.75rem',
        fontSize: '0.8rem', cursor: 'pointer', fontWeight: 600,
      }}>Avsluta</button>
    </div>
  );
}

function AppInner({ user, activeCustomer, allCustomers, onRefresh, onChainChange }) {
  const [page, setPage]                 = useState('survey');
  const [refreshKey, setRefreshKey]     = useState(0);
  const { can, loading: roleLoading }   = useRole();
  const urlHandledRef                   = useRef(false);

  useEffect(() => {
    if (!activeCustomer || urlHandledRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const tpId = params.get('tp');
    if (tpId) {
      const tp = (activeCustomer.touchpoints || []).find(t => t.id === tpId);
      if (tp) {
        setActiveChainId(activeCustomer.id);
        updateChain(activeCustomer.id, { activeTouchpointId: tpId });
        // Sätt bara till survey om användaren har åtkomst; annars låter vi
        // normalize-effekten nedan välja första tillåtna sidan.
        if (can('view_tab_survey')) setPage('survey');
        onRefresh();
      }
      urlHandledRef.current = true;
    }
  }, [activeCustomer, onRefresh, can]);

  // Håll page synkad med behörigheter. Körs när:
  // - roleLoading blir false (initial inloggning — permissions har laddats)
  // - rollsimulering startas eller stoppas (can-funktionen ändras)
  // - page ändras till en sida användaren inte har åtkomst till
  //
  // Om nuvarande sida är otillåten hoppar vi till första tillåtna i NAV_PAGES.
  // Om INGEN sida är tillåten låter vi page vara — hasAnyAccess-checken
  // nedan renderar då "Ingen åtkomst"-vyn istället.
  useEffect(() => {
    if (roleLoading) return;
    const current = NAV_PAGES.find(p => p.key === page);
    if (current && can(current.perm)) return; // nuvarande sida ok, stanna
    const first = NAV_PAGES.find(p => can(p.perm));
    if (first && first.key !== page) setPage(first.key);
  }, [roleLoading, page, can]);

  const hasAnyAccess = NAV_PAGES.some(p => can(p.perm));

  const handleSettingsChange = useCallback(() => {
    onRefresh();
    setRefreshKey(v => v + 1);
  }, [onRefresh]);

  // Navigera — ladda om från Supabase bara när vi lämnar Inställningar
  const handleNavigate = useCallback((newPage) => {
    if (page === 'settings' && newPage !== 'settings') {
      onRefresh();
    }
    setPage(newPage);
  }, [page, onRefresh]);

  return (
    <div className="app">
      <SimulationBanner />
      <Navigation
        currentPage={page}
        onNavigate={handleNavigate}
        activeCustomer={activeCustomer}
        user={user}
        onSignOut={signOut}
      />
      <main className="app-main">
        {roleLoading ? (
          <div style={{
            padding: '3rem 2rem',
            textAlign: 'center',
            color: '#7a9aaa',
            fontSize: '0.95rem',
          }}>
            Laddar...
          </div>
        ) : !hasAnyAccess ? (
          <div style={{
            padding: '3rem 2rem',
            textAlign: 'center',
            color: '#1e3a4f',
            maxWidth: '480px',
            margin: '2rem auto',
            background: '#fff',
            borderRadius: '8px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          }}>
            <h2 style={{ marginTop: 0, color: '#1e3a4f' }}>Ingen åtkomst</h2>
            <p style={{ color: '#7a9aaa', lineHeight: 1.5 }}>
              Ditt konto har inte behörighet att se några flikar i appen.
              Kontakta din administratör för att få åtkomst.
            </p>
          </div>
        ) : (
          <>
            {page === 'survey' && can('view_tab_survey') && (
              <SurveyPage key={refreshKey} activeCustomer={activeCustomer} />
            )}
            {page === 'report' && can('view_tab_report') && (
              <ReportPage key={refreshKey} activeCustomer={activeCustomer} />
            )}
            {page === 'settings' && can('view_tab_settings') && (
              <SettingsPage
                onSettingsChange={handleSettingsChange}
                onChainSelect={onChainChange}
                initialChains={allCustomers}
              />
            )}
            {page === 'admin' && can('view_tab_admin') && <AdminPage />}
          </>
        )}
      </main>
    </div>
  );
}

function App() {
  const [user, setUser]                     = useState(undefined);
  const [authLoading, setAuthLoading]       = useState(true);
  const [orgId, setOrgId]                   = useState(null);
  const [allOrgIds, setAllOrgIds]           = useState([]);
  const [activeCustomer, setActiveCustomer] = useState(null);
  const [allCustomers, setAllCustomers]     = useState([]);
  const debounceRef                         = useRef(null);
  const allOrgIdsRef                        = useRef([]);

  // Synka allOrgIds till ref så callbacks alltid har senaste värdet
  useEffect(() => { allOrgIdsRef.current = allOrgIds; }, [allOrgIds]);

  const loadActiveCustomer = useCallback(async (orgIds) => {
    const ids = Array.isArray(orgIds) ? orgIds : [orgIds].filter(Boolean);
    if (ids.length === 0) return;

    try {
      const customers = await getAssembledCustomers(ids);

      if (customers.length === 0) {
        const { getActiveCustomer } = await import('./utils/settings');
        setActiveCustomer(getActiveCustomer());
        return;
      }

      const activeId = getActiveChainId();
      const active   = customers.find(c => c.id === activeId) || customers[0];

      // Bevara activeTouchpointId — fallback till första touchpoint
      const localChains = JSON.parse(localStorage.getItem('npsCustomers') || '[]');
      const localChain  = localChains.find(c => c.id === active.id);
      active.activeTouchpointId =
        localChain?.activeTouchpointId || active.touchpoints?.[0]?.id || null;

      setAllCustomers(customers);
      setActiveCustomer(active);
    } catch (e) {
      console.error('[App] loadActiveCustomer:', e);
      const { getActiveCustomer } = await import('./utils/settings');
      setActiveCustomer(getActiveCustomer());
    }
  }, []);

  // Debounced refresh — slår ihop snabba anrop till ett Supabase-anrop
  const handleRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      loadActiveCustomer(allOrgIdsRef.current);
    }, 80);
  }, [loadActiveCustomer]);

  // Direkt kedjeyte från SettingsPage — sätter activeChainId + debounced reload
  const handleChainChange = useCallback((chainId) => {
    setActiveChainId(chainId);
    handleRefresh();
  }, [handleRefresh]);

  useEffect(() => {
    const { data: { subscription } } = onAuthStateChange(async (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);

      if (currentUser && !IS_INVITE_FLOW) {
        try {
          const { supabase } = await import('./utils/supabaseClient');

          const { data: memberships = [] } = await supabase
            .from('org_members')
            .select('organization_id')
            .eq('user_id', currentUser.id);

          const ids = memberships.map(m => m.organization_id);
          const primaryOrgId = ids[0] || null;

          setOrgId(primaryOrgId);
          setAllOrgIds(ids);
          allOrgIdsRef.current = ids;

          if (ids.length > 0) {
            await loadActiveCustomer(ids);
          } else {
            const { getActiveCustomer } = await import('./utils/settings');
            setActiveCustomer(getActiveCustomer());
          }
        } catch {
          const { getActiveCustomer } = await import('./utils/settings');
          setActiveCustomer(getActiveCustomer());
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [loadActiveCustomer]);

  if (authLoading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#f0f4f7',
        color: '#1e3a4f', fontSize: '1rem',
      }}>Laddar...</div>
    );
  }

  // Kiosk-läge — visa enkät direkt utan inloggning
  if (KIOSK_TOKEN) return <KioskPage accessToken={KIOSK_TOKEN} />;

  if (!user || IS_INVITE_FLOW) return <LoginPage />;

  return (
    <RoleProvider organizationId={orgId}>
      <AppInner
        user={user}
        activeCustomer={activeCustomer}
        allCustomers={allCustomers}
        onRefresh={handleRefresh}
        onChainChange={handleChainChange}
      />
    </RoleProvider>
  );
}

export default App;
