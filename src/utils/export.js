import { categorize } from './npsCalculations';
import { TYPE_LABELS, MODE_LABELS } from './settings';

const CATEGORY_LABELS = {
  detractor: 'Kritiker',
  passive: 'Passiv',
  promoter: 'Ambassadör',
};

function buildMaps(chains) {
  const chainMap = {};
  const deptMap = {};
  const tpMap = {};
  chains.forEach((c) => {
    chainMap[c.id] = c.name;
    (c.departments || []).forEach((d) => { deptMap[d.id] = { name: d.name, uniqueCode: d.uniqueCode || '' }; });
    (c.touchpoints || []).forEach((t) => {
      tpMap[t.id] = { name: t.name, departmentId: t.departmentId, type: t.type, mode: t.mode };
    });
  });
  return { chainMap, deptMap, tpMap };
}

function buildRows(responses, chains) {
  const { chainMap, deptMap, tpMap } = buildMaps(chains);
  return responses.sort((a, b) => b.timestamp - a.timestamp).map((r) => {
    const tp = r.touchpointId ? tpMap[r.touchpointId] : null;
    const dept = tp ? deptMap[tp.departmentId] : null;
    return {
      Datum: new Date(r.timestamp).toLocaleDateString('sv-SE'),
      Tid: new Date(r.timestamp).toLocaleTimeString('sv-SE'),
      Kedja: chainMap[r.customerId] || '',
      Avdelning: dept ? dept.name : '',
      'Avdelnings-ID': dept ? dept.uniqueCode : '',
      Mätpunkt: tp ? tp.name : '',
      Typ: tp ? (TYPE_LABELS[tp.type] || tp.type) : '',
      Läge: tp ? (MODE_LABELS[tp.mode] || tp.mode) : '',
      Poäng: r.score,
      Kategori: CATEGORY_LABELS[categorize(r.score)],
      Svarsalternativ: r.predefinedAnswer || '',
      Kommentar: r.comment || '',
      Uppföljning: r.followUpEmail || '',
    };
  });
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function toCsv(rows) {
  if (!rows.length) return null;
  const headers = Object.keys(rows[0]);
  return [
    headers.join(';'),
    ...rows.map((row) => headers.map((h) => {
      const val = String(row[h]);
      return val.includes(';') || val.includes('"') || val.includes('\n')
        ? `"${val.replace(/"/g, '""')}"` : val;
    }).join(';')),
  ].join('\r\n');
}

function buildXml(rows, sheetName) {
  if (!rows.length) return null;
  const headers = Object.keys(rows[0]);
  const xmlRows = rows.map((row) =>
    '<Row>' + headers.map((h) => {
      const val = row[h];
      const type = typeof val === 'number' ? 'Number' : 'String';
      return `<Cell><Data ss:Type="${type}">${String(val).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</Data></Cell>`;
    }).join('') + '</Row>'
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="${sheetName}">
    <Table>
      <Row>${headers.map((h) => `<Cell><Data ss:Type="String">${h}</Data></Cell>`).join('')}</Row>
      ${xmlRows.join('\n      ')}
    </Table>
  </Worksheet>
</Workbook>`;
}

// Sprint B: chain skickas in som parameter (tidigare lästes alla kedjor
// via getChains() från localStorage). Den enda kedjan som behövs är den
// aktiva — alla responses i exporten tillhör samma kedja.
export function exportCsv(responses, chain) {
  if (!chain) return;
  const rows = buildRows(responses, [chain]);
  const csv = toCsv(rows);
  if (!csv) return;
  download(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }),
    `nps-export-${new Date().toISOString().slice(0, 10)}.csv`);
}

export function exportExcel(responses, chain) {
  if (!chain) return;
  const rows = buildRows(responses, [chain]);
  const xml = buildXml(rows, 'NPS');
  if (!xml) return;
  download(new Blob([xml], { type: 'application/vnd.ms-excel' }),
    `nps-export-${new Date().toISOString().slice(0, 10)}.xls`);
}
