import React, { useState } from 'react';
import {
  getChains, getActiveChainId, setActiveChainId,
  addChain, updateChain, deleteChain, reorderChains,
  addDepartment, updateDepartment, deleteDepartment, reorderDepartments,
  applyConfigToType, migrateTouchpointsFromDept,
  addTouchpoint, updateTouchpoint, deleteTouchpoint, setActiveTouchpoint,
  getTouchpointUrl, getDefaultConfig, getEffectiveConfig,
  DEMO_CHAIN_ID, TYPE_LABELS, MODE_LABELS,
} from '../utils/settings';
import { resetChainResponses, resetTouchpointResponses } from '../utils/storage';
import { parseBackupFile, importSelectedBackup } from '../utils/backup';
import MigrationTool from './MigrationTool';
import './SettingsPage.css';
import { supabase } from '../utils/supabaseClient';

// ── Supabase-synkhjälpare ─────────────────────────────────────
async function syncChainToSupabase(chain) {
  try {
    await supabase.from('chains').upsert({
      id: chain.id, organization_id: chain.id, name: chain.name,
      custom_logo: chain.customLogo || null,
      config: { physicalConfig: chain.physicalConfig, onlineConfig: chain.onlineConfig, otherConfig: chain.otherConfig, enpsConfig: chain.enpsConfig },
      sort_order: chain.sortOrder || 0, is_active: true,
    }, { onConflict: 'id' });
  } catch (e) { console.error('[Settings] syncChain:', e?.message); }
}
async function syncDeptToSupabase(dept, chainId) {
  try {
    await supabase.from('departments').upsert({ id: dept.id, chain_id: chainId, name: dept.name, sort_order: dept.order || 0 }, { onConflict: 'id' });
  } catch (e) { console.error('[Settings] syncDept:', e?.message); }
}
async function syncTouchpointToSupabase(tp, chainId) {
  try {
    await supabase.from('touchpoints').upsert({
      id: tp.id, chain_id: chainId, department_id: tp.departmentId || null, name: tp.name,
      sort_order: tp.order || 0, is_active: true, config_override: tp.configOverride || null,
      type: tp.type || 'physical', mode: tp.mode || 'app',
    }, { onConflict: 'id' });
  } catch (e) { console.error('[Settings] syncTp:', e?.message); }
}
async function softDeleteChainInSupabase(id) {
  try { await supabase.from('chains').update({ deleted_at: new Date().toISOString() }).eq('id', id); }
  catch (e) { console.error('[Settings] deleteChain:', e?.message); }
}
async function softDeleteDeptInSupabase(id) {
  try { await supabase.from('departments').update({ deleted_at: new Date().toISOString() }).eq('id', id); }
  catch (e) { console.error('[Settings] deleteDept:', e?.message); }
}
async function softDeleteTpInSupabase(id) {
  try { await supabase.from('touchpoints').update({ deleted_at: new Date().toISOString() }).eq('id', id); }
  catch (e) { console.error('[Settings] deleteTp:', e?.message); }
}


