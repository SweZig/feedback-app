import { useState, useEffect } from 'react';
import { categorize } from '../utils/npsCalculations';
import './CommentList.css';

// ── Persist resolved follow-ups i localStorage ──
const STORAGE_KEY = 'resolved_followups';
function loadResolved() {
  try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY)) || []); }
  catch { return new Set(); }
}
function saveResolved(set) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
}

// ── Kopieringsknapp ──
function CopyEmailButton({ email }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(email).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button className="comment-followup-copy" onClick={handleCopy} title="Kopiera e-postadress">
      {copied ? '✓' : '📋'}
    </button>
  );
}

// ── Fördefinierade svar — grupperad expand/collapse ──
function PredefinedGroup({ responses }) {
  const [openGroups, setOpenGroups] = useState({});

  function toggleGroup(score) {
    setOpenGroups(prev => ({ ...prev, [score]: !prev[score] }));
  }

  // Gruppera per betyg, sortera betyg stigande
  const groups = {};
  responses.forEach(r => {
    if (!groups[r.score]) groups[r.score] = [];
    groups[r.score].push(r);
  });
  const sorted = Object.entries(groups).sort((a, b) => Number(a[0]) - Number(b[0]));
  if (sorted.length === 0) return null;

  return (
    <div className="predefined-group">
      {sorted.map(([score, items]) => {
        const isOpen = openGroups[score];
        const cat = categorize(Number(score));
        return (
          <div key={score} className="predefined-group-section">
            <button className="predefined-group-toggle" onClick={() => toggleGroup(score)}>
              <span className={`comment-badge comment-badge--${cat}`}>{score}</span>
              <span className="predefined-group-title">
                {items.map(r => r.predefinedAnswer).filter((v, i, a) => a.indexOf(v) === i).join(', ')}
              </span>
              <span className="predefined-group-count">{items.length} st</span>
              <span className="predefined-group-chevron">{isOpen ? '▲' : '▼'}</span>
            </button>
            {isOpen && (
              <ul className="predefined-group-list">
                {items.sort((a, b) => b.timestamp - a.timestamp).map(r => (
                  <li key={r.id} className="predefined-group-item">
                    <span className="predefined-group-answer">{r.predefinedAnswer}</span>
                    <span className="predefined-group-date">
                      {new Date(r.timestamp).toLocaleDateString('sv-SE')}
                    </span>
                    {r.comment && <span className="predefined-group-comment">{r.comment}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Avdelningsetikett (Sprint A.13) ──
// Ett svar bär bara touchpointId. För att slippa leta upp avdelningen manuellt
// när en kund vill bli kontaktad visas den direkt på kommentaren.
function OriginTag({ origin }) {
  if (!origin) return null;
  return (
    <span className="comment-origin" title={origin.title}>
      {origin.dept}
      {origin.tp && <span className="comment-origin-tp">{origin.tp}</span>}
    </span>
  );
}

// ── Huvud-komponent ──
function CommentList({ responses, touchpoints = [], departments = [] }) {
  const [resolved, setResolved] = useState(() => loadResolved());

  // Slår upp avdelning + mätpunkt för ett svar. Mätpunktsnamnen är ofta
  // identiska mellan avdelningar ("Exitpoll"), så avdelningen är huvudetiketten.
  const tpById = {};
  touchpoints.forEach(t => { tpById[t.id] = t; });
  const deptById = {};
  departments.forEach(d => { deptById[d.id] = d; });

  function originOf(r) {
    const tp = r.touchpointId ? tpById[r.touchpointId] : null;
    if (!tp) return null;
    const dept = tp.departmentId ? deptById[tp.departmentId] : null;
    return {
      dept: dept ? dept.name : tp.name,
      tp: dept ? tp.name : '',
      title: dept
        ? `${dept.name}${dept.uniqueCode ? ` (${dept.uniqueCode})` : ''} · ${tp.name}`
        : tp.name,
    };
  }

  useEffect(() => { saveResolved(resolved); }, [resolved]);

  function toggleResolved(id) {
    setResolved(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const withContent = responses
    .filter(r => r.comment || r.predefinedAnswer || r.followUpEmail)
    .sort((a, b) => b.timestamp - a.timestamp);

  if (withContent.length === 0) {
    return <p className="comments-empty">Inga kommentarer ännu.</p>;
  }

  const followUps  = withContent.filter(r => r.followUpEmail);
  const freeTexts  = withContent.filter(r => r.comment && !r.followUpEmail);
  // Alla svar exkl. follow-ups — grupperas per betyg oavsett om de har svarsalternativ
  const allScored  = responses.filter(r => !r.followUpEmail);

  return (
    <div className="comments">
      <h3>Kommentarer</h3>

      {/* ── Uppföljning ── */}
      {followUps.length > 0 && (
        <div className="comments-section">
          <p className="comments-section-label">
            Uppföljning behövs
            <span className="comments-section-meta">
              {followUps.filter(r => resolved.has(r.id)).length}/{followUps.length} hanterade
            </span>
          </p>
          <ul className="comments-list">
            {followUps.map(r => {
              const isResolved = resolved.has(r.id);
              return (
                <li key={r.id} className={`comment-item comment-item--followup ${isResolved ? 'comment-item--resolved' : ''}`}>
                  <div className="comment-header">
                    <span className={`comment-badge comment-badge--${categorize(r.score)}`}>{r.score}</span>
                    <OriginTag origin={originOf(r)} />
                    <span className="comment-date">{new Date(r.timestamp).toLocaleDateString('sv-SE')}</span>
                  </div>
                  <div className="comment-followup">
                    <span className="comment-followup-icon">✉</span>
                    <span className="comment-followup-email">{r.followUpEmail}</span>
                    <span className="comment-followup-label">vill bli kontaktad</span>
                    <CopyEmailButton email={r.followUpEmail} />
                    <label className="comment-resolved-label" title="Markera som hanterad">
                      <input
                        type="checkbox"
                        className="comment-resolved-checkbox"
                        checked={isResolved}
                        onChange={() => toggleResolved(r.id)}
                      />
                      <span className="comment-resolved-text">{isResolved ? 'Hanterad ✓' : 'Hantera'}</span>
                    </label>
                  </div>
                  {r.predefinedAnswer && (
                    <span className="comment-predefined" style={{ marginTop: '0.4rem', display: 'inline-block' }}>
                      {r.predefinedAnswer}
                    </span>
                  )}
                  {r.comment && <p className="comment-text" style={{ marginTop: '0.3rem' }}>{r.comment}</p>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ── Fritextkommentarer ── */}
      {freeTexts.length > 0 && (
        <div className="comments-section">
          {followUps.length > 0 && <p className="comments-section-label">Fritextkommentarer</p>}
          <ul className="comments-list">
            {freeTexts.map(r => (
              <li key={r.id} className="comment-item">
                <div className="comment-header">
                  <span className={`comment-badge comment-badge--${categorize(r.score)}`}>{r.score}</span>
                  <OriginTag origin={originOf(r)} />
                  <span className="comment-date">{new Date(r.timestamp).toLocaleDateString('sv-SE')}</span>
                </div>
                {r.predefinedAnswer && (
                  <span className="comment-predefined">{r.predefinedAnswer}</span>
                )}
                <p className="comment-text">{r.comment}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Alla svar per betyg (expand/collapse) ── */}
      {allScored.length > 0 && (
        <div className="comments-section">
          <p className="comments-section-label">Alla svar per betyg</p>
          <PredefinedGroup responses={allScored} />
        </div>
      )}
    </div>
  );
}

export default CommentList;
