const BACKUP_KEYS = ['npsResponses', 'npsCustomers', 'npsActiveCustomerId'];

export function exportBackup() {
  const data = {};
  BACKUP_KEYS.forEach((key) => {
    const val = localStorage.getItem(key);
    if (val) {
      try {
        data[key] = JSON.parse(val);
      } catch {
        data[key] = val;
      }
    }
  });

  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `feedback-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Parse a backup file and return { customers, responses, activeId }
export function parseBackupFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        const customers = data['npsCustomers'] || [];
        const responses = data['npsResponses'] || [];
        const activeId = typeof data['npsActiveCustomerId'] === 'string'
          ? data['npsActiveCustomerId']
          : null;
        resolve({ customers, responses, activeId });
      } catch {
        reject(new Error('Ogiltig fil'));
      }
    };
    reader.onerror = () => reject(new Error('Kunde inte läsa filen'));
    reader.readAsText(file);
  });
}

// Import only selected customers and their responses
export function importSelectedBackup({ customers, responses, activeId }, selectedIds) {
  try {
    // Merge customers: keep existing, add/overwrite selected from backup
    const existingCustomersRaw = localStorage.getItem('npsCustomers');
    const existingCustomers = existingCustomersRaw ? JSON.parse(existingCustomersRaw) : [];
    const selectedCustomers = customers.filter((c) => selectedIds.includes(c.id));

    const mergedCustomers = [...existingCustomers];
    selectedCustomers.forEach((incoming) => {
      const idx = mergedCustomers.findIndex((c) => c.id === incoming.id);
      if (idx >= 0) {
        mergedCustomers[idx] = incoming;
      } else {
        mergedCustomers.push(incoming);
      }
    });
    localStorage.setItem('npsCustomers', JSON.stringify(mergedCustomers));

    // Merge responses: keep existing, add selected from backup (skip duplicates by id)
    const existingResponsesRaw = localStorage.getItem('npsResponses');
    const existingResponses = existingResponsesRaw ? JSON.parse(existingResponsesRaw) : [];
    const selectedResponses = responses.filter((r) => selectedIds.includes(r.customerId));
    const existingIds = new Set(existingResponses.map((r) => r.id));
    const newResponses = selectedResponses.filter((r) => !existingIds.has(r.id));
    localStorage.setItem('npsResponses', JSON.stringify([...existingResponses, ...newResponses]));

    // Set active customer if it was among selected
    if (activeId && selectedIds.includes(activeId)) {
      localStorage.setItem('npsActiveCustomerId', activeId);
    }

    return true;
  } catch {
    return false;
  }
}
