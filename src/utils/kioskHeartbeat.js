// src/utils/kioskHeartbeat.js
//
// Heartbeat-funktioner för kiosk-driftövervakning (Sprint A.5)
//
// Designval (uppdaterat efter Sprint A.6):
// - Periodisk ping var 15:e minut via setInterval (fungerar när skärm är på)
// - Ping vid 'visibilitychange' när dokumentet blir synligt (fångar wake-from-sleep)
// - Manuell ping via pingNow() från KioskPage (anropas vid user-interaction)
// - Throttling: max 1 ping per 60 sekunder oavsett trigger
// - Bara mellan 08:15 och 21:00 svensk tid (Europe/Stockholm)
// - UPSERT på touchpoint_id PK — bara senaste status sparas, ingen historik
// - Tysta katcher — om en ping failar gör vi ingenting, nästa puls försöker igen
//
// Bakgrund till multi-trigger-arkitekturen:
// - Chrome 81 WebView (SM-T510 Android 10) pausar setInterval när skärmen släcks
//   och återupptar inte tillförlitligt vid wakeup. Utan visibilitychange + manuell
//   trigger skulle plattor som sovit över natten aldrig pinga igen utan reload.

import { supabase } from './supabaseClient';

const HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000; // 15 minuter
const HEARTBEAT_THROTTLE_MS = 60 * 1000;      // Max 1 ping per 60 sekunder
const WINDOW_START_HOUR = 8;                   // 08:15 svensk tid
const WINDOW_START_MINUTE = 15;
const WINDOW_END_HOUR = 21;                    // 21:00 svensk tid (exklusivt)

// Slumpad client_id per session — för debug om flera enheter pekar på samma touchpoint.
function generateClientId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback för äldre Android WebView (samma mönster som SurveyPage)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : ((r & 0x3) | 0x8)).toString(16);
  });
}

/**
 * Returnerar true om vi just nu är inom heartbeat-fönstret 08:15–21:00 svensk tid.
 *
 * Använder Intl.DateTimeFormat med timeZone: 'Europe/Stockholm' så det funkar
 * även om enhetens tidszon är felställd (vanligt i Fully Kiosk på fabriksinställd platta).
 */
export function isWithinHeartbeatWindow(now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Stockholm',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);

    const hour   = parseInt(parts.find(p => p.type === 'hour').value, 10);
    const minute = parseInt(parts.find(p => p.type === 'minute').value, 10);

    // Före 08:15 → utanför
    if (hour < WINDOW_START_HOUR) return false;
    if (hour === WINDOW_START_HOUR && minute < WINDOW_START_MINUTE) return false;

    // 21:00 eller senare → utanför
    if (hour >= WINDOW_END_HOUR) return false;

    return true;
  } catch {
    // Om Intl-API:n failar — fall tillbaka på lokala tiden (acceptabelt fel)
    const h = now.getHours();
    const m = now.getMinutes();
    if (h < WINDOW_START_HOUR) return false;
    if (h === WINDOW_START_HOUR && m < WINDOW_START_MINUTE) return false;
    if (h >= WINDOW_END_HOUR) return false;
    return true;
  }
}

/**
 * Skicka en heartbeat-UPSERT till Supabase. Tysta katcher — failar tyst.
 */
