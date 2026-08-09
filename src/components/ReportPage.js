import { useState, useEffect } from 'react';
import { supabase } from '../utils/supabaseClient';
import { calculateNps } from '../utils/npsCalculations';
import { exportCsv, exportExcel } from '../utils/export';
import { TYPE_LABELS } from '../utils/settings';
import CommentList from './CommentList';
import './ReportPage.css';

// Tidsfilter använder en `key` istället för rakt antal dagar, eftersom
// "Idag" och "Igår" är kalenderbaserade (midnatt-till-midnatt) och
// inte kan uttryckas som ett rullande N-dagars fönster.
const TIME_FILTERS = [
  { key: 'today',     label: 'Idag' },
  { key: 'yesterday', label: 'Igår' },
  { key: '7d',        label: '7 dagar',  days: 7 },
  { key: '14d',       label: '14 dagar', days: 14 },
  { key: '30d',       label: '30 dagar', days: 30 },
  { key: '90d',       label: '90 dagar', days: 90 },
  { key: 'all',       label: 'Alla' },
];

// Returnerar { from, to } i ms (epoch). `to` är exklusivt.
function getFilterRange(key) {
  if (key === 'today') {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return { from: start.getTime(), to: Infinity };
  }
  if (key === 'yesterday') {
    const start = new Date();
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { from: start.getTime(), to: end.getTime() };
  }
  const filter = TIME_FILTERS.find((f) => f.key === key);
  if (filter?.days) return { from: Date.now() - filter.days * 86400000, to: Infinity };
  return { from: 0, to: Infinity };
}

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

// Räknar NPS + andel kritiker från en scores-array (heltal 0–10)
function summarizeScores(scores) {
  if (!scores || scores.length === 0) return null;
  const result = calculateNps(scores.map((score) => ({ score })));
  if (!result) return null;
  const detractorPct = Math.round((result.counts.detractor / result.total) * 100);
  return { nps: result.nps, total: result.total, detractorPct };
}

// Färgskala för andel kritiker (challenges-läge)
function getDetractorColor(pct) {
  if (pct >= 30) return { bg: '#e74c3c', text: '#fff' };
  if (pct >= 15) return { bg: '#f1c40f', text: '#333' };
  return { bg: '#27ae60', text: '#fff' };
}

// ── Trend-stöd ────────────────────────────────────────────────────────────────
// ISO 8601-vecka (måndag–söndag). Returnerar { year, week } där `year` är ISO-
// veckans år (kan skilja sig från kalenderåret i januari/december).
function getIsoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week: weekNum };
}

const MONTH_LABELS_SV = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

// Gruppera svar i tidsfönster (dag / vecka / månad). Returnerar en sorterad
// lista av { key, label, nps, total, counts } där varje bucket motsvarar en
// period. Tomma perioder utelämnas — chartet visar bara de buckets där svar
// faktiskt finns.
function groupResponsesByBucket(responses, granularity) {
  const buckets = new Map();
  responses.forEach((r) => {
    const d = new Date(r.timestamp);
    let key, label, sortKey;

    if (granularity === 'day') {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      key = `${y}-${m}-${day}`;
      sortKey = key;
      label = `${day}/${m}`;
    } else if (granularity === 'week') {
      const { year, week } = getIsoWeek(d);
      key = `${year}-W${String(week).padStart(2, '0')}`;
      sortKey = key;
      label = `v${week}`;
    } else { // month
      const y = d.getFullYear();
      const m = d.getMonth();
      key = `${y}-${String(m + 1).padStart(2, '0')}`;
      sortKey = key;
      label = `${MONTH_LABELS_SV[m]} ${String(y).slice(-2)}`;
    }

    if (!buckets.has(key)) buckets.set(key, { key, label, sortKey, scores: [] });
    buckets.get(key).scores.push(r.score);
  });

  return [...buckets.values()]
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .map((b) => {
      const res = calculateNps(b.scores.map((s) => ({ score: s })));
      return {
        key: b.key,
        label: b.label,
        nps: res?.nps ?? 0,
        total: res?.total ?? 0,
        counts: res?.counts ?? { detractor: 0, passive: 0, promoter: 0 },
      };
    });
}

// ── Orsaks-lager (Sprint A.10) ──────────────────────────────────────────────
// Klassificerar ett predefinedAnswer till en driftorsak. Matchar på nyckelord
// (inte exakt sträng) eftersom kedjor kan ha egna configOverride-formuleringar:
// standard är "Det var för lång väntetid" men Webhallens export använder
// "För lång väntetid". Nyckelordsmatchning fångar båda.
function classifyReason(answer) {
  if (!answer) return null;
  const a = answer.toLowerCase();
  if (a.includes('väntetid')) return 'wait';
  if (a.includes('hjälp') || a.includes('service') || a.includes('bemöt')) return 'service';
  return null;
}

const REASON_MARKERS = {
  wait:    { symbol: '⏱', label: 'Lång väntetid' },
  service: { symbol: '●', label: 'Dåligt bemötande' },
};

