// src/utils/kioskHeartbeat.js
//
// Heartbeat-funktioner för kiosk-driftövervakning (Sprint A.5)
//
// Designval:
// - Heartbeat skickas var 15:e minut från KioskPage
// - Bara mellan 08:15 och 21:00 svensk tid (Europe/Stockholm)
// - UPSERT på touchpoint_id PK — bara senaste status sparas, ingen historik
// - Anon-roll: RLS-policy 'kiosk_heartbeats_anon_write' släpper igenom
// - Tysta katcher — om en ping failar gör vi ingenting, nästa puls försöker igen

import { supabase } from './supabaseClient';

const HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000; // 15 minuter
const WINDOW_START_HOUR = 8;                   // 08:15 svensk tid
const WINDOW_START_MINUTE = 15;
const WINDOW_END_HOUR = 21;                    // 21:00 svensk tid (exklusivt)

// Slumpad client_id per session — för debug om flera enheter pekar på samma touchpoint.
// Genereras en gång per page-load och behålls genom hela sessionen.
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
async function sendHeartbeat(touchpointId, clientId) {
  if (!touchpointId) return false;
  if (!isWithinHeartbeatWindow()) return false;

  try {
    const userAgent = (typeof navigator !== 'undefined' && navigator.userAgent) || 'unknown';

    const { error } = await supabase
      .from('kiosk_heartbeats')
      .upsert(
        {
          touchpoint_id: touchpointId,
          last_seen_at:  new Date().toISOString(),
          user_agent:    userAgent.slice(0, 500), // begränsa längd defensivt
          client_id:     clientId,
        },
        { onConflict: 'touchpoint_id' }
      );

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
 * Starta heartbeat-loop för en touchpoint. Returnerar en stop-funktion som
 * KioskPage anropar i useEffect-cleanup.
 *
 * Beteende:
 * - Skickar första pingen direkt vid start (om inom fönster)
 * - Skickar sedan en ping var 15:e minut
 * - Pingar utanför fönstret no-op:as men intervallet fortsätter ticka
 *   (så vi kommer igång igen automatiskt när fönstret öppnar)
 */
export function startHeartbeat(touchpointId) {
  if (!touchpointId) return () => {};

  const clientId = generateClientId();

  // Första pingen direkt — utan await så vi inte blockerar caller
  sendHeartbeat(touchpointId, clientId);

  const intervalId = setInterval(() => {
    sendHeartbeat(touchpointId, clientId);
  }, HEARTBEAT_INTERVAL_MS);

  return () => clearInterval(intervalId);
}
