import { useState } from 'react';
import {
  getCustomers,
  getActiveCustomerId,
  setActiveCustomerId,
  addCustomer,
  updateCustomer,
  deleteCustomer,
  reorderCustomers,
  DEMO_CUSTOMER_ID,
} from '../utils/settings';
import { parseBackupFile, importSelectedBackup } from '../utils/backup';
import './SettingsPage.css';

// Export only selected customers to JSON
function exportSelectedBackup(selectedIds, customers) {
  const allResponsesRaw = localStorage.getItem('npsResponses');
  const allResponses = allResponsesRaw ? JSON.parse(allResponsesRaw) : [];
  const selectedCustomers = customers.filter((c) => selectedIds.includes(c.id));
  const selectedResponses = allResponses.filter((r) => selectedIds.includes(r.customerId));
  const activeId = localStorage.getItem('npsActiveCustomerId');

  const data = {
    npsCustomers: selectedCustomers,
    npsResponses: selectedResponses,
    npsActiveCustomerId: activeId,
  };

  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `feedback-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function SettingsPage({ onSettingsChange }) {
  const [customers, setCustomers] = useState(getCustomers);
  const [activeId, setActiveId] = useState(getActiveCustomerId);
  const [newName, setNewName] = useState('');
  const [newAnswer, setNewAnswer] = useState('');
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [editingAnswerIdx, setEditingAnswerIdx] = useState(null);
  const [editingAnswerText, setEditingAnswerText] = useState('');
  const [dragAnswerIdx, setDragAnswerIdx] = useState(null);
  const [dragOverAnswerIdx, setDragOverAnswerIdx] = useState(null);

  // Export selection
  const allIds = customers.map((c) => c.id);
  const [selectedExportIds, setSelectedExportIds] = useState(allIds);

  // Import state
  const [parsedBackup, setParsedBackup] = useState(null);
  const [selectedImportIds, setSelectedImportIds] = useState([]);
  const [importStatus, setImportStatus] = useState(null);

  const active = customers.find((c) => c.id === activeId) || null;

  function refresh() {
    const updated = getCustomers();
    setCustomers(updated);
    setActiveId(getActiveCustomerId());
    setSelectedExportIds(updated.map((c) => c.id));
    onSettingsChange();
  }

  function handleAddCustomer(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    addCustomer(newName.trim());
    setNewName('');
    refresh();
  }

  function handleSelect(id) {
    setActiveCustomerId(id);
    refresh();
  }

  function handleDelete(id) {
    deleteCustomer(id);
    refresh();
  }

  function handleDragStart(id) {
    if (id === DEMO_CUSTOMER_ID) return;
    setDragId(id);
  }

  function handleDragOver(e, id) {
    e.preventDefault();
    if (id === DEMO_CUSTOMER_ID || id === dragId) return;
    setDragOverId(id);
  }

  function handleDrop(targetId) {
    if (!dragId || targetId === DEMO_CUSTOMER_ID || dragId === targetId) {
      setDragId(null);
      setDragOverId(null);
      return;
    }
    const ids = customers.map((c) => c.id);
    const fromIdx = ids.indexOf(dragId);
    const toIdx = ids.indexOf(targetId);
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, dragId);
    reorderCustomers(ids);
    setDragId(null);
    setDragOverId(null);
    refresh();
  }

  function handleDragEnd() {
    setDragId(null);
    setDragOverId(null);
  }

  function handleToggleColor(mode) {
    if (!active) return;
    updateCustomer(active.id, { npsColorMode: mode });
    refresh();
  }

  function handleToggleFreeText() {
    if (!active) return;
    updateCustomer(active.id, { freeTextEnabled: !active.freeTextEnabled });
    refresh();
  }

  function handleLogoUpload(e) {
    const file = e.target.files[0];
    if (!file || !active) return;
    const reader = new FileReader();
    reader.onload = () => {
      updateCustomer(active.id, { customLogo: reader.result });
      refresh();
    };
    reader.readAsDataURL(file);
  }

  function handleRemoveLogo() {
    if (!active) return;
    updateCustomer(active.id, { customLogo: null });
    refresh();
  }

  // Export checkboxes
  function toggleExportCustomer(id) {
    setSelectedExportIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function toggleExportAll() {
    setSelectedExportIds((prev) =>
      prev.length === allIds.length ? [] : allIds
    );
  }

  // Import
  async function handleFileSelected(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const parsed = await parseBackupFile(file);
      setParsedBackup(parsed);
      setSelectedImportIds(parsed.customers.map((c) => c.id));
      setImportStatus(null);
    } catch {
      setImportStatus('error');
      setParsedBackup(null);
    }
    e.target.value = '';
  }

  function toggleImportCustomer(id) {
    setSelectedImportIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function toggleImportAll() {
    if (!parsedBackup) return;
    const allBackupIds = parsedBackup.customers.map((c) => c.id);
    setSelectedImportIds((prev) =>
      prev.length === allBackupIds.length ? [] : allBackupIds
    );
  }

  function handleConfirmImport() {
    if (!parsedBackup || selectedImportIds.length === 0) return;
    const ok = importSelectedBackup(parsedBackup, selectedImportIds);
    setImportStatus(ok ? 'ok' : 'error');
    setParsedBackup(null);
    setSelectedImportIds([]);
    if (ok) refresh();
    setTimeout(() => setImportStatus(null), 3000);
  }

  return (
    <div className="settings">
      <div className="settings-card">
        <h2>Kunder</h2>
        <form className="settings-add-form" onSubmit={handleAddCustomer}>
          <input
            type="text"
            placeholder="Nytt kundnamn..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="settings-input"
          />
          <button type="submit" className="settings-btn settings-btn--primary">
            Lägg till
          </button>
        </form>

        {customers.length === 0 ? (
          <p className="settings-empty">Inga kunder ännu. Lägg till en ovan.</p>
        ) : (
          <ul className="customer-list">
            {customers.map((c) => (
              <li
                key={c.id}
                className={
                  `customer-item` +
                  (c.id === activeId ? ' customer-item--active' : '') +
                  (dragId === c.id ? ' customer-item--dragging' : '') +
                  (dragOverId === c.id ? ' customer-item--drag-over' : '')
                }
                draggable={c.id !== DEMO_CUSTOMER_ID}
                onDragStart={() => handleDragStart(c.id)}
                onDragOver={(e) => handleDragOver(e, c.id)}
                onDrop={() => handleDrop(c.id)}
                onDragEnd={handleDragEnd}
              >
                {c.id !== DEMO_CUSTOMER_ID && (
                  <span className="customer-drag-handle">&#x2630;</span>
                )}
                <button
                  className="customer-select"
                  onClick={() => handleSelect(c.id)}
                >
                  <span className="customer-name">{c.name}</span>
                  {c.id === activeId && <span className="customer-badge">Aktiv</span>}
                </button>
                {c.id !== DEMO_CUSTOMER_ID && (
                  <button
                    className="customer-delete"
                    onClick={() => handleDelete(c.id)}
                    title="Ta bort kund"
                  >
                    &times;
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {active && (
        <div className="settings-card">
          <h2>Inställningar för {active.name}</h2>

          <div className="setting-row">
            <div className="setting-info">
              <h3>NPS-skalans färger</h3>
              <p>Välj om poängknapparna ska ha NPS-färger eller vara neutrala.</p>
            </div>
            <div className="setting-toggle-group">
              <button
                className={`setting-toggle ${active.npsColorMode === 'colored' ? 'setting-toggle--active' : ''}`}
                onClick={() => handleToggleColor('colored')}
              >
                Färg
              </button>
              <button
                className={`setting-toggle ${active.npsColorMode === 'neutral' ? 'setting-toggle--active' : ''}`}
                onClick={() => handleToggleColor('neutral')}
              >
                Neutral
              </button>
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-info">
              <h3>Färdiga svarsalternativ</h3>
              <p>Visa valbara knappar med fördefinierade svar (max 6 st).</p>
            </div>
            <button
              className={`setting-switch ${active.predefinedAnswersEnabled ? 'setting-switch--on' : ''}`}
              onClick={() => {
                updateCustomer(active.id, { predefinedAnswersEnabled: !active.predefinedAnswersEnabled });
                refresh();
              }}
            >
              <span className="setting-switch-knob" />
            </button>
          </div>
          {active.predefinedAnswersEnabled && (
            <div className="setting-row setting-row--col">
              <div className="setting-info">
                <h3>Hantera svarsalternativ</h3>
              </div>
              <div className="setting-predefined">
                <ul className="predefined-list">
                  {(active.predefinedAnswers || []).map((answer, i) => (
                    <li
                      key={i}
                      className={
                        'predefined-item' +
                        (dragAnswerIdx === i ? ' predefined-item--dragging' : '') +
                        (dragOverAnswerIdx === i ? ' predefined-item--drag-over' : '')
                      }
                      draggable
                      onDragStart={() => setDragAnswerIdx(i)}
                      onDragOver={(e) => { e.preventDefault(); setDragOverAnswerIdx(i); }}
                      onDrop={() => {
                        if (dragAnswerIdx === null || dragAnswerIdx === i) {
                          setDragAnswerIdx(null);
                          setDragOverAnswerIdx(null);
                          return;
                        }
                        const updated = [...active.predefinedAnswers];
                        const [moved] = updated.splice(dragAnswerIdx, 1);
                        updated.splice(i, 0, moved);
                        updateCustomer(active.id, { predefinedAnswers: updated });
                        setDragAnswerIdx(null);
                        setDragOverAnswerIdx(null);
                        refresh();
                      }}
                      onDragEnd={() => { setDragAnswerIdx(null); setDragOverAnswerIdx(null); }}
                    >
                      <span className="predefined-drag-handle">&#x2630;</span>
                      {editingAnswerIdx === i ? (
                        <form
                          className="predefined-edit-form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (!editingAnswerText.trim()) return;
                            const updated = [...active.predefinedAnswers];
                            updated[i] = editingAnswerText.trim();
                            updateCustomer(active.id, { predefinedAnswers: updated });
                            setEditingAnswerIdx(null);
                            refresh();
                          }}
                        >
                          <input
                            className="settings-input"
                            value={editingAnswerText}
                            onChange={(e) => setEditingAnswerText(e.target.value)}
                            autoFocus
                            onBlur={() => setEditingAnswerIdx(null)}
                            onKeyDown={(e) => { if (e.key === 'Escape') setEditingAnswerIdx(null); }}
                          />
                        </form>
                      ) : (
                        <span
                          className="predefined-text"
                          onDoubleClick={() => {
                            setEditingAnswerIdx(i);
                            setEditingAnswerText(answer);
                          }}
                          title="Dubbelklicka för att redigera"
                        >
                          {answer}
                        </span>
                      )}
                      <button
                        className="predefined-remove"
                        onClick={() => {
                          const updated = active.predefinedAnswers.filter((_, idx) => idx !== i);
                          updateCustomer(active.id, { predefinedAnswers: updated });
                          refresh();
                        }}
                      >
                        &times;
                      </button>
                    </li>
                  ))}
                </ul>
                {(active.predefinedAnswers || []).length < 6 && (
                  <form
                    className="predefined-add-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!newAnswer.trim()) return;
                      const updated = [...(active.predefinedAnswers || []), newAnswer.trim()];
                      updateCustomer(active.id, { predefinedAnswers: updated });
                      setNewAnswer('');
                      refresh();
                    }}
                  >
                    <input
                      type="text"
                      placeholder="Nytt svarsalternativ..."
                      value={newAnswer}
                      onChange={(e) => setNewAnswer(e.target.value)}
                      className="settings-input"
                    />
                    <button type="submit" className="settings-btn settings-btn--primary">
                      Lägg till
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}

          <div className="setting-row">
            <div className="setting-info">
              <h3>Fritextfält</h3>
              <p>Visa kommentarsfältet i enkäten.</p>
            </div>
            <button
              className={`setting-switch ${active.freeTextEnabled ? 'setting-switch--on' : ''}`}
              onClick={handleToggleFreeText}
            >
              <span className="setting-switch-knob" />
            </button>
          </div>

          <div className="setting-row">
            <div className="setting-info">
              <h3>Nedräkning efter svar</h3>
              <p>Antal sekunder innan enkäten återställs ({active.countdownSeconds || 6}s).</p>
            </div>
            <div className="setting-range">
              <span>3</span>
              <input
                type="range"
                min={3}
                max={20}
                value={active.countdownSeconds || 6}
                onChange={(e) => {
                  updateCustomer(active.id, { countdownSeconds: Number(e.target.value) });
                  refresh();
                }}
              />
              <span>20</span>
            </div>
          </div>

          <div className="setting-row setting-row--col">
            <div className="setting-info">
              <h3>Kundlogotyp</h3>
              <p>Ladda upp kundens logo. Visas i navigeringen istället för standardlogon.</p>
            </div>
            {active.customLogo ? (
              <div className="setting-logo-preview">
                <img src={active.customLogo} alt="Kundlogo" />
                <button
                  className="settings-btn settings-btn--danger"
                  onClick={handleRemoveLogo}
                >
                  Ta bort logo
                </button>
              </div>
            ) : (
              <label className="settings-upload">
                <span className="settings-btn settings-btn--primary">Välj fil...</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  hidden
                />
              </label>
            )}
          </div>
        </div>
      )}

      {/* Backup card */}
      <div className="settings-card">
        <h2>Säkerhetskopiering</h2>

        {/* Export */}
        <div className="setting-row setting-row--col">
          <div className="setting-info">
            <h3>Exportera backup</h3>
            <p>Välj vilka kedjor som ska ingå i backup-filen.</p>
          </div>
          <div style={{ width: '100%', marginTop: '0.5rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '0.75rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={selectedExportIds.length === allIds.length}
                  onChange={toggleExportAll}
                  style={{ accentColor: 'var(--color-primary)', width: 16, height: 16 }}
                />
                <strong>Alla kedjor</strong>
              </label>
              {customers.map((c) => (
                <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', cursor: 'pointer', paddingLeft: '1.5rem' }}>
                  <input
                    type="checkbox"
                    checked={selectedExportIds.includes(c.id)}
                    onChange={() => toggleExportCustomer(c.id)}
                    style={{ accentColor: 'var(--color-primary)', width: 16, height: 16 }}
                  />
                  {c.name}
                </label>
              ))}
            </div>
            <button
              className="settings-btn settings-btn--primary"
              disabled={selectedExportIds.length === 0}
              onClick={() => exportSelectedBackup(selectedExportIds, customers)}
            >
              Exportera
            </button>
          </div>
        </div>

        {/* Import */}
        <div className="setting-row setting-row--col">
          <div className="setting-info">
            <h3>Importera backup</h3>
            <p>Välj en backup-fil och sedan vilka kedjor som ska importeras. Data slås ihop med befintlig.</p>
          </div>
          {!parsedBackup ? (
            <label className="settings-upload" style={{ marginTop: '0.5rem' }}>
              <span className="settings-btn settings-btn--primary">Välj fil...</span>
              <input
                type="file"
                accept=".json"
                hidden
                onChange={handleFileSelected}
              />
            </label>
          ) : (
            <div style={{ width: '100%', marginTop: '0.5rem' }}>
              <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-light)' }}>
                Välj kedjor att importera:
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '0.75rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={selectedImportIds.length === parsedBackup.customers.length}
                    onChange={toggleImportAll}
                    style={{ accentColor: 'var(--color-primary)', width: 16, height: 16 }}
                  />
                  <strong>Alla kedjor</strong>
                </label>
                {parsedBackup.customers.map((c) => (
                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', cursor: 'pointer', paddingLeft: '1.5rem' }}>
                    <input
                      type="checkbox"
                      checked={selectedImportIds.includes(c.id)}
                      onChange={() => toggleImportCustomer(c.id)}
                      style={{ accentColor: 'var(--color-primary)', width: 16, height: 16 }}
                    />
                    {c.name}
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  className="settings-btn settings-btn--primary"
                  onClick={handleConfirmImport}
                  disabled={selectedImportIds.length === 0}
                >
                  Importera
                </button>
                <button
                  className="settings-btn"
                  style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
                  onClick={() => { setParsedBackup(null); setSelectedImportIds([]); }}
                >
                  Avbryt
                </button>
              </div>
            </div>
          )}
        </div>

        {importStatus === 'ok' && (
          <p style={{ color: 'var(--color-promoter)', margin: '0.5rem 0 0' }}>
            ✓ Data importerad!
          </p>
        )}
        {importStatus === 'error' && (
          <p style={{ color: 'var(--color-detractor)', margin: '0.5rem 0 0' }}>
            ✗ Ogiltig fil – kontrollera att det är en giltig backup.
          </p>
        )}
      </div>
    </div>
  );
}

export default SettingsPage;