// Genererar konkreta bemanningstips ur heatmap-matrisen. Returnerar en lista
// { level, text } där level styr färg ('action' | 'watch' | 'ok'). Tipsen
// bygger BARA på celler med tillräckligt underlag (minNForTip) så att en
// enstaka kritiker inte triggar en åtgärdsrekommendation. Håller sig medvetet
// försiktig: pekar ut var man ska titta närmare, inte statistiskt facit.
function buildStaffingTips(matrix, dayLabels, slotLabels, opts = {}) {
  const minNForTip = opts.minNForTip ?? 8;      // celler under detta = för tunt
  const detractorFloor = opts.detractorFloor ?? 18; // % kritiker för "hög"
  const waitCells = [];
  const serviceCells = [];

  matrix.forEach((row, di) => {
    row.forEach((cell, si) => {
      const n = cell.scores.length;
      if (n === 0) return;
      const det = cell.scores.filter((s) => s <= 6).length;
      const detPct = Math.round((det / n) * 100);
      const label = `${dayLabels[di].slice(0, 3).toLowerCase()} ${slotLabels[si].toLowerCase()}`;
      if (cell.waitCount > 0) {
        waitCells.push({ label, detPct, n, flags: cell.waitCount, strong: n >= minNForTip && detPct >= detractorFloor });
      }
      if (cell.serviceCount > 0) {
        serviceCells.push({ label, detPct, n, flags: cell.serviceCount });
      }
    });
  });

  const tips = [];

  // Väntetid: prioritera celler med flera flaggor ELLER hög kritikerandel + underlag
  const strongWait = waitCells.filter((c) => c.strong || c.flags >= 2)
    .sort((a, b) => (b.flags - a.flags) || (b.detPct - a.detPct));
  if (strongWait.length > 0) {
    const top = strongWait.slice(0, 2).map((c) => c.label).join(' och ');
    tips.push({
      level: 'action',
      text: `Förstärk bemanningen ${top} – återkommande signaler om lång väntetid.`,
    });
  } else if (waitCells.length > 0) {
    tips.push({
      level: 'watch',
      text: 'Spridda väntetidssignaler utan tydligt mönster – ingen bemanningsåtgärd motiverad ännu. Fortsätt mäta.',
    });
  }

  // Bemötande: bemanning löser sällan detta – flagga som coachning istället
  if (serviceCells.length >= 2) {
    const spots = serviceCells.slice(0, 2).map((c) => c.label).join(' och ');
    tips.push({
      level: 'watch',
      text: `Signaler om bemötande ${spots} – snarare coachning/kundmöte än fler i kassan.`,
    });
  } else if (serviceCells.length === 1) {
    tips.push({
      level: 'watch',
      text: `Enstaka signal om bemötande (${serviceCells[0].label}) – för tidigt att dra slutsats, håll koll.`,
    });
  }

  if (tips.length === 0) {
    tips.push({ level: 'ok', text: 'Inga väntetids- eller bemötandesignaler i vald period.' });
  }
  return tips;
}

// ── Drill-down-popup (Sprint A.11) ──────────────────────────────────────────
// Visar veckotrend för en specifik veckodag × tidsslot. Grupperar physical-
// svaren på ISO-vecka och visar en stapel per vecka de senaste `span` veckorna.
// Staplarnas höjd = antal svar, färg = NPS eller kritikerandel (följer cellens
// showChallenges-läge). Tomma veckor visas som bleka staplar så att glest
// underlag är synligt i stället för dolt bakom en jämn linje.
function DrillDownModal({ dayIdx, slotIdx, physicalResponses, showChallenges, span, onSpanChange, onClose }) {
  const slot = TIME_SLOTS[slotIdx];
  // Filtrera svar till vald veckodag + tidsslot
  const cellResponses = physicalResponses.filter((r) => {
    const d = new Date(r.timestamp);
    const di = (d.getDay() + 6) % 7;
    const hour = d.getHours();
    let si = TIME_SLOTS.findIndex((s) => hour >= s.from && hour < s.to);
    if (si === -1) si = 3;
    return di === dayIdx && si === slotIdx;
  });

  // Bygg lista av de senaste `span` ISO-veckorna (bakåt från nuvarande vecka),
  // även de utan svar, så tomma veckor syns.
  const now = new Date();
  const weeks = [];
  for (let i = span - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    const { year, week } = getIsoWeek(d);
    weeks.push({ year, week, key: `${year}-W${String(week).padStart(2, '0')}`, scores: [] });
  }
  const weekMap = new Map(weeks.map((w) => [w.key, w]));
  cellResponses.forEach((r) => {
    const d = new Date(r.timestamp);
    const { year, week } = getIsoWeek(d);
    const key = `${year}-W${String(week).padStart(2, '0')}`;
    const w = weekMap.get(key);
    if (w) w.scores.push(r.score);
  });

  // Per-vecka-värde beroende på läge
  const weekData = weeks.map((w) => {
    const s = summarizeScores(w.scores);
    return {
      week: w.week,
      n: w.scores.length,
      value: s ? (showChallenges ? s.detractorPct : s.nps) : null,
    };
  });

  const withData = weekData.filter((w) => w.n > 0);
  const totalN = weekData.reduce((sum, w) => sum + w.n, 0);
  const maxN = Math.max(...weekData.map((w) => w.n), 1);
  const avg = withData.length
    ? Math.round(withData.reduce((sum, w) => sum + w.value * w.n, 0) / withData.reduce((sum, w) => sum + w.n, 0))
    : null;

  function colorFor(v) {
    if (v === null) return '#eceff1';
    return showChallenges ? getDetractorColor(v).bg : getHeatmapColor(v).bg;
  }
  function fmt(v) {
    if (v === null) return '–';
    return showChallenges ? `${v}%` : `${v >= 0 ? '+' : ''}${v}`;
  }

  return (
    <div className="drill-overlay" onClick={onClose}>
      <div className="drill-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="drill-head">
          <div>
            <div className="drill-title">{DAYS[dayIdx]} · {slot.label}</div>
            <div className="drill-sub">
              Senaste {span} veckorna · {showChallenges ? 'kritikerandel' : 'NPS'} · fysiska mätpunkter
            </div>
          </div>
          <button className="drill-close" onClick={onClose} aria-label="Stäng">×</button>
        </div>

        <div className="drill-span">
          {[8, 12, 16].map((s) => (
            <button
              key={s}
              className={`drill-span-btn ${span === s ? 'drill-span-btn--active' : ''}`}
              onClick={() => onSpanChange(s)}
            >{s} v</button>
          ))}
        </div>

        <div className="drill-stats">
          <div className="drill-stat">
            <div className="drill-stat-label">Snitt</div>
            <div className="drill-stat-value" style={{ color: avg === null ? '#95a5a6' : colorFor(avg) }}>{fmt(avg)}</div>
          </div>
          <div className="drill-stat">
            <div className="drill-stat-label">Totalt svar</div>
            <div className="drill-stat-value">{totalN}</div>
          </div>
          <div className="drill-stat">
            <div className="drill-stat-label">Veckor m. svar</div>
            <div className="drill-stat-value">{withData.length}/{span}</div>
          </div>
        </div>

        <div className="drill-bars">
          {weekData.map((w, i) => {
            const h = w.n === 0 ? 3 : Math.round((w.n / maxN) * 64) + 8;
            return (
              <div key={i} className="drill-bar-col" title={`v${w.week}: ${w.n} svar${w.value !== null ? `, ${fmt(w.value)}` : ''}`}>
                <span className="drill-bar-val">{fmt(w.value)}</span>
                <div
                  className="drill-bar"
                  style={{ height: `${h}px`, background: colorFor(w.value), opacity: w.n === 0 ? 0.35 : 1 }}
                />
                <span className="drill-bar-week">v{w.week}</span>
              </div>
            );
          })}
        </div>

        <p className="drill-note">
          Staplarnas höjd = antal svar, färg = {showChallenges ? 'kritikerandel' : 'NPS'}. Blek stapel = vecka utan svar.
          En enskild cell har ofta få svar per vecka — läs trenden som riktning, inte exakt värde.
        </p>
      </div>
    </div>
  );
}

