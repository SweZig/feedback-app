import React, { useState } from 'react';
import {
  getChains, getActiveChainId, setActiveChainId,
  addChain, updateChain, deleteChain,
  addDepartment, deleteDepartment,
  applyConfigToType, migrateTouchpointsFromDept,
  addTouchpoint, updateTouchpoint, deleteTouchpoint, setActiveTouchpoint,
  getDefaultConfig, getEffectiveConfig,
  DEMO_CHAIN_ID, TYPE_LABELS, MODE_LABELS,
} from '../utils/settings';
import { resetChainResponses, resetTouchpointResponses } from '../utils/storage';
import { parseBackupFile, importSelectedBackup } from '../utils/backup';
import MigrationTool from './MigrationTool';
import './SettingsPage.css';

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
      <div className="setting-row">
        <div className="setting-info"><h3>NPS-skalans färger</h3><p>Färgade eller neutrala knappar.</p></div>
        <div className="setting-toggle-group">
          <button className={`setting-toggle ${config.npsColorMode === 'colored' ? 'setting-toggle--active' : ''}`}
            onClick={() => onChange({ ...config, npsColorMode: 'colored' })}>Färg</button>
          <button className={`setting-toggle ${config.npsColorMode === 'neutral' ? 'setting-toggle--active' : ''}`}
            onClick={() => onChange({ ...config, npsColorMode: 'neutral' })}>Neutral</button>
        </div>
      </div>
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
        <div className="setting-row setting-row--col">
          <div className="setting-info"><h3>Svarsalternativ</h3><p>Max 6 st. Dra för att ändra ordning. Sätt polaritet per alternativ.</p></div>
          <PredefinedAnswersList answers={config.predefinedAnswers || []} onChange={(answers) => onChange({ ...config, predefinedAnswers: answers })} />
        </div>
      )}
      {config.predefinedAnswersEnabled && (
        <>
          <div className="setting-row">
            <div className="setting-info"><h3>Visa positiva alternativ för Promoters</h3><p>Positiva svar visas endast när betyg ≥ 9.</p></div>
            <button className={`setting-switch ${config.showPositiveAnswersForPromoters ? 'setting-switch--on' : ''}`}
              onClick={() => onChange({ ...config, showPositiveAnswersForPromoters: !config.showPositiveAnswersForPromoters })}>
              <span className="setting-switch-knob" /></button>
          </div>
          <div className="setting-row">
            <div className="setting-info"><h3>Visa negativa alternativ för Detractors</h3><p>Negativa svar visas endast när betyg ≤ 3.</p></div>
            <button className={`setting-switch ${config.showNegativeAnswersForDetractors ? 'setting-switch--on' : ''}`}
              onClick={() => onChange({ ...config, showNegativeAnswersForDetractors: !config.showNegativeAnswersForDetractors })}>
              <span className="setting-switch-knob" /></button>
          </div>
        </>
      )}
      <div className="setting-row">
        <div className="setting-info"><h3>Uppföljningsfråga</h3><p>Fråga om e-post vid låga betyg (0–2).</p></div>
        <button className={`setting-switch ${config.followUpEnabled ? 'setting-switch--on' : ''}`}
          onClick={() => onChange({ ...config, followUpEnabled: !config.followUpEnabled })}>
          <span className="setting-switch-knob" /></button>
      </div>
    </div>
  );
}