async function sendHeartbeat(touchpointId, clientId, getDiagnostics) {
  if (!touchpointId) return false;
  if (!isWithinHeartbeatWindow()) return false;

  try {
    const userAgent = (typeof navigator !== 'undefined' && navigator.userAgent) || 'unknown';

    const row = {
      touchpoint_id: touchpointId,
      last_seen_at:  new Date().toISOString(),
      user_agent:    userAgent.slice(0, 500), // begränsa längd defensivt
      client_id:     clientId,
    };

    // Sprint A.14: kameradiagnostik. Diagnostiken får aldrig sänka pulsen —
    // kastar callbacken skickas heartbeaten ändå, utan kamerafälten.
    if (typeof getDiagnostics === 'function') {
      try {
        const d = getDiagnostics() || {};
        row.camera_state      = d.cameraState || null;
        row.camera_detail     = d.cameraDetail ? String(d.cameraDetail).slice(0, 200) : null;
        row.camera_resolution = d.cameraResolution || null;
        row.camera_label      = d.cameraLabel ? String(d.cameraLabel).slice(0, 200) : null;
        row.models_loaded     = typeof d.modelsLoaded === 'boolean' ? d.modelsLoaded : null;
        row.secure_context    = typeof d.secureContext === 'boolean' ? d.secureContext : null;
        row.webview_version   = Number.isFinite(d.webviewVersion) ? d.webviewVersion : null;
        // last_face_at skrivs bara när ett ansikte faktiskt setts, annars
        // skulle en UPSERT nolla bort tidigare träffar.
        if (d.lastFaceAt) row.last_face_at = d.lastFaceAt;
      } catch (e) {
        console.warn('[heartbeat] diagnostik misslyckades:', e.message);
      }
    }

    const { error } = await supabase
      .from('kiosk_heartbeats')
      .upsert(row, { onConflict: 'touchpoint_id' });

    if (error) {
      // Logga bara — kasta inte. Kioskens primära flöde (svar) får aldrig brytas.
      console.warn('[heartbeat] upsert failed:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[heartbeat] exception:', e.message);
    return false;
  }
}

/**
 * Starta heartbeat-loop för en touchpoint. Returnerar ett objekt med:
 *   { stop, pingNow }
 *
 * - stop()    — anropas av useEffect-cleanup, river ner alla listeners + timer
 * - pingNow() — kan anropas av KioskPage vid user-interaction (t.ex. score-select).
 *               Throttlas internt så snabba klick inte spammar Supabase.
 *
 * Beteende:
 * - Skickar första pingen direkt vid start (om inom fönster)
 * - Skickar sedan en ping var 15:e minut
 * - Skickar ping när dokumentet blir synligt (fångar wake-from-sleep)
 * - Skickar ping när KioskPage manuellt anropar pingNow()
 * - Alla pingar throttlas till max 1 per 60 sekunder
 * - Pingar utanför fönstret no-op:as
 */
export function startHeartbeat(touchpointId, getDiagnostics) {
  if (!touchpointId) {
    return { stop: () => {}, pingNow: () => {} };
  }

  const clientId = generateClientId();
  let lastPingAt = 0; // throttle-stämpel (epoch ms)

  // Throttlad ping — alla triggers går genom denna
  function tryPing(reason) {
    const now = Date.now();
    if (now - lastPingAt < HEARTBEAT_THROTTLE_MS) {
      // Tyst no-op när vi nyligen pingat (ingen console-spam)
      return;
    }
    lastPingAt = now;
    sendHeartbeat(touchpointId, clientId, getDiagnostics).then(ok => {
      if (ok && reason && process.env.NODE_ENV !== 'production') {
        console.log(`[heartbeat] sent (${reason})`);
      }
    });
  }

  // Trigger 1: omedelbar ping vid start
  tryPing('mount');

  // Trigger 2: periodisk ping (fungerar bara när skärm är på i Chrome WebView)
  const intervalId = setInterval(() => tryPing('interval'), HEARTBEAT_INTERVAL_MS);

  // Trigger 3: ping när dokumentet blir synligt (wake-from-sleep, tab focus)
  function handleVisibilityChange() {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      tryPing('visibility');
    }
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  // Trigger 4: ping vid 'pageshow' (BFCache-restore, Fully reload)
  function handlePageShow() {
    tryPing('pageshow');
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pageshow', handlePageShow);
  }

  return {
    stop: () => {
      clearInterval(intervalId);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('pageshow', handlePageShow);
      }
    },
    pingNow: () => tryPing('manual'),
  };
}

// ═══════════════════════════════════════════════════════════════════
// LÄSFUNKTIONER (används av SettingsPage för driftstatus-vy)
// ═══════════════════════════════════════════════════════════════════

const STATUS_GREEN_MAX_MIN  = 20;  // ≤ 20 min sedan = grön
const STATUS_YELLOW_MAX_MIN = 45;  // 20–45 min = gul, > 45 min = röd

