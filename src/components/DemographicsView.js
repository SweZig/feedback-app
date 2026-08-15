import { useState } from 'react';
import { calculateNps } from '../utils/npsCalculations';
import './DemographicsView.css';

/**
 * DemographicsView — Rapport → Demografi (Beta)
 *
 * Sprint A.12. Ersätter Demografi Beta-kortet i Översikt.
 *
 * Bucketningen ligger HÄR, inte i faceAnalysis.js. Svar som samlats in från
 * och med A.12 har raw_age och kan därför placeras i vilken gruppindelning som
 * helst. Äldre svar har bara den grova etiketten och kan bara visas på
 * fyragruppsnivå — de redovisas öppet i stället för att tyst försvinna.
 */

// ── Åldersgrupper ───────────────────────────────────────────────────────────
// De åtta grupperna delar dagens fyra utan att korsa en gräns, så roll-up är
// exakt. Ändra här — inte i insamlingen — om indelningen behöver justeras.
export const AGE_BUCKETS_8 = [
  { key: 'u13',   label: '<13',   min: 0,  max: 12 },
  { key: '13_19', label: '13–19', min: 13, max: 19 },
  { key: '20_25', label: '20–25', min: 20, max: 25 },
  { key: '26_35', label: '26–35', min: 26, max: 35 },
  { key: '36_45', label: '36–45', min: 36, max: 45 },
  { key: '46_60', label: '46–60', min: 46, max: 60 },
  { key: '61_70', label: '61–70', min: 61, max: 70 },
  { key: '71p',   label: '71+',   min: 71, max: 200 },
];

export const AGE_BUCKETS_4 = [
  { key: 'barn',   label: 'Barn (<13)',     min: 0,  max: 12,  legacy: 'barn' },
  { key: 'ungdom', label: 'Ungdom (13–25)', min: 13, max: 25,  legacy: 'ungdom' },
  { key: 'vuxen',  label: 'Vuxen (26–60)',  min: 26, max: 60,  legacy: 'vuxen' },
  { key: 'aldre',  label: 'Äldre (>60)',    min: 61, max: 200, legacy: 'äldre' },
];

const GENDERS = [
  { key: 'man',    label: 'Man',        color: '#3498db' },
  { key: 'kvinna', label: 'Kvinna',     color: '#8e44ad' },
  { key: 'okänt',  label: 'Okänt kön',  color: '#95a5a6' },
];

// Volymramp: en ton av --color-primary mot vitt. Ljus = få, mörk = många.
const VOL_RAMP = ['#e4e7ea', '#c0c8ce', '#9aa6b0', '#748592', '#4b6172', '#1e3a4f'];

const MIN_CONFIDENCE = 0.50; // under detta litar vi inte på klassificeringen
const THIN_N = 20;           // under detta = tunt underlag (jfr minNForTip)

// Hur många svar med exakt ålder som krävs innan vyn startar i åttagruppsläge.
// Under detta öppnas fyragruppsvyn i stället, så att man aldrig möts av en tom
// vy bara för att historiken saknar raw_age. Användarens egna val vinner alltid.
const MIN_RAW_FOR_8 = 30;

const LS_GRAN    = 'report_demo_granularity';
const LS_METRIC  = 'report_demo_metric';
const LS_COMPARE = 'report_demo_compare';

