import { useState, useEffect } from 'react';
import { supabase } from '../utils/supabaseClient';
import { fetchAllRows } from '../utils/fetchAllRows';
import { isDemographicallyUsable } from './DemographicsView';
import { getKioskStatuses, describeCamera } from '../utils/kioskHeartbeat';
import './CameraCoverage.css';

/**
 * CameraCoverage — Inställningar → Kameratäckning (Sprint A.12)
 *
 * Driftvy, inte kundvy. Visar hur stor andel av svaren som kameran lyckats
 * klassificera per mätpunkt, så att plattor som inte levererar går att peka ut
 * och ställa in. Demografi-fliken visar bara en sammanfattande rad — den här
 * nedbrytningen ska kunden inte se.
 */

const PERIODS = [
  { key: '30d', label: '30 dagar', days: 30 },
  { key: '90d', label: '90 dagar', days: 90 },
  { key: 'all', label: 'Alla',     days: null },
];

// Samma trösklar som underlagsraden i rapporten
function status(p) {
  if (p >= 65) return { color: '#27ae60', word: 'Bra' };
  if (p >= 55) return { color: '#f39c12', word: 'Ojämn' };
  if (p > 0)   return { color: '#e74c3c', word: 'Låg' };
  return { color: '#b8c5cf', word: 'Ingen' };
}

const fmt = n => n.toLocaleString('sv-SE');
const pct = (n, d = 0) => n.toFixed(d).replace('.', ',') + ' %';

function daysAgo(ts) {
  if (!ts) return null;
  return Math.floor((Date.now() - ts) / 86400000);
}

function lastSeenLabel(ts) {
  const d = daysAgo(ts);
  if (d === null) return 'aldrig';
  if (d === 0) return 'idag';
  if (d === 1) return 'igår';
  return `för ${d} dagar sedan`;
}

