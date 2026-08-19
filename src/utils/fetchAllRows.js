// Paginerad hämtning mot PostgREST.
//
// Supabase kapar varje svar vid projektets `max-rows` (1000 som standard).
// Kapningen är tyst: inget fel, ingen varning, bara färre rader än man bad om.
// En kedja som passerar gränsen tappar därför sin äldsta historik ur alla vyer
// utan att någon märker det förrän en kund frågar var våren tog vägen.
//
// buildQuery måste returnera en NY query-builder vid varje anrop — en builder
// är engångs och kan inte köras om efter await.
//
// Sortera alltid deterministiskt (inklusive id som sista nyckel), annars är
// radordningen odefinierad mellan sidor och pagineringen ger både dubbletter
// och hål.

export const PAGE_SIZE = 1000;

// Skydd mot oändlig loop om servern beter sig oväntat. 100 sidor = 100 000 rader.
const MAX_PAGES = 100;

export async function fetchAllRows(buildQuery, { pageSize = PAGE_SIZE } = {}) {
  const all = [];
  const seen = new Set();

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * pageSize;
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) return { data: all, error };

    const rows = data || [];
    for (const row of rows) {
      // Rader som skrivs in medan vi bläddrar kan förskjuta sidgränserna och
      // få samma rad att dyka upp två gånger. Ett dubbelräknat svar snedvrider
      // NPS, så id-filtret här är korrekthet, inte snygghet.
      if (row && row.id !== undefined) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
      }
      all.push(row);
    }

    if (rows.length < pageSize) return { data: all, error: null };
  }

  console.warn(`[fetchAllRows] Nådde taket på ${MAX_PAGES} sidor — resultatet kan vara ofullständigt.`);
  return { data: all, error: null };
}
