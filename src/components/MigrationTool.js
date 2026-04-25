// src/components/MigrationTool.js
import { useState, useEffect } from 'react';
import { getMigrationSummary, migrateToSupabase } from '../utils/migrateToSupabase';
import './MigrationTool.css';

const RLS_DISABLE_SQL = `ALTER TABLE organizations DISABLE ROW LEVEL SECURITY;
ALTER TABLE chains DISABLE ROW LEVEL SECURITY;
ALTER TABLE departments DISABLE ROW LEVEL SECURITY;
ALTER TABLE touchpoints DISABLE ROW LEVEL SECURITY;
ALTER TABLE responses DISABLE ROW LEVEL SECURITY;
ALTER TABLE response_comments DISABLE ROW LEVEL SECURITY;`;

const RLS_ENABLE_SQL = `ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chains ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE touchpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE response_comments ENABLE ROW LEVEL SECURITY;`;

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button className="migration-copy-btn" onClick={handleCopy}>
      {copied ? '✓ Kopierat' : 'Kopiera SQL'}
    </button>
  );
}

function SqlBlock({ label, sql }) {
  return (
    <div className="migration-sql-block">
      <div className="migration-sql-header">
        <span className="migration-sql-label">{label}</span>
        <CopyButton text={sql} />
      </div>
      <pre className="migration-sql-code">{sql}</pre>
    </div>
  );
}

function MigrationTool() {
  const [summary, setSummary]   = useState(null);
  const [status, setStatus]     = useState('idle'); // idle | running | done | error
  const [progress, setProgress] = useState({ msg: '', pct: 0 });
  const [result, setResult]     = useState(null);
  const [showRls, setShowRls]   = useState(false);

  useEffect(() => { setSummary(getMigrationSummary()); }, []);

  async function handleMigrate() {
    setStatus('running');
    setProgress({ msg: 'Startar...', pct: 0 });
    setResult(null);

    const res = await migrateToSupabase((msg, pct) => setProgress({ msg, pct }));
    setResult(res);
    setStatus(res.success ? 'done' : 'error');

    // Om RLS-fel, visa SQL-instruktioner automatiskt
    if (!res.success && res.errors[0]?.includes('RLS')) {
      setShowRls(true);
    }

    setSummary(getMigrationSummary());
  }

  if (!summary) return null;

  return (
    <div className="migration-tool">
      <h3 className="migration-title">Migrera till molnet</h3>
      <p className="migration-desc">
        Flytta all data från lokal lagring (localStorage) till Supabase-databasen.
        Befintlig data berörs inte — migreringsverktyget kopierar data, raderar ingenting.
      </p>

      {summary.alreadyDone && (
        <div className="migration-banner migration-banner--info">
          ✓ Migration genomförd {new Date(localStorage.getItem('migrated_at')).toLocaleString('sv-SE')}
        </div>
      )}

      <div className="migration-summary">
        <div className="migration-stat">
          <span className="migration-stat-value">{summary.chains}</span>
          <span className="migration-stat-label">Kedjor</span>
        </div>
        <div className="migration-stat">
          <span className="migration-stat-value">{summary.departments}</span>
          <span className="migration-stat-label">Avdelningar</span>
        </div>
        <div className="migration-stat">
          <span className="migration-stat-value">{summary.touchpoints}</span>
          <span className="migration-stat-label">Mätpunkter</span>
        </div>
        <div className="migration-stat">
          <span className="migration-stat-value">{summary.migratable}</span>
          <span className="migration-stat-label">Svar</span>
        </div>
        {summary.skipped > 0 && (
          <div className="migration-stat migration-stat--warn">
            <span className="migration-stat-value">{summary.skipped}</span>
            <span className="migration-stat-label">Hoppas över</span>
          </div>
        )}
      </div>

      {/* RLS-instruktioner */}
      <div className="migration-rls-toggle">
        <button className="migration-rls-btn" onClick={() => setShowRls(v => !v)}>
          {showRls ? '▲ Dölj SQL-instruktioner' : '▼ Visa SQL-instruktioner (kör i Supabase innan migration)'}
        </button>
      </div>

      {showRls && (
        <div className="migration-rls-panel">
          <p className="migration-rls-desc">
            Kör dessa SQL-kommandon i <strong>Supabase → SQL Editor</strong> innan och efter migration:
          </p>
          <SqlBlock label="1. Stäng av RLS (kör INNAN migration)" sql={RLS_DISABLE_SQL} />
          <SqlBlock label="2. Slå på RLS igen (kör EFTER migration)" sql={RLS_ENABLE_SQL} />
        </div>
      )}

      {status === 'idle' && (
        <button className="migration-btn" onClick={handleMigrate}>
          {summary.alreadyDone ? 'Kör migration igen' : 'Starta migration'}
        </button>
      )}

      {status === 'running' && (
        <div className="migration-progress">
          <div className="migration-progress-bar">
            <div className="migration-progress-fill" style={{ width: `${progress.pct}%` }} />
          </div>
          <p className="migration-progress-msg">{progress.msg}</p>
        </div>
      )}

      {status === 'done' && (
        <>
          <div className="migration-banner migration-banner--success">
            ✓ Migration klar! {result.migrated} svar migrerade.
            {result.skipped > 0 && ` ${result.skipped} svar hoppades över.`}
          </div>
          <div className="migration-banner migration-banner--warn">
            ⚠ Glöm inte att slå på RLS igen i Supabase SQL Editor!
          </div>
          <SqlBlock label="Slå på RLS igen" sql={RLS_ENABLE_SQL} />
          <button className="migration-btn migration-btn--ghost" onClick={() => setStatus('idle')}>
            Kör igen
          </button>
        </>
      )}

      {status === 'error' && result && (
        <>
          <div className="migration-banner migration-banner--error">
            <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>
              ⚠ {result.errors[0]}
            </p>
            {result.errors.length > 1 && (
              <ul className="migration-errors">
                {result.errors.slice(1, 6).map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
          </div>
          <button className="migration-btn migration-btn--ghost" onClick={() => setStatus('idle')}>
            Försök igen
          </button>
        </>
      )}
    </div>
  );
}

export default MigrationTool;