function exportSelectedBackup(selectedIds, chains) {
  const allResponses = JSON.parse(localStorage.getItem('npsResponses') || '[]');
  const data = {
    npsCustomers: chains.filter((c) => selectedIds.includes(c.id)),
    npsResponses: allResponses.filter((r) => selectedIds.includes(r.customerId)),
    npsActiveCustomerId: localStorage.getItem('npsActiveCustomerId'),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `feedback-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

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
  { key: 'departments', label: 'Avdelningar' },
  { key: 'config', label: 'Konfiguration' },
  { key: 'backup', label: 'Säkerhetskopiering' },
];

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
                borderColor: answer.polarity === 'positive' ? '#27ae60' : '#ccc',
                background: answer.polarity === 'positive' ? '#27ae60' : 'transparent',
                color: answer.polarity === 'positive' ? '#fff' : '#888',
              }}>+</button>
            <button type="button" title="Negativt alternativ" onClick={() => togglePolarity(i, 'negative')}
              style={{
                width: '1.6rem', height: '1.6rem', borderRadius: '50%', border: '1.5px solid',
                fontWeight: 700, fontSize: '1.1rem', lineHeight: 1, cursor: 'pointer', flexShrink: 0,
                borderColor: answer.polarity === 'negative' ? '#e74c3c' : '#ccc',
                background: answer.polarity === 'negative' ? '#e74c3c' : 'transparent',
                color: answer.polarity === 'negative' ? '#fff' : '#888',
              }}>−</button>
            <button className="predefined-remove"
              onClick={() => onChange(normalized.filter((_, idx) => idx !== i))}>&times;</button>
          </li>
        ))}
      </ul>
      {normalized.length < 6 && (
        <form className="predefined-add-form" onSubmit={(e) => {
          e.preventDefault(); if (!newAnswer.trim()) return;
          onChange([...normalized, { text: newAnswer.trim(), polarity: null }]); setNewAnswer('');
        }}>
          <input type="text" placeholder="Nytt svarsalternativ..." value={newAnswer}
            onChange={(e) => setNewAnswer(e.target.value)} className="settings-input" />
          <button type="submit" className="settings-btn settings-btn--primary">Lägg till</button>
        </form>
      )}
    </div>
  );
}

function LogoCropperModal({ imageSrc, onSave, onCancel }) {
  const imgRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const containerRef = React.useRef(null);

  const [imgLoaded, setImgLoaded] = React.useState(false);
  const [imgRect, setImgRect] = React.useState({ x: 0, y: 0, w: 0, h: 0 });
  const [crop, setCrop] = React.useState({ x: 20, y: 20, w: 200, h: 100 });
  const [dragging, setDragging] = React.useState(null);
  const [dragStart, setDragStart] = React.useState(null);
  const [outputScale, setOutputScale] = React.useState(1);

  function onImgLoad() {
    const img = imgRef.current;
    const cont = containerRef.current;
    if (!img || !cont) return;
    const cr = cont.getBoundingClientRect();
    const ir = img.getBoundingClientRect();
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

  const [selectedExportIds, setSelectedExportIds] = useState(() => getChains().map((c) => c.id));
  const [parsedBackup, setParsedBackup] = useState(null);
  const [selectedImportIds, setSelectedImportIds] = useState([]);
  const [importStatus, setImportStatus] = useState(null);

  const [cropperSrc, setCropperSrc] = React.useState(null);

  // Punkt 6: visa migration bara om inte redan gjord
  const migrationDone = !!localStorage.getItem('migrated_at');

  // Initialisera kedjor från prop (redan laddade av App.js) vid mount
  React.useEffect(() => {
    if (initialChains && initialChains.length > 0) {
      setChains(initialChains);
      setSelectedExportIds(initialChains.map(c => c.id));
      const savedId = getActiveChainId();
      const validId = initialChains.find(c => c.id === savedId) ? savedId : (initialChains[0]?.id || '');
      setActiveId(validId);
      setLoadingChains(false);
    } else {
      // Fallback: ladda från Supabase om inga kedjor skickades ner
      setChains(getChains());
      setLoadingChains(false);
    }
  }, [initialChains]); // eslint-disable-line react-hooks/exhaustive-deps

  function refresh() {
    // Vid refresh — trigga App.js att ladda om, vilket skickar nya initialChains hit
    onSettingsChange();
  }

  const active = chains.find((c) => c.id === activeId) || null;
  const departments = (active?.departments || []).slice().sort((a, b) => a.order - b.order);
  const touchpoints = active?.touchpoints || [];
  const allChainIds = chains.map((c) => c.id);

  function handleAddChain(e) {
    e.preventDefault();
    if (!newChainName.trim()) return;
    const newChain = addChain(newChainName.trim()); setNewChainName('');
    (async()=>{ await syncChainToSupabase(newChain); const{data:{user}}=await supabase.auth.getUser(); if(user){ await supabase.from('organizations').upsert({id:newChain.id,name:newChain.name},{onConflict:'id'}); await supabase.from('org_members').upsert({organization_id:newChain.id,user_id:user.id,role:'owner'},{onConflict:'organization_id,user_id'}); } })(); refresh();
  }

  function handleChainDrop(targetId) {
    if (!dragId || targetId === DEMO_CHAIN_ID || dragId === targetId) { setDragId(null); setDragOverId(null); return; }
    const ids = chains.map((c) => c.id);
    const fi = ids.indexOf(dragId); const ti = ids.indexOf(targetId);
    ids.splice(fi, 1); ids.splice(ti, 0, dragId);
    reorderChains(ids); setDragId(null); setDragOverId(null); refresh();
  }

  function handleAddDept(e) {
    e.preventDefault();
    if (!newDeptName.trim() || !active) return;
    const code = newDeptCode.trim() || generateDeptCode(active.departments);
    const dept = addDepartment(active.id, newDeptName.trim(), code);
    setNewDeptName(''); setNewDeptCode('');
    setExpandedDeptId(dept?.id || null);
    if (dept) syncDeptToSupabase(dept, active.id);
    refresh();
  }

  function handleDeptDrop(targetId) {
    if (!deptDragId || deptDragId === targetId || !active) { setDeptDragId(null); setDeptDragOverId(null); return; }
    const ids = departments.map((d) => d.id);
    const fi = ids.indexOf(deptDragId); const ti = ids.indexOf(targetId);
    ids.splice(fi, 1); ids.splice(ti, 0, deptDragId);
    reorderDepartments(active.id, ids); setDeptDragId(null); setDeptDragOverId(null); refresh();
  }

  function handleMigrateClick(dept, deptTps) {
    setConfirmMigrate({ deptId: dept.id, deptName: dept.name, tpNames: deptTps.map((t) => t.name), otherCount: departments.length - 1 });
  }

  function executeMigrate() {
    if (!confirmMigrate || !active) return;
    const result = migrateTouchpointsFromDept(active.id, confirmMigrate.deptId);
    setConfirmMigrate(null);
    setMigrateResult(result);
    setTimeout(() => setMigrateResult(null), 4000);
    refresh();
  }

  function handleAddTp(e, deptId) {
    e.preventDefault();
    const state = newTpByDept[deptId] || {};
    const name = (state.name || '').trim();
    const type = state.type || 'physical';
    if (!name || !active) return;
    const newTp = addTouchpoint(active.id, name, deptId, type);
    if (newTp) syncTouchpointToSupabase(newTp, active.id);
    setNewTpByDept((prev) => ({ ...prev, [deptId]: { name: '', type: prev[deptId]?.type || 'physical' } }));
    refresh();
  }

  function handleSetActiveTp(tpId) {
    if (!active) return;
    setActiveTouchpoint(active.id, active.activeTouchpointId === tpId ? null : tpId);
    refresh();
  }

  async function handleTpUpdate(tpId, updates) {
    if (active) {
      updateTouchpoint(active.id, tpId, updates);
      const uc = getChains().find(c => c.id === active.id);
      const ut = (uc?.touchpoints || []).find(t => t.id === tpId);
      if (ut) await syncTouchpointToSupabase(ut, active.id);
      refresh();
    }
  }

  function executeDelete() {
    if (!confirmDelete) return;
    const { type, id } = confirmDelete;
    if (type === 'chain') { deleteChain(id); softDeleteChainInSupabase(id); }
    else if (type === 'dept' && active) { deleteDepartment(active.id, id); softDeleteDeptInSupabase(id); }
    else if (type === 'tp' && active) { deleteTouchpoint(active.id, id); softDeleteTpInSupabase(id); }
    setConfirmDelete(null); refresh();
  }

  function executeReset() {
    if (!confirmReset) return;
    if (confirmReset.type === 'chain') resetChainResponses(confirmReset.id);
    else resetTouchpointResponses(confirmReset.id);
    setConfirmReset(null); refresh();
  }

  async function handleConfigChange(type, newConfig) {
    if (!active) return;
    const key = type === 'physical' ? 'physicalConfig' : type === 'online' ? 'onlineConfig' : type === 'enps' ? 'enpsConfig' : 'otherConfig';

    // Bygg den uppdaterade config-JSONB direkt från active (som redan kommit från Supabase)
    const updatedConfig = {
      physicalConfig: active.physicalConfig,
      onlineConfig:   active.onlineConfig,
      otherConfig:    active.otherConfig,
      enpsConfig:     active.enpsConfig,
      [key]: newConfig,
    };

    // Spara kedja-config direkt till Supabase (undviker localStorage-beroende)
    const { error: chainErr } = await supabase
      .from('chains')
      .update({ config: updatedConfig })
      .eq('id', active.id);
    if (chainErr) console.error('[Settings] handleConfigChange chain:', chainErr.message);

    // Hämta touchpoints från Supabase och propagera config_override
    const { data: sbTouchpoints = [] } = await supabase
      .from('touchpoints')
      .select('id, type')
      .eq('chain_id', active.id)
      .is('deleted_at', null);

    const affected = sbTouchpoints.filter(t => (t.type || 'physical') === type);

    if (affected.length > 0) {
      await Promise.all(affected.map(tp =>
        supabase.from('touchpoints')
          .update({ config_override: newConfig })
          .eq('id', tp.id)
      ));
    }

    // Uppdatera även localStorage för konsistens (om data finns där)
    updateChain(active.id, { [key]: newConfig });

    onSettingsChange();
  }

  function handleApplyToAll(type) {
    if (!active) return;
    applyConfigToType(active.id, type); const uc=getChains().find(c=>c.id===active.id); if(uc)(uc.touchpoints||[]).filter(t=>t.type===type).forEach(t=>syncTouchpointToSupabase(t,active.id));
    setChains(getChains()); onSettingsChange();
  }

  async function handleFileSelected(e) {
    const file = e.target.files[0]; if (!file) return;
    try {
      const parsed = await parseBackupFile(file);
      setParsedBackup(parsed); setSelectedImportIds(parsed.customers.map((c) => c.id)); setImportStatus(null);
    } catch { setImportStatus('error'); setParsedBackup(null); }
    e.target.value = '';
  }

  function handleConfirmImport() {
    if (!parsedBackup || selectedImportIds.length === 0) return;
    const ok = importSelectedBackup(parsedBackup, selectedImportIds);
    setImportStatus(ok ? 'ok' : 'error');
    setParsedBackup(null); setSelectedImportIds([]);
    if (ok) refresh();
    setTimeout(() => setImportStatus(null), 3000);
  }

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
            {/* Punkt 2: Lägg till-formulär ÖVERST precis som originalet */}
            <form className="settings-add-form" onSubmit={handleAddChain}>
              <input type="text" placeholder="Ny kedja..." value={newChainName}
                onChange={(e) => setNewChainName(e.target.value)} className="settings-input" />
              <button type="submit" className="settings-btn settings-btn--primary">Lägg till</button>
            </form>
            {/* Punkt 3: Aktiv-badge återinförd */}
            <ul className="customer-list">
              {chains.map((c) => (
                <li key={c.id}
                  className={'customer-item' + (c.id === activeId ? ' customer-item--active' : '') + (dragId === c.id ? ' customer-item--dragging' : '') + (dragOverId === c.id ? ' customer-item--drag-over' : '')}
                  draggable={c.id !== DEMO_CHAIN_ID}
                  onDragStart={() => c.id !== DEMO_CHAIN_ID && setDragId(c.id)}
                  onDragOver={(e) => { e.preventDefault(); if (c.id !== DEMO_CHAIN_ID && c.id !== dragId) setDragOverId(c.id); }}
                  onDrop={() => handleChainDrop(c.id)}
                  onDragEnd={() => { setDragId(null); setDragOverId(null); }}
                >
                  {c.id !== DEMO_CHAIN_ID && <span className="customer-drag-handle">&#x2630;</span>}
                  <button className="customer-select" onClick={() => { setActiveChainId(c.id); refresh(); }}>
                    <span className="customer-name">{c.name}</span>
                    {c.id === activeId && <span className="customer-badge">Aktiv</span>}
                  </button>
                  <button className="reset-btn" title="Nollställ data" onClick={() => setConfirmReset({ type: 'chain', id: c.id, label: c.name })}>↺</button>
                  {c.id !== DEMO_CHAIN_ID && (
                    <button className="customer-delete" onClick={() => setConfirmDelete({ type: 'chain', id: c.id, label: c.name })}>&times;</button>
                  )}
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
                      <button className="settings-btn settings-btn--danger" onClick={() => { updateChain(active.id, { customLogo: null }); const uc=getChains().find(c=>c.id===active.id); if(uc) syncChainToSupabase(uc); refresh(); }}>Ta bort logo</button>
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
                    onSave={(dataUrl) => { updateChain(active.id, { customLogo: dataUrl }); const uc=getChains().find(c=>c.id===active.id); if(uc) syncChainToSupabase(uc); setCropperSrc(null); refresh(); }}
                    onCancel={() => setCropperSrc(null)}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* Punkt 4: Avdelningar — originalt accordion-utseende */}
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
                                onSubmit={(e) => { e.preventDefault(); if (!editingDeptText.trim()) return; updateDepartment(active.id, d.id, { name: editingDeptText.trim() }); setEditingDeptId(null); refresh(); }}>
                                <input className="settings-input" value={editingDeptText} onChange={(e) => setEditingDeptText(e.target.value)} autoFocus onBlur={() => setEditingDeptId(null)} onKeyDown={(e) => { if (e.key === 'Escape') setEditingDeptId(null); }} />
                              </form>
                            ) : (
                              <span className="dept-accordion-name" onDoubleClick={(e) => { e.stopPropagation(); setEditingDeptId(d.id); setEditingDeptText(d.name); }} title="Dubbelklicka för att redigera namn">{d.name}</span>
                            )}
                            {editingCodeId === d.id ? (
                              <form style={{ flexShrink: 0 }} onClick={(e) => e.stopPropagation()}
                                onSubmit={(e) => { e.preventDefault(); updateDepartment(active.id, d.id, { uniqueCode: editingCodeText.trim() }); setEditingCodeId(null); refresh(); }}>
                                <input className="settings-input settings-input--code" value={editingCodeText} onChange={(e) => setEditingCodeText(e.target.value)} autoFocus
                                  onBlur={() => { updateDepartment(active.id, d.id, { uniqueCode: editingCodeText.trim() }); setEditingCodeId(null); refresh(); }}
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
                                      return (
                                        <li key={tp.id} className={'tp-item tp-item--in-dept' + (isActive ? ' tp-item--active' : '') + (tp.access_token ? ' tp-item--has-token' : '')}>
                                          <div className="tp-item-top">
                                            <button className="tp-detail-btn" onClick={() => setSelectedTp({ tp, dept: d })}>
                                              <span className={`dept-badge ${TYPE_BADGE[tp.type] || ''}`}>{TYPE_LABELS[tp.type] || tp.type}</span>
                                              <span className="tp-name">{tp.name}</span>
                                              <span className="tp-mode-badge">{MODE_LABELS[tp.mode] || tp.mode}</span>
                                            </button>
                                            <button className={`dept-activate-btn ${isActive ? 'dept-activate-btn--on' : ''}`} onClick={() => handleSetActiveTp(tp.id)}>{isActive ? 'Aktiv' : 'Sätt aktiv'}</button>
                                            <button className="customer-delete" onClick={() => setConfirmDelete({ type: 'tp', id: tp.id, label: tp.name })}>&times;</button>
                                          </div>
                                          {tp.access_token && (
                                            <div className="tp-token-row">
                                              <span className="tp-token-label">Kiosk-URL</span>
                                              <code className="tp-token-code">{`${window.location.origin}/?tp=${tp.access_token}`}</code>
                                              <button
                                                type="button"
                                                className="tp-token-copy"
                                                title="Kopiera URL"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  navigator.clipboard.writeText(`${window.location.origin}/?tp=${tp.access_token}`);
                                                  e.currentTarget.textContent = '✓';
                                                  setTimeout(() => { e.currentTarget.textContent = '📋'; }, 1500);
                                                }}
                                              >📋</button>
                                            </div>
                                          )}
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

        {/* Punkt 5: Konfiguration — originalt utseende */}
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

        {section === 'backup' && (
          <div className="settings-card">
            <h2>Säkerhetskopiering</h2>

            {/* Punkt 6: Visa migration bara om inte redan klar */}
            {!migrationDone && (
              <div className="setting-row setting-row--col" style={{ marginBottom: '1.5rem' }}>
                <div className="setting-info">
                  <h3>Migrera till molnet</h3>
                  <p>Flytta data från lokal lagring till Supabase-databasen.</p>
                </div>
                <MigrationTool />
              </div>
            )}

            <div className="setting-row setting-row--col">
              <div className="setting-info"><h3>Exportera backup</h3><p>Välj vilka kedjor som ska ingå (JSON).</p></div>
              <div style={{ width: '100%', marginTop: '0.5rem' }}>
                <div className="backup-checkbox-list">
                  <label className="backup-checkbox-item">
                    <input type="checkbox" checked={selectedExportIds.length === allChainIds.length}
                      onChange={() => setSelectedExportIds((p) => p.length === allChainIds.length ? [] : allChainIds)} />
                    <strong>Alla kedjor</strong>
                  </label>
                  {chains.map((c) => (
                    <label key={c.id} className="backup-checkbox-item backup-checkbox-item--indent">
                      <input type="checkbox" checked={selectedExportIds.includes(c.id)}
                        onChange={() => setSelectedExportIds((p) => p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id])} />
                      {c.name}
                    </label>
                  ))}
                </div>
                <button className="settings-btn settings-btn--primary" disabled={selectedExportIds.length === 0}
                  onClick={() => exportSelectedBackup(selectedExportIds, chains)}>Exportera</button>
              </div>
            </div>
            <div className="setting-row setting-row--col">
              <div className="setting-info"><h3>Importera backup</h3><p>Välj fil och kedjor att importera. Data slås ihop.</p></div>
              {!parsedBackup ? (
                <label className="settings-upload" style={{ marginTop: '0.5rem' }}>
                  <span className="settings-btn settings-btn--primary">Välj fil...</span>
                  <input type="file" accept=".json" hidden onChange={handleFileSelected} />
                </label>
              ) : (
                <div style={{ width: '100%', marginTop: '0.5rem' }}>
                  <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-light)' }}>Välj kedjor att importera:</p>
                  <div className="backup-checkbox-list">
                    <label className="backup-checkbox-item">
                      <input type="checkbox" checked={selectedImportIds.length === parsedBackup.customers.length}
                        onChange={() => { const all = parsedBackup.customers.map((c) => c.id); setSelectedImportIds((p) => p.length === all.length ? [] : all); }} />
                      <strong>Alla kedjor</strong>
                    </label>
                    {parsedBackup.customers.map((c) => (
                      <label key={c.id} className="backup-checkbox-item backup-checkbox-item--indent">
                        <input type="checkbox" checked={selectedImportIds.includes(c.id)}
                          onChange={() => setSelectedImportIds((p) => p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id])} />
                        {c.name}
                      </label>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="settings-btn settings-btn--primary" onClick={handleConfirmImport} disabled={selectedImportIds.length === 0}>Importera</button>
                    <button className="settings-btn settings-btn--ghost" onClick={() => { setParsedBackup(null); setSelectedImportIds([]); }}>Avbryt</button>
                  </div>
                </div>
              )}
              {importStatus === 'ok' && <p style={{ color: 'var(--color-promoter)', margin: '0.5rem 0 0' }}>✓ Data importerad!</p>}
              {importStatus === 'error' && <p style={{ color: 'var(--color-detractor)', margin: '0.5rem 0 0' }}>✗ Ogiltig fil.</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
