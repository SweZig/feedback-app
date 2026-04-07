import { useState, useEffect } from 'react';
import { getFilteredResponses, getResponsesByDateRange } from '../utils/storage';
import { supabase } from '../utils/supabaseClient';
import { calculateNps } from '../utils/npsCalculations';
import { exportCsv, exportExcel } from '../utils/export';
import { TYPE_LABELS } from '../utils/settings';
import CommentList from './CommentList';
import './ReportPage.css';

const TIME_FILTERS = [
  { label: '7 dagar', days: 7 },
  { label: '30 dagar', days: 30 },
  { label: '90 dagar', days: 90 },
  { label: 'Alla', days: null },
];

const DAYS = ['Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag', 'Söndag'];

const TIME_SLOTS = [
  { label: 'Morgon (–11)', from: 0, to: 11 },
  { label: 'Lunch (11–13)', from: 11, to: 13 },
  { label: 'Eftermiddag (13–17)', from: 13, to: 17 },
  { label: 'Kväll (17–)', from: 17, to: 24 },
];

function getHeatmapColor(nps) {
  if (nps === null) return { bg: '#f5f5f5', text: '#aaa' };
  if (nps >= 30) return { bg: '#27ae60', text: '#fff' };
  if (nps >= 0) return { bg: '#f1c40f', text: '#333' };
  return { bg: '#e74c3c', text: '#fff' };
}