function WeeklyHeatmap({ responses, touchpoints }) {
  // Toggle: visa andel kritiker (0–6) istället för NPS-poäng
  const [showChallenges, setShowChallenges] = useState(() => {
    try { return localStorage.getItem('report_heatmap_challenges') === 'true'; } catch { return false; }
  });
  function toggleChallenges() {
    const next = !showChallenges;
    setShowChallenges(next);
    try { localStorage.setItem('report_heatmap_challenges', String(next)); } catch {}
  }

  // Toggle: visa orsaks-markörer (väntetid / bemötande) i cellerna
  const [showReasons, setShowReasons] = useState(() => {
    try { return localStorage.getItem('report_heatmap_reasons') === 'true'; } catch { return false; }
  });
  function toggleReasons() {
    const next = !showReasons;
    setShowReasons(next);
    try { localStorage.setItem('report_heatmap_reasons', String(next)); } catch {}
  }

  // Drill-down: vald cell (day/slot) för popup med veckotrend. null = stängd.
  const [drillCell, setDrillCell] = useState(null);
  // Veckospann för drill-down-popupen (8/12/16), sparas i localStorage.
  const [drillSpan, setDrillSpan] = useState(() => {
    try {
      const v = parseInt(localStorage.getItem('report_heatmap_drill_span'), 10);
      return [8, 12, 16].includes(v) ? v : 8;
    } catch { return 8; }
  });
  function setDrillSpanPersisted(span) {
    setDrillSpan(span);
    try { localStorage.setItem('report_heatmap_drill_span', String(span)); } catch {}
  }

  // Only physical touchpoints
  const physicalTpIds = new Set(touchpoints.filter((t) => t.type === 'physical').map((t) => t.id));
  const physicalResponses = responses.filter((r) => physicalTpIds.has(r.touchpointId));

  if (physicalResponses.length === 0) {
    return <p className="report-empty-text">Inga svar från fysiska mätpunkter i vald period.</p>;
  }

  // Build matrix: day (0=Mon..6=Sun) x slot. Varje cell räknar även orsaks-
  // flaggor (väntetid / bemötande) ur predefinedAnswer.
  const matrix = Array.from({ length: 7 }, () =>
    Array.from({ length: 4 }, () => ({ scores: [], waitCount: 0, serviceCount: 0 }))
  );

  physicalResponses.forEach((r) => {
    const d = new Date(r.timestamp);
    // getDay(): 0=Sun,1=Mon..6=Sat → map to 0=Mon..6=Sun
    const dayIdx = (d.getDay() + 6) % 7;
    const hour = d.getHours();
    let slotIdx = TIME_SLOTS.findIndex((s) => hour >= s.from && hour < s.to);
    if (slotIdx === -1) slotIdx = 3; // fallback to evening
    const cell = matrix[dayIdx][slotIdx];
    cell.scores.push(r.score);
    const reason = classifyReason(r.predefinedAnswer);
    if (reason === 'wait') cell.waitCount += 1;
    else if (reason === 'service') cell.serviceCount += 1;
  });

  const staffingTips = buildStaffingTips(
    matrix,
    DAYS,
    TIME_SLOTS.map((s) => s.label.replace(/\s*\(.*\)/, '')),
  );
  const totalWait = matrix.flat().reduce((sum, c) => sum + c.waitCount, 0);
  const totalService = matrix.flat().reduce((sum, c) => sum + c.serviceCount, 0);

  // Totals (NPS-viktade): rad per veckodag, kolumn per tidsslot, samt grand total
  const rowTotals = matrix.map((row) => summarizeScores(row.flatMap((c) => c.scores)));
  const colTotals = TIME_SLOTS.map((_, si) =>
    summarizeScores(matrix.flatMap((row) => row[si].scores))
  );
  const grandTotal = summarizeScores(physicalResponses.map((r) => r.score));

  // Hjälpare: format för cellens huvudvärde + färg
  function renderCellContent(summary) {
    if (!summary) return null;
    if (showChallenges) {
      return {
        main: `${summary.detractorPct}%`,
        count: summary.total,
        color: getDetractorColor(summary.detractorPct),
      };
    }
    return {
      main: `${summary.nps >= 0 ? '+' : ''}${summary.nps}`,
      count: summary.total,
      color: getHeatmapColor(summary.nps),
    };
  }

  // Diskret total-cell (ofärgad, mjukare typografi)
  function renderTotalCell(summary, key, extraStyle = {}) {
    if (!summary) {
      return (
        <td key={key} className="heatmap-cell heatmap-total-cell" style={{ background: '#fafafa', color: '#bbb', ...extraStyle }}>
          –
        </td>
      );
    }
    const mainValue = showChallenges
      ? `${summary.detractorPct}%`
      : `${summary.nps >= 0 ? '+' : ''}${summary.nps}`;
    return (
      <td
        key={key}
        className="heatmap-cell heatmap-total-cell"
        style={{
          background: '#fafafa',
          color: '#34495e',
          borderLeft: '2px solid #e0e0e0',
          ...extraStyle,
        }}
      >
        <span className="heatmap-nps" style={{ fontWeight: 600 }}>{mainValue}</span>
        <span className="heatmap-count" style={{ color: '#7f8c8d' }}>{summary.count ?? summary.total}</span>
      </td>
    );
  }

  return (
    <div className="heatmap-wrap">
      {/* Toggles: Visa var vi har utmaningar + Visa orsaker */}
      <div className="heatmap-toggles">
        <div className="heatmap-toggle">
          <button
            className={`setting-switch ${showChallenges ? 'setting-switch--on' : ''}`}
            onClick={toggleChallenges}
            aria-label="Visa var vi har utmaningar"
          >
            <span className="setting-switch-knob" />
          </button>
          <span className="heatmap-toggle-label" onClick={toggleChallenges}>Visa var vi har utmaningar</span>
        </div>
        <div className="heatmap-toggle">
          <button
            className={`setting-switch ${showReasons ? 'setting-switch--on' : ''}`}
            onClick={toggleReasons}
            aria-label="Visa orsaker"
          >
            <span className="setting-switch-knob" />
          </button>
          <span className="heatmap-toggle-label" onClick={toggleReasons}>Visa orsaker</span>
        </div>
      </div>

      <table className="heatmap-table">
        <thead>
          <tr>
            <th className="heatmap-th heatmap-th--day"></th>
            {TIME_SLOTS.map((s) => (
              <th key={s.label} className="heatmap-th">{s.label}</th>
            ))}
            <th
              className="heatmap-th"
              style={{ borderLeft: '2px solid #e0e0e0', color: '#7f8c8d', fontWeight: 600 }}
            >
              Total
            </th>
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
                const summary = summarizeScores(cell.scores);
                const content = renderCellContent(summary);
                const markers = showReasons
                  ? REASON_MARKERS.wait.symbol.repeat(Math.min(cell.waitCount, 3))
                    + REASON_MARKERS.service.symbol.repeat(Math.min(cell.serviceCount, 2))
                  : '';
                return (
                  <td
                    key={si}
                    className="heatmap-cell heatmap-cell--clickable"
                    style={{ background: content.color.bg, color: content.color.text }}
                    onClick={() => setDrillCell({ day: di, slot: si })}
                    role="button"
                    tabIndex={0}
                    title={`${DAYS[di]} ${TIME_SLOTS[si].label} – klicka för veckotrend`}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDrillCell({ day: di, slot: si }); } }}
                  >
                    {markers && (
                      <span
                        className="heatmap-markers"
                        title={`${cell.waitCount ? `${cell.waitCount}× lång väntetid` : ''}${cell.waitCount && cell.serviceCount ? ', ' : ''}${cell.serviceCount ? `${cell.serviceCount}× bemötande` : ''}`}
                      >{markers}</span>
                    )}
                    <span className="heatmap-nps">{content.main}</span>
                    <span className="heatmap-count">{content.count}</span>
                  </td>
                );
              })}
              {renderTotalCell(rowTotals[di], `rowtot-${di}`)}
            </tr>
          ))}
          {/* Kolumn-totaler (diskret rad längst ned) */}
          <tr>
            <td
              className="heatmap-day"
              style={{ borderTop: '2px solid #e0e0e0', color: '#7f8c8d', fontWeight: 600 }}
            >
              Total
            </td>
            {colTotals.map((ct, si) =>
              renderTotalCell(ct, `coltot-${si}`, { borderTop: '2px solid #e0e0e0', borderLeft: 'none' })
            )}
            {renderTotalCell(grandTotal, 'grandtot', {
              borderTop: '2px solid #e0e0e0',
              borderLeft: '2px solid #e0e0e0',
              background: '#f4f4f4',
            })}
          </tr>
        </tbody>
      </table>

      <div className="heatmap-legend">
        {showChallenges ? (
          <>
            <span><span className="heatmap-dot" style={{ background: '#27ae60' }}></span>Kritiker &lt; 15%</span>
            <span><span className="heatmap-dot" style={{ background: '#f1c40f' }}></span>Kritiker 15–29%</span>
            <span><span className="heatmap-dot" style={{ background: '#e74c3c' }}></span>Kritiker ≥ 30%</span>
            <span style={{ color: '#aaa' }}>– = inga svar</span>
            <span style={{ color: '#7f8c8d', fontStyle: 'italic' }}>Visar andel kritiker (0–6)</span>
          </>
        ) : (
          <>
            <span><span className="heatmap-dot" style={{ background: '#27ae60' }}></span>NPS ≥ 30</span>
            <span><span className="heatmap-dot" style={{ background: '#f1c40f' }}></span>NPS 0–29</span>
            <span><span className="heatmap-dot" style={{ background: '#e74c3c' }}></span>NPS &lt; 0</span>
            <span style={{ color: '#aaa' }}>– = inga svar</span>
          </>
        )}
        {showReasons && (
          <>
            <span><span className="heatmap-marker-key">{REASON_MARKERS.wait.symbol}</span>{REASON_MARKERS.wait.label}</span>
            <span><span className="heatmap-marker-key">{REASON_MARKERS.service.symbol}</span>{REASON_MARKERS.service.label}</span>
          </>
        )}
      </div>

      {/* Bemanningstips – genereras ur orsaks-lagret */}
      <div className="staffing-tips">
        <div className="staffing-tips-head">
          <span className="staffing-tips-title">Bemanningstips</span>
          <span className="staffing-tips-meta">
            {totalWait} väntetid · {totalService} bemötande
          </span>
        </div>
        {staffingTips.map((tip, i) => (
          <div key={i} className={`staffing-tip staffing-tip--${tip.level}`}>
            <span className="staffing-tip-icon">
              {tip.level === 'action' ? '▲' : tip.level === 'watch' ? '►' : '✓'}
            </span>
            <span>{tip.text}</span>
          </div>
        ))}
        <p className="staffing-tips-note">
          Tipsen bygger på fördjupningssvar (skäl) som bara samlas in från en del av
          kritikerna. Läs dem som «var ska vi titta närmare», inte som statistiskt facit.
        </p>
      </div>

      {drillCell && (
        <DrillDownModal
          dayIdx={drillCell.day}
          slotIdx={drillCell.slot}
          physicalResponses={physicalResponses}
          showChallenges={showChallenges}
          span={drillSpan}
          onSpanChange={setDrillSpanPersisted}
          onClose={() => setDrillCell(null)}
        />
      )}
    </div>
  );
}

