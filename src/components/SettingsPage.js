// src/components/SettingsPage.js
//
// Sprint B: All CRUD går via chainOperations.js direkt mot Supabase.
// Inga localStorage-skrivningar, inga sync-helpers, ingen backup-flik,
// inga DEMO_CHAIN_ID-checks.
//
// Felhantering: alla mutation-handlers wrappas i try/catch och visar
// `alert("Fel: " + e.message)` vid fel. Vid lyckad mutation kallas
// refresh() som triggar App.js att ladda om kedjorna från Supabase.

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  getActiveChainId, setActiveChainId, setActiveTouchpoint,
  getTouchpointUrl, getDefaultConfig, getEffectiveConfig,
  TYPE_LABELS, MODE_LABELS,
} from '../utils/settings';
import {
  addChain, updateChain, deleteChain, reorderChains,
  addDepartment, updateDepartment, deleteDepartment, reorderDepartments,
  addTouchpoint, updateTouchpoint, deleteTouchpoint,
  applyConfigToType, migrateTouchpointsFromDept,
  resetChainResponses, resetTouchpointResponses,
} from '../utils/chainOperations';
import { getKioskStatuses, computeKioskStatus, describeKioskStatus } from '../utils/kioskHeartbeat';
import {
  getOrgUsers, inviteUser, updateUserRole,
  removeUserFromOrg, getMyRole,
  ROLE_LABELS, ROLE_ORDER,
} from '../utils/userManagement';
import { getCurrentUser } from '../utils/storageAdapter';
import {
  PERMISSION_GROUPS, DEFAULT_PERMISSIONS,
  getPermissions, savePermissions,
} from '../utils/permissions';
import { useRole } from '../contexts/RoleContext';
import './SettingsPage.css';
import './SettingsPage.driftstatus.css';
import './AdminPage.css';

// Sprint A.5 Del 2: pollar driftstatus var 30s i Avdelningar-vyn
const DRIFTSTATUS_POLL_MS = 30 * 1000;


// ════════════════════════════════════════════════════════════
// HJÄLPFUNKTIONER
// ════════════════════════════════════════════════════════════

function generateDeptCode(departments) {
  const existing = new Set((departments || []).map((d) => d.uniqueCode).filter(Boolean));
  let i = 1;
  while (existing.has(`AVD-${String(i).padStart(3, '0')}`)) i++;
  return `AVD-${String(i).padStart(3, '0')}`;
}

const TYPE_BADGE = {
  physical: 'dept-badge--physical',
  online: 'dept-badge--online',
  other: 'dept-badge--other',
  enps: 'dept-badge--enps',
};

const MENU_ITEMS = [
  { key: 'chains', label: 'Kedjor' },
  { key: 'users', label: 'Användare' },
  { key: 'departments', label: 'Avdelningar' },
  { key: 'config', label: 'Konfiguration' },
];


// ════════════════════════════════════════════════════════════
// DIALOG-KOMPONENTER
// ════════════════════════════════════════════════════════════

function ConfirmDialog({ message, detail, onConfirm, onCancel }) {
  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
        <p className="confirm-msg">{message}</p>
        {detail && <p style={{ fontSize: '0.85rem', color: 'var(--color-text-light)', margin: '-0.75rem 0 1.25rem' }}>{detail}</p>}
        <div className="confirm-btns">
          <button className="settings-btn settings-btn--primary" onClick={onConfirm}>Ja, kör</button>
          <button className="settings-btn settings-btn--ghost" onClick={onCancel}>Avbryt</button>
        </div>
      </div>
    </div>
  );
}

function DeleteDialog({ message, onConfirm, onCancel }) {
  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
        <p className="confirm-msg">{message}</p>
        <div className="confirm-btns">
          <button className="settings-btn settings-btn--danger" onClick={onConfirm}>Ja, ta bort</button>
          <button className="settings-btn settings-btn--ghost" onClick={onCancel}>Avbryt</button>
        </div>
      </div>
    </div>
  );
}

function ResetDialog({ label, onConfirm, onCancel }) {
  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
        <p className="confirm-msg">Nollställ all data för <strong>{label}</strong>? Detta kan inte ångras.</p>
        <div className="confirm-btns">
          <button className="settings-btn settings-btn--danger" onClick={onConfirm}>Ja, nollställ</button>
          <button className="settings-btn settings-btn--ghost" onClick={onCancel}>Avbryt</button>
        </div>
      </div>
    </div>
  );
}


// ════════════════════════════════════════════════════════════
// CONFIG-FORMULÄR (per typ)
// ════════════════════════════════════════════════════════════

// showCountdown: true when mode === 'app'
function ConfigForm({ config, onChange, type, showCountdown = false }) {
  return (
    <div className="config-form">
      <div className="setting-row setting-row--col">
        <div className="setting-info">
          <h3>NPS-fråga</h3>
          <p>Frågetexten som visas för respondenten i enkäten.</p>
        </div>
        <textarea
          className="settings-input settings-textarea"
          rows={3}
          value={config.npsQuestion || ''}
          onChange={(e) => onChange({ ...config, npsQuestion: e.target.value })}
        />
      </div>
      {type === 'physical' && (
        <div className="setting-row">
          <div className="setting-info"><h3>NPS-skalans färger</h3><p>Färgade eller neutrala knappar.</p></div>
          <div className="setting-toggle-group">
            <button className={`setting-toggle ${config.npsColorMode === 'colored' ? 'setting-toggle--active' : ''}`}
              onClick={() => onChange({ ...config, npsColorMode: 'colored' })}>Färg</button>
            <button className={`setting-toggle ${config.npsColorMode === 'neutral' ? 'setting-toggle--active' : ''}`}
              onClick={() => onChange({ ...config, npsColorMode: 'neutral' })}>Neutral</button>
          </div>
        </div>
      )}
      {(type === 'physical' || showCountdown) && (
        <div className="setting-row">
          <div className="setting-info">
            <h3>Nedräkning efter svar</h3>
            <p>Sekunder innan enkäten återställs ({config.countdownSeconds || 6}s).</p>
          </div>
          <div className="setting-range">
            <span>3</span>
            <input type="range" min={3} max={20} value={config.countdownSeconds || 6}
              onChange={(e) => onChange({ ...config, countdownSeconds: Number(e.target.value) })} />
            <span>20</span>
          </div>
        </div>
      )}
      <div className="setting-row">
        <div className="setting-info"><h3>Fritextfält</h3><p>Visa kommentarsfältet i enkäten.</p></div>
        <button className={`setting-switch ${config.freeTextEnabled ? 'setting-switch--on' : ''}`}
          onClick={() => onChange({ ...config, freeTextEnabled: !config.freeTextEnabled })}>
          <span className="setting-switch-knob" /></button>
      </div>
      <div className="setting-row">
        <div className="setting-info"><h3>Färdiga svarsalternativ</h3><p>Visa fördefinierade svar (max 6 st).</p></div>
        <button className={`setting-switch ${config.predefinedAnswersEnabled ? 'setting-switch--on' : ''}`}
          onClick={() => onChange({ ...config, predefinedAnswersEnabled: !config.predefinedAnswersEnabled })}>
          <span className="setting-switch-knob" /></button>
      </div>
      {config.predefinedAnswersEnabled && (
        <>
          <PredefinedAnswers answers={config.predefinedAnswers || []}
            onChange={(answers) => onChange({ ...config, predefinedAnswers: answers })} />
          <div className="setting-row">
            <div className="setting-info">
              <h3>Visa positiva alternativ enbart med 9–10</h3>
              <p>Positiva svarsalternativ visas bara när kunden gett betyg 9 eller 10.</p>
            </div>
            <button className={`setting-switch ${config.showPositiveAnswersForPromoters ? 'setting-switch--on' : ''}`}
              onClick={() => onChange({ ...config, showPositiveAnswersForPromoters: !config.showPositiveAnswersForPromoters })}>
              <span className="setting-switch-knob" />
            </button>
          </div>
          <div className="setting-row">
            <div className="setting-info">
              <h3>Visa negativa alternativ enbart med 0–3</h3>
              <p>Negativa svarsalternativ visas bara när kunden gett betyg 0–3.</p>
            </div>
            <button className={`setting-switch ${config.showNegativeAnswersForDetractors ? 'setting-switch--on' : ''}`}
              onClick={() => onChange({ ...config, showNegativeAnswersForDetractors: !config.showNegativeAnswersForDetractors })}>
              <span className="setting-switch-knob" />
            </button>
          </div>
        </>
      )}
      <div className="setting-row">
        <div className="setting-info">
          <h3>Uppföljning</h3>
          <p>Vid betyg 0–2 frågar enkäten om kunden vill bli kontaktad via e-post.</p>
        </div>
        <button className={`setting-switch ${config.followUpEnabled ? 'setting-switch--on' : ''}`}
          onClick={() => onChange({ ...config, followUpEnabled: !config.followUpEnabled })}>
          <span className="setting-switch-knob" /></button>
      </div>
    </div>
  );
}