function PredefinedAnswersList({ answers, onChange }) {
  const [dragIdx, setDragIdx] = useState(null);
  const MAX = 6;

  function handleDragStart(i) { setDragIdx(i); }
  function handleDrop(i) {
    if (dragIdx === null || dragIdx === i) return;
    const next = [...answers];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(i, 0, moved);
    onChange(next);
    setDragIdx(null);
  }
  function handleRemove(i) { onChange(answers.filter((_, idx) => idx !== i)); }
  function handleAdd() {
    if (answers.length >= MAX) return;
    onChange([...answers, { text: '', polarity: null }]);
  }
  function handleTextChange(i, val) {
    const next = [...answers];
    next[i] = { ...next[i], text: val };
    onChange(next);
  }
  function handlePolarityChange(i, polarity) {
    const next = [...answers];
    next[i] = { ...next[i], polarity };
    onChange(next);
  }

  return (
    <div className="predefined-list">
      {answers.map((a, i) => (
        <div key={i} className="predefined-item" draggable
          onDragStart={() => handleDragStart(i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => handleDrop(i)}>
          <span className="predefined-drag">⠿</span>
          <input className="settings-input predefined-input" value={a.text}
            onChange={(e) => handleTextChange(i, e.target.value)} placeholder={`Alternativ ${i + 1}`} />
          <div className="polarity-group">
            <button className={`polarity-btn polarity-btn--pos ${a.polarity === 'positive' ? 'polarity-btn--active' : ''}`}
              onClick={() => handlePolarityChange(i, a.polarity === 'positive' ? null : 'positive')} title="Positiv">+</button>
            <button className={`polarity-btn polarity-btn--neg ${a.polarity === 'negative' ? 'polarity-btn--active' : ''}`}
              onClick={() => handlePolarityChange(i, a.polarity === 'negative' ? null : 'negative')} title="Negativ">−</button>
          </div>
          <button className="predefined-remove" onClick={() => handleRemove(i)}>×</button>
        </div>
      ))}
      {answers.length < MAX && (
        <button className="settings-btn settings-btn--ghost predefined-add" onClick={handleAdd}>+ Lägg till alternativ</button>
      )}
    </div>
  );
}

function SettingsPage({ onSettingsChange }) {
  const [section, setSection] = useState('chains');
  const [chains, setChains] = useState(() => getChains());
  const [activeChainId, setActiveChainIdState] = useState(() => getActiveChainId());
  const [newChainName, setNewChainName] = useState('');
  const [newDeptName, setNewDeptName] = useState('');
  const [newTpByDept, setNewTpByDept] = useState({});
  const [configTab, setConfigTab] = useState('physical');
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmReset, setConfirmReset] = useState(null);
  const [selectedTp, setSelectedTp] = useState(null);
  const [parsedBackup, setParsedBackup] = useState(null);
  const [selectedExportIds, setSelectedExportIds] = useState([]);
  const [selectedImportIds, setSelectedImportIds] = useState([]);
  const [importStatus, setImportStatus] = useState(null);

  const refresh = () => { setChains(getChains()); onSettingsChange?.(); };
  const active = chains.find((c) => c.id === activeChainId) || null;
  const touchpoints = active ? (active.touchpoints || []) : [];
  const allChainIds = chains.map((c) => c.id);

  function handleSelectChain(id) {
    setActiveChainId(id);
    setActiveChainIdState(id);
    onSettingsChange?.();
  }

  function handleAddChain(e) {
    e.preventDefault();
    if (!newChainName.trim()) return;
    addChain(newChainName.trim());
    setNewChainName('');
    refresh();
  }

  function handleDeleteChain(id) {
    deleteChain(id);
    if (activeChainId === id) { setActiveChainIdState(getActiveChainId()); }
    refresh();
  }

  function handleAddDept(e) {
    e.preventDefault();
    if (!active || !newDeptName.trim()) return;
    const code = generateDeptCode(active.departments || []);
    addDepartment(active.id, newDeptName.trim(), code);
    setNewDeptName('');
    refresh();
  }

  function handleAddTp(e, deptId) {
    e.preventDefault();
    if (!active) return;
    const state = newTpByDept[deptId] || { name: '', type: 'physical' };
    if (!state.name.trim()) return;
    addTouchpoint(active.id, state.name.trim(), deptId, state.type);
    setNewTpByDept((prev) => ({ ...prev, [deptId]: { name: '', type: 'physical' } }));
    refresh();
  }

  function handleSetActiveTp(tpId) {
    if (!active) return;
    setActiveTouchpoint(active.id, tpId);
    refresh();
  }

  function handleConfigChange(type, newConfig) {
    if (!active) return;
    const configKey = type === 'physical' ? 'physicalConfig' : type === 'online' ? 'onlineConfig' : type === 'enps' ? 'enpsConfig' : 'otherConfig';
    const tpsOfType = touchpoints.filter((t) => t.type === type && t.configOverride !== null);
    if (tpsOfType.length > 0) {
      setConfirmDialog({
        type, newConfig, configKey,
        message: `${tpsOfType.length} mätpunkt(er) av typ "${TYPE_LABELS[type]}" har egna inställningar.`,
        detail: 'Vill du också uppdatera dem med de nya kedjeinställningarna?',
      });
    } else {
      updateChain(active.id, { [configKey]: newConfig });
      refresh();
    }
  }

  function handleConfirmDialog(applyToAll) {
    if (!confirmDialog || !active) return;
    const { type, newConfig, configKey } = confirmDialog;
    updateChain(active.id, { [configKey]: newConfig });
    if (applyToAll) { applyConfigToType(active.id, type); }
    setConfirmDialog(null);
    refresh();
  }

  function handleApplyToAll(type) {
    if (!active) return;
    applyConfigToType(active.id, type);
    refresh();
  }

  function handleMigrateClick(dept, deptTps) {
    if (!active || deptTps.length === 0) return;
    const result = migrateTouchpointsFromDept(active.id, dept.id);
    refresh();
    alert(`Klart! ${result.added} mätpunkter skapade, ${result.skipped} hoppades över (namn redan finns).`);
  }

  function handleFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    parseBackupFile(file).then((parsed) => {
      if (!parsed) { setImportStatus('error'); return; }
      setParsedBackup(parsed);
      setSelectedImportIds(parsed.customers.map((c) => c.id));
      setImportStatus(null);
    });
  }

  function handleConfirmImport() {
    if (!parsedBackup) return;
    importSelectedBackup(parsedBackup, selectedImportIds);
    setParsedBackup(null);
    setSelectedImportIds([]);
    setImportStatus('ok');
    refresh();
  }

  return (
    <div className="settings-layout">
      <nav className="settings-nav">
        {MENU_ITEMS.map((item) => (
          <button key={item.key} className={`settings-nav-btn ${section === item.key ? 'settings-nav-btn--active' : ''}`}
            onClick={() => setSection(item.key)}>{item.label}</button>
        ))}
      </nav>

      <div className="settings-content">

        {confirmDialog && (
          <ConfirmDialog
            message={confirmDialog.message}
            detail={confirmDialog.detail}
            onConfirm={() => handleConfirmDialog(true)}
            onCancel={() => { handleConfirmDialog(false); setConfirmDialog(null); }}
          />
        )}

        {confirmDelete && (
          <DeleteDialog
            message={`Ta bort "${confirmDelete.label}"? Detta kan inte ångras.`}
            onConfirm={() => {
              if (confirmDelete.type === 'chain') handleDeleteChain(confirmDelete.id);
              else if (confirmDelete.type === 'dept') { deleteDepartment(active.id, confirmDelete.id); refresh(); }
              else if (confirmDelete.type === 'tp') { deleteTouchpoint(active.id, confirmDelete.id); refresh(); }
              setConfirmDelete(null);
            }}
            onCancel={() => setConfirmDelete(null)}
          />
        )}

        {confirmReset && (
          <ResetDialog
            label={confirmReset.label}
            onConfirm={() => {
              if (confirmReset.type === 'chain') resetChainResponses(confirmReset.id);
              else if (confirmReset.type === 'tp') resetTouchpointResponses(confirmReset.id);
              setConfirmReset(null);
              refresh();
            }}
            onCancel={() => setConfirmReset(null)}
          />
        )}

        {selectedTp && (
          <div className="confirm-overlay" onClick={() => setSelectedTp(null)}>
            <div className="confirm-box tp-detail-box" onClick={(e) => e.stopPropagation()}>
              <h3 style={{ margin: '0 0 0.75rem', color: 'var(--color-primary)' }}>{selectedTp.tp.name}</h3>
              {(() => {
                const config = getEffectiveConfig(active, selectedTp.tp.id);
                const hasOverride = selectedTp.tp.configOverride !== null;
                return (
                  <>
                    <p style={{ fontSize: '0.82rem', color: 'var(--color-text-light)', margin: '0 0 1rem' }}>
                      {hasOverride ? 'Egna inställningar (override aktiv)' : 'Ärver kedjans inställningar'}
                    </p>
                    <ConfigForm config={config} type={selectedTp.tp.type} showCountdown={selectedTp.tp.mode === 'app'}
                      onChange={(newConfig) => {
                        updateTouchpoint(active.id, selectedTp.tp.id, { configOverride: newConfig });
                        refresh();
                        setSelectedTp((prev) => ({ ...prev, tp: { ...prev.tp, configOverride: newConfig } }));
                      }} />
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                      {hasOverride && (
                        <button className="settings-btn settings-btn--ghost" onClick={() => {
                          updateTouchpoint(active.id, selectedTp.tp.id, { configOverride: null });
                          refresh();
                          setSelectedTp(null);
                        }}>Återställ till kedja-standard</button>
                      )}
                      <button className="settings-btn settings-btn--primary" onClick={() => setSelectedTp(null)}>Stäng</button>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        )}

        {section === 'chains' && (
          <div className="settings-card">
            <h2>Kedjor</h2>
            <ul className="customer-list">
              {chains.map((c) => (
                <li key={c.id} className={`customer-item ${c.id === activeChainId ? 'customer-item--active' : ''}`}>
                  <button className="customer-select" onClick={() => handleSelectChain(c.id)}>{c.name}</button>
                  {c.id !== DEMO_CHAIN_ID && (
                    <button className="customer-delete" onClick={() => setConfirmDelete({ type: 'chain', id: c.id, label: c.name })}>&times;</button>
                  )}
                </li>
              ))}
            </ul>
            <form className="settings-add-form" onSubmit={handleAddChain}>
              <input type="text" placeholder="Ny kedja" value={newChainName}
                onChange={(e) => setNewChainName(e.target.value)} className="settings-input" />
              <button type="submit" className="settings-btn settings-btn--primary">Lägg till</button>
            </form>
          </div>
        )}

        {section === 'departments' && (
          <div className="settings-card">
            <h2>Avdelningar{active ? ` — ${active.name}` : ''}</h2>
            {!active ? <p className="settings-empty">Välj en kedja under Kedjor.</p> : (
              <>
                {(active.departments || []).length === 0 ? (
                  <p className="settings-empty">Inga avdelningar ännu.</p>
                ) : (
                  <div className="dept-list">
                    {(active.departments || [])
                      .slice().sort((a, b) => a.order - b.order)
                      .map((d) => {
                        const deptTps = touchpoints.filter((t) => t.departmentId === d.id).sort((a, b) => a.order - b.order);
                        const otherDeptsCount = (active.departments || []).length - 1;
                        return (
                          <div key={d.id} className="dept-card">
                            <div className="dept-header">
                              <div className="dept-header-left">
                                <span className="dept-name">{d.name}</span>
                                {d.uniqueCode && <span className="dept-code">{d.uniqueCode}</span>}
                              </div>
                              <div className="dept-header-actions">
                                <button className="reset-btn" title="Nollställ data" onClick={() => setConfirmReset({ type: 'chain', id: active.id, label: d.name })}>↺</button>
                                <button className="customer-delete" onClick={() => setConfirmDelete({ type: 'dept', id: d.id, label: d.name })}>&times;</button>
                              </div>
                            </div>
                            {deptTps.length > 0 && (
                              <>
                                <ul className="tp-list">
                                  {deptTps.map((tp) => {
                                    const isActive = tp.id === active.activeTouchpointId;
                                    return (
                                      <li key={tp.id} className={`tp-item ${isActive ? 'tp-item--active' : ''}`}>
                                        <button className="tp-detail-btn" onClick={() => setSelectedTp({ tp, dept: d })}>
                                          <span className={`dept-badge ${TYPE_BADGE[tp.type] || ''}`}>{TYPE_LABELS[tp.type] || tp.type}</span>
                                          <span className="tp-name">{tp.name}</span>
                                          <span className="tp-mode-badge">{MODE_LABELS[tp.mode] || tp.mode}</span>
                                        </button>
                                        <button className={`dept-activate-btn ${isActive ? 'dept-activate-btn--on' : ''}`} onClick={() => handleSetActiveTp(tp.id)}>{isActive ? 'Aktiv' : 'Sätt aktiv'}</button>
                                        <button className="reset-btn" title="Nollställ data" onClick={() => setConfirmReset({ type: 'tp', id: tp.id, label: tp.name })}>↺</button>
                                        <button className="customer-delete" onClick={() => setConfirmDelete({ type: 'tp', id: tp.id, label: tp.name })}>&times;</button>
                                      </li>
                                    );
                                  })}
                                </ul>
                                {otherDeptsCount > 0 && (
                                  <div className="migrate-btn-wrap">
                                    <button className="settings-btn settings-btn--migrate" onClick={() => handleMigrateClick(d, deptTps)}>
                                      ⇄ Migrera till alla {otherDeptsCount} övriga avdelningar
                                    </button>
                                  </div>
                                )}
                              </>
                            )}
                            <form className="settings-add-form tp-add-form" onSubmit={(e) => handleAddTp(e, d.id)}>
                              <input type="text" placeholder="Ny mätpunkt (t.ex. Kassa 1)" value={(newTpByDept[d.id] || {}).name || ''}
                                onChange={(e) => setNewTpByDept((prev) => ({ ...prev, [d.id]: { ...prev[d.id], name: e.target.value } }))} className="settings-input" />
                              <select value={(newTpByDept[d.id] || {}).type || 'physical'}
                                onChange={(e) => setNewTpByDept((prev) => ({ ...prev, [d.id]: { ...prev[d.id], type: e.target.value } }))} className="settings-select">
                                <option value="physical">Fysisk plats</option>
                                <option value="online">Online</option>
                                <option value="other">Övriga</option>
                                <option value="enps">eNPS</option>
                              </select>
                              <button type="submit" className="settings-btn settings-btn--primary">Lägg till</button>
                            </form>
                          </div>
                        );
                      })}
                  </div>
                )}
                <form className="settings-add-form" onSubmit={handleAddDept}>
                  <input type="text" placeholder="Ny avdelning" value={newDeptName}
                    onChange={(e) => setNewDeptName(e.target.value)} className="settings-input" />
                  <button type="submit" className="settings-btn settings-btn--primary">Lägg till</button>
                </form>
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

        {section === 'backup' && (
          <div className="settings-card">
            <h2>Säkerhetskopiering</h2>

            {/* ── Migreringsverktyg ── */}
            <div className="setting-row setting-row--col" style={{ marginBottom: '1.5rem' }}>
              <div className="setting-info">
                <h3>Migrera till molnet</h3>
                <p>Flytta data från lokal lagring till Supabase-databasen.</p>
              </div>
              <MigrationTool />
            </div>

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

export default SettingsPage;