function WeeklyHeatmap({ responses, touchpoints }) {
  // Only physical touchpoints
  const physicalTpIds = new Set(touchpoints.filter((t) => t.type === 'physical').map((t) => t.id));
  const physicalResponses = responses.filter((r) => physicalTpIds.has(r.touchpointId));

  if (physicalResponses.length === 0) {
    return <p className="report-empty-text">Inga svar från fysiska mätpunkter i vald period.</p>;
  }

  // Build matrix: day (0=Mon..6=Sun) x slot
  const matrix = Array.from({ length: 7 }, () =>
    Array.from({ length: 4 }, () => ({ scores: [] }))
  );

  physicalResponses.forEach((r) => {
    const d = new Date(r.timestamp);
    // getDay(): 0=Sun,1=Mon..6=Sat → map to 0=Mon..6=Sun
    const dayIdx = (d.getDay() + 6) % 7;
    const hour = d.getHours();
    let slotIdx = TIME_SLOTS.findIndex((s) => hour >= s.from && hour < s.to);
    if (slotIdx === -1) slotIdx = 3; // fallback to evening
    matrix[dayIdx][slotIdx].scores.push(r.score);
  });

  return (
    <div className="heatmap-wrap">
      <table className="heatmap-table">
        <thead>
          <tr>
            <th className="heatmap-th heatmap-th--day"></th>
            {TIME_SLOTS.map((s) => (
              <th key={s.label} className="heatmap-th">{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAYS.map((day, di) => (
            <tr key={day}>
              <td className="heatmap-day">{day}</td>
              {TIME_SLOTS.map((_, si) => {
                const cell = matrix[di][si];
                if (cell.scores.length === 0) {
                  return <td key={si} className="heatmap-cell heatmap-cell--empty">–</td>;
                }
                const result = calculateNps(cell.scores.map((score) => ({ score })));
                const nps = result ? result.nps : null;
                const { bg, text } = getHeatmapColor(nps);
                return (
                  <td key={si} className="heatmap-cell" style={{ background: bg, color: text }}>
                    <span className="heatmap-nps">{nps >= 0 ? '+' : ''}{nps}</span>
                    <span className="heatmap-count">{cell.scores.length}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="heatmap-legend">
        <span><span className="heatmap-dot" style={{ background: '#27ae60' }}></span>NPS ≥ 30</span>
        <span><span className="heatmap-dot" style={{ background: '#f1c40f' }}></span>NPS 0–29</span>
        <span><span className="heatmap-dot" style={{ background: '#e74c3c' }}></span>NPS &lt; 0</span>
        <span style={{ color: '#aaa' }}>– = inga svar</span>
      </div>
    </div>
  );
}

// NPS gauge SVG
function NpsGauge({ nps, total, periodLabel }) {
  const clampedNps = Math.max(-100, Math.min(100, nps));
  const angleDeg = 180 - ((clampedNps + 100) / 200) * 180;
  const angleRad = (angleDeg * Math.PI) / 180;
  const nx = 100 + 65 * Math.cos(angleRad);
  const ny = 100 - 65 * Math.sin(angleRad);
  const color = nps >= 30 ? '#27ae60' : nps >= 0 ? '#f39c12' : '#e74c3c';
  return (
    <div className="gauge-block">
      <svg viewBox="0 0 200 130" className="gauge-svg">
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#e0e0e0" strokeWidth="18" strokeLinecap="round"/>
        <path d="M 20 100 A 80 80 0 0 1 68 34" fill="none" stroke="#e74c3c" strokeWidth="18" strokeLinecap="round"/>
        <path d="M 68 34 A 80 80 0 0 1 120 20" fill="none" stroke="#f39c12" strokeWidth="18" strokeLinecap="round"/>
        <path d="M 120 20 A 80 80 0 0 1 180 100" fill="none" stroke="#27ae60" strokeWidth="18" strokeLinecap="round"/>
        <line x1="100" y1="100" x2={nx} y2={ny} stroke="#2c3e50" strokeWidth="2.5" strokeLinecap="round"/>
        <circle cx="100" cy="100" r="5" fill="#2c3e50"/>
        <text x="100" y="82" textAnchor="middle" fontSize="38" fontWeight="700" fill={color}>{nps >= 0 ? '+' : ''}{nps}</text>
        <text x="100" y="97" textAnchor="middle" fontSize="9" fill="#7f8c8d">NPS-poäng</text>
        <text x="14" y="118" textAnchor="middle" fontSize="9" fill="#e74c3c">-100</text>
        <text x="100" y="14" textAnchor="middle" fontSize="9" fill="#7f8c8d">0</text>
        <text x="186" y="118" textAnchor="middle" fontSize="9" fill="#27ae60">+100</text>
      </svg>
      {(total !== undefined || periodLabel) && (
        <div className="gauge-sub">
          {total !== undefined && <span className="gauge-sub-count">{total} svar</span>}
          {periodLabel && <span className="gauge-sub-period">{periodLabel}</span>}
        </div>
      )}
    </div>
  );
}

function DistBar({ det, pas, pro, detN, pasN, proN }) {
  return (
    <>
      <div className="dist-bar-row">
        {det > 0 && <div className="dist-seg dist-seg--det" style={{ width: `${det}%` }}>{det >= 10 ? `${det}%` : ''}</div>}
        {pas > 0 && <div className="dist-seg dist-seg--pas" style={{ width: `${pas}%` }}>{pas >= 10 ? `${pas}%` : ''}</div>}
        {pro > 0 && <div className="dist-seg dist-seg--pro" style={{ width: `${pro}%` }}>{pro >= 10 ? `${pro}%` : ''}</div>}
      </div>
      <div className="dist-legend">
        <span><span className="dist-dot dist-dot--det"/>Kritiker {detN} ({det}%)</span>
        <span><span className="dist-dot dist-dot--pas"/>Passiva {pasN} ({pas}%)</span>
        <span><span className="dist-dot dist-dot--pro"/>Ambassadörer {proN} ({pro}%)</span>
      </div>
    </>
  );
}

function TotalChainCard({ allResponses, periodLabel, title = 'Total Kedja' }) {
  const result = calculateNps(allResponses);
  return (
    <div className="report-card total-chain-card">
      <h3 className="total-chain-title">{title}</h3>
      {!result ? (
        <p className="report-empty-text">Inga svar under perioden.</p>
      ) : (
        <>
          <div className="total-chain-body">
            <NpsGauge nps={result.nps} total={result.total} periodLabel={periodLabel} />
            <div className="total-chain-dist">
              <DistBar
                det={result.percentages.detractor} pas={result.percentages.passive} pro={result.percentages.promoter}
                detN={result.counts.detractor} pasN={result.counts.passive} proN={result.counts.promoter}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function TouchpointsView({ touchpoints, departments, allResponses, periodLabel }) {
  if (!touchpoints.length) {
    return (
      <div className="report-card report-empty">
        <p>Inga mätpunkter konfigurerade för denna kedja.</p>
      </div>
    );
  }

  const deptMap = Object.fromEntries(departments.map((d) => [d.id, d]));
  const sorted = [...touchpoints].sort((a, b) => {
    const dA = deptMap[a.departmentId]?.order ?? 999;
    const dB = deptMap[b.departmentId]?.order ?? 999;
    return dA !== dB ? dA - dB : (a.order ?? 0) - (b.order ?? 0);
  });

  return (
    <>
      <TotalChainCard allResponses={allResponses} periodLabel={periodLabel} />
      <div className="tp-grid">
        {sorted.map((tp) => {
          const tpResponses = allResponses.filter((r) => r.touchpointId === tp.id);
          const result = calculateNps(tpResponses);
          const dept = deptMap[tp.departmentId];
          return (
            <div key={tp.id} className="report-card tp-card">
              <div className="tp-card-header">
                {dept && <span className="tp-card-dept">{dept.name}</span>}
                <h3 className="tp-card-name">{tp.name}</h3>
                <span className={`tp-card-type tp-card-type--${tp.type}`}>{TYPE_LABELS[tp.type]}</span>
              </div>
              {!result ? (
                <p className="report-empty-text">Inga svar under perioden.</p>
              ) : (
                <>
                  <NpsGauge nps={result.nps} total={result.total} periodLabel={periodLabel} />
                  <div style={{ marginTop: '0.75rem' }}>
                    <DistBar
                      det={result.percentages.detractor} pas={result.percentages.passive} pro={result.percentages.promoter}
                      detN={result.counts.detractor} pasN={result.counts.passive} proN={result.counts.promoter}
                    />
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

export default function ReportPage({ activeCustomer }) {
  const [filterDays, setFilterDays] = useState(null);
  const [dateRange, setDateRange] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [filterMode, setFilterMode] = useState('all');
  const [activeView, setActiveView] = useState('overview'); // 'overview' | 'weekly'
  const [focusImprovements, setFocusImprovements] = useState(false);
  const [supabaseResponses, setSupabaseResponses] = useState(null);

  const customerId = activeCustomer?.id || null;

  // Hämta svar direkt från Supabase till state.
  // activeCustomer laddas asynkront — useEffect körs när customerId sätts.
  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    supabase
      .from('responses')
      .select('*, response_answers(predefined_answer_id, predefined_answers(text)), response_comments(comment)')
      .eq('chain_id', customerId)
      .order('responded_at', { ascending: false })
      .then(({ data = [], error }) => {
        if (cancelled) return;
        if (error) { console.error('[ReportPage]', error.message); return; }
        const formatted = (data || []).map(r => ({
          id:               r.id,
          score:            r.score,
          comment:          r.response_comments?.[0]?.comment || '',
          predefinedAnswer: r.response_answers?.[0]?.predefined_answers?.text || '',
          customerId:       r.chain_id,
          touchpointId:     r.touchpoint_id,
          timestamp:        new Date(r.responded_at).getTime(),
          nps_category:     r.nps_category,
        }));
        setSupabaseResponses(formatted);
      });
    return () => { cancelled = true; };
  }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps
  const departments = activeCustomer?.departments || [];
  const touchpoints = activeCustomer?.touchpoints || [];
  const hasDepts = departments.length > 0;
  const hasPhysical = touchpoints.some((t) => t.type === 'physical');

  function resolveTouchpointIds(mode) {
    if (mode === 'all') return null;
    if (mode.startsWith('type:')) {
      const type = mode.slice(5);
      return touchpoints.filter((t) => t.type === type).map((t) => t.id);
    }
    if (mode.startsWith('dept:')) {
      const deptId = mode.slice(5);
      return touchpoints.filter((t) => t.departmentId === deptId).map((t) => t.id);
    }
    if (mode.startsWith('tp:')) return [mode.slice(3)];
    return null;
  }

  const touchpointIds = resolveTouchpointIds(filterMode);

  // Använd supabaseResponses (från Supabase) om tillgänglig,
  // annars fallback på localStorage direkt
  const responses = supabaseResponses !== null
    ? (dateRange
        ? supabaseResponses.filter(r => {
            const ts = r.timestamp;
            const fromTs = fromDate ? new Date(fromDate).getTime() : 0;
            const toTs = toDate ? new Date(toDate).getTime() + 86399999 : Infinity;
            const tpOk = touchpointIds === null || touchpointIds.includes(r.touchpointId);
            return ts >= fromTs && ts <= toTs && tpOk;
          })
        : supabaseResponses.filter(r => {
            const cutoff = filterDays ? Date.now() - filterDays * 86400000 : 0;
            const tpOk = touchpointIds === null || touchpointIds.includes(r.touchpointId);
            return r.timestamp >= cutoff && tpOk;
          }))
    : (dateRange
        ? getResponsesByDateRange(fromDate, toDate, customerId, touchpointIds)
        : getFilteredResponses(filterDays, customerId, touchpointIds));

  // For Mätpunkter view: date-filtered only, not tp-filtered
  const allResponses = supabaseResponses !== null
    ? (dateRange
        ? supabaseResponses.filter(r => {
            const fromTs = fromDate ? new Date(fromDate).getTime() : 0;
            const toTs = toDate ? new Date(toDate).getTime() + 86399999 : Infinity;
            return r.timestamp >= fromTs && r.timestamp <= toTs;
          })
        : supabaseResponses.filter(r => {
            const cutoff = filterDays ? Date.now() - filterDays * 86400000 : 0;
            return r.timestamp >= cutoff;
          }))
    : (dateRange
        ? getResponsesByDateRange(fromDate, toDate, customerId, null)
        : getFilteredResponses(filterDays, customerId, null));

  const result = calculateNps(responses);

  const typeStats = ['physical', 'online', 'other'].map((type) => {
    const tpIds = touchpoints.filter((t) => t.type === type).map((t) => t.id);
    if (!tpIds.length) return null;
    const r = calculateNps(responses.filter((res) => tpIds.includes(res.touchpointId)));
    if (!r) return null;
    return { type, ...r };
  }).filter(Boolean);

  const deptStats = departments.map((dept) => {
    const tpIds = touchpoints.filter((t) => t.departmentId === dept.id).map((t) => t.id);
    if (!tpIds.length) return null;
    const r = calculateNps(responses.filter((res) => tpIds.includes(res.touchpointId)));
    if (!r) return null;
    return { dept, ...r };
  }).filter(Boolean).sort((a, b) => b.nps - a.nps);

  const answerCounts = {};
  let freeTextCount = 0;
  responses.forEach((r) => {
    if (r.predefinedAnswer) answerCounts[r.predefinedAnswer] = (answerCounts[r.predefinedAnswer] || 0) + 1;
    if (r.comment?.trim()) freeTextCount++;
  });
  const answerEntries = Object.entries(answerCounts).sort((a, b) => b[1] - a[1]);

  // Build polarity map from all configs in activeCustomer
  const polarityMap = {};
  ['physicalConfig', 'onlineConfig', 'otherConfig'].forEach((key) => {
    (activeCustomer?.[key]?.predefinedAnswers || []).forEach((a) => {
      if (a && typeof a === 'object' && a.polarity) polarityMap[a.text] = a.polarity;
    });
  });
  (activeCustomer?.touchpoints || []).forEach((tp) => {
    (tp.configOverride?.predefinedAnswers || []).forEach((a) => {
      if (a && typeof a === 'object' && a.polarity) polarityMap[a.text] = a.polarity;
    });
  });

  function isPositiveAnswer(answer) {
    if (polarityMap[answer] === 'positive') return true;
    if (polarityMap[answer] === 'negative') return false;
    // Fallback: derive from data heuristically
    const pro = responses.filter((r) => r.predefinedAnswer === answer && r.score >= 9).length;
    const det = responses.filter((r) => r.predefinedAnswer === answer && r.score <= 6).length;
    return pro >= det;
  }

  // Filter comments based on focusImprovements toggle (scores 0–6)
  const commentResponses = focusImprovements
    ? responses.filter((r) => r.score <= 6)
    : responses;

  const selectValue = (filterMode.startsWith('dept:') || filterMode.startsWith('tp:')) ? filterMode : '';
  const periodLabel = dateRange
    ? (fromDate && toDate ? `${fromDate} – ${toDate}` : 'Datumintervall')
    : TIME_FILTERS.find((f) => f.days === filterDays)?.label || 'Alla';

  return (
    <div className="report">
      {activeCustomer && <h2 className="report-title">Rapport: {activeCustomer.name}</h2>}

      {/* View toggle */}
      <div className="report-view-tabs">
        <button
          className={`report-view-tab ${activeView === 'overview' ? 'report-view-tab--active' : ''}`}
          onClick={() => setActiveView('overview')}
        >Översikt</button>
        {hasPhysical && (
          <button
            className={`report-view-tab ${activeView === 'weekly' ? 'report-view-tab--active' : ''}`}
            onClick={() => setActiveView('weekly')}
          >Veckoanalys</button>
        )}
        {touchpoints.length > 0 && (
          <button
            className={`report-view-tab ${activeView === 'touchpoints' ? 'report-view-tab--active' : ''}`}
            onClick={() => setActiveView('touchpoints')}
          >Mätpunkter</button>
        )}
      </div>

      {/* Filters – only shown for Översikt (dept/tp drill-down) */}
      {hasDepts && activeView === 'overview' && (
        <div className="report-card">
          <select className="report-dept-select" value={selectValue}
            onChange={(e) => { setFilterMode(e.target.value || 'all'); }}
          >
            <option value="">— Filtrera på avdelning eller mätpunkt —</option>
            {departments.map((dept) => {
              const deptTps = touchpoints.filter((t) => t.departmentId === dept.id).sort((a, b) => a.order - b.order);
              if (!deptTps.length) return null;
              return (
                <optgroup key={dept.id} label={`${dept.name}${dept.uniqueCode ? ` (${dept.uniqueCode})` : ''}`}>
                  <option value={`dept:${dept.id}`}>Hela {dept.name}</option>
                  {deptTps.map((tp) => (
                    <option key={tp.id} value={`tp:${tp.id}`}>{'\u00a0\u00a0'}{tp.name}</option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </div>
      )}

      <div className="report-filters">
        {TIME_FILTERS.map((f) => (
          <button key={f.label}
            className={`filter-btn ${!dateRange && filterDays === f.days ? 'filter-btn--active' : ''}`}
            onClick={() => { setDateRange(false); setFilterDays(f.days); }}>{f.label}</button>
        ))}
        <button className={`filter-btn ${dateRange ? 'filter-btn--active' : ''}`}
          onClick={() => setDateRange(true)}>Datumintervall</button>
      </div>

      {dateRange && (
        <div className="date-range">
          <label className="date-range-field">Från <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></label>
          <label className="date-range-field">Till <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></label>
        </div>
      )}

      {/* ===== WEEKLY VIEW ===== */}
      {activeView === 'weekly' && (
        <>
          <TotalChainCard allResponses={allResponses} periodLabel={periodLabel} />
          <div className="report-card">
            <h3>Veckoanalys – fysiska mätpunkter</h3>
            <p className="report-card-desc">NPS-poäng per veckodag och tid. Siffrorna visar NPS och antal svar.</p>
            <WeeklyHeatmap responses={allResponses} touchpoints={touchpoints} />
          </div>
        </>
      )}

      {/* ===== MÄTPUNKTER VIEW ===== */}
      {activeView === 'touchpoints' && (
        <TouchpointsView
          touchpoints={touchpoints}
          departments={departments}
          allResponses={allResponses}
          periodLabel={periodLabel}
        />
      )}

      {/* ===== OVERVIEW ===== */}
      {activeView === 'overview' && (
        <>
          {!result ? (
            <div className="report-card report-empty">
              <p>Inga svar ännu{activeCustomer ? ` för ${activeCustomer.name}` : ''}.</p>
            </div>
          ) : (
            <>
              {/* Gauge */}
              <div className="report-card">
                <h3 className="total-chain-title">
                  {filterMode === 'all' ? 'Total Kedja' : 'Filtrerat urval'}
                </h3>
                <div className="total-chain-body">
                  <NpsGauge nps={result.nps} total={result.total} periodLabel={periodLabel} />
                  <div className="total-chain-dist">
                    <DistBar
                      det={result.percentages.detractor} pas={result.percentages.passive} pro={result.percentages.promoter}
                      detN={result.counts.detractor} pasN={result.counts.passive} proN={result.counts.promoter}
                    />
                  </div>
                </div>
              </div>

              {/* Per type */}
              {typeStats.length > 0 && (
                <div className="report-card">
                  <h3>Fördelning per typ</h3>
                  <div className="type-stats">
                    {typeStats.map(({ type, nps, total, percentages, counts }) => {
                      const c = nps >= 30 ? '#27ae60' : nps >= 0 ? '#f39c12' : '#e74c3c';
                      return (
                        <div key={type} className="type-stat-row">
                          <div className="type-stat-header">
                            <span className="type-stat-name">{TYPE_LABELS[type]}</span>
                            <span className="type-stat-nps" style={{ color: c }}>{nps >= 0 ? '+' : ''}{nps}</span>
                            <span className="type-stat-count">{total} svar</span>
                          </div>
                          <DistBar
                            det={percentages.detractor} pas={percentages.passive} pro={percentages.promoter}
                            detN={counts.detractor} pasN={counts.passive} proN={counts.promoter}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Answer summary */}
              {(answerEntries.length > 0 || freeTextCount > 0) && (
                <div className="report-card">
                  <h3>Svarsalternativ</h3>
                  <ul className="answer-summary">
                    {answerEntries.map(([answer, count]) => {
                      const pct = Math.round((count / result.total) * 100);
                      const positive = isPositiveAnswer(answer);
                      const barColor = positive ? '#27ae60' : '#e74c3c';
                      return (
                        <li key={answer} className="answer-summary-item">
                          <span className="answer-summary-label">{answer}</span>
                          <div className="answer-summary-bar-wrap">
                            <div className="answer-summary-bar" style={{ width: `${pct}%`, background: barColor }} />
                          </div>
                          <span className="answer-summary-pct" style={{ color: barColor }}>{pct}%</span>
                          <span className="answer-summary-count">{count}</span>
                        </li>
                      );
                    })}
                    {freeTextCount > 0 && (
                      <li className="answer-summary-item answer-summary-item--freetext">
                        <span className="answer-summary-label answer-summary-label--italic">Fritext</span>
                        <div className="answer-summary-bar-wrap">
                          <div className="answer-summary-bar" style={{ width: `${Math.round((freeTextCount / result.total) * 100)}%`, background: '#95a5a6' }} />
                        </div>
                        <span className="answer-summary-pct" style={{ color: '#7f8c8d' }}>{Math.round((freeTextCount / result.total) * 100)}%</span>
                        <span className="answer-summary-count">{freeTextCount}</span>
                      </li>
                    )}
                  </ul>
                </div>
              )}

              {/* Dept NPS */}
              {deptStats.length > 1 && (
                <div className="report-card">
                  <h3>NPS per avdelning</h3>
                  <div className="dept-nps-list">
                    {deptStats.map(({ dept, nps, total }) => {
                      const barWidth = Math.max(8, Math.round(((nps + 100) / 200) * 100));
                      const barColor = nps >= 30 ? '#27ae60' : nps >= 0 ? '#f39c12' : '#e74c3c';
                      return (
                        <div key={dept.id} className="dept-nps-row">
                          <span className="dept-nps-label">{dept.name}</span>
                          <div className="dept-nps-bar-wrap">
                            <div className="dept-nps-bar" style={{ width: `${barWidth}%`, background: barColor }}>
                              <span className="dept-nps-val">{nps >= 0 ? '+' : ''}{nps}</span>
                            </div>
                          </div>
                          <span className="dept-nps-count">{total} sv</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Comments */}
              <div className="report-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <button
                    className={`setting-switch ${focusImprovements ? 'setting-switch--on' : ''}`}
                    onClick={() => setFocusImprovements((f) => !f)}
                  >
                    <span className="setting-switch-knob" />
                  </button>
                  <span
                    style={{ fontSize: '0.85rem', color: 'var(--color-text-light)', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => setFocusImprovements((f) => !f)}
                  >
                    Fokusera enbart på förbättringsåtgärder
                  </span>
                </div>
                <CommentList responses={commentResponses} />
              </div>

              <div className="report-export">
                <button className="export-btn" onClick={() => exportCsv(responses)}>Exportera CSV</button>
                <button className="export-btn" onClick={() => exportExcel(responses)}>Exportera Excel</button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