// ════════════════════════════════════════════════════════════
// PREDEFINED ANSWERS (drag-and-drop-lista i ConfigForm)
// ════════════════════════════════════════════════════════════

function PredefinedAnswers({ answers, onChange }) {
  const [newAnswer, setNewAnswer] = useState('');
  const [editIdx, setEditIdx] = useState(null);
  const [editText, setEditText] = useState('');
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  const normalized = answers.map((a) => (typeof a === 'string' ? { text: a, polarity: null } : a));

  function togglePolarity(i, p) {
    const u = [...normalized];
    u[i] = { ...u[i], polarity: u[i].polarity === p ? null : p };
    onChange(u);
  }

  return (
    <div className="setting-predefined">
      <ul className="predefined-list">
        {normalized.map((answer, i) => (
          <li key={i}
            className={'predefined-item' + (dragIdx === i ? ' predefined-item--dragging' : '') + (dragOverIdx === i ? ' predefined-item--drag-over' : '')}
            draggable
            onDragStart={() => setDragIdx(i)}
            onDragOver={(e) => { e.preventDefault(); setDragOverIdx(i); }}
            onDrop={() => {
              if (dragIdx === null || dragIdx === i) { setDragIdx(null); setDragOverIdx(null); return; }
              const u = [...normalized]; const [m] = u.splice(dragIdx, 1); u.splice(i, 0, m);
              onChange(u); setDragIdx(null); setDragOverIdx(null);
            }}
            onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
          >
            <span className="predefined-drag-handle">&#x2630;</span>
            {editIdx === i ? (
              <form className="predefined-edit-form" onSubmit={(e) => {
                e.preventDefault(); if (!editText.trim()) return;
                const u = [...normalized]; u[i] = { ...u[i], text: editText.trim() }; onChange(u); setEditIdx(null);
              }}>
                <input className="settings-input" value={editText}
                  onChange={(e) => setEditText(e.target.value)} autoFocus
                  onBlur={() => setEditIdx(null)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setEditIdx(null); }} />
              </form>
            ) : (
              <span className="predefined-text"
                onDoubleClick={() => { setEditIdx(i); setEditText(answer.text); }}
                title="Dubbelklicka för att redigera">{answer.text}</span>
            )}
            <button type="button" title="Positivt alternativ" onClick={() => togglePolarity(i, 'positive')}
              style={{
                width: '1.6rem', height: '1.6rem', borderRadius: '50%', border: '1.5px solid',
                fontWeight: 700, fontSize: '1rem', lineHeight: 1, cursor: 'pointer', flexShrink: 0,
                background: answer.polarity === 'positive' ? '#27ae60' : 'transparent',
                color: answer.polarity === 'positive' ? '#fff' : '#27ae60',
                borderColor: '#27ae60',
              }}>+</button>
            <button type="button" title="Negativt alternativ" onClick={() => togglePolarity(i, 'negative')}
              style={{
                width: '1.6rem', height: '1.6rem', borderRadius: '50%', border: '1.5px solid',
                fontWeight: 700, fontSize: '1rem', lineHeight: 1, cursor: 'pointer', flexShrink: 0,
                background: answer.polarity === 'negative' ? '#e74c3c' : 'transparent',
                color: answer.polarity === 'negative' ? '#fff' : '#e74c3c',
                borderColor: '#e74c3c',
              }}>−</button>
            <button type="button" className="predefined-remove" title="Ta bort"
              onClick={() => { const u = normalized.filter((_, j) => j !== i); onChange(u); }}>×</button>
          </li>
        ))}
      </ul>
      {normalized.length < 6 && (
        <form className="predefined-add" onSubmit={(e) => {
          e.preventDefault(); const t = newAnswer.trim(); if (!t) return;
          onChange([...normalized, { text: t, polarity: null }]); setNewAnswer('');
        }}>
          <input className="settings-input" placeholder="Lägg till svar..." value={newAnswer}
            onChange={(e) => setNewAnswer(e.target.value)} />
          <button type="submit" className="settings-btn settings-btn--ghost settings-btn--sm">Lägg till</button>
        </form>
      )}
    </div>
  );
}


// ════════════════════════════════════════════════════════════
// LOGO CROPPER MODAL
// ════════════════════════════════════════════════════════════

