/**
 * offlineQueue.js — Sprint A.9
 *
 * Lokal kö i localStorage för NPS-svar som inte gick fram till Supabase
 * p.g.a. nätverksavbrott eller tröghet. Tyst för slutkund: tackvyn visas
 * som vanligt, svaret skickas så fort uppkoppling återställs.
 *
 * Designval:
 * - localStorage (inte sessionStorage / RAM) — överlever Sprint A.6:s 4h-
 *   reload, Fully-restart och Android-restart. 5 MB-tak räcker till många
 *   tusen svar.
 * - Payload bär med sig client-genererat id och respondedAt-tidstämpel,
 *   så att retries blir idempotenta. A.7:s unique-index på
 *   (touchpoint_id, score, date_trunc('second', responded_at)) blockerar
 *   eventuella dubbla flushar.
 * - Vid retry-tak (48h) släpps item:et tyst. Risken finns att en touchpoint
 *   raderats medan svar låg i kön — då skulle vi annars retrya i evighet.
 * - Vid första nätverksfel under en flush avbryts resten av sweepen — de
 *   skulle ändå failat och vi vill inte spamma onödiga requests.
 * - Concurrency-guard hindrar parallella flushar (mount + setInterval +
 *   post-submit kan trigga samtidigt).
 */

const STORAGE_KEY  = 'feedback_offline_queue';
const MAX_AGE_MS   = 48 * 60 * 60 * 1000; // 48 timmar
const PG_UNIQUE_VIOLATION = '23505';

let flushInProgress = false;

function readQueue() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn('[OfflineQueue] kunde inte läsa kön:', e?.message);
    return [];
  }
}

function writeQueue(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (e) {
    // QuotaExceededError eller liknande — vi väljer att inte hantera detta
    // dramatiskt. Loggar och låter call-site fortsätta.
    console.warn('[OfflineQueue] kunde inte skriva kön:', e?.message);
  }
}

/**
 * Lägg ett payload på kön. Returnerar köstorleken efter add.
 */
export function enqueue(payload) {
  const items = readQueue();
  items.push({
    enqueuedAt:  new Date().toISOString(),
    attempts:    0,
    lastAttempt: null,
    lastError:   null,
    payload,
  });
  writeQueue(items);
  console.log(`[OfflineQueue] kö +1, totalt ${items.length} items`);
  return items.length;
}

export function getQueueSize() {
  return readQueue().length;
}

export function peekQueue() {
  return readQueue();
}

export function clearQueue() {
  writeQueue([]);
}

/**
 * Försök tömma kön. saveFn ska vara en async-funktion som tar ett payload
 * och kastar ett error vid misslyckande (samma signatur som
 * saveKioskResponse). Returnerar { sent, failed, dropped, queued }.
 */
export async function flushQueue(saveFn) {
  if (flushInProgress) {
    return { sent: 0, failed: 0, dropped: 0, queued: getQueueSize() };
  }
  const items = readQueue();
  if (items.length === 0) {
    return { sent: 0, failed: 0, dropped: 0, queued: 0 };
  }

  flushInProgress = true;
  const now = Date.now();
  let sent = 0, failed = 0, dropped = 0;
  const remaining = [];
  let networkDown = false;

  try {
    for (const item of items) {
      // Hoppa över resten om nätverket är nere — sparar requests
      if (networkDown) {
        remaining.push(item);
        continue;
      }

      // Släpp items äldre än 48h tyst — sannolikt har touchpointen ändrats
      // eller raderats i admin under tiden
      const age = now - new Date(item.enqueuedAt).getTime();
      if (age > MAX_AGE_MS) {
        console.warn(`[OfflineQueue] släpper item äldre än 48h: ${item.payload?.id}`);
        dropped++;
        continue;
      }

      try {
        await saveFn(item.payload);
        sent++;
      } catch (e) {
        // Item redan i DB (vi har redan flushat det förut) — drop
        if (e?.code === PG_UNIQUE_VIOLATION) {
          console.log(`[OfflineQueue] item redan i DB, droppar: ${item.payload?.id}`);
          dropped++;
          continue;
        }

        // Annars: behåll i kön, öka attempts
        item.attempts    = (item.attempts || 0) + 1;
        item.lastAttempt = new Date().toISOString();
        item.lastError   = e?.message || String(e);
        remaining.push(item);
        failed++;

        if (isNetworkError(e)) {
          // Avbryt resten av sweepen — de skulle alla failat
          networkDown = true;
        }
      }
    }

    writeQueue(remaining);

    if (sent > 0 || failed > 0 || dropped > 0) {
      console.log(
        `[OfflineQueue] flush klar: skickade=${sent} misslyckade=${failed} ` +
        `släppta=${dropped} kvar=${remaining.length}`
      );
    }

    return { sent, failed, dropped, queued: remaining.length };
  } finally {
    flushInProgress = false;
  }
}

/**
 * Är ett error sannolikt ett nätverksfel (offline / timeout / tröghet)?
 * Används både här i flushQueue och i KioskPage för att avgöra om ett
 * misslyckat direkt-INSERT ska köas eller bubblas upp som UI-error.
 */
export function isNetworkError(e) {
  if (!e) return false;
  const msg = (e.message || String(e)).toLowerCase();
  if (msg.includes('failed to fetch'))      return true;
  if (msg.includes('network request failed')) return true;
  if (msg.includes('networkerror'))         return true;
  if (msg.includes('load failed'))          return true; // Safari-formulering
  if (e.name === 'TypeError' && /fetch|network/i.test(msg)) return true;
  // Supabase / PostgREST kan returnera 503/504 vid backend-tröghet
  if (e.status === 503 || e.status === 504) return true;
  return false;
}