/**
 * Beräkna R/A/G-status för en mätpunkt baserat på senaste heartbeat.
 * Returnerar 'green' | 'yellow' | 'red' | 'closed' | 'never'.
 */
export function computeKioskStatus(lastSeenAt, now = new Date()) {
  if (!isWithinHeartbeatWindow(now)) return 'closed';
  if (!lastSeenAt) return 'never';

  const lastSeen = lastSeenAt instanceof Date ? lastSeenAt : new Date(lastSeenAt);
  const ageMinutes = (now.getTime() - lastSeen.getTime()) / 60000;

  if (ageMinutes <= STATUS_GREEN_MAX_MIN)  return 'green';
  if (ageMinutes <= STATUS_YELLOW_MAX_MIN) return 'yellow';
  return 'red';
}

/**
 * Hämta heartbeat-status + senaste svartidpunkt för en lista touchpoints.
 *
 * Returnerar Map<touchpointId, { lastSeenAt: Date|null, lastResponseAt: Date|null }>.
 * Tysta katcher — vid Supabase-fel returneras tom Map så UI:t inte kraschar.
 */
export async function getKioskStatuses(touchpointIds) {
  const result = new Map();
  if (!Array.isArray(touchpointIds) || touchpointIds.length === 0) return result;

  for (const id of touchpointIds) {
    result.set(id, {
      lastSeenAt: null, lastResponseAt: null,
      cameraState: null, cameraDetail: null, cameraResolution: null,
      modelsLoaded: null, secureContext: null, webviewVersion: null, lastFaceAt: null,
    });
  }

  // Sprint A.14: kamerakolumnerna finns bara efter migrationen. Har den inte
  // körts svarar PostgREST med fel på HELA selecten, och då skulle även de
  // gamla driftprickarna slockna. Därför ett försök till med basfälten.
  async function fetchHeartbeats() {
    const extended = await supabase
      .from('kiosk_heartbeats')
      .select('touchpoint_id, last_seen_at, camera_state, camera_detail, camera_resolution, models_loaded, secure_context, webview_version, last_face_at')
      .in('touchpoint_id', touchpointIds);

    if (!extended.error) return extended;

    console.warn('[heartbeat] kamerafält saknas, faller tillbaka på basfält:', extended.error.message);
    return supabase
      .from('kiosk_heartbeats')
      .select('touchpoint_id, last_seen_at')
      .in('touchpoint_id', touchpointIds);
  }

  try {
    const [heartbeats, responses] = await Promise.all([
      fetchHeartbeats(),
      supabase
        .from('responses')
        .select('touchpoint_id, responded_at')
        .in('touchpoint_id', touchpointIds)
        .order('responded_at', { ascending: false }),
    ]);

    if (heartbeats.data) {
      for (const h of heartbeats.data) {
        const entry = result.get(h.touchpoint_id);
        if (!entry) continue;
        entry.lastSeenAt = new Date(h.last_seen_at);
        // Sprint A.14 — kameradiagnostik
        entry.cameraState      = h.camera_state || null;
        entry.cameraDetail     = h.camera_detail || null;
        entry.cameraResolution = h.camera_resolution || null;
        entry.modelsLoaded     = h.models_loaded;
        entry.secureContext    = h.secure_context;
        entry.webviewVersion   = h.webview_version;
        entry.lastFaceAt       = h.last_face_at ? new Date(h.last_face_at) : null;
      }
    }

    if (responses.data) {
      for (const r of responses.data) {
        const entry = result.get(r.touchpoint_id);
        if (entry && !entry.lastResponseAt) {
          entry.lastResponseAt = new Date(r.responded_at);
        }
      }
    }
  } catch (e) {
    console.warn('[heartbeat] getKioskStatuses failed:', e.message);
  }

  return result;
}

// ── Kameradiagnostik (Sprint A.14) ──────────────────────────────────────────

