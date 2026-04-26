// src/utils/settings.js
//
// Sprint B: All CRUD är flyttad till chainOperations.js (Supabase).
// Den här filen innehåller bara:
//   - Default-konfigurationer per touchpoint-typ
//   - getEffectiveConfig — bygger ihop chain-config + touchpoint-override
//   - UI-state-helpers som lever i localStorage:
//       getActiveChainId / setActiveChainId
//       getActiveTouchpointId / setActiveTouchpoint
//   - getTouchpointUrl — URL-byggare för kiosk-länkar
//   - TYPE_LABELS, MODE_LABELS — UI-konstanter

const ACTIVE_KEY = 'npsActiveCustomerId';
const ACTIVE_TP_MAP_KEY = 'npsActiveTouchpointByChain';


// ────────────────────────────────────────────
// UI-konstanter
// ────────────────────────────────────────────

export const TYPE_LABELS = {
  physical: 'Fysisk plats',
  online: 'Online',
  other: 'Övriga',
  enps: 'eNPS',
};

export const MODE_LABELS = {
  app: 'Enkät',
  qr: 'QR-kod',
  link: 'Webblänk',
  embed: 'Inbäddad kod',
};


// ────────────────────────────────────────────
// Default-konfigurationer
// ────────────────────────────────────────────

const DEFAULT_NPS_QUESTION = 'På en skala från 0–10, hur troligt är det att du skulle rekommendera oss till vänner och bekanta?';

const DEFAULT_PREDEFINED_ANSWERS = [
  { text: 'Jag fick dålig service', polarity: 'negative' },
  { text: 'Butiken gav ett rörigt intryck', polarity: 'negative' },
  { text: 'Det var för lång väntetid', polarity: 'negative' },
  { text: 'Jag fick ej hjälp när jag behövde', polarity: 'negative' },
  { text: 'Jag fann inte produkten jag sökte', polarity: 'negative' },
  { text: 'Inget av ovanstående', polarity: null },
];

const DEFAULT_ENPS_ANSWERS = [
  { text: 'Problem i gruppen', polarity: 'negative' },
  { text: 'Problem med en kollega', polarity: 'negative' },
  { text: 'Problem med ledarskapet', polarity: 'negative' },
  { text: 'Problem med arbetsmiljön', polarity: 'negative' },
  { text: 'Schemat kommer inte ut i tid', polarity: 'negative' },
];

const DEFAULT_PHYSICAL_CONFIG = {
  npsColorMode: 'colored',
  npsQuestion: DEFAULT_NPS_QUESTION,
  freeTextEnabled: true,
  countdownSeconds: 6,
  predefinedAnswersEnabled: false,
  predefinedAnswers: DEFAULT_PREDEFINED_ANSWERS,
  showPositiveAnswersForPromoters: false,
  showNegativeAnswersForDetractors: false,
  followUpEnabled: false,
};

const DEFAULT_ONLINE_CONFIG = {
  npsColorMode: 'colored',
  npsQuestion: DEFAULT_NPS_QUESTION,
  freeTextEnabled: true,
  predefinedAnswersEnabled: false,
  predefinedAnswers: DEFAULT_PREDEFINED_ANSWERS,
  showPositiveAnswersForPromoters: false,
  showNegativeAnswersForDetractors: false,
  followUpEnabled: false,
};

const DEFAULT_OTHER_CONFIG = {
  npsColorMode: 'colored',
  npsQuestion: DEFAULT_NPS_QUESTION,
  freeTextEnabled: true,
  predefinedAnswersEnabled: false,
  predefinedAnswers: DEFAULT_PREDEFINED_ANSWERS,
  showPositiveAnswersForPromoters: false,
  showNegativeAnswersForDetractors: false,
  followUpEnabled: false,
};

