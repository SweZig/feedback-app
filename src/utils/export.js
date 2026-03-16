import { categorize } from './npsCalculations';
import { getResponses } from './storage';
import { getCustomers } from './settings';

const CATEGORY_LABELS = {
  detractor: 'Kritiker',
  passive: 'Passiv',
  promoter: 'Ambassadör',
};

function buildRows(responses, includeCustomer = false, customerMap = {}) {
  return responses
    .sort((a, b) => b.timestamp - a.timestamp)
    .map((r) => {
      const row = {};
      if (includeCustomer) {
        row['Kund'] = customerMap[r.customerId] || r.customerId || '';
      }
      row['Datum'] = new Date(r.timestamp).toLocaleDateString('sv-SE');
      row['Tid'] = new Date(r.timestamp).toLocaleTimeString('sv-SE');
      row['Poäng'] = r.score;
      row['Kategori'] = CATEGORY_LABELS[categorize(r.score)];
      row['Svarsalternativ'] = r.predefinedAnswer || '';
      row['Kommentar'] = r.comment || '';
      return row;
    });
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toCsv(rows) {
  if (rows.length === 0) return null;
  const headers = Object.keys(rows[0]);
  const csvLines = [
    headers.join(';'),
    ...rows.map((row) =>
      headers.map((h) => {
        const val = String(row[h]);
        return val.includes(';') || val.includes('"') || val.includes('\n')
          ? `"${val.replace(/"/g, '""')}"`
          : val;
      }).join(';')
    ),
  ];
  return csvLines.join('\r\n');
}

function buildXml(headers, xmlRows, sheetName) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="${sheetName}">
    <Table>
      <Row>${headers.map((h) => `<Cell><Data ss:Type="String">${h}</Data></Cell>`).join('')}</Row>
      ${xmlRows.join('\n      ')}
    </Table>
  </Worksheet>
</Workbook>`;
}

function toXml(rows, sheetName = 'NPS') {
  if (rows.length === 0) return null;
  const headers = Object.keys(rows[0]);
  const xmlRows = rows.map((row) =>
    '<Row>' +
    headers.map((h) => {
      const val = row[h];
      const type = typeof val === 'number' ? 'Number' : 'String';
      return `<Cell><Data ss:Type="${type}">${String(val).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</Data></Cell>`;
    }).join('') +
    '</Row>'
  );
  return { headers, xmlRows };
}

// Export active customer (filtered responses already passed in)
export function exportCsv(responses) {
  const rows = buildRows(responses);
  const csv = toCsv(rows);
  if (!csv) return;
  const bom = '\uFEFF';
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' });
  download(blob, `nps-export-${new Date().toISOString().slice(0, 10)}.csv`);
}

export function exportExcel(responses) {
  const rows = buildRows(responses);
  const result = toXml(rows);
  if (!result) return;
  const { headers, xmlRows } = result;
  const xml = buildXml(headers, xmlRows, 'NPS');
  const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
  download(blob, `nps-export-${new Date().toISOString().slice(0, 10)}.xls`);
}

// Export selected customer IDs
export function exportSelectedCsv(selectedIds) {
  const allResponses = getResponses();
  const customers = getCustomers();
  const customerMap = Object.fromEntries(customers.map((c) => [c.id, c.name]));
  const filtered = allResponses.filter((r) => selectedIds.includes(r.customerId));
  const rows = buildRows(filtered, selectedIds.length > 1, customerMap);
  const csv = toCsv(rows);
  if (!csv) return;
  const bom = '\uFEFF';
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' });
  download(blob, `nps-export-urval-${new Date().toISOString().slice(0, 10)}.csv`);
}

export function exportSelectedExcel(selectedIds) {
  const allResponses = getResponses();
  const customers = getCustomers();
  const customerMap = Object.fromEntries(customers.map((c) => [c.id, c.name]));
  const filtered = allResponses.filter((r) => selectedIds.includes(r.customerId));
  const rows = buildRows(filtered, selectedIds.length > 1, customerMap);
  const result = toXml(rows, 'NPS - Urval');
  if (!result) return;
  const { headers, xmlRows } = result;
  const xml = buildXml(headers, xmlRows, 'NPS - Urval');
  const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
  download(blob, `nps-export-urval-${new Date().toISOString().slice(0, 10)}.xls`);
}