// NPS gauge SVG
// ── Trend-vy ───────────────────────────────────────────────────────────────
// Visar NPS över tid med toggle dag / vecka / månad. Återanvänder samma
// avdelnings-/mätpunktsfilter och datumintervall som Översikt och Veckoanalys.
// Datakälla: dubblettrensade svar (npsResponses) för konsistens med övriga
// flikar.
function TrendView({ responses, periodLabel }) {
  const [granularity, setGranularity] = useState(() => {
    try { return localStorage.getItem('report_trend_granularity') || 'day'; } catch { return 'day'; }
  });
  function pickGranularity(g) {
    setGranularity(g);
    try { localStorage.setItem('report_trend_granularity', g); } catch {}
  }

  const buckets = groupResponsesByBucket(responses, granularity);

  const GRAN_OPTIONS = [
    { key: 'day',   label: 'Dag' },
    { key: 'week',  label: 'Vecka' },
    { key: 'month', label: 'Månad' },
  ];

  // Chart-geometri. Vi använder fixerad bar-bredd och låter SVG:n växa
  // horisontellt — wrapper-div har overflow-x:auto så långa serier scrollar.
  const chartHeight   = 240;
  const barMaxHeight  = chartHeight / 2 - 12;
  const barWidth      = 34;
  const barGap        = 10;
  const leftPad       = 42;
  const rightPad      = 16;
  const labelRowHeight = 38;
  const totalHeight   = chartHeight + labelRowHeight;
  const chartWidth    = Math.max(640, leftPad + rightPad + buckets.length * (barWidth + barGap));
  const zeroY         = chartHeight / 2;

  function npsColor(nps) {
    if (nps >= 30) return '#27ae60';
    if (nps >= 0)  return '#f39c12';
    return '#e74c3c';
  }

  // Totalsumma för perioden — visas som en liten sammanfattning.
  const periodTotal = calculateNps(responses.map((r) => ({ score: r.score })));

  return (
    <div className="report-card">
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '0.5rem',
        flexWrap: 'wrap',
        gap: '0.75rem',
      }}>
        <h3 style={{ margin: 0 }}>NPS-trend</h3>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          {GRAN_OPTIONS.map((g) => (
            <button
              key={g.key}
              className={`filter-btn ${granularity === g.key ? 'filter-btn--active' : ''}`}
              onClick={() => pickGranularity(g.key)}
            >{g.label}</button>
          ))}
        </div>
      </div>
      <p className="report-card-desc">
        NPS-poäng grupperat per {granularity === 'day' ? 'dag' : granularity === 'week' ? 'ISO-vecka (mån–sön)' : 'månad'}.
        Period: {periodLabel}{periodTotal ? `, ${periodTotal.total} svar totalt.` : '.'}
      </p>

      {buckets.length === 0 ? (
        <p className="report-empty-text">Inga svar att gruppera i vald period.</p>
      ) : (
        <>
          <div style={{ overflowX: 'auto', overflowY: 'hidden' }}>
            <svg
              viewBox={`0 0 ${chartWidth} ${totalHeight}`}
              style={{ minWidth: chartWidth, height: totalHeight, display: 'block' }}
              role="img"
              aria-label="NPS-trend"
            >
              {/* Y-axel-rutnät */}
              {[100, 50, 0, -50, -100].map((v) => {
                const y = zeroY - (v / 100) * barMaxHeight;
                const isZero = v === 0;
                return (
                  <g key={v}>
                    <line
                      x1={leftPad} x2={chartWidth - rightPad}
                      y1={y} y2={y}
                      stroke={isZero ? '#7f8c8d' : '#e8eaed'}
                      strokeWidth={isZero ? 1.25 : 1}
                      strokeDasharray={isZero ? 'none' : '3,3'}
                    />
                    <text
                      x={leftPad - 6} y={y + 3}
                      textAnchor="end" fontSize="9" fill="#7f8c8d"
                    >{v >= 0 ? '+' : ''}{v}</text>
                  </g>
                );
              })}

              {/* Stapelserie */}
              {buckets.map((b, i) => {
                const cx = leftPad + i * (barWidth + barGap) + barWidth / 2;
                const x  = cx - barWidth / 2;
                const h  = Math.max(2, Math.abs(b.nps) / 100 * barMaxHeight);
                const y  = b.nps >= 0 ? zeroY - h : zeroY;
                const color = npsColor(b.nps);
                const valueY = b.nps >= 0 ? y - 4 : y + h + 11;
                return (
                  <g key={b.key}>
                    <rect
                      x={x} y={y}
                      width={barWidth} height={h}
                      fill={color}
                      rx={3}
                    >
                      <title>
                        {b.label} · NPS {b.nps >= 0 ? '+' : ''}{b.nps} · {b.total} svar
                        {`\nKritiker ${b.counts.detractor}  Passiva ${b.counts.passive}  Ambassadörer ${b.counts.promoter}`}
                      </title>
                    </rect>
                    {/* NPS-värde ovanför/under stapeln */}
                    <text
                      x={cx} y={valueY}
                      textAnchor="middle"
                      fontSize="10" fontWeight="600"
                      fill={color}
                    >{b.nps >= 0 ? '+' : ''}{b.nps}</text>
                    {/* X-label */}
                    <text
                      x={cx} y={chartHeight + 16}
                      textAnchor="middle"
                      fontSize="10" fill="#7f8c8d"
                    >{b.label}</text>
                    {/* Antal svar */}
                    <text
                      x={cx} y={chartHeight + 30}
                      textAnchor="middle"
                      fontSize="9" fill="#bdc3c7"
                    >{b.total} sv</text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div style={{
            display: 'flex',
            gap: '1rem',
            flexWrap: 'wrap',
            marginTop: '0.5rem',
            fontSize: '0.78rem',
            color: '#7f8c8d',
          }}>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#27ae60', borderRadius: 2, verticalAlign: 'middle', marginRight: 4 }} />NPS ≥ 30</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#f39c12', borderRadius: 2, verticalAlign: 'middle', marginRight: 4 }} />NPS 0–29</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#e74c3c', borderRadius: 2, verticalAlign: 'middle', marginRight: 4 }} />NPS &lt; 0</span>
            <span style={{ fontStyle: 'italic' }}>Hovra över en stapel för fördelning.</span>
          </div>
        </>
      )}
    </div>
  );
}

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


// ── Demografi Beta ─────────────────────────────────────────────────────────────
function DemographicsCard({ responses, duplicateCount }) {
  const [selectedGender, setSelectedGender] = useState(null);

  const withDemo = responses.filter(r => r.ageGroup || r.gender);
  const total = withDemo.length;
  const overallTotal = responses.length;
  const coveragePct = overallTotal > 0
    ? ((total / overallTotal) * 100).toFixed(1).replace('.', ',')
    : '0,0';

  if (total === 0) {
    return (
      <div className="report-card demo-card">
        <div className="demo-header">
          <h3>Demografi <span className="demo-beta-badge">Beta</span></h3>
        </div>
        <p className="report-empty-text">Inga demografidata ännu — kräver kamera på kiosk-enheter.</p>
      </div>
    );
  }

  // Åldersgrupperna filtreras på valt kön om något är valt
  const ageGroupSource = selectedGender
    ? withDemo.filter(r => r.gender === selectedGender)
    : withDemo;
  const ageTotal = ageGroupSource.length;

  function groupStats(source, sourceTotal, key, groups) {
    return groups.map(g => {
      const group = source.filter(r => r[key] === g.value);
      const npsResult = calculateNps(group);
      return {
        value: g.value,
        label: g.label,
        count: group.length,
        pct: sourceTotal > 0 ? Math.round((group.length / sourceTotal) * 100) : 0,
        nps: npsResult?.nps ?? null,
      };
    }).filter(g => g.count > 0);
  }

  const genderGroups = groupStats(withDemo, total, 'gender', [
    { value: 'man',    label: 'Man' },
    { value: 'kvinna', label: 'Kvinna' },
    { value: 'okänt',  label: 'Okänt kön' },
  ]);

  const ageGroups = groupStats(ageGroupSource, ageTotal, 'ageGroup', [
    { value: 'barn',   label: 'Barn (<13)' },
    { value: 'ungdom', label: 'Ungdom (13–25)' },
    { value: 'vuxen',  label: 'Vuxen (26–60)' },
    { value: 'äldre',  label: 'Äldre (>60)' },
  ]);

  const selectedGenderLabel = genderGroups.find(g => g.value === selectedGender)?.label;

  function NpsChip({ nps }) {
    if (nps === null) return null;
    const color = nps >= 30 ? '#27ae60' : nps >= 0 ? '#f39c12' : '#e74c3c';
    return <span className="demo-nps-chip" style={{ background: color }}>{nps >= 0 ? '+' : ''}{nps}</span>;
  }

  function DemoGroup({ title, groups, onSelect, activeValue, hint }) {
    const clickable = !!onSelect;
    return (
      <div className="demo-group">
        <h4 className="demo-group-title">
          {title}
          {hint && <span className="demo-group-hint">{hint}</span>}
        </h4>
        {groups.map(g => {
          const isActive = activeValue === g.value;
          return (
            <div
              key={g.label}
              className={
                'demo-row' +
                (clickable ? ' demo-row--clickable' : '') +
                (isActive  ? ' demo-row--active'    : '')
              }
              onClick={clickable ? () => onSelect(isActive ? null : g.value) : undefined}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              onKeyDown={clickable ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(isActive ? null : g.value);
                }
              } : undefined}
              title={
                clickable
                  ? (isActive ? 'Klicka för att rensa filter' : `Filtrera åldersgrupp på ${g.label}`)
                  : undefined
              }
            >
              <span className="demo-row-label">{g.label}</span>
              <div className="demo-bar-wrap">
                <div className="demo-bar" style={{ width: `${g.pct}%` }} />
              </div>
              <span className="demo-row-pct">{g.pct}%</span>
              <span className="demo-row-count">{g.count} sv</span>
              <NpsChip nps={g.nps} />
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="report-card demo-card">
      <div className="demo-header">
        <h3>Demografi <span className="demo-beta-badge">Beta</span></h3>
        <span className="demo-coverage">
          {total} av {overallTotal} svar med demografidata ({coveragePct}%)
        </span>
      </div>
      {duplicateCount > 0 && (
        <p className="demo-duplicate-info">ℹ️ {duplicateCount} dubblettsvar filtrerade från NPS-beräkningar.</p>
      )}
      <div className="demo-groups">
        <DemoGroup
          title="Kön"
          groups={genderGroups}
          onSelect={setSelectedGender}
          activeValue={selectedGender}
          hint={selectedGender ? ' — klicka igen för att rensa' : ' — klicka för att filtrera ålder'}
        />
        <DemoGroup
          title="Åldersgrupp"
          groups={ageGroups}
          hint={selectedGenderLabel ? ` — filtrerat på ${selectedGenderLabel} (${ageTotal} svar)` : null}
        />
      </div>
    </div>
  );
}

export default function ReportPage({ activeCustomer }) {
  const [filterKey, setFilterKey] = useState('all');
  const [dateRange, setDateRange] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [filterMode, setFilterMode] = useState('all');
  const [activeView, setActiveView] = useState('overview'); // 'overview' | 'weekly' | 'trend' | 'touchpoints'
  const [focusImprovements, setFocusImprovements] = useState(false);
  const [showDemographics, setShowDemographics] = useState(() => {
    try { return localStorage.getItem('report_show_demographics') === 'true'; } catch { return false; }
  });
  const [supabaseResponses, setSupabaseResponses] = useState(undefined);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const customerId = activeCustomer?.id || null;

  // Auto-poll var 60:e sekund
  useEffect(() => {
    const interval = setInterval(() => setRefreshKey(k => k + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  // Hämta svar direkt från Supabase till state.
  // activeCustomer laddas asynkront — useEffect körs när customerId sätts.
  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    supabase
      .from('responses')
      .select('*, response_answers(answer_text), response_comments(comment)')
      .eq('chain_id', customerId)
      .order('responded_at', { ascending: false })
      .then(({ data = [], error }) => {
        if (cancelled) return;
        if (error) { console.error('[ReportPage]', error.message); return; }
        const formatted = (data || []).map(r => ({
          id:               r.id,
          score:            r.score,
          comment:          (Array.isArray(r.response_comments) ? r.response_comments[0]?.comment : r.response_comments?.comment) || '',
          predefinedAnswer: r.response_answers?.[0]?.answer_text || '',
          customerId:       r.chain_id,
          touchpointId:     r.touchpoint_id,
          timestamp:        new Date(r.responded_at).getTime(),
          followUpEmail:    r.metadata?.followUpEmail || '',
          nps_category:     r.nps_category,
          ageGroup:         r.age_group   || null,
          gender:           r.gender      || null,
          isDuplicate:      r.is_duplicate || false,
        }));
        setSupabaseResponses(formatted);
        setIsRefreshing(false);
      });
    return () => { cancelled = true; };
  }, [customerId, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
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

  // Supabase är ensam källa. Innan första fetchen är klar är supabaseResponses
  // `undefined` — då blir filtreringen tom (rapporten visar 0 svar i ~100ms).
  const responseList = supabaseResponses || [];

  // Beräkna tidsfönster en gång per render baserat på valt preset.
  const range = getFilterRange(filterKey);

  const responses = dateRange
    ? responseList.filter(r => {
        const ts = r.timestamp;
        const fromTs = fromDate ? new Date(fromDate).getTime() : 0;
        const toTs = toDate ? new Date(toDate).getTime() + 86399999 : Infinity;
        const tpOk = touchpointIds === null || touchpointIds.includes(r.touchpointId);
        return ts >= fromTs && ts <= toTs && tpOk;
      })
    : responseList.filter(r => {
        const tpOk = touchpointIds === null || touchpointIds.includes(r.touchpointId);
        return r.timestamp >= range.from && r.timestamp < range.to && tpOk;
      });

  // För Mätpunkter-vyn: datumfiltrerat men inte tp-filtrerat.
  // Filtrera bort dubbletter direkt så att Översikt, Veckoanalys och
  // Mätpunkter alla redovisar samma antal svar (annars syns "53" i
  // Översikt och "54" i Veckoanalys/Mätpunkter när 1 dubblett finns).
  const allResponses = (dateRange
    ? responseList.filter(r => {
        const fromTs = fromDate ? new Date(fromDate).getTime() : 0;
        const toTs = toDate ? new Date(toDate).getTime() + 86399999 : Infinity;
        return r.timestamp >= fromTs && r.timestamp <= toTs;
      })
    : responseList.filter(r => r.timestamp >= range.from && r.timestamp < range.to)
  ).filter(r => !r.isDuplicate);

  // Filtrera bort dubbletter från NPS-beräkningar
  const npsResponses = responses.filter(r => !r.isDuplicate);
  const duplicateCount = responses.filter(r => r.isDuplicate).length;
  const result = calculateNps(npsResponses);

  const typeStats = ['physical', 'online', 'other'].map((type) => {
    const tpIds = touchpoints.filter((t) => t.type === type).map((t) => t.id);
    if (!tpIds.length) return null;
    const r = calculateNps(npsResponses.filter((res) => tpIds.includes(res.touchpointId)));
    if (!r) return null;
    return { type, ...r };
  }).filter(Boolean);

  const deptStats = departments.map((dept) => {
    const tpIds = touchpoints.filter((t) => t.departmentId === dept.id).map((t) => t.id);
    if (!tpIds.length) return null;
    const r = calculateNps(npsResponses.filter((res) => tpIds.includes(res.touchpointId)));
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
    : TIME_FILTERS.find((f) => f.key === filterKey)?.label || 'Alla';

  // Filterdropdownen visas på Översikt, Veckoanalys och Trend (men inte på
  // Mätpunkter — där är hela poängen att se alla mätpunkter parallellt).
  const showDeptFilter = hasDepts && (activeView === 'overview' || activeView === 'weekly' || activeView === 'trend');

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
        <button
          className={`report-view-tab ${activeView === 'trend' ? 'report-view-tab--active' : ''}`}
          onClick={() => setActiveView('trend')}
        >Trend</button>
        {touchpoints.length > 0 && (
          <button
            className={`report-view-tab ${activeView === 'touchpoints' ? 'report-view-tab--active' : ''}`}
            onClick={() => setActiveView('touchpoints')}
          >Mätpunkter</button>
        )}
      </div>

      {/* Filter på avdelning / mätpunkt — visas för Översikt och Veckoanalys */}
      {showDeptFilter && (
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
          <button key={f.key}
            className={`filter-btn ${!dateRange && filterKey === f.key ? 'filter-btn--active' : ''}`}
            onClick={() => { setDateRange(false); setFilterKey(f.key); }}>{f.label}</button>
        ))}
        <button
          className="filter-btn filter-btn--refresh"
          onClick={() => { setIsRefreshing(true); setRefreshKey(k => k + 1); }}
          title="Hämta nya svar"
        >{isRefreshing ? '⟳ Hämtar...' : '⟳ Uppdatera'}</button>
        <button className={`filter-btn ${dateRange ? 'filter-btn--active' : ''}`}
          onClick={() => setDateRange(true)}>Datumintervall</button>
      </div>

      {dateRange && (
        <div className="date-range">
          <label className="date-range-field">Från <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></label>
          <label className="date-range-field">Till <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></label>
        </div>
      )}

      {/* ===== WEEKLY VIEW =====
         Använder npsResponses (tp-filtrerat + dubblettrensat) så att
         filtervalet på avdelning/mätpunkt faktiskt påverkar både
         TotalChainCard och heatmap, och så att antalet svar synkar
         med Översikt. */}
      {activeView === 'weekly' && (
        <>
          <TotalChainCard
            allResponses={npsResponses}
            periodLabel={periodLabel}
            title={filterMode === 'all' ? 'Total Kedja' : 'Filtrerat urval'}
          />
          <div className="report-card">
            <h3>Veckoanalys – fysiska mätpunkter</h3>
            <p className="report-card-desc">NPS-poäng per veckodag och tid. Siffrorna visar NPS och antal svar. Slå på «Visa orsaker» för väntetids- och bemötandesignaler samt bemanningstips.</p>
            <WeeklyHeatmap responses={npsResponses} touchpoints={touchpoints} />
          </div>
        </>
      )}

      {/* ===== TREND VIEW =====
         Visar NPS över tid med toggle dag/vecka/månad. Använder npsResponses
         (tp-filtrerat + dubblettrensat) så att filterval och svarsantal är
         konsistenta med Översikt och Veckoanalys. */}
      {activeView === 'trend' && (
        <>
          <TotalChainCard
            allResponses={npsResponses}
            periodLabel={periodLabel}
            title={filterMode === 'all' ? 'Total Kedja' : 'Filtrerat urval'}
          />
          <TrendView responses={npsResponses} periodLabel={periodLabel} />
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

              {/* Demografi Beta */}
              <div className="report-card" style={{padding:'0.75rem 1rem 0.5rem'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                  <span style={{fontSize:'0.9rem',fontWeight:600,color:'var(--color-text)'}}>
                    Demografi <span className="demo-beta-badge">Beta</span>
                  </span>
                  <button
                    className={`setting-switch ${showDemographics ? 'setting-switch--on' : ''}`}
                    onClick={() => {
                      const next = !showDemographics;
                      setShowDemographics(next);
                      try { localStorage.setItem('report_show_demographics', next); } catch {}
                    }}
                  ><span className="setting-switch-knob" /></button>
                </div>
              </div>
              {showDemographics && (
                <DemographicsCard responses={npsResponses} duplicateCount={duplicateCount} />
              )}

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
                <button className="export-btn" onClick={() => exportCsv(responses, activeCustomer)}>Exportera CSV</button>
                <button className="export-btn" onClick={() => exportExcel(responses, activeCustomer)}>Exportera Excel</button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