// Varje tillstånd har en åtgärd. Texten säger vad man gör, inte bara vad som hänt.
const CAMERA_LABELS = {
  ok:          { label: 'Kamera OK',        hint: '' },
  denied:      { label: 'Behörighet nekad', hint: 'Ge Fully Kiosk kameratillstånd i Android-inställningarna.' },
  notfound:    { label: 'Ingen kamera',     hint: 'Enheten hittar ingen frontkamera.' },
  insecure:    { label: 'Osäkert ursprung', hint: 'Sidan körs inte över HTTPS. Fully Kiosks webbkameraåtkomst kräver det.' },
  unsupported: { label: 'Stöd saknas',      hint: 'WebView saknar getUserMedia — för gammal Chromium.' },
  error:       { label: 'Kamerafel',        hint: 'Ofta upptagen av annat, t.ex. Fullys rörelsedetektering.' },
  pending:     { label: 'Inte testad än',   hint: 'Plattan har inte hunnit försöka öppna kameran.' },
};

/**
 * Sammanfatta kamerans hälsa för en mätpunkt. Returnerar null när plattan
 * aldrig rapporterat kamerastatus (heartbeat från före A.14).
 */
export function describeCamera(entry) {
  if (!entry || !entry.cameraState) return null;

  const base = CAMERA_LABELS[entry.cameraState] || CAMERA_LABELS.error;
  const parts = [];

  if (entry.cameraState === 'ok') {
    if (entry.cameraResolution) parts.push(entry.cameraResolution);
    parts.push(entry.lastFaceAt
      ? `senaste ansikte ${formatRelativeTime(entry.lastFaceAt)}`
      : 'inget ansikte ännu');
  } else if (entry.cameraDetail) {
    parts.push(entry.cameraDetail);
  }

  // Modellerna laddas över nätet — utan dem hjälper ingen kamera i världen.
  if (entry.modelsLoaded === false) parts.push('modeller ej laddade');
  if (Number.isFinite(entry.webviewVersion) && entry.webviewVersion < 87) {
    parts.push(`WebView ${entry.webviewVersion} — kräver 87+`);
  }

  return {
    state: entry.cameraState,
    ok: entry.cameraState === 'ok',
    label: base.label,
    hint: base.hint,
    detail: parts.join(' · '),
  };
}

/**
 * Returnera mänsklig label + förklaring för en status (för tooltip).
 * Sprint A.14: kamerans tillstånd hängs på när plattan rapporterat det.
 */
export function describeKioskStatus(status, lastSeenAt, lastResponseAt, entry) {
  const seenAgo = lastSeenAt ? formatRelativeTime(lastSeenAt) : 'aldrig';
  const respAgo = lastResponseAt ? formatRelativeTime(lastResponseAt) : 'inga svar än';

  let base;
  switch (status) {
    case 'green':  base = `Online · pingade ${seenAgo} · senaste svar ${respAgo}`; break;
    case 'yellow': base = `Kanske glapp · pingade ${seenAgo} · senaste svar ${respAgo}`; break;
    case 'red':    base = `Offline · pingade ${seenAgo} · senaste svar ${respAgo}`; break;
    case 'closed': base = `Stängt (utanför 08:15–21:00) · senaste svar ${respAgo}`; break;
    case 'never':  base = `Aldrig sett · senaste svar ${respAgo}`; break;
    default:       return '';
  }

  const cam = describeCamera(entry);
  if (!cam) return base;

  const camLine = cam.detail ? `${cam.label} (${cam.detail})` : cam.label;
  return `${base}\n${camLine}${cam.hint ? `\n${cam.hint}` : ''}`;
}

/**
 * Formatera "X min sedan" / "X tim sedan" / "X dagar sedan".
 * Returnerar "inga svar än" om ts är null.
 */
export function formatRelativeTime(ts, now = new Date()) {
  if (!ts) return 'inga svar än';
  const date = ts instanceof Date ? ts : new Date(ts);
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60000);

  if (minutes < 1)    return 'precis nu';
  if (minutes < 60)   return `${minutes} min sedan`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)     return `${hours} tim sedan`;
  const days = Math.floor(hours / 24);
  if (days < 30)      return `${days} ${days === 1 ? 'dag' : 'dagar'} sedan`;
  return date.toLocaleDateString('sv-SE');
}
