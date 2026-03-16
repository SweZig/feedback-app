import { categorize } from './npsCalculations';

const CATEGORY_LABELS = {
  detractor: 'Kritiker',
  passive: 'Passiv',
  promoter: 'Ambassadör',
};

function buildRows(responses) {
  return responses
    .sort((a, b) => b.timestamp - a.timestamp)
    .map((r) => ({
      Datum: new Date(r.timestamp).toLocaleDateString('sv-SE'),
      Tid: new Date(r.timestamp).toLocaleTimeString('sv-SE'),
      Poäng: r.score,
      Kategori: CATEGORY_LABELS[categorize(r.score)],
      Svarsalternativ: r.predefinedAnswer || '',
      Kommentar: r.comment || '',
    }));
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportCsv(responses) {
  const rows = buildRows(responses);
  if (rows.length === 0) return;

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

  const bom = '\uFEFF';
  const blob = new Blob([bom + csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  download(blob, `nps-export-${new Date().toISOString().slice(0, 10)}.csv`);
}

export function exportExcel(responses) {
  const rows = buildRows(responses);
  if (rows.length === 0) return;

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

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="NPS">
    <Table>
      <Row>${headers.map((h) => `<Cell><Data ss:Type="String">${h}</Data></Cell>`).join('')}</Row>
      ${xmlRows.join('\n      ')}
    </Table>
  </Worksheet>
</Workbook>`;

  const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
  download(blob, `nps-export-${new Date().toISOString().slice(0, 10)}.xls`);
}
