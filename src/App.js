import { useState, useCallback } from 'react';
import { getActiveCustomer } from './utils/settings';
import Navigation from './components/Navigation';
import SurveyPage from './components/SurveyPage';
import ReportPage from './components/ReportPage';
import SettingsPage from './components/SettingsPage';
import './App.css';

function App() {
  const [page, setPage] = useState('survey');
  const [settingsVersion, setSettingsVersion] = useState(0);

  const activeCustomer = getActiveCustomer();

  const handleSettingsChange = useCallback(() => {
    setSettingsVersion((v) => v + 1);
  }, []);

  return (
    <div className="app">
      <Navigation
        currentPage={page}
        onNavigate={setPage}
        activeCustomer={activeCustomer}
      />
      <main className="app-main">
        {page === 'survey' && <SurveyPage activeCustomer={activeCustomer} />}
        {page === 'report' && <ReportPage activeCustomer={activeCustomer} />}
        {page === 'settings' && (
          <SettingsPage
            key={settingsVersion}
            onSettingsChange={handleSettingsChange}
          />
        )}
      </main>
    </div>
  );
}

export default App;