const DEFAULT_ENPS_CONFIG = {
  npsColorMode: 'colored',
  npsQuestion: 'På en skala från 0–10, hur troligt är det att du skulle rekommendera oss som arbetsgivare till en vän eller kollega?',
  freeTextEnabled: true,
  predefinedAnswersEnabled: false,
  predefinedAnswers: DEFAULT_ENPS_ANSWERS,
  showPositiveAnswersForPromoters: false,
  showNegativeAnswersForDetractors: false,
  followUpEnabled: false,
};

export function getDefaultConfig(type) {
  if (type === 'physical') return { ...DEFAULT_PHYSICAL_CONFIG };
  if (type === 'online')   return { ...DEFAULT_ONLINE_CONFIG };
  if (type === 'enps')     return { ...DEFAULT_ENPS_CONFIG };
  return { ...DEFAULT_OTHER_CONFIG };
}


// ────────────────────────────────────────────
// Effective config (chain default + touchpoint override)
// ────────────────────────────────────────────

/**
 * Returnerar effektiv config för en mätpunkt:
 * defaults (per typ) ← kedjans config för typen ← touchpointens configOverride
 *
 * Säkerställer att alla config-fält (t.ex. followUpEnabled, npsQuestion)
 * alltid är definierade i resultatet, även om kedjan/mätpunkten inte
 * explicit har satt dem.
 */
export function getEffectiveConfig(chain, touchpointId) {
  const tp = (chain?.touchpoints || []).find((t) => t.id === touchpointId);
  if (!tp) {
    // Ingen touchpoint hittad — returnera kedjans physicalConfig som fallback
    return { ...DEFAULT_PHYSICAL_CONFIG, ...(chain?.physicalConfig || {}) };
  }
  const type = tp.type || 'physical';
  const chainConfig =
      type === 'physical' ? { ...DEFAULT_PHYSICAL_CONFIG, ...(chain?.physicalConfig || {}) }
    : type === 'online'   ? { ...DEFAULT_ONLINE_CONFIG,   ...(chain?.onlineConfig   || {}) }
    : type === 'enps'     ? { ...DEFAULT_ENPS_CONFIG,     ...(chain?.enpsConfig     || {}) }
    :                       { ...DEFAULT_OTHER_CONFIG,    ...(chain?.otherConfig    || {}) };
  return { ...chainConfig, ...(tp.configOverride || {}) };
}


// ────────────────────────────────────────────
// UI-state — aktiv kedja (per webbläsare)
// ────────────────────────────────────────────

export function getActiveChainId() {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveChainId(id) {
  if (id == null) localStorage.removeItem(ACTIVE_KEY);
  else            localStorage.setItem(ACTIVE_KEY, id);
}


// ────────────────────────────────────────────
// UI-state — aktiv mätpunkt per kedja (per webbläsare)
// ────────────────────────────────────────────
//
// Lagras som en separat map (chain_id → tp_id) snarare än på chain-objektet,
// så att det fungerar för kedjor som bara finns i Supabase. assembleChain
// i storageAdapter läser den här mappen och fyller i activeTouchpointId
// på chain-objektet vid laddning.

function getActiveTpMap() {
  try { return JSON.parse(localStorage.getItem(ACTIVE_TP_MAP_KEY) || '{}'); }
  catch { return {}; }
}

function saveActiveTpMap(map) {
  localStorage.setItem(ACTIVE_TP_MAP_KEY, JSON.stringify(map));
}

export function getActiveTouchpointId(chainId) {
  return getActiveTpMap()[chainId] ?? null;
}

export function setActiveTouchpoint(chainId, tpId) {
  const map = getActiveTpMap();
  if (tpId == null) delete map[chainId];
  else              map[chainId] = tpId;
  saveActiveTpMap(map);
}


// ────────────────────────────────────────────
// URL-byggare för kiosk-länkar
// ────────────────────────────────────────────

export function getTouchpointUrl(tpId) {
  return `${window.location.origin}${window.location.pathname}?tp=${tpId}`;
}