function LogoCropperModal({ imageSrc, onSave, onCancel }) {
  const containerRef = React.useRef(null);
  const imgRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const [imgRect, setImgRect] = React.useState({ x: 0, y: 0, w: 0, h: 0 });
  const [crop, setCrop] = React.useState({ x: 0, y: 0, w: 0, h: 0 });
  const [imgLoaded, setImgLoaded] = React.useState(false);
  const [outputScale, setOutputScale] = React.useState(1);
  const [dragging, setDragging] = React.useState(null);
  const [dragStart, setDragStart] = React.useState(null);

  function onImgLoad() {
    const img = imgRef.current;
    const cont = containerRef.current;
    if (!img || !cont) return;
    const ir = img.getBoundingClientRect();
    const cr = cont.getBoundingClientRect();
    const rx = ir.left - cr.left;
    const ry = ir.top - cr.top;
    setImgRect({ x: rx, y: ry, w: ir.width, h: ir.height });
    setCrop({ x: rx, y: ry, w: ir.width, h: ir.height });
    setImgLoaded(true);
  }

  function clampCrop(c) {
    const minW = 20; const minH = 20;
    let { x, y, w, h } = c;
    if (w < minW) w = minW;
    if (h < minH) h = minH;
    if (x < imgRect.x) x = imgRect.x;
    if (y < imgRect.y) y = imgRect.y;
    if (x + w > imgRect.x + imgRect.w) w = imgRect.x + imgRect.w - x;
    if (y + h > imgRect.y + imgRect.h) h = imgRect.y + imgRect.h - y;
    return { x, y, w, h };
  }

  function onMouseDown(e, handle) {
    e.preventDefault();
    setDragging(handle);
    setDragStart({ mx: e.clientX, my: e.clientY, crop: { ...crop } });
  }

  React.useEffect(() => {
    if (!dragging) return;
    function onMove(e) {
      const dx = e.clientX - dragStart.mx;
      const dy = e.clientY - dragStart.my;
      const prev = dragStart.crop;
      let next;
      if (dragging === 'move') {
        next = clampCrop({ ...prev, x: prev.x + dx, y: prev.y + dy });
      } else {
        let { x, y, w, h } = prev;
        if (dragging.includes('e')) w = prev.w + dx;
        if (dragging.includes('s')) h = prev.h + dy;
        if (dragging.includes('w')) { x = prev.x + dx; w = prev.w - dx; }
        if (dragging.includes('n')) { y = prev.y + dy; h = prev.h - dy; }
        next = clampCrop({ x, y, w, h });
      }
      setCrop(next);
    }
    function onUp() { setDragging(null); setDragStart(null); }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragging, dragStart, imgRect]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSave() {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    const scaleX = img.naturalWidth / imgRect.w;
    const scaleY = img.naturalHeight / imgRect.h;
    const sx = (crop.x - imgRect.x) * scaleX;
    const sy = (crop.y - imgRect.y) * scaleY;
    const sw = crop.w * scaleX;
    const sh = crop.h * scaleY;
    const outW = Math.round(sw * outputScale);
    const outH = Math.round(sh * outputScale);
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
    onSave(canvas.toDataURL('image/png'));
  }

  const handles = ['n','s','e','w','nw','ne','sw','se'];
  const handleStyle = (h) => {
    const base = { position: 'absolute', width: 10, height: 10, background: '#fff', border: '2px solid #1e3a4f', borderRadius: 2 };
    const pos = {};
    if (h.includes('n')) pos.top = -5; else if (h.includes('s')) pos.bottom = -5; else pos.top = '50%';
    if (h.includes('w')) pos.left = -5; else if (h.includes('e')) pos.right = -5; else pos.left = '50%';
    const cursors = { n:'ns-resize', s:'ns-resize', e:'ew-resize', w:'ew-resize', nw:'nw-resize', ne:'ne-resize', sw:'sw-resize', se:'se-resize' };
    return { ...base, ...pos, cursor: cursors[h], transform: (h === 'n' || h === 's') ? 'translateX(-50%)' : (h === 'e' || h === 'w') ? 'translateY(-50%)' : 'none', zIndex: 10 };
  };

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-box" style={{ maxWidth: 640, width: '90vw' }} onClick={(e) => e.stopPropagation()}>
        <p className="confirm-msg" style={{ marginBottom: '0.5rem' }}>Beskär logotyp</p>
        <p style={{ fontSize: '0.82rem', color: 'var(--color-text-light)', margin: '0 0 0.75rem' }}>
          Dra i hörnen eller kanterna för att justera urklippet.
        </p>
        <div ref={containerRef} style={{ position: 'relative', userSelect: 'none', background: '#f0f4f8', borderRadius: 8, overflow: 'hidden', maxHeight: 340, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '0.75rem' }}>
          <img ref={imgRef} src={imageSrc} alt="Logo" onLoad={onImgLoad}
            style={{ maxWidth: '100%', maxHeight: 320, display: 'block', objectFit: 'contain' }} />
          {imgLoaded && (
            <>
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', pointerEvents: 'none' }} />
              <div
                style={{ position: 'absolute', left: crop.x, top: crop.y, width: crop.w, height: crop.h,
                  boxSizing: 'border-box', border: '2px solid #1e3a4f', background: 'transparent',
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)', cursor: 'move' }}
                onMouseDown={(e) => onMouseDown(e, 'move')}
              >
                {handles.map((h) => (
                  <div key={h} style={handleStyle(h)} onMouseDown={(e) => { e.stopPropagation(); onMouseDown(e, h); }} />
                ))}
              </div>
            </>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', fontSize: '0.85rem', color: 'var(--color-text-light)' }}>
          <span style={{ whiteSpace: 'nowrap' }}>Storlek på sparad bild:</span>
          <input type="range" min={0.25} max={2} step={0.25} value={outputScale}
            onChange={(e) => setOutputScale(Number(e.target.value))} style={{ flex: 1 }} />
          <span style={{ whiteSpace: 'nowrap', minWidth: 40 }}>{Math.round(crop.w * outputScale)} × {Math.round(crop.h * outputScale)} px</span>
        </div>
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        <div className="confirm-btns">
          <button className="settings-btn settings-btn--primary" onClick={handleSave}>Spara urklipp</button>
          <button className="settings-btn settings-btn--ghost" onClick={onCancel}>Avbryt</button>
        </div>
      </div>
    </div>
  );
}


// ════════════════════════════════════════════════════════════
// TOUCHPOINT LINKS (visas i TouchpointModal när mode !== 'app')
// ════════════════════════════════════════════════════════════

function TouchpointLinks({ tp }) {
  const [copiedKey, setCopiedKey] = useState(null);
  const url = getTouchpointUrl(tp.id);
  const embedCode = `<iframe src="${url}" width="100%" height="650" frameborder="0" style="border:none;"></iframe>`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(url)}`;
  function copy(text, key) {
    navigator.clipboard.writeText(text).then(() => { setCopiedKey(key); setTimeout(() => setCopiedKey(null), 2000); });
  }
  return (
    <div className="tp-links-panel">
      <div className="tp-link-block">
        <p className="tp-link-label">Webblänk</p>
        <div className="tp-link-row">
          <code className="tp-link-code">{url}</code>
          <button className="settings-btn settings-btn--sm" onClick={() => copy(url, 'link')}>{copiedKey === 'link' ? '✓ Kopierad!' : 'Kopiera'}</button>
        </div>
      </div>
      <div className="tp-link-block">
        <p className="tp-link-label">QR-kod</p>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
          <img src={qrUrl} alt="QR-kod" className="tp-qr-img" />
          <button className="settings-btn settings-btn--sm" onClick={() => copy(url, 'qr')}>{copiedKey === 'qr' ? '✓ Kopierad!' : 'Kopiera länk'}</button>
        </div>
      </div>
      <div className="tp-link-block">
        <p className="tp-link-label">Inbäddningskod (iframe)</p>
        <div className="tp-link-row">
          <code className="tp-link-code tp-link-code--embed">{embedCode}</code>
          <button className="settings-btn settings-btn--sm" onClick={() => copy(embedCode, 'embed')}>{copiedKey === 'embed' ? '✓ Kopierad!' : 'Kopiera'}</button>
        </div>
      </div>
    </div>
  );
}


// ════════════════════════════════════════════════════════════
// TOUCHPOINT MODAL
// ════════════════════════════════════════════════════════════

function TouchpointModal({ tp, dept, chain, onClose, onUpdate, onReset }) {
  const [mode, setMode] = useState(tp.mode || 'app');
  const [tpType, setTpType] = useState(tp.type || 'physical');
  const [localConfig, setLocalConfig] = useState(() => getEffectiveConfig(chain, tp.id));
  function handleModeChange(newMode) { setMode(newMode); onUpdate(tp.id, { mode: newMode }); }
  function handleTypeChange(newType) { setTpType(newType); onUpdate(tp.id, { type: newType }); }
  function handleConfigChange(newConfig) { setLocalConfig(newConfig); onUpdate(tp.id, { configOverride: newConfig }); }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            <span className={`dept-badge ${TYPE_BADGE[tpType]}`}>{TYPE_LABELS[tpType]}</span>
            {dept && <span className="modal-dept-name">{dept.name}</span>}
            <span className="modal-sep">›</span>
            <strong className="modal-tp-name">{tp.name}</strong>
          </div>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="modal-section">
            <h3>Typ av mätpunkt</h3>
            <div className="mode-selector">
              {Object.entries(TYPE_LABELS).map(([key, label]) => (
                <button key={key} className={`mode-btn ${tpType === key ? 'mode-btn--active' : ''}`}
                  onClick={() => handleTypeChange(key)}>{label}</button>
              ))}
            </div>
          </div>
          <div className="modal-section">
            <h3>Insamlingsläge</h3>
            <div className="mode-selector">
              {Object.entries(MODE_LABELS).map(([key, label]) => (
                <button key={key} className={`mode-btn ${mode === key ? 'mode-btn--active' : ''}`}
                  onClick={() => handleModeChange(key)}>{label}</button>
              ))}
            </div>
          </div>
          {mode !== 'app' ? (
            <div className="modal-section"><h3>Länk &amp; kod</h3><TouchpointLinks tp={{ ...tp, mode }} /></div>
          ) : (
            <div className="modal-section"><p className="modal-info-text">Enkät-läge – används direkt i appen på en surfplatta eller skärm.</p></div>
          )}
          <div className="modal-section">
            <h3>Konfiguration</h3>
            <p className="settings-card-desc" style={{ marginBottom: '0.5rem' }}>
              Individuella inställningar. Lämna oförändrat för att ärva kedjans standard.
            </p>
            <ConfigForm config={localConfig} onChange={handleConfigChange} type={tpType} showCountdown={mode === 'app'} />
          </div>
          <div className="modal-section">
            <h3>Kiosk-token</h3>
            <p className="settings-card-desc" style={{ marginBottom: '0.5rem' }}>
              Token identifierar denna mätpunkt för surfplattor i kiosk-läge. URL:en öppnas i Fully Kiosk Browser utan inloggning.
            </p>
            {tp.access_token ? (
              <div className="token-display">
                <code className="token-display-code">{`${window.location.origin}/?tp=${tp.access_token}`}</code>
                <button
                  type="button"
                  className="settings-btn settings-btn--secondary"
                  style={{ marginTop: '0.5rem' }}
                  onClick={async (e) => {
                    await navigator.clipboard.writeText(`${window.location.origin}/?tp=${tp.access_token}`);
                    const orig = e.currentTarget.textContent;
                    e.currentTarget.textContent = '✓ Kopierad!';
                    setTimeout(() => { e.currentTarget.textContent = orig; }, 1500);
                  }}
                >📋 Kopiera URL</button>
              </div>
            ) : (
              <button
                type="button"
                className="settings-btn settings-btn--primary"
                onClick={async () => {
                  // Generera ett nytt UUID-token (32-char hex utan bindestreck)
                  const newToken = crypto.randomUUID().replace(/-/g, '');
                  onUpdate(tp.id, { access_token: newToken });
                }}
              >🔑 Generera token</button>
            )}
          </div>
          <div className="modal-section modal-footer-actions">
            <button className="settings-btn settings-btn--danger-outline"
              onClick={() => { onReset(tp.id, tp.name); onClose(); }}>
              ↺ Nollställ data för denna mätpunkt
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


// ════════════════════════════════════════════════════════════
// USERS-SEKTION (flyttad från AdminPage i Sprint A.7)
// ════════════════════════════════════════════════════════════
//
// Användarhantering, behörigheter och rollsimulering — allt knutet till
// den aktiva kedjans organisation. chain.organization_id = chain.id i
// detta system (1-till-1), men vi använder organization_id-fältet om
// det finns och faller tillbaka på id för säkerhets skull.
//
// Designval:
// - Subflikar (Användare/Behörigheter/Rollsimulering) — samma mönster som
//   Konfiguration-fliken använder för fysisk/online/övriga/eNPS
// - Använder befintliga AdminPage.css-klasser ('admin-*'-prefix) för att
//   minimera regression — ingen omstuvning av styling
// - Återanvänder DeleteDialog från SettingsPage för "ta bort användare"

const USERS_ROLES = ['owner', 'admin', 'manager', 'analytiker'];

function RoleBadge({ role }) {
  return <span className={`role-badge role-badge--${role}`}>{ROLE_LABELS[role] || role}</span>;
}

function InviteForm({ organizationId, myRole, onInvited }) {
  const [email, setEmail]     = useState('');
  const [role, setRole]       = useState('manager');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState('');

  const availableRoles = myRole === 'owner'
    ? ['admin', 'manager', 'analytiker']
    : ['manager', 'analytiker'];

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setError(''); setSuccess(''); setLoading(true);
    try {
      await inviteUser(email.trim(), role, organizationId);
      setSuccess(`Inbjudan skickad till ${email.trim()}`);
      setEmail('');
      onInvited?.();
    } catch (err) {
      setError(err.message || 'Inbjudan misslyckades');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="admin-invite-form">
      <h3 className="admin-section-title">Bjud in användare</h3>
      <form className="admin-form-row" onSubmit={handleSubmit}>
        <input className="admin-input" type="email" placeholder="e-postadress"
          value={email} onChange={(e) => setEmail(e.target.value)} disabled={loading} required />
        <select className="admin-select" value={role}
          onChange={(e) => setRole(e.target.value)} disabled={loading}>
          {availableRoles.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
        <button className="admin-btn admin-btn--primary" type="submit" disabled={loading}>
          {loading ? 'Skickar...' : 'Skicka inbjudan'}
        </button>
      </form>
      {error   && <p className="admin-msg admin-msg--error">✗ {error}</p>}
      {success && <p className="admin-msg admin-msg--success">✓ {success}</p>}
    </div>
  );
}

function UserList({ users, currentUserId, myRole, onRoleChange, onRemove }) {
  if (users.length === 0) return <p className="admin-empty">Inga användare hittades.</p>;
  return (
    <div className="admin-user-list">
      {users.map((u) => {
        const isMe = u.userId === currentUserId;
        const canEdit = !isMe && (myRole === 'owner' || (myRole === 'admin' && u.role !== 'owner'));
        return (
          <div key={u.memberId} className={`admin-user-card ${isMe ? 'admin-user-card--me' : ''}`}>
            <div className="admin-user-info">
              <span className="admin-user-email">{u.email}</span>
              {u.displayName && <span className="admin-user-name">{u.displayName}</span>}
              {isMe && <span className="admin-user-you">Du</span>}
              {u.lastLogin && (
                <span className="admin-user-login">
                  Senast inloggad: {new Date(u.lastLogin).toLocaleDateString('sv-SE')}
                </span>
              )}
            </div>
            <div className="admin-user-actions">
              {canEdit ? (
                <select className="admin-select admin-select--sm" value={u.role}
                  onChange={(e) => onRoleChange(u.memberId, e.target.value)}>
                  {ROLE_ORDER.filter((r) => myRole === 'owner' || r !== 'owner').map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              ) : (
                <RoleBadge role={u.role} />
              )}
              {canEdit && (
                <button className="admin-btn admin-btn--icon" title="Ta bort"
                  onClick={() => onRemove(u)}>×</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function UsersTab({ organizationId, chainName }) {
  const [users, setUsers]                 = useState([]);
  const [myRole, setMyRole]               = useState(null);
  const [currentUser, setCurrentUser]     = useState(null);
  const [loading, setLoading]             = useState(true);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [error, setError]                 = useState('');

  const loadUsers = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const [user, fetchedUsers, role] = await Promise.all([
        getCurrentUser(),
        getOrgUsers(organizationId),
        getMyRole(organizationId),
      ]);
      setCurrentUser(user);
      setUsers(fetchedUsers);
      setMyRole(role);
    } catch (err) {
      setError('Kunde inte ladda användare: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  async function handleRoleChange(memberId, newRole) {
    try {
      await updateUserRole(memberId, newRole);
      await loadUsers();
    } catch (err) {
      setError('Kunde inte ändra roll: ' + err.message);
    }
  }

  async function handleRemoveConfirmed() {
    if (!confirmRemove) return;
    try {
      await removeUserFromOrg(confirmRemove.memberId);
      setConfirmRemove(null);
      await loadUsers();
    } catch (err) {
      setError('Kunde inte ta bort användare: ' + err.message);
    }
  }

  const canManage = myRole === 'owner' || myRole === 'admin';

  return (
    <>
      {error && (
        <div className="admin-error-banner" onClick={() => setError('')}>
          ⚠ {error} <span className="admin-error-close">×</span>
        </div>
      )}

      {canManage && organizationId && (
        <InviteForm organizationId={organizationId} myRole={myRole} onInvited={loadUsers} />
      )}

      <div className="admin-users-section">
        <h3 className="admin-section-title">
          Användare{chainName ? ` — ${chainName}` : ''}
          {!loading && <span className="admin-user-count">{users.length} st</span>}
          {myRole && <span style={{ marginLeft: '0.75rem' }}><RoleBadge role={myRole} /></span>}
        </h3>
        {loading ? <p className="admin-empty">Laddar...</p> : (
          <UserList
            users={users}
            currentUserId={currentUser?.id}
            myRole={myRole}
            onRoleChange={handleRoleChange}
            onRemove={(u) => setConfirmRemove(u)}
          />
        )}
      </div>

      {confirmRemove && (
        <DeleteDialog
          message={`Ta bort ${confirmRemove.email} från organisationen?`}
          onConfirm={handleRemoveConfirmed}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </>
  );
}

function PermissionsMatrix({ organizationId }) {
  const { reloadRole } = useRole();
  const [perms, setPerms]   = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState('');

  useEffect(() => {
    if (!organizationId) return;
    getPermissions(organizationId)
      .then(setPerms)
      .catch(() => setPerms({ ...DEFAULT_PERMISSIONS }));
  }, [organizationId]);

  function toggle(feature, role) {
    if (role === 'owner') return;
    setPerms((prev) => ({
      ...prev,
      [feature]: { ...prev[feature], [role]: !prev[feature][role] },
    }));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true); setError('');
    try {
      await savePermissions(organizationId, perms);
      // Ladda om roll/permissions i RoleContext så Navigation och Rollsimulering
      // reflekterar ändringen direkt (ingen refresh krävs).
      await reloadRole();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError('Kunde inte spara: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!perms) return <p className="admin-empty">Laddar behörigheter...</p>;

  return (
    <div className="admin-perms">
      <div className="admin-perms-header">
        <p className="admin-perms-desc">
          Kryssa i vilka roller som ska ha tillgång till varje funktion.
          Owner har alltid full tillgång och kan inte ändras.
        </p>
        <div className="admin-perms-actions">
          <button className="admin-btn admin-btn--ghost admin-btn--sm"
            onClick={() => { setPerms({ ...DEFAULT_PERMISSIONS }); setSaved(false); }}>
            Återställ till standard
          </button>
          <button className="admin-btn admin-btn--primary admin-btn--sm"
            onClick={handleSave} disabled={saving}>
            {saving ? 'Sparar...' : 'Spara behörigheter'}
          </button>
        </div>
      </div>

      {saved && <p className="admin-msg admin-msg--success">✓ Behörigheter sparade</p>}
      {error && <p className="admin-msg admin-msg--error">✗ {error}</p>}

      <div className="admin-perms-table-wrap">
        <table className="admin-perms-table">
          <thead>
            <tr>
              <th className="admin-perms-th-feature">Funktion</th>
              {USERS_ROLES.map((r) => (
                <th key={r} className="admin-perms-th-role"><RoleBadge role={r} /></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_GROUPS.map((group) => (
              <React.Fragment key={group.group}>
                <tr className="admin-perms-group-row">
                  <td colSpan={USERS_ROLES.length + 1} className="admin-perms-group-label">
                    {group.group}
                  </td>
                </tr>
                {group.features.map((feature) => (
                  <tr key={feature.key} className="admin-perms-row">
                    <td className="admin-perms-feature">{feature.label}</td>
                    {USERS_ROLES.map((role) => (
                      <td key={role} className="admin-perms-cell">
                        <input
                          type="checkbox"
                          className="admin-perms-checkbox"
                          checked={role === 'owner' ? true : (perms[feature.key]?.[role] ?? false)}
                          onChange={() => toggle(feature.key, role)}
                          disabled={role === 'owner'}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RoleSimulator() {
  const { realRole, simulatedRole, startSimulation, stopSimulation } = useRole();
  const simulatableRoles = ROLE_ORDER.filter((r) => r !== 'owner' && r !== realRole);

  return (
    <div className="admin-simulator">
      <h3 className="admin-section-title">Rollsimulering</h3>
      <p className="admin-perms-desc">
        Simulera hur appen ser ut för olika användarroller. Bara du ser simuleringen —
        din faktiska roll påverkas inte.
      </p>

      {simulatedRole ? (
        <div className="admin-sim-active">
          <div className="admin-sim-banner">
            <span>🎭 Simulerar <strong>{ROLE_LABELS[simulatedRole]}</strong></span>
            <button className="admin-btn admin-btn--danger admin-btn--sm" onClick={stopSimulation}>
              Avsluta simulering
            </button>
          </div>
          <p className="admin-perms-desc" style={{ marginTop: '0.5rem' }}>
            Navigera runt i appen för att se vad denna roll kan komma åt.
            Kom tillbaka hit för att avsluta.
          </p>
        </div>
      ) : (
        <div className="admin-sim-buttons">
          {simulatableRoles.map((role) => (
            <button key={role} className="admin-sim-btn" onClick={() => startSimulation(role)}>
              <span>🎭 Simulera {ROLE_LABELS[role]}</span>
              <RoleBadge role={role} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UsersSection({ chain }) {
  const [tab, setTab] = useState('users');

  const SUB_TABS = [
    { key: 'users',       label: 'Användare' },
    { key: 'permissions', label: 'Behörigheter' },
    { key: 'simulation',  label: 'Rollsimulering' },
  ];

  if (!chain) {
    return (
      <div className="settings-card">
        <h2>Användare</h2>
        <p className="settings-empty">Välj en kedja under Kedjor.</p>
      </div>
    );
  }

  // chain.id = organization_id i detta system (1-till-1). Vi använder
  // organization_id om det finns för defensiv kompatibilitet, annars id.
  const organizationId = chain.organization_id || chain.id;

  return (
    <div className="settings-card">
      <h2>Användare — {chain.name}</h2>
      <p className="settings-card-desc">
        Hantera vilka som har tillgång till {chain.name} och vad de får göra.
      </p>
      <div className="config-tabs">
        {SUB_TABS.map((t) => (
          <button key={t.key}
            className={`config-tab ${tab === t.key ? 'config-tab--active' : ''}`}
            onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      {tab === 'users'       && <UsersTab organizationId={organizationId} chainName={chain.name} />}
      {tab === 'permissions' && <PermissionsMatrix organizationId={organizationId} />}
      {tab === 'simulation'  && <RoleSimulator />}
    </div>
  );
}


// ════════════════════════════════════════════════════════════
// HUVUDKOMPONENT
// ════════════════════════════════════════════════════════════

export default function SettingsPage({ onSettingsChange, onChainSelect, initialChains }) {
  const [section, setSection] = useState('chains');
  const [chains, setChains] = useState([]);
  const [activeId, setActiveId] = useState(() => getActiveChainId() || '');
  const [loadingChains, setLoadingChains] = useState(true);

  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmReset, setConfirmReset] = useState(null);
  const [confirmMigrate, setConfirmMigrate] = useState(null);
  const [migrateResult, setMigrateResult] = useState(null);

  const [newChainName, setNewChainName] = useState('');
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  const [newDeptName, setNewDeptName] = useState('');
  const [newDeptCode, setNewDeptCode] = useState('');
  const [deptDragId, setDeptDragId] = useState(null);
  const [deptDragOverId, setDeptDragOverId] = useState(null);
  const [editingDeptId, setEditingDeptId] = useState(null);
  const [editingDeptText, setEditingDeptText] = useState('');
  const [editingCodeId, setEditingCodeId] = useState(null);
  const [editingCodeText, setEditingCodeText] = useState('');
  const [expandedDeptId, setExpandedDeptId] = useState(null);
  const [newTpByDept, setNewTpByDept] = useState({});
  const [selectedTp, setSelectedTp] = useState(null);

  const [configTab, setConfigTab] = useState('physical');
  const [confirmApplyToAll, setConfirmApplyToAll] = useState(null);

  const [cropperSrc, setCropperSrc] = React.useState(null);

  // Initialisera kedjor från App.js-prop. App.js är ensam ansvarig för
  // att ladda från Supabase via getAssembledCustomers — vi tar bara emot.
  React.useEffect(() => {
    if (initialChains && initialChains.length > 0) {
      setChains(initialChains);
      const savedId = getActiveChainId();
      const validId = initialChains.find(c => c.id === savedId) ? savedId : (initialChains[0]?.id || '');
      setActiveId(validId);
    } else {
      setChains([]);
    }
    setLoadingChains(false);
  }, [initialChains]); // eslint-disable-line react-hooks/exhaustive-deps

  // Be App.js om en ny laddning från Supabase. Mutation-handlers nedan
  // skriver till Supabase och kallar refresh() — App.js plockar upp
  // ändringen och pushar tillbaka via initialChains.
  function refresh() {
    onSettingsChange();
  }

  const active = chains.find((c) => c.id === activeId) || null;
  const departments = (active?.departments || []).slice().sort((a, b) => a.order - b.order);
  const touchpoints = active?.touchpoints || [];


  // ── Driftstatus (Sprint A.5 Del 2) ────────────────────
  // Alltid synlig prick på fysiska mätpunkter. Pollar var 30s i Avdelningar-vyn.
  // tick driver om-rendering var minut så "X min sedan" i tooltips håller sig fräsch.
  const physicalTpIds = useMemo(
    () => touchpoints.filter(tp => (tp.type || 'physical') === 'physical').map(tp => tp.id),
    [touchpoints]
  );
  const [driftStatusMap, setDriftStatusMap] = useState(() => new Map());
  // eslint-disable-next-line no-unused-vars
  const [driftTick, setDriftTick] = useState(0);

  useEffect(() => {
    if (section !== 'departments') return;
    if (physicalTpIds.length === 0) return;

    let cancelled = false;
    const fetchStatuses = async () => {
      const statuses = await getKioskStatuses(physicalTpIds);
      if (!cancelled) setDriftStatusMap(statuses);
    };

    fetchStatuses();
    const intervalId = setInterval(fetchStatuses, DRIFTSTATUS_POLL_MS);

    return () => { cancelled = true; clearInterval(intervalId); };
  }, [section, physicalTpIds]);

  useEffect(() => {
    if (section !== 'departments') return;
    const id = setInterval(() => setDriftTick(v => v + 1), 60 * 1000);
    return () => clearInterval(id);
  }, [section]);


  // ── Chains ──────────────────────────────────────────────

  async function handleAddChain(e) {
    e.preventDefault();
    if (!newChainName.trim()) return;
    try {
      const newChain = await addChain(newChainName.trim());
      setNewChainName('');
      // Hoppa direkt till den nya kedjan — matchar originalbeteendet
      // där settings.addChain satte activeChainId automatiskt.
      setActiveChainId(newChain.id);
      if (onChainSelect) onChainSelect(newChain.id);
      refresh();
    } catch (err) {
      alert('Fel: ' + err.message);
    }
  }

  async function handleChainDrop(targetId) {
    if (!dragId || dragId === targetId) {
      setDragId(null); setDragOverId(null); return;
    }
    const ids = chains.map((c) => c.id);
    const fi = ids.indexOf(dragId); const ti = ids.indexOf(targetId);
    ids.splice(fi, 1); ids.splice(ti, 0, dragId);
    setDragId(null); setDragOverId(null);
    try {
      await reorderChains(ids);
      refresh();
    } catch (err) {
      alert('Fel: ' + err.message);
    }
  }

  async function handleChainLogoSet(dataUrl) {
    if (!active) return;
    try {
      await updateChain(active.id, { customLogo: dataUrl });
      setCropperSrc(null);
      refresh();
    } catch (err) {
      alert('Fel: ' + err.message);
    }
  }

  async function handleChainLogoRemove() {
    if (!active) return;
    try {
      await updateChain(active.id, { customLogo: null });
      refresh();
    } catch (err) {
      alert('Fel: ' + err.message);
    }
  }


  // ── Departments ────────────────────────────────────────

  async function handleAddDept(e) {
    e.preventDefault();
    if (!newDeptName.trim() || !active) return;
    const code = newDeptCode.trim() || generateDeptCode(active.departments);
    try {
      const dept = await addDepartment(active.id, newDeptName.trim(), code);
      setNewDeptName(''); setNewDeptCode('');
      setExpandedDeptId(dept?.id || null);
      refresh();
    } catch (err) {
      alert('Fel: ' + err.message);
    }
  }

  async function handleDeptDrop(targetId) {
    if (!deptDragId || deptDragId === targetId || !active) {
      setDeptDragId(null); setDeptDragOverId(null); return;
    }
    const ids = departments.map((d) => d.id);
    const fi = ids.indexOf(deptDragId); const ti = ids.indexOf(targetId);
    ids.splice(fi, 1); ids.splice(ti, 0, deptDragId);
    setDeptDragId(null); setDeptDragOverId(null);
    try {
      await reorderDepartments(ids);
      refresh();
    } catch (err) {
      alert('Fel: ' + err.message);
    }
  }

  async function handleDeptNameSave(deptId, newName) {
    const trimmed = (newName || '').trim();
    if (!trimmed) { setEditingDeptId(null); return; }
    try {
      await updateDepartment(deptId, { name: trimmed });
      setEditingDeptId(null);
      refresh();
    } catch (err) {
      alert('Fel: ' + err.message);
    }
  }

  async function handleDeptCodeSave(deptId, newCode) {
    try {
      await updateDepartment(deptId, { uniqueCode: (newCode || '').trim() });
      setEditingCodeId(null);
      refresh();
    } catch (err) {
      alert('Fel: ' + err.message);
    }
  }

  function handleMigrateClick(dept, deptTps) {
    setConfirmMigrate({
      deptId: dept.id, deptName: dept.name,
      tpNames: deptTps.map((t) => t.name),
      otherCount: departments.length - 1,
    });
  }

  async function executeMigrate() {
    if (!confirmMigrate || !active) return;
    try {
      const result = await migrateTouchpointsFromDept(active.id, confirmMigrate.deptId);
      setConfirmMigrate(null);
      setMigrateResult(result);
      setTimeout(() => setMigrateResult(null), 4000);
      refresh();
    } catch (err) {
      setConfirmMigrate(null);
      alert('Fel: ' + err.message);
    }
  }


  // ── Touchpoints ────────────────────────────────────────

  async function handleAddTp(e, deptId) {
    e.preventDefault();
    const state = newTpByDept[deptId] || {};
    const name = (state.name || '').trim();
    const type = state.type || 'physical';
    if (!name || !active) return;
    try {
      await addTouchpoint(active.id, name, deptId, type);
      setNewTpByDept((prev) => ({
        ...prev,
        [deptId]: { name: '', type: prev[deptId]?.type || 'physical' },
      }));
      refresh();
    } catch (err) {
      alert('Fel: ' + err.message);
    }
  }

  // setActiveTouchpoint är UI-state (per webbläsare) och stannar i settings.js
  function handleSetActiveTp(tpId) {
    if (!active) return;
    setActiveTouchpoint(active.id, active.activeTouchpointId === tpId ? null : tpId);
    refresh();
  }

  async function handleTpUpdate(tpId, updates) {
    if (!active) return;
    try {
      await updateTouchpoint(tpId, updates);
      refresh();
    } catch (err) {
      alert('Fel: ' + err.message);
    }
  }


  // ── Delete ──────────────────────────────────────────────

  async function executeDelete() {
    if (!confirmDelete) return;
    const { type, id } = confirmDelete;
    setConfirmDelete(null);
    try {
      if (type === 'chain')      await deleteChain(id);
      else if (type === 'dept')  await deleteDepartment(id);
      else if (type === 'tp')    await deleteTouchpoint(id);
      refresh();
    } catch (err) {
      alert('Fel: ' + err.message);
    }
  }


  // ── Reset (nollställ svar) ─────────────────────────────

  async function executeReset() {
    if (!confirmReset) return;
    const target = confirmReset;
    setConfirmReset(null);
    try {
      if (target.type === 'chain') await resetChainResponses(target.id);
      else                          await resetTouchpointResponses(target.id);
      refresh();
    } catch (err) {
      alert('Fel: ' + err.message);
    }
  }


  // ── Konfiguration (kedjenivå) ──────────────────────────
  //
  // Uppdaterar kedjans config OCH propagerar till alla mätpunkter med
  // matching type via applyConfigToType. Detta är samma beteende som
  // föregående version — användaren har separat "Tillämpa på alla"-knapp
  // som gör samma sak men med explicit bekräftelse.

  async function handleConfigChange(type, newConfig) {
    if (!active) return;
    const key = type === 'physical' ? 'physicalConfig'
              : type === 'online'   ? 'onlineConfig'
              : type === 'enps'     ? 'enpsConfig'
              :                       'otherConfig';

    const updatedConfig = {
      physicalConfig: active.physicalConfig,
      onlineConfig:   active.onlineConfig,
      otherConfig:    active.otherConfig,
      enpsConfig:     active.enpsConfig,
      [key]: newConfig,
    };

    try {
      await updateChain(active.id, { config: updatedConfig });
      await applyConfigToType(active.id, type, newConfig);
      onSettingsChange();
    } catch (err) {
      alert('Fel: ' + err.message);
    }
  }

  async function handleApplyToAll(type) {
    if (!active) return;
    const key = type === 'physical' ? 'physicalConfig'
              : type === 'online'   ? 'onlineConfig'
              : type === 'enps'     ? 'enpsConfig'
              :                       'otherConfig';
    const config = active[key] || getDefaultConfig(type);
    try {
      await applyConfigToType(active.id, type, config);
      onSettingsChange();
    } catch (err) {
      alert('Fel: ' + err.message);
    }
  }


  // ── Render ─────────────────────────────────────────────

  if (loadingChains) {
    return <div style={{ padding: '2rem', color: 'var(--color-text-light)' }}>Laddar inställningar...</div>;
  }

  return (
    <div className="settings-layout">
      {confirmDelete && <DeleteDialog message={`Ta bort "${confirmDelete.label}"? Detta kan inte ångras.`} onConfirm={executeDelete} onCancel={() => setConfirmDelete(null)} />}
      {confirmReset && <ResetDialog label={confirmReset.label} onConfirm={executeReset} onCancel={() => setConfirmReset(null)} />}
      {confirmMigrate && (
        <ConfirmDialog
          message={`Synka mätpunkter från "${confirmMigrate.deptName}" till alla ${confirmMigrate.otherCount} övriga avdelningar?`}
          detail={`Synkar typ, läge och individuella inställningar för: ${confirmMigrate.tpNames.join(', ')}. Befintliga mätpunkter uppdateras — nya skapas om de saknas.`}
          onConfirm={executeMigrate} onCancel={() => setConfirmMigrate(null)} />
      )}
      {confirmApplyToAll && (
        <ConfirmDialog
          message={`Tillämpa på alla ${confirmApplyToAll.tpCount} ${TYPE_LABELS[confirmApplyToAll.type].toLowerCase()}-mätpunkter?`}
          detail="Skriver över deras individuella inställningar med kedjans nuvarande konfiguration."
          onConfirm={() => { handleApplyToAll(confirmApplyToAll.type); setConfirmApplyToAll(null); }}
          onCancel={() => setConfirmApplyToAll(null)}
        />
      )}
      {selectedTp && (
        <TouchpointModal tp={selectedTp.tp} dept={selectedTp.dept} chain={active}
          onClose={() => { setSelectedTp(null); refresh(); }}
          onUpdate={handleTpUpdate}
          onReset={(id, name) => setConfirmReset({ type: 'tp', id, label: name })} />
      )}

      <nav className="settings-menu">
        <p className="settings-menu-label">Meny</p>
        {MENU_ITEMS.map((item) => (
          <button key={item.key}
            className={`settings-menu-item ${section === item.key ? 'settings-menu-item--active' : ''}`}
            onClick={() => setSection(item.key)}>{item.label}</button>
        ))}
      </nav>

      <div className="settings-content">

        {section === 'chains' && (
          <div className="settings-card">
            <h2>Kedjor</h2>
            <form className="settings-add-form" onSubmit={handleAddChain}>
              <input type="text" placeholder="Ny kedja..." value={newChainName}
                onChange={(e) => setNewChainName(e.target.value)} className="settings-input" />
              <button type="submit" className="settings-btn settings-btn--primary">Lägg till</button>
            </form>
            <ul className="customer-list">
              {chains.map((c) => (
                <li key={c.id}
                  className={'customer-item' + (c.id === activeId ? ' customer-item--active' : '') + (dragId === c.id ? ' customer-item--dragging' : '') + (dragOverId === c.id ? ' customer-item--drag-over' : '')}
                  draggable
                  onDragStart={() => setDragId(c.id)}
                  onDragOver={(e) => { e.preventDefault(); if (c.id !== dragId) setDragOverId(c.id); }}
                  onDrop={() => handleChainDrop(c.id)}
                  onDragEnd={() => { setDragId(null); setDragOverId(null); }}
                >
                  <span className="customer-drag-handle">&#x2630;</span>
                  <button className="customer-select" onClick={() => {
                    setActiveChainId(c.id);
                    if (onChainSelect) onChainSelect(c.id);
                    refresh();
                  }}>
                    <span className="customer-name">{c.name}</span>
                    {c.id === activeId && <span className="customer-badge">Aktiv</span>}
                  </button>
                  <button className="reset-btn" title="Nollställ data" onClick={() => setConfirmReset({ type: 'chain', id: c.id, label: c.name })}>↺</button>
                  <button className="customer-delete" onClick={() => setConfirmDelete({ type: 'chain', id: c.id, label: c.name })}>&times;</button>
                </li>
              ))}
            </ul>
            {active && (
              <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border)' }}>
                <p className="settings-card-desc">Logotyp för {active.name}</p>
                {active.customLogo ? (
                  <div className="setting-logo-preview">
                    <img src={active.customLogo} alt="Logo" />
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <label className="settings-upload">
                        <span className="settings-btn settings-btn--ghost">Byt logotyp...</span>
                        <input type="file" accept="image/*" hidden onChange={(e) => {
                          const file = e.target.files[0]; if (!file) return;
                          const reader = new FileReader();
                          reader.onload = () => setCropperSrc(reader.result);
                          reader.readAsDataURL(file);
                        }} />
                      </label>
                      <button className="settings-btn settings-btn--danger" onClick={handleChainLogoRemove}>Ta bort logo</button>
                    </div>
                  </div>
                ) : (
                  <label className="settings-upload">
                    <span className="settings-btn settings-btn--primary">Välj logotyp...</span>
                    <input type="file" accept="image/*" hidden onChange={(e) => {
                      const file = e.target.files[0]; if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => setCropperSrc(reader.result);
                      reader.readAsDataURL(file);
                    }} />
                  </label>
                )}
                {cropperSrc && (
                  <LogoCropperModal
                    imageSrc={cropperSrc}
                    onSave={handleChainLogoSet}
                    onCancel={() => setCropperSrc(null)}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {section === 'users' && <UsersSection chain={active} />}

        {section === 'departments' && (
          <div className="settings-card">
            <h2>Avdelningar{active ? ` — ${active.name}` : ''}</h2>
            {!active ? <p className="settings-empty">Välj en kedja under Kedjor.</p> : (
              <>
                <p className="settings-card-desc">Avdelningar är containers för mätpunkter. Unikt ID auto-genereras om inget anges. Dubbelklicka på namn eller ID för att redigera.</p>
                {migrateResult && (
                  <div className="migrate-result">
                    ✓ Synkning klar – {migrateResult.added} mätpunkter skapade, {migrateResult.updated} uppdaterade{migrateResult.skipped > 0 ? `, ${migrateResult.skipped} redan identiska.` : '.'}
                  </div>
                )}
                <form className="settings-add-form" onSubmit={handleAddDept}>
                  <input type="text" placeholder="Namn (t.ex. ICA Stockholm City)" value={newDeptName} onChange={(e) => setNewDeptName(e.target.value)} className="settings-input" />
                  <input type="text" placeholder="Unikt ID (auto)" value={newDeptCode} onChange={(e) => setNewDeptCode(e.target.value)} className="settings-input settings-input--code" />
                  <button type="submit" className="settings-btn settings-btn--primary">Lägg till</button>
                </form>
                {departments.length === 0 ? <p className="settings-empty">Inga avdelningar ännu.</p> : (
                  <div className="dept-accordion">
                    {departments.map((d) => {
                      const deptTps = touchpoints.filter((t) => t.departmentId === d.id).sort((a, b) => a.order - b.order);
                      const isExpanded = expandedDeptId === d.id;
                      const deptState = newTpByDept[d.id] || { name: '', type: 'physical' };
                      const otherDeptsCount = departments.length - 1;
                      return (
                        <div key={d.id}
                          className={'dept-accordion-item' + (deptDragId === d.id ? ' dept-item--dragging' : '') + (deptDragOverId === d.id ? ' dept-item--drag-over' : '')}
                          draggable
                          onDragStart={() => setDeptDragId(d.id)}
                          onDragOver={(e) => { e.preventDefault(); if (d.id !== deptDragId) setDeptDragOverId(d.id); }}
                          onDrop={() => handleDeptDrop(d.id)}
                          onDragEnd={() => { setDeptDragId(null); setDeptDragOverId(null); }}
                        >
                          <div className="dept-accordion-header" onClick={() => setExpandedDeptId(isExpanded ? null : d.id)}>
                            <span className="customer-drag-handle" onClick={(e) => e.stopPropagation()}>&#x2630;</span>
                            {editingDeptId === d.id ? (
                              <form className="predefined-edit-form" style={{ flex: 1 }} onClick={(e) => e.stopPropagation()}
                                onSubmit={(e) => { e.preventDefault(); handleDeptNameSave(d.id, editingDeptText); }}>
                                <input className="settings-input" value={editingDeptText} onChange={(e) => setEditingDeptText(e.target.value)} autoFocus
                                  onBlur={() => setEditingDeptId(null)}
                                  onKeyDown={(e) => { if (e.key === 'Escape') setEditingDeptId(null); }} />
                              </form>
                            ) : (
                              <span className="dept-accordion-name" onDoubleClick={(e) => { e.stopPropagation(); setEditingDeptId(d.id); setEditingDeptText(d.name); }} title="Dubbelklicka för att redigera namn">{d.name}</span>
                            )}
                            {editingCodeId === d.id ? (
                              <form style={{ flexShrink: 0 }} onClick={(e) => e.stopPropagation()}
                                onSubmit={(e) => { e.preventDefault(); handleDeptCodeSave(d.id, editingCodeText); }}>
                                <input className="settings-input settings-input--code" value={editingCodeText} onChange={(e) => setEditingCodeText(e.target.value)} autoFocus
                                  onBlur={() => handleDeptCodeSave(d.id, editingCodeText)}
                                  onKeyDown={(e) => { if (e.key === 'Escape') setEditingCodeId(null); }} />
                              </form>
                            ) : (
                              <span className="dept-code dept-code--editable" onDoubleClick={(e) => { e.stopPropagation(); setEditingCodeId(d.id); setEditingCodeText(d.uniqueCode || ''); }} title="Dubbelklicka för att redigera ID">{d.uniqueCode || '–'}</span>
                            )}
                            <span className="dept-tp-count">{deptTps.length} mätpunkter</span>
                            <span className="dept-accordion-chevron">{isExpanded ? '▲' : '▼'}</span>
                            <button className="customer-delete" onClick={(e) => { e.stopPropagation(); setConfirmDelete({ type: 'dept', id: d.id, label: d.name }); }}>&times;</button>
                          </div>
                          {isExpanded && (
                            <div className="dept-accordion-body">
                              {deptTps.length === 0 ? (
                                <p className="settings-empty" style={{ paddingBottom: '0.5rem' }}>Inga mätpunkter ännu. Lägg till nedan.</p>
                              ) : (
                                <>
                                  <ul className="tp-list">
                                    {deptTps.map((tp) => {
                                      const isActive = active.activeTouchpointId === tp.id;
                                      const isPhysical = (tp.type || 'physical') === 'physical';
                                      const driftData = isPhysical ? driftStatusMap.get(tp.id) : null;
                                      const driftStatus = isPhysical
                                        ? computeKioskStatus(driftData?.lastSeenAt)
                                        : null;
                                      const driftTooltip = isPhysical
                                        ? describeKioskStatus(driftStatus, driftData?.lastSeenAt, driftData?.lastResponseAt)
                                        : '';
                                      return (
                                        <li key={tp.id} className={'tp-item tp-item--in-dept tp-item--has-token' + (isActive ? ' tp-item--active' : '')}>
                                          <div className="tp-item-top">
                                            <button className="tp-detail-btn" onClick={() => setSelectedTp({ tp, dept: d })}>
                                              <span className={`dept-badge ${TYPE_BADGE[tp.type] || ''}`}>{TYPE_LABELS[tp.type] || tp.type}</span>
                                              <span className="tp-name">{tp.name}</span>
                                              {isPhysical && (
                                                <span
                                                  className={`tp-driftstatus-dot tp-driftstatus-dot--${driftStatus || 'never'}`}
                                                  title={driftTooltip}
                                                  aria-label={driftTooltip}
                                                />
                                              )}
                                              <span className="tp-mode-badge">{MODE_LABELS[tp.mode] || tp.mode}</span>
                                            </button>
                                            <button className={`dept-activate-btn ${isActive ? 'dept-activate-btn--on' : ''}`} onClick={() => handleSetActiveTp(tp.id)}>{isActive ? 'Aktiv' : 'Sätt aktiv'}</button>
                                            <button className="customer-delete" onClick={() => setConfirmDelete({ type: 'tp', id: tp.id, label: tp.name })}>&times;</button>
                                          </div>
                                          <div className="tp-token-row">
                                            <span className="tp-token-label">Token</span>
                                            {tp.access_token ? (
                                              <>
                                                <code className="tp-token-code">{tp.access_token}</code>
                                                <button
                                                  type="button"
                                                  className="tp-token-copy"
                                                  title="Kopiera kiosk-URL"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    navigator.clipboard.writeText(`${window.location.origin}/?tp=${tp.access_token}`);
                                                    const btn = e.currentTarget;
                                                    btn.textContent = '✓';
                                                    setTimeout(() => { if (btn) btn.textContent = '📋'; }, 1500);
                                                  }}
                                                >📋</button>
                                              </>
                                            ) : (
                                              <span className="tp-token-na">n/a — generera via inställningar</span>
                                            )}
                                          </div>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                  {otherDeptsCount > 0 && (
                                    <div className="migrate-btn-wrap">
                                      <button className="settings-btn settings-btn--migrate" onClick={() => handleMigrateClick(d, deptTps)}>
                                        ⇄ Synka till alla {otherDeptsCount} övriga avdelningar
                                      </button>
                                      <p className="migrate-btn-hint">Kopierar typ, läge och individuella inställningar (configOverride). Kedjans standardkonfiguration synkas via Konfiguration-fliken.</p>
                                    </div>
                                  )}
                                </>
                              )}
                              <form className="settings-add-form tp-add-form" onSubmit={(e) => handleAddTp(e, d.id)}>
                                <input type="text" placeholder="Ny mätpunkt (t.ex. Kassa 1)" value={deptState.name}
                                  onChange={(e) => setNewTpByDept((prev) => ({ ...prev, [d.id]: { ...prev[d.id], name: e.target.value } }))} className="settings-input" />
                                <select value={deptState.type}
                                  onChange={(e) => setNewTpByDept((prev) => ({ ...prev, [d.id]: { ...prev[d.id], type: e.target.value } }))} className="settings-select">
                                  <option value="physical">Fysisk plats</option>
                                  <option value="online">Online</option>
                                  <option value="other">Övriga</option>
                                  <option value="enps">eNPS</option>
                                </select>
                                <button type="submit" className="settings-btn settings-btn--primary">Lägg till</button>
                              </form>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {section === 'config' && (
          <div className="settings-card">
            <h2>Konfiguration{active ? ` — ${active.name}` : ''}</h2>
            {!active ? <p className="settings-empty">Välj en kedja under Kedjor.</p> : (
              <>
                <p className="settings-card-desc">Standardinställningar per typ. Nya mätpunkter ärver dessa automatiskt.</p>
                <div className="config-tabs">
                  {['physical', 'online', 'other', 'enps'].map((type) => (
                    <button key={type} className={`config-tab ${configTab === type ? 'config-tab--active' : ''}`}
                      onClick={() => setConfigTab(type)}>{TYPE_LABELS[type]}</button>
                  ))}
                </div>
                {['physical', 'online', 'other', 'enps'].map((type) => {
                  if (configTab !== type) return null;
                  const configKey = type === 'physical' ? 'physicalConfig' : type === 'online' ? 'onlineConfig' : type === 'enps' ? 'enpsConfig' : 'otherConfig';
                  const config = active[configKey] || getDefaultConfig(type);
                  const tpCount = touchpoints.filter((t) => t.type === type).length;
                  return (
                    <div key={type}>
                      <ConfigForm config={config} type={type} showCountdown={true}
                        onChange={(newConfig) => handleConfigChange(type, newConfig)} />
                      {tpCount > 0 && (
                        <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border)' }}>
                          <button className="settings-btn settings-btn--primary" onClick={() => handleApplyToAll(type)}>
                            Tillämpa på alla {tpCount} {TYPE_LABELS[type].toLowerCase()}-mätpunkter
                          </button>
                          <p className="settings-card-desc" style={{ marginTop: '0.4rem', marginBottom: 0 }}>Skriver över individuella inställningar.</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