function readLs(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writeLs(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

// ── Bucketing ───────────────────────────────────────────────────────────────
export function bucketForResponse(r, buckets) {
  if (typeof r.rawAge === 'number' && Number.isFinite(r.rawAge)) {
    return buckets.find(b => r.rawAge >= b.min && r.rawAge <= b.max) || null;
  }
  // Historik utan raw_age: går bara att placera i fyragruppsindelningen.
  if (r.ageGroup) return buckets.find(b => b.legacy === r.ageGroup) || null;
  return null;
}

// Svar som får räknas i demografin alls: har kön eller åldersuppgift, och
// klarar konfidensgränsen när konfidens finns lagrad.
export function isDemographicallyUsable(r) {
  if (!r.gender && !r.ageGroup && typeof r.rawAge !== 'number') return false;
  if (typeof r.faceConfidence === 'number' && r.faceConfidence < MIN_CONFIDENCE) return false;
  return true;
}

const fmt = n => n.toLocaleString('sv-SE');
const sgn = n => (n > 0 ? '+' : '') + n;
const pct = (n, d = 1) => n.toFixed(d).replace('.', ',') + ' %';

function npsColor(nps) {
  // Samma trösklar som getHeatmapColor i ReportPage.js
  return nps >= 30 ? '#27ae60' : nps >= 0 ? '#f1c40f' : '#e74c3c';
}
function npsInk(nps) {
  return nps >= 0 && nps < 30 ? '#333' : '#fff';
}
function volColor(n, max) {
  if (!n) return 'var(--color-bg)';
  const i = Math.max(0, Math.min(VOL_RAMP.length - 1, Math.floor((n / max) * VOL_RAMP.length - 1e-9)));
  return VOL_RAMP[i];
}
function volInk(n, max) {
  if (!n) return '#bbb';
  return Math.floor((n / max) * VOL_RAMP.length - 1e-9) >= 3 ? '#fff' : 'var(--color-text)';
}

// ── Aggregat ────────────────────────────────────────────────────────────────
function buildSegments(rows, buckets) {
  const segs = [];
  buckets.forEach((b) => {
    GENDERS.forEach((g) => {
      const group = rows.filter(r => r.gender === g.key && bucketForResponse(r, buckets)?.key === b.key);
      const res = calculateNps(group);
      segs.push({
        bucket: b, gender: g, n: group.length,
        nps: res?.nps ?? null,
        label: `${g.label}, ${b.label}`,
      });
    });
  });
  return segs;
}

export default function DemographicsView({
  responses = [],
  allResponses = [],
  touchpoints = [],
  departments = [],
  periodLabel = '',
}) {
  // 'auto' = inget eget val gjort ännu. Läget härleds då ur hur mycket exakt
  // ålder som faktiskt finns, och räknas om när data hunnit laddas — därför
  // härledd vid render i stället för låst i initialt state.
  const [granPref, setGranPref] = useState(() => readLs(LS_GRAN, 'auto'));
  const [metric, setMetric]     = useState(() => (readLs(LS_METRIC, 'n') === 'nps' ? 'nps' : 'n'));
  const [compare, setCompare]   = useState(() => readLs(LS_COMPARE, 'false') === 'true');

  const withRawAge = responses.filter(r => typeof r.rawAge === 'number').length;
  const autoGranularity = withRawAge >= MIN_RAW_FOR_8 ? 8 : 4;
  const granularity = granPref === '4' ? 4 : granPref === '8' ? 8 : autoGranularity;

  const buckets = granularity === 8 ? AGE_BUCKETS_8 : AGE_BUCKETS_4;

  const usable  = responses.filter(isDemographicallyUsable);
  const placed  = usable.filter(r => bucketForResponse(r, buckets));
  const unplaced = usable.length - placed.length; // historik utan raw_age i 8-läget

  const segs = buildSegments(placed, buckets);
  const withData = segs.filter(s => s.n > 0);
  const demoTotal = placed.length;
  const overall = calculateNps(placed);
  const overallNps = overall?.nps ?? 0;

  const ranked = [...withData].sort((a, b) => b.n - a.n);
  const top = ranked.find(s => s.n >= THIN_N) || ranked[0] || null;
  const maxN = ranked.length ? ranked[0].n : 0;

  function pick(setter, key, value) {
    setter(value);
    writeLs(key, String(value));
  }

  if (!usable.length) {
    return (
      <div className="report-card demo-card">
        <div className="demo-header">
          <h3>Demografi <span className="demo-beta-badge">Beta</span></h3>
        </div>
        <p className="report-empty-text">
          Inga demografidata i urvalet ännu — kräver kamera på kiosk-enheter.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* ── Underlagsrad ────────────────────────────────────────────────
         Sprint A.12: bara sammanfattningen ligger kvar här. ATT vyn vilar på
         en delmängd måste läsaren veta; VILKEN platta som inte levererar är
         driftdata och bor under Inställningar → Kameratäckning. */}
      <p className="demo-duplicate-info dv-basis">
        ℹ️ Demografi bygger på {fmt(demoTotal)} av {fmt(responses.length)} svar
        ({responses.length ? pct(100 * demoTotal / responses.length, 0) : '0 %'}) —
        de svarande som kameran lyckats klassificera.
      </p>

      {/* ── Kontrollrad ────────────────────────────────────────────────── */}
      <div className="report-card dv-controls">
        <div className="dv-control">
          <span className="dv-control-label">Åldersgrupper</span>
          <div className="dv-segbtns">
            <button
              className={`filter-btn ${granularity === 4 ? 'filter-btn--active' : ''}`}
              onClick={() => pick(setGranPref, LS_GRAN, '4')}
            >Fyra</button>
            <button
              className={`filter-btn ${granularity === 8 ? 'filter-btn--active' : ''}`}
              onClick={() => pick(setGranPref, LS_GRAN, '8')}
              title={withRawAge < MIN_RAW_FOR_8
                ? `Endast ${withRawAge} svar har exakt ålder ännu — vyn blir tom`
                : undefined}
            >Åtta</button>
          </div>
          {granPref === 'auto' && withRawAge < MIN_RAW_FOR_8 && (
            <span className="dv-control-hint">
              Åtta grupper slås på automatiskt vid {MIN_RAW_FOR_8} svar med exakt ålder ({withRawAge} hittills)
            </span>
          )}
        </div>
        <div className="dv-control">
          <span className="dv-control-label">Matrisens färg</span>
          <div className="dv-segbtns">
            <button
              className={`filter-btn ${metric === 'n' ? 'filter-btn--active' : ''}`}
              onClick={() => pick(setMetric, LS_METRIC, 'n')}
            >Antal svar</button>
            <button
              className={`filter-btn ${metric === 'nps' ? 'filter-btn--active' : ''}`}
              onClick={() => pick(setMetric, LS_METRIC, 'nps')}
            >NPS</button>
          </div>
        </div>
        <div className="dv-control dv-control--end">
          <button
            className={`filter-btn ${compare ? 'filter-btn--active' : ''}`}
            onClick={() => pick(setCompare, LS_COMPARE, !compare)}
            title="Visar alla mätpunkter parallellt — mätpunktsfiltret ignoreras i det läget"
          >Jämför mätpunkter</button>
        </div>
      </div>

      {unplaced > 0 && (
        <p className="demo-duplicate-info">
          ℹ️ {fmt(unplaced)} {unplaced === 1 ? 'svar saknar' : 'svar saknar'} exakt ålder och kan inte
          placeras i åtta grupper — insamlade före sprint A.12. De ingår i fyragruppsvyn.
        </p>
      )}

      {/* ── Den typiska kunden + näst vanligast ─────────────────────────── */}
      <div className="dv-grid2">
        <div className="report-card">
          <h3>Den typiska kunden <span className="demo-beta-badge">Beta</span></h3>
          <p className="report-card-desc">
            {fmt(demoTotal)} identifierade svarande av {fmt(responses.length)} svar · {periodLabel}
          </p>

          {top ? (
            <>
              <div className="dv-persona">
                <div className="dv-avatar" style={{ background: 'var(--stat-bg, #f4f6f7)' }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
                       stroke={top.gender.color} strokeWidth="1.7" strokeLinecap="round">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
                  </svg>
                </div>
                <div>
                  <div className="dv-persona-name">{top.label}</div>
                  <div className="dv-persona-sub">
                    Vanligaste kombinationen av kön och åldersgrupp bland de svarande.
                  </div>
                </div>
              </div>

              <div className="drill-stats">
                <div className="drill-stat">
                  <div className="drill-stat-label">Andel av svarande</div>
                  <div className="drill-stat-value">{pct(100 * top.n / demoTotal)}</div>
                  <div className="dv-stat-note">{fmt(top.n)} av {fmt(demoTotal)} svar</div>
                </div>
                <div className="drill-stat">
                  <div className="drill-stat-label">NPS i segmentet</div>
                  <div className="drill-stat-value" style={{ color: npsColor(top.nps ?? 0) }}>
                    {top.nps === null ? '–' : sgn(top.nps)}
                  </div>
                  <div className="dv-stat-note">
                    {top.nps === null ? 'för få svar' :
                      `${sgn(top.nps - overallNps)} mot urvalets snitt (${sgn(overallNps)})`}
                  </div>
                </div>
              </div>

              {granularity === 4 && (
                <p className="dv-flag">
                  <b>{pct(100 * top.n / demoTotal)} av alla identifierade svarande hamnar i den här enda rutan.</b>{' '}
                  Med fyra åldersgrupper säger «typisk kund» nästan ingenting — växla till Åtta ovan.
                </p>
              )}
            </>
          ) : (
            <p className="report-empty-text">För få svar för att peka ut ett segment.</p>
          )}
        </div>

        <div className="report-card">
          <h3>Näst vanligast</h3>
          <p className="report-card-desc">
            Rangordnat på antal svar. Segment under {THIN_N} svar är dämpade — tunt underlag.
          </p>
          {ranked.slice(1, 7).map((s, i) => (
            <div key={`${s.gender.key}-${s.bucket.key}`}
                 className={`demo-row ${s.n < THIN_N ? 'dv-row--thin' : ''}`}>
              <span className="dv-rank">{i + 2}</span>
              <span className="demo-row-label">{s.label}</span>
              <div className="demo-bar-wrap">
                <div className="demo-bar" style={{ width: `${maxN ? 100 * s.n / maxN : 0}%`, background: s.gender.color }} />
              </div>
              <span className="demo-row-pct">{pct(100 * s.n / demoTotal)}</span>
              <span className="demo-row-count">{fmt(s.n)} sv</span>
              {s.nps !== null && (
                <span className="demo-nps-chip" style={{ background: npsColor(s.nps) }}>{sgn(s.nps)}</span>
              )}
            </div>
          ))}
          <div className="heatmap-legend">
            {GENDERS.map(g => (
              <span key={g.key}><span className="heatmap-dot" style={{ background: g.color }} />{g.label}</span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Segmentmatris ──────────────────────────────────────────────── */}
      <div className="report-card">
        <h3>Segmentmatris — ålder × kön</h3>
        <p className="report-card-desc">
          {metric === 'n'
            ? 'Färg = antal svar. Mörkare ruta, fler kunder.'
            : 'Färg = NPS med samma trösklar som Veckoanalysens heatmap.'}
        </p>
        <div className="dv-matrix-wrap">
          <table className="dv-matrix">
            <tbody>
              <tr>
                <th />
                {buckets.map(b => <th key={b.key}>{b.label}</th>)}
              </tr>
              {GENDERS.map(g => (
                <tr key={g.key}>
                  <th className="dv-rowh">
                    <span className="heatmap-dot" style={{ background: g.color }} />{g.label}
                  </th>
                  {buckets.map((b) => {
                    const s = segs.find(x => x.gender.key === g.key && x.bucket.key === b.key);
                    const thin = s.n > 0 && s.n < THIN_N;
                    const bg = metric === 'n'
                      ? volColor(s.n, maxN)
                      : (s.n ? npsColor(s.nps ?? 0) : 'var(--color-bg)');
                    const ink = metric === 'n'
                      ? volInk(s.n, maxN)
                      : (s.n ? npsInk(s.nps ?? 0) : '#bbb');
                    return (
                      <td key={b.key}>
                        <div
                          className={`dv-cell ${thin ? 'dv-cell--thin' : ''}`}
                          style={{ background: bg, color: ink }}
                          title={`${g.label}, ${b.label}\n${fmt(s.n)} svar${s.nps !== null ? ` · NPS ${sgn(s.nps)}` : ''}${thin ? '\nTunt underlag' : ''}`}
                        >
                          {metric === 'n'
                            ? (s.n ? fmt(s.n) : '–')
                            : (s.n ? sgn(s.nps ?? 0) : '–')}
                          {metric === 'nps' && s.n > 0 && <small>{fmt(s.n)} sv</small>}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="heatmap-legend">
          {metric === 'n' ? (
            <span>
              Få
              <span className="dv-ramp">
                {VOL_RAMP.map(c => <i key={c} style={{ background: c }} />)}
              </span>
              Många
            </span>
          ) : (
            <>
              <span><span className="heatmap-dot" style={{ background: '#27ae60' }} />NPS ≥ 30</span>
              <span><span className="heatmap-dot" style={{ background: '#f1c40f' }} />NPS 0–29</span>
              <span><span className="heatmap-dot" style={{ background: '#e74c3c' }} />NPS &lt; 0</span>
            </>
          )}
          <span><span className="dv-thin-key" />Under {THIN_N} svar</span>
        </div>
      </div>

      {/* ── Jämför mätpunkter ──────────────────────────────────────────── */}
      {compare && (
        <CompareCard
          allResponses={allResponses}
          touchpoints={touchpoints}
          departments={departments}
          buckets={buckets}
        />
      )}
    </>
  );
}

// ── Täckningsgrad ───────────────────────────────────────────────────────────
// Sprint A.12: nedbrytningen per mätpunkt flyttad till CameraCoverage.js
// (Inställningar → Kameratäckning). Kunden ska se att underlaget är en
// delmängd, men inte vilken platta som strular.

// ── Jämför mätpunkter: pyramid + avvikelse ──────────────────────────────────
function CompareCard({ allResponses, touchpoints, departments = [], buckets }) {
  const usable = allResponses.filter(isDemographicallyUsable);

  // Mätpunkterna heter ofta samma sak i varje avdelning ("Exitpoll"), så
  // panelrubriken måste bära avdelningens namn för att gå att skilja åt.
  const deptById = {};
  departments.forEach((d) => { deptById[d.id] = d; });
  const panelName = (tp) => {
    const dept = tp.departmentId ? deptById[tp.departmentId] : null;
    return dept ? dept.name : tp.name;
  };
  const panelSub = (tp) => {
    const dept = tp.departmentId ? deptById[tp.departmentId] : null;
    return dept ? tp.name : '';
  };

  const stores = touchpoints
    .map((tp) => {
      const rows = usable.filter(r => r.touchpointId === tp.id && bucketForResponse(r, buckets));
      if (rows.length < 10) return null; // för tunt för att jämföra
      const byBucket = buckets.map(b => rows.filter(r => bucketForResponse(r, buckets).key === b.key).length);
      const men = buckets.map(b => rows.filter(r => r.gender === 'man' && bucketForResponse(r, buckets).key === b.key).length);
      const women = buckets.map(b => rows.filter(r => r.gender === 'kvinna' && bucketForResponse(r, buckets).key === b.key).length);
      return { tp, rows, total: rows.length, byBucket, men, women, nps: calculateNps(rows)?.nps ?? null };
    })
    .filter(Boolean);

  if (stores.length < 2) {
    return (
      <div className="report-card">
        <h3>Jämför mätpunkter</h3>
        <p className="report-empty-text">
          Kräver minst två mätpunkter med tillräckligt underlag i perioden.
        </p>
      </div>
    );
  }

  const chainTotal = stores.reduce((a, s) => a + s.total, 0);
  const chainShare = buckets.map((b, i) =>
    100 * stores.reduce((a, s) => a + s.byBucket[i], 0) / chainTotal);

  const pyrMax = Math.max(
    ...stores.flatMap(s => [...s.men, ...s.women].map(v => 100 * v / s.total)), 1);
  const devMax = Math.max(
    ...stores.flatMap(s => s.byBucket.map((v, i) => Math.abs(100 * v / s.total - chainShare[i]))), 1);

  return (
    <>
      <div className="report-card">
        <h3>Åldersprofil per mätpunkt</h3>
        <p className="report-card-desc">
          Andel av mätpunktens identifierade svarande. Samma skala i alla paneler.
          Mätpunktsfiltret ignoreras här — jämförelsen är hela poängen.
        </p>
        <div className="dv-panels">
          {stores.map(s => (
            <div key={s.tp.id}>
              <div className="dv-store-name">{panelName(s.tp)}</div>
              <div className="dv-store-sub">
                {panelSub(s.tp) && <>{panelSub(s.tp)} · </>}
                {fmt(s.total)} identifierade svarande{s.nps !== null ? ` · NPS ${sgn(s.nps)}` : ''}
              </div>
              <div className="dv-pyr-head">
                <span>Man</span><span /><span>Kvinna</span>
              </div>
              <div className="dv-pyr">
                {buckets.map((b, i) => (
                  <div key={b.key} className="dv-pyr-row">
                    <div className="dv-pyr-l">
                      <div className="dv-pyr-bar" style={{
                        width: `${100 * (100 * s.men[i] / s.total) / pyrMax}%`, background: '#3498db',
                      }} title={`Man, ${b.label}: ${fmt(s.men[i])} svar`} />
                    </div>
                    <div className="dv-pyr-lab">{b.label}</div>
                    <div className="dv-pyr-r">
                      <div className="dv-pyr-bar" style={{
                        width: `${100 * (100 * s.women[i] / s.total) / pyrMax}%`, background: '#8e44ad',
                      }} title={`Kvinna, ${b.label}: ${fmt(s.women[i])} svar`} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="heatmap-legend">
          <span><span className="heatmap-dot" style={{ background: '#3498db' }} />Man</span>
          <span><span className="heatmap-dot" style={{ background: '#8e44ad' }} />Kvinna</span>
          <span className="dv-muted">Skala 0–{Math.ceil(pyrMax)} % per åldersgrupp · svar med okänt kön ingår i underlaget men saknar sida</span>
        </div>
      </div>

      <div className="report-card">
        <h3>Vad skiljer mätpunkten från kedjesnittet?</h3>
        <p className="report-card-desc">
          Procentenheters avvikelse per åldersgrupp. Höger om linjen = överrepresenterat i mätpunkten.
        </p>
        <div className="dv-panels">
          {stores.map(s => (
            <div key={s.tp.id}>
              <div className="dv-store-name" style={{ marginBottom: '.6rem' }}>{panelName(s.tp)}</div>
              {buckets.map((b, i) => {
                const delta = 100 * s.byBucket[i] / s.total - chainShare[i];
                const w = Math.min(50, Math.abs(delta) / devMax * 50);
                return (
                  <div key={b.key} className="dv-dev-row">
                    <div className="dv-dev-lab">{b.label}</div>
                    <div className="dv-dev-track">
                      <div className="dv-dev-zero" />
                      <div
                        className="dv-dev-bar"
                        style={delta >= 0 ? { left: '50%', width: `${w}%` } : { right: '50%', width: `${w}%` }}
                        title={`${b.label}: ${delta >= 0 ? '+' : ''}${delta.toFixed(1).replace('.', ',')} procentenheter mot kedjesnittet`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="heatmap-legend">
          <span><span className="heatmap-dot" style={{ background: '#1e3a4f' }} />Avvikelse mot kedjesnitt</span>
          <span className="dv-muted">
            Skala ±{Math.ceil(devMax)} procentenheter · sidan om nollinjen bär riktningen, därför en enda färg
          </span>
        </div>
      </div>
    </>
  );
}