export default function CameraCoverage({ chain }) {
  const [period, setPeriod]     = useState('90d');
  const [rows, setRows]         = useState(undefined);
  const [error, setError]       = useState('');
  // Sprint A.14 — kamerans självrapporterade hälsa per platta
  const [health, setHealth]     = useState(() => new Map());

  const chainId = chain?.id || null;

  useEffect(() => {
    if (!chainId) { setRows([]); return; }
    let cancelled = false;
    setRows(undefined);
    setError('');

    // Pagineras — täckningsgraden räknas på hela historiken, inte på de
    // senaste tusen svaren.
    fetchAllRows(() =>
      supabase
        .from('responses')
        .select('touchpoint_id, responded_at, age_group, gender, raw_age, face_confidence, is_duplicate')
        .eq('chain_id', chainId)
        .order('responded_at', { ascending: false })
        .order('id', { ascending: false })
    )
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) { setError(err.message); setRows([]); return; }
        setRows((data || []).map(r => ({
          touchpointId:   r.touchpoint_id,
          timestamp:      new Date(r.responded_at).getTime(),
          ageGroup:       r.age_group || null,
          gender:         r.gender || null,
          rawAge:         typeof r.raw_age === 'number' ? r.raw_age : null,
          faceConfidence: typeof r.face_confidence === 'number' ? r.face_confidence : null,
          isDuplicate:    r.is_duplicate || false,
        })));
      });

    return () => { cancelled = true; };
  }, [chainId]);

  // Heartbeat-diagnostiken hämtas separat: den beskriver plattans NUVARANDE
  // tillstånd, medan täckningen ovan är historik. De besvarar olika frågor —
  // "fungerar kameran nu" respektive "har den fungerat".
  useEffect(() => {
    const ids = (chain?.touchpoints || [])
      .filter(t => t.type === 'physical')
      .map(t => t.id);
    if (!ids.length) { setHealth(new Map()); return; }
    let cancelled = false;
    getKioskStatuses(ids).then((m) => { if (!cancelled) setHealth(m); });
    return () => { cancelled = true; };
  }, [chain]);

  if (!chainId) {
    return <div className="settings-card"><h2>Kameratäckning</h2>
      <p className="settings-card-desc">Välj en kedja först.</p></div>;
  }
  if (rows === undefined) {
    return <div className="settings-card"><h2>Kameratäckning</h2>
      <p className="settings-card-desc">Hämtar svar…</p></div>;
  }

  const days = PERIODS.find(p => p.key === period)?.days;
  const from = days ? Date.now() - days * 86400000 : 0;
  const inPeriod = rows.filter(r => !r.isDuplicate && r.timestamp >= from);

  const departments = chain.departments || [];
  const touchpoints = chain.touchpoints || [];
  const deptById = {};
  departments.forEach(d => { deptById[d.id] = d; });

  // Bara fysiska mätpunkter har kamera. Övriga kan aldrig leverera demografi
  // och ska varken listas eller färgas röda.
  //
  // eNPS utesluts explicit: typen 'enps' finns i TYPE_LABELS, men mätpunkter
  // som skapades innan den typen infördes ligger kvar som 'physical' i
  // databasen. Namnkontrollen fångar dem tills de är omtypade vid källan.
  const isEnps = (tp) => {
    if (tp.type === 'enps') return true;
    const dept = tp.departmentId ? deptById[tp.departmentId] : null;
    return /enps/i.test(tp.name || '') || /enps/i.test(dept?.name || '');
  };

  const physical = touchpoints.filter(t => t.type === 'physical' && !isEnps(t));
  const excluded = touchpoints.length - physical.length;

  const list = physical.map((tp) => {
    const all  = inPeriod.filter(r => r.touchpointId === tp.id);
    const demo = all.filter(isDemographicallyUsable);
    const withRaw = demo.filter(r => r.rawAge !== null);
    const lastDemo = demo.length ? Math.max(...demo.map(r => r.timestamp)) : null;
    const lastAny  = all.length  ? Math.max(...all.map(r => r.timestamp))  : null;
    const dept = tp.departmentId ? deptById[tp.departmentId] : null;
    return {
      id: tp.id,
      dept: dept?.name || '—',
      code: dept?.uniqueCode || '',
      name: tp.name,
      total: all.length,
      demo: demo.length,
      withRaw: withRaw.length,
      p: all.length ? 100 * demo.length / all.length : 0,
      lastDemo, lastAny,
    };
  }).sort((a, b) => a.p - b.p || b.total - a.total); // sämst täckning först — det är dem du ska åtgärda

  const sumTotal   = list.reduce((a, r) => a + r.total, 0);
  const sumDemo    = list.reduce((a, r) => a + r.demo, 0);
  const sumWithRaw = list.reduce((a, r) => a + r.withRaw, 0);
  const noData     = list.filter(r => r.total > 0 && r.demo === 0).length;

  return (
    <div className="settings-card">
      <h2>Kameratäckning</h2>
      <p className="settings-card-desc">
        Andel av svaren där kameran lyckats klassificera besökaren, per fysisk mätpunkt.
        Sorterat med sämst täckning först. Den här vyn är intern — rapporten visar bara en
        sammanfattande rad.
        {excluded > 0 && (
          <> {excluded} {excluded === 1 ? 'mätpunkt' : 'mätpunkter'} utan kamera
          (online, övriga och eNPS) visas inte.</>
        )}
      </p>

      <div className="cc-periods">
        {PERIODS.map(p => (
          <button key={p.key}
            className={`settings-btn ${period === p.key ? 'settings-btn--primary' : ''}`}
            onClick={() => setPeriod(p.key)}>{p.label}</button>
        ))}
      </div>

      {error && <p className="cc-error">Kunde inte hämta svar: {error}</p>}

      <div className="cc-summary">
        <div className="cc-stat">
          <span className="cc-stat-label">Svar i perioden</span>
          <span className="cc-stat-value">{fmt(sumTotal)}</span>
        </div>
        <div className="cc-stat">
          <span className="cc-stat-label">Identifierade</span>
          <span className="cc-stat-value">
            {fmt(sumDemo)}
            <small>{sumTotal ? pct(100 * sumDemo / sumTotal) : '0 %'}</small>
          </span>
        </div>
        <div className="cc-stat">
          <span className="cc-stat-label">Med exakt ålder</span>
          <span className="cc-stat-value">
            {fmt(sumWithRaw)}
            <small>sedan A.12</small>
          </span>
        </div>
        <div className="cc-stat">
          <span className="cc-stat-label">Mätpunkter utan träff</span>
          <span className="cc-stat-value" style={{ color: noData ? '#e74c3c' : undefined }}>
            {noData}
            <small>av {list.length} fysiska</small>
          </span>
        </div>
      </div>

      {!list.length ? (
        <p className="settings-card-desc">Inga fysiska mätpunkter i den här kedjan.</p>
      ) : (
        <table className="cc-table">
          <thead>
            <tr>
              <th>Avdelning</th>
              <th>Mätpunkt</th>
              <th className="num">Svar</th>
              <th className="num">Identifierade</th>
              <th className="num">Täckning</th>
              <th>Senaste träff</th>
              <th>Kamerastatus</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const st = status(r.p);
              return (
                <tr key={r.id} className={r.total === 0 ? 'cc-row--idle' : ''}>
                  {/* Sprint A.14.1: ingen färgprick här. En rund prick i
                     Inställningar betyder alltid "hörs plattan av" (driftstatus
                     i Avdelningar). Täckningen bärs av stapeln och etiketten,
                     så samma form aldrig betyder två saker. */}
                  <td>
                    {r.dept}
                    {r.code && <span className="cc-code">{r.code}</span>}
                  </td>
                  <td className="cc-tp">{r.name}</td>
                  <td className="num">{fmt(r.total)}</td>
                  <td className="num">{fmt(r.demo)}</td>
                  <td className="num">
                    <div className="cc-bar"><i style={{ width: `${r.p.toFixed(1)}%`, background: st.color }} /></div>
                    <span className="cc-pct">{pct(r.p)} · {st.word}</span>
                  </td>
                  <td className={r.demo === 0 && r.total > 0 ? 'cc-never' : ''}>
                    {r.total === 0
                      ? <span className="cc-muted">inga svar</span>
                      : r.demo === 0
                        ? <span>aldrig — svar {lastSeenLabel(r.lastAny)}</span>
                        : lastSeenLabel(r.lastDemo)}
                  </td>
                  <td>
                    {(() => {
                      const cam = describeCamera(health.get(r.id));
                      if (!cam) return <span className="cc-muted">rapporterar inte än</span>;
                      return (
                        <span
                          className={cam.ok ? 'cc-cam cc-cam--ok' : 'cc-cam cc-cam--bad'}
                          title={`${cam.detail || cam.label}${cam.hint ? `\n${cam.hint}` : ''}`}
                        >
                          {cam.label}
                          {cam.detail && <span className="cc-cam-detail">{cam.detail}</span>}
                        </span>
                      );
                    })()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p className="cc-note">
        En mätpunkt med svar men noll identifierade betyder nästan alltid att kameran inte når
        besökaren: fel vinkel, för långt avstånd, eller en WebView äldre än Chromium 87 som inte
        kan köra modellen. Kolumnen «Senaste träff» skiljer en kamera som slutat leverera från en
        som aldrig gjort det.
      </p>
    </div>
  );
}
