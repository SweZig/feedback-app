// src/components/KioskPage.js
//
// Kiosk-läge — visas när appen öppnas med ?tp=<access_token>
// Kräver INGEN inloggning. Identifierar touchpoint via access_token.
// Används av Fully Kiosk Browser på Android-surfplattor i butik.
//
// Flöde:
//   Steg 1 — NPS-fråga + betygsskala
//   Steg 2 — Fördefinierade svar och/eller fritext (om aktiverat)
//   Steg 3 — Tack-vy med nedräkning
//
// Kamera:
//   Ansiktsanalys körs lokalt via face-api.js vid score-val.
//   Råbild sparas aldrig — demografidata (age_group, gender) sparas anonymt.
//   Deduplikering: samma person blockeras i 5 min (in-memory, ej persisterat).
//
// Sprint A.7 — två sammansatta fixar:
//   1. Dedup-guard mot dubbla INSERTs. Synkrona useRef-flaggor (savingRef,
//      captureLockRef) blockerar parallella saveKioskResponse-anrop som
//      tidigare gav 2-7 identiska rader på samma sekund vid otåliga taps
//      eller seg Supabase-respons. Ref-läsning är synkron — useState skulle
//      inte hinna re-rendera mellan två taps med 200ms mellanrum.
//   2. Inaktivitetstimer i steg 2. 60-sekunders nedräkning som auto-submittar
//      med det som ligger ifyllt. Återställs vid varje keystroke / val av
//      följdfråga så att en kund som skriver lång text inte avbryts. Detta
//      hindrar plattan från att fastna i steg 2 om kunden går iväg.

import { useState, useEffect, useRef } from 'react';
import ScoreSelector from './ScoreSelector';
import { supabase } from '../utils/supabaseClient';
import { getDefaultConfig } from '../utils/settings';
import { startHeartbeat } from '../utils/kioskHeartbeat';
import { useFaceCamera } from '../hooks/useFaceCamera';
import { enqueue, flushQueue, isNetworkError, getQueueSize } from '../utils/offlineQueue';
import './KioskPage.css';

const MEGAFON_LOGO = process.env.PUBLIC_URL + '/Megafon_bla_512px.png';
const FA_LOGO      = process.env.PUBLIC_URL + '/FA_Original_transparent-01.svg';

const FOLLOW_UP_THRESHOLD = 2;
const TYPE_SHORT = { physical: 'F', online: 'O', enps: 'eNPS', other: 'Ö' };

// ── Auto-reload-konstanter (Sprint A.6) ──
// Reload appen var 4:e timme för att hämta senaste bundle. Fungerar som
// snabbare versions-rollout än Fully's egen reload-watchdog. Jitter sprider
// lasten så inte alla plattor reloadar exakt samtidigt mot Vercel/Supabase.
const AUTO_RELOAD_BASE_MS    = 4 * 60 * 60 * 1000; // 4 timmar
const AUTO_RELOAD_JITTER_MS  = 10 * 60 * 1000;     // ±10 minuter slump
const AUTO_RELOAD_RETRY_MS   = 60 * 1000;          // försök igen efter 1 min om mitt-i-svar

// ── Step 2 inaktivitetstimer (Sprint A.7) ──
// Hur länge plattan får stå i steg 2 utan användaraktivitet innan svaret
// skickas automatiskt och plattan återgår till startläget. Återställs vid
// keystroke i textarea/email-fält och vid val av följdfråga.
const STEP2_AUTO_SUBMIT_SECONDS = 60;

// ── Hämta touchpoint + kedja-config från Supabase via access_token ──
async function fetchKioskData(accessToken) {
  const { data: tp, error: tpError } = await supabase
    .from('touchpoints')
    .select('*')
    .eq('access_token', accessToken)
    .is('deleted_at', null)
    .single();

  if (tpError || !tp) throw new Error('Touchpoint hittades inte');

  const { data: chain, error: chainError } = await supabase
    .from('chains')
    .select('*')
    .eq('id', tp.chain_id)
    .is('deleted_at', null)
    .single();

  if (chainError || !chain) throw new Error('Kedja hittades inte');

  let dept = null;
  if (tp.department_id) {
    const { data: d } = await supabase
      .from('departments')
      .select('*')
      .eq('id', tp.department_id)
      .single();
    dept = d || null;
  }

  return { tp, chain, dept };
}

// ── Bygg effektiv config (kedja → configOverride) ──
function resolveKioskConfig(chain, tp) {
  const type = tp.type || 'physical';
  const configKey =
    type === 'physical' ? 'physicalConfig' :
    type === 'online'   ? 'onlineConfig'   :
    type === 'enps'     ? 'enpsConfig'     : 'otherConfig';

  const chainConfig = chain.config?.[configKey] || getDefaultConfig(type);
  return { ...chainConfig, ...(tp.config_override || {}) };
}

// ── Spara svar anonymt ──
// Sprint A.9: tar nu id och respondedAt som inparametrar så att samma
// payload kan retryas idempotent via offline-kön utan att tidsstämpeln
// vandrar. A.7:s unique-index på (touchpoint_id, score, sekund-truncerad
// responded_at) blockerar dubblettinserts på databasnivå.
async function saveKioskResponse({
  id,
  touchpointId,
  chainId,
  score,
  comment,
  selectedAnswer,
  followUpEmail,
  ageGroup,    // 'barn' | 'ungdom' | 'vuxen' | 'äldre' | null
  gender,      // 'man' | 'kvinna' | 'okänt' | null
  rawAge,      // Sprint A.12: avrundad åldersskattning, number | null
  confidence,  // Sprint A.12: detektionens score 0-1, number | null
  isDuplicate, // boolean
  respondedAt, // ISO-string
}) {
  const responseId = id          || generateUUID();
  const responded  = respondedAt || new Date().toISOString();

  const nps_category =
    score <= 6 ? 'detractor' :
    score <= 8 ? 'passive'   : 'promoter';

  const metadata = {};
  if (followUpEmail?.trim()) metadata.followUpEmail = followUpEmail.trim();

  const { data: resp, error: respError } = await supabase
    .from('responses')
    .insert({
      id:            responseId,
      touchpoint_id: touchpointId,
      chain_id:      chainId,
      score,
      nps_category,
      session_id:    generateUUID(),
      responded_at:  responded,
      metadata,
      age_group:     ageGroup     || null,
      gender:        gender       || null,
      // Sprint A.12: bucketningen görs numera i rapportlagret, så den råa
      // åldersskattningen och konfidensen måste sparas. age_group ligger kvar
      // för bakåtkompatibilitet med historiken.
      raw_age:         Number.isFinite(rawAge)     ? Math.round(rawAge) : null,
      face_confidence: Number.isFinite(confidence) ? confidence         : null,
      is_duplicate:  isDuplicate  || false,
    })
    .select()
    .single();

  if (respError) throw respError;

  if (comment?.trim()) {
    await supabase.from('response_comments').insert({
      response_id: resp.id,
      comment:     comment.trim(),
    });
  }

  if (selectedAnswer?.trim()) {
    try {
      await supabase.from('response_answers').insert({
        response_id: resp.id,
        answer_text: selectedAnswer.trim(),
      });
    } catch (e) {
      console.error('[KioskPage] response_answers insert:', e);
    }
  }

  return resp;
}

// UUID-fallback för äldre Android/WebView som saknar crypto.randomUUID()
function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : ((r & 0x3) | 0x8)).toString(16);
  });
}

function TpBadge({ tp, dept }) {
  return (
    <div className="kiosk-badge">
      {tp.type && (
        <span className={`kiosk-badge-type kiosk-badge-type--${tp.type}`}>
          {TYPE_SHORT[tp.type] || tp.type}
        </span>
      )}
      {dept && <span className="kiosk-badge-dept">{dept.name}</span>}
      {dept && tp.name !== dept.name && (
        <>
          <span className="kiosk-badge-sep">›</span>
          <span className="kiosk-badge-tp">{tp.name}</span>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════
export default function KioskPage({ accessToken }) {
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [kioskData, setKioskData] = useState(null);

  const [step, setStep]                         = useState(1);
  const [score, setScore]                       = useState(null);
  const [comment, setComment]                   = useState('');
  const [predefinedAnswer, setPredefinedAnswer] = useState('');
  const [followUpEmail, setFollowUpEmail]       = useState('');
  const [countdown, setCountdown]               = useState(6);
  const [faceData, setFaceData]                 = useState(null);
  const [submitting, setSubmitting]             = useState(false);
  const [step2Countdown, setStep2Countdown]     = useState(STEP2_AUTO_SUBMIT_SECONDS);
  const timerRef       = useRef(null);
  const step2TimerRef  = useRef(null);

  // ── Diagnostik (TILLFÄLLIGT — ta bort efter felsökning) ───────────────
  // Aktiveras genom att lägga till &debug=1 i kiosk-URL:en. Visar en liten
  // dämpad logg-overlay längst ner på skärmen där kameraanalysens resultat
  // skrivs ut. Bara aktiv på den specifika plattan som har debug=1 i URL.
  const debugMode = typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('debug') === '1';
  const [debugLog, setDebugLog] = useState([]);
  function dbg(msg) {
    if (!debugMode) return;
    const ts = new Date().toLocaleTimeString('sv-SE');
    setDebugLog(prev => [...prev.slice(-9), `${ts} ${msg}`]);
    // Ekot till console gör att om vi får igång DevTools senare ser vi historiken
    console.log('[dbg]', msg);
  }

  // ── Dedup-guards (Sprint A.7) ────────────────────────────────────────────
  // savingRef:      blockerar dubbla saveKioskResponse()-anrop. Sätts inuti
  //                 submit() innan await, nollställs vid fel eller via
  //                 resetSurvey() när tackvyn räknat ner till steg 1.
  // captureLockRef: blockerar handleScoreSelect från att fyra fler captureAnalysis()
  //                 medan första är i flight. Sätts vid första tap, nollställs i
  //                 resetSurvey() (eller vid steg 2-flödet, se nedan).
  //
  // Båda är useRef (inte useState) eftersom setState är asynkront — mellan två
  // taps med 200ms mellanrum hinner React inte re-rendera, så en state-baserad
  // guard skulle släppa igenom dubbletter. Ref-läsning är synkron och garanterar
  // att tap nr 2 ser flaggan satt av tap nr 1.
  const savingRef = useRef(false);
  const captureLockRef = useRef(false);

  // Sprint A.8.1 (face-fix-v2): faceData speglas i en ref så att alla submit-
  // anrop kan läsa det senaste resultatet SYNKRONT, även om kunden klickar
  // ett fördefinierat svar innan React hunnit committa state-uppdateringen.
  // Bakgrund: faceData som state uppdateras av captureAnalysis().then() några
  // hundra ms efter score-tappet. Om kunden i steg 2 klickar ett snabbt svar
  // inom det fönstret läser submit() från en state som ännu inte är satt.
  // Ref-läsning är synkron och garanterar att vi alltid ser senaste värdet.
  const faceDataRef = useRef(null);

  // Heartbeat-controller (Sprint A.6) — pingNow() kan anropas vid user-interaction
  // för att garantera att vi får en ping även om setInterval pausats av WebView.
  const heartbeatRef = useRef({ stop: () => {}, pingNow: () => {} });

  // Step-ref så auto-reload-timern kan kolla nuvarande step utan stale closure
  const stepRef = useRef(step);
  useEffect(() => { stepRef.current = step; }, [step]);

  // ── Kamera + ansiktsanalys ──
  const { videoRef, captureAnalysis } = useFaceCamera();

  // Diagnostik (tillfälligt): logga video-element-state efter mount och var 5:e sek
  useEffect(() => {
    if (!debugMode) return;
    const checkVideo = () => {
      const v = videoRef?.current;
      if (!v) {
        dbg('VIDEO: ref saknar element');
        return;
      }
      dbg(`VIDEO: rs=${v.readyState} w=${v.videoWidth} h=${v.videoHeight} src=${!!v.srcObject} paused=${v.paused}`);
    };
    setTimeout(checkVideo, 1000);
    setTimeout(checkVideo, 3000);
    const id = setInterval(checkVideo, 10000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debugMode]);

  // Diagnostik (tillfälligt): logga MediaDevices-permission och kamera-tillgång
  useEffect(() => {
    if (!debugMode) return;
    if (!navigator.mediaDevices) { dbg('CAM: navigator.mediaDevices saknas'); return; }
    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: 'camera' })
        .then(r => dbg('CAM: permission=' + r.state))
        .catch(e => dbg('CAM: perm-query fel: ' + e.message));
    } else {
      dbg('CAM: navigator.permissions saknas');
    }
    navigator.mediaDevices.getUserMedia({ video: true })
      .then(s => {
        const t = s.getVideoTracks()[0];
        dbg('CAM: getUserMedia OK label="' + (t?.label || '?') + '"');
        s.getTracks().forEach(x => x.stop());
      })
      .catch(e => dbg('CAM: getUserMedia FAIL ' + e.name + ' - ' + e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debugMode]);

  useEffect(() => {
    fetchKioskData(accessToken)
      .then(data => { setKioskData(data); setLoading(false); })
      .catch(e  => { setError(e.message); setLoading(false); });
  }, [accessToken]);

  // Sprint A.9 — Offline-kö flush ───────────────────────────────────────
  // Vid mount och var 60:e sekund: försök tömma offline-kön. Concurrency-
  // guarden i flushQueue hindrar att en pågående flush överlappar med en
  // post-submit-flush. Tyst i UI:n — vid eventuella items skickas de bara.
  useEffect(() => {
    if (!kioskData) return;

    // Försök direkt vid mount så ev. items från tidigare session går först
    flushQueue(saveKioskResponse)
      .then(r => {
        if (r.sent > 0 || r.dropped > 0) {
          dbg(`QUEUE: mount-flush sent=${r.sent} dropped=${r.dropped} kvar=${r.queued}`);
        }
      })
      .catch(() => {});

    const intervalMs = 60 * 1000;
    const id = setInterval(() => {
      flushQueue(saveKioskResponse)
        .then(r => {
          if (r.sent > 0) {
            dbg(`QUEUE: periodisk flush sent=${r.sent} kvar=${r.queued}`);
          }
        })
        .catch(() => {});
    }, intervalMs);

    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kioskData]);

  // Diagnostik (tillfälligt): visa kö-storlek i debug-overlayn så ?debug=1
  // räcker för att verifiera att kön används vid nätverksavbrott.
  useEffect(() => {
    if (!debugMode) return;
    const tick = () => {
      const n = getQueueSize();
      if (n > 0) dbg(`QUEUE: ${n} item${n === 1 ? '' : 's'} väntar`);
    };
    tick();
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debugMode]);

  // Heartbeat (Sprint A.5+A.6) — pingar Supabase var 15:e minut 08:15-21:00 svensk tid
  // så att admin kan se i Inställningar att kiosken är igång. Kör bara för
  // fysiska mätpunkter — online/eNPS bryr vi oss inte om för driftövervakning.
  useEffect(() => {
    if (!kioskData?.tp?.id) return;
    if (kioskData.tp.type !== 'physical') return;

    const controller = startHeartbeat(kioskData.tp.id);
    heartbeatRef.current = controller;

    return () => {
      controller.stop();
      heartbeatRef.current = { stop: () => {}, pingNow: () => {} };
    };
  }, [kioskData]);

  // Auto-reload (Sprint A.6) — reloadar appen var 4:e timme (±10 min jitter)
  // för att hämta senaste bundle. Kompletterar Fully's egen reload-watchdog
  // som agerar fallback om JS-timern dör. Reload sker BARA på steg 1 så
  // användare som är mitt i ett svar inte avbryts.
  useEffect(() => {
    if (!kioskData?.tp?.id) return;
    if (kioskData.tp.type !== 'physical') return;

    const initialDelay = AUTO_RELOAD_BASE_MS + Math.random() * AUTO_RELOAD_JITTER_MS;
    let timerId = null;

    function tryReload() {
      if (stepRef.current === 1) {
        if (process.env.NODE_ENV !== 'production') {
          console.log('[auto-reload] reloading page');
        }
        window.location.reload();
      } else {
        timerId = setTimeout(tryReload, AUTO_RELOAD_RETRY_MS);
      }
    }

    timerId = setTimeout(tryReload, initialDelay);

    return () => {
      if (timerId) clearTimeout(timerId);
    };
  }, [kioskData]);

  const config = kioskData
    ? resolveKioskConfig(kioskData.chain, kioskData.tp)
    : getDefaultConfig('physical');

  const {
    npsQuestion              = 'På en skala från 0–10, hur troligt är det att du skulle rekommendera oss till vänner och bekanta?',
    freeTextEnabled          = true,
    predefinedAnswersEnabled = false,
    predefinedAnswers        = [],
    npsColorMode             = 'colored',
    countdownSeconds         = 6,
    followUpEnabled          = false,
    showPositiveAnswersForPromoters   = false,
    showNegativeAnswersForDetractors  = false,
  } = config;

  const normalizedAnswers = (predefinedAnswers || []).map(a =>
    typeof a === 'string' ? { text: a, polarity: null } : a
  );

  function getVisibleAnswers(val) {
    return normalizedAnswers.filter(a => {
      if (a.polarity === 'positive') return showPositiveAnswersForPromoters && val >= 9;
      if (a.polarity === 'negative') return showNegativeAnswersForDetractors && val <= 3;
      const hasAny = normalizedAnswers.some(x => x.polarity !== null);
      if (hasAny) return (showPositiveAnswersForPromoters && val >= 9) || (showNegativeAnswersForDetractors && val <= 3);
      return true;
    });
  }

  const visibleAnswers = score !== null ? getVisibleAnswers(score) : normalizedAnswers;
  const showFollowUp   = followUpEnabled && score !== null && score <= FOLLOW_UP_THRESHOLD;
  const hasSubmitButton = freeTextEnabled || showFollowUp;

  function step2HasContent(val) {
    const answers = getVisibleAnswers(val);
    const willFollowUp = followUpEnabled && val <= FOLLOW_UP_THRESHOLD;
    return freeTextEnabled ||
           (predefinedAnswersEnabled && answers.length > 0) ||
           willFollowUp;
  }

  // Tack-vy nedräkning (steg 3)
  useEffect(() => {
    if (step !== 3) return;
    setCountdown(countdownSeconds);
    timerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          resetSurvey();
          return countdownSeconds;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, countdownSeconds]);

  // Steg 2 inaktivitetstimer (Sprint A.7) ─────────────────────────────────
  // Nedräkning från 60 sekunder. Återställs via bumpStep2Activity() vid
  // keystroke / val av följdfråga. Vid 0 fyrar separat useEffect nedan som
  // auto-submittar med det som finns ifyllt.
  useEffect(() => {
    if (step !== 2) return;
    setStep2Countdown(STEP2_AUTO_SUBMIT_SECONDS);
    step2TimerRef.current = setInterval(() => {
      setStep2Countdown(prev => {
        if (prev <= 1) {
          clearInterval(step2TimerRef.current);
          step2TimerRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (step2TimerRef.current) {
        clearInterval(step2TimerRef.current);
        step2TimerRef.current = null;
      }
    };
  }, [step]);

  // Auto-submit när countdown når 0. Separat useEffect för att få access till
  // FÄRSKA värden av comment/predefinedAnswer/followUpEmail/faceData (effekten
  // re-skapar sin closure varje gång den körs). savingRef-checken förhindrar
  // dubbel-submit om kunden råkar trycka Skicka samma sekund som timern dör.
  useEffect(() => {
    if (step !== 2) return;
    if (step2Countdown !== 0) return;
    if (savingRef.current) return;
    if (process.env.NODE_ENV !== 'production') {
      console.log('[Kiosk] step2 inaktivitet — auto-submit');
    }
    // Sprint A.8.1: läs faceDataRef.current (synkront, alltid färskt)
    // istället för faceData state (kan vara stale i closure).
    submit(score, freeTextEnabled ? comment : '', predefinedAnswer, followUpEmail, faceDataRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step2Countdown, step]);

  // Återställer step2-timern till 60. Anropas från textarea/email/predefined.
  // Sätter inte timern direkt — låter intervallet fortsätta tickta från 60.
  function bumpStep2Activity() {
    if (step !== 2) return;
    if (savingRef.current) return;
    setStep2Countdown(STEP2_AUTO_SUBMIT_SECONDS);
  }

  function resetSurvey() {
    setStep(1);
    setScore(null);
    setComment('');
    setPredefinedAnswer('');
    setFollowUpEmail('');
    setFaceData(null);
    setSubmitting(false);
    setStep2Countdown(STEP2_AUTO_SUBMIT_SECONDS);
    // Sprint A.7: nollställ båda dedup-flaggorna när vi är tillbaka på steg 1
    // och redo för nästa kund. INTE nollställa innan tackvyn räknat ner —
    // annars kan en sen tap eller en setInterval-tick som överlappar nästa
    // session ge en spöksparning.
    savingRef.current = false;
    captureLockRef.current = false;
    // Sprint A.8.1: nollställ också face-ref:en så nästa kund inte ärver
    // föregående kunds demografidata om captureAnalysis skulle failas.
    faceDataRef.current = null;
  }

  async function submit(s, c, pa, email = '', face = null) {
    if (!kioskData) { console.error('[Kiosk] submit: kioskData är null'); return; }

    // Sprint A.7: dedup-guard. Blockerar parallella submit()-anrop som annars
    // skulle resultera i flera identiska INSERTs på samma sekund.
    if (savingRef.current) {
      console.log('[Kiosk] submit blockerad — sparning redan i gång');
      return;
    }
    savingRef.current = true;
    setSubmitting(true);

    // Stoppa step 2-timern direkt så den inte triggar en andra auto-submit
    // mellan att savingRef sätts och att den blir kontrollerad i useEffect.
    if (step2TimerRef.current) {
      clearInterval(step2TimerRef.current);
      step2TimerRef.current = null;
    }

    // Sprint A.9: bygg payload med id och respondedAt HÄR (en gång) så att
    // exakt samma payload kan användas både för direkt-INSERT och, vid
    // nätverksfel, läggas på offline-kön och spelas upp senare utan att
    // tidsstämpeln vandrar. A.7:s unique-index skyddar mot dubblettinserts
    // om en flush råkar spela upp samma item igen.
    const payload = {
      id:             generateUUID(),
      touchpointId:   kioskData.tp.id,
      chainId:        kioskData.tp.chain_id,
      score:          s,
      comment:        c || '',
      selectedAnswer: pa || null,
      followUpEmail:  email || '',
      ageGroup:       face?.ageGroup || null,
      gender:         face?.gender || null,
      rawAge:         face?.rawAge ?? null,
      confidence:     face?.confidence ?? null,
      isDuplicate:    face?.isDuplicate || false,
      respondedAt:    new Date().toISOString(),
    };

    try {
      await saveKioskResponse(payload);
      setStep(3);
      // OBS: savingRef nollställs INTE här — vi vill blockera ev. sena dubbel-anrop
      // som ligger i pipen från fördröjda captureAnalysis-promises. Ref nollställs
      // i resetSurvey() när tackvyn räknat ner.

      // Sprint A.9: passa på att tömma ev. äldre köade items när vi just
      // bekräftat att nätverket är uppe. Bakgrundsanrop — vi väntar inte in.
      flushQueue(saveKioskResponse).catch(() => {});
    } catch (e) {
      if (isNetworkError(e)) {
        // Sprint A.9: nätverksfel — lägg på offline-kön och fortsätt UX som
        // vanligt. Slutkunden ser exakt samma tackvy. Kön töms automatiskt
        // av periodisk flush eller nästa lyckade submit.
        enqueue(payload);
        console.log('[Kiosk] köade svar pga nätverksfel:', e?.message);
        setStep(3);
      } else {
        // Riktigt fel (validering, RLS, schema) — visa fel-UI
        console.error('[Kiosk] saveResponse fel:', e);
        setError('Kunde inte spara svar: ' + (e?.message || JSON.stringify(e)));
        // Vid fel: släpp guarden så användaren kan försöka igen
        savingRef.current = false;
        setSubmitting(false);
      }
    }
  }

  // ── Score-val: navigera direkt, kör kameraanalys i bakgrunden ──
  //
  // Sprint A.8 (face-fix): captureAnalysis() körs NU oavsett om svaret går
  // vidare till steg 2 eller direkt till steg 3. Tidigare anropades funktionen
  // bara i direkt-till-steg-3-grenen, så alla svar som passerade steg 2 fick
  // age_group=NULL, gender=NULL och is_duplicate=false. Det förklarade varför
  // bara ~24% av svaren hade demografidata och varför face-api-dedupen så
  // sällan triggade. För steg 2-flödet kör analysen i bakgrunden och resultatet
  // landar i faceData-state innan kunden hinner submitta (typiskt 200-500 ms
  // jämfört med flera sekunder i steg 2).
  function handleScoreSelect(val) {
    // Sprint A.7: blockera dubbla taps. captureLockRef sätts synkront här,
    // så tap nr 2 (även 50ms efter tap nr 1) ser flaggan och avslutas tidigt.
    if (captureLockRef.current || savingRef.current) {
      console.log('[Kiosk] handleScoreSelect blockerad — bearbetning pågår');
      return;
    }
    captureLockRef.current = true;

    setScore(val);

    // Sprint A.6: trigga heartbeat vid user-interaction. Throttlas internt.
    heartbeatRef.current.pingNow();

    const goesToStep2 = step2HasContent(val);

    // Diagnostik (tillfälligt): timestamp på när vi anropar captureAnalysis
    dbg(`FACE: kallar captureAnalysis() (goesToStep2=${goesToStep2})`);
    const t0 = Date.now();

    // Visuell feedback bara när vi blockerar UI:n (direkt-submit-grenen).
    // I steg 2-grenen får kunden själv styra tempot.
    if (!goesToStep2) setSubmitting(true);

    // Navigera omedelbart till steg 2 om relevant — analysen rullar parallellt.
    if (goesToStep2) setStep(2);

    captureAnalysis().then(faceResult => {
      const dt = Date.now() - t0;
      // Diagnostik (tillfälligt): vad fick vi tillbaka?
      if (faceResult) {
        dbg(`FACE: OK i ${dt}ms age=${faceResult.ageGroup} gender=${faceResult.gender} dup=${faceResult.isDuplicate}`);
      } else {
        dbg(`FACE: NULL i ${dt}ms (inget ansikte / model fail)`);
      }
      const data = faceResult ? {
        ageGroup:    faceResult.ageGroup,
        gender:      faceResult.gender,
        rawAge:      faceResult.rawAge,
        confidence:  faceResult.confidence,
        isDuplicate: faceResult.isDuplicate,
      } : null;
      // Sprint A.8.1: spara i BÅDE ref och state. Ref-en läses synkront av
      // submit-anropen i steg 2. State-en finns för framtida UI-bruk.
      faceDataRef.current = data;
      setFaceData(data);

      // Bara direkt-submit-grenen submittar härifrån. Steg 2-grenen läser
      // faceData från state när kunden trycker Skicka (eller när inaktivitets-
      // timern auto-submittar).
      if (!goesToStep2) {
        submit(val, '', '', '', faceResult);
      }
    }).catch(e => {
      const dt = Date.now() - t0;
      // Diagnostik (tillfälligt): vilket fel kastade captureAnalysis?
      dbg(`FACE: THROW i ${dt}ms ${e?.name || ''} - ${e?.message || e}`);
      console.warn('[Kiosk] Kameraanalys misslyckades:', e?.message || e);
      faceDataRef.current = null;
      if (!goesToStep2) {
        submit(val, '', '', '', null);
      }
    });
  }


  // ── Laddning ──
  if (loading) {
    return (
      <div className="kiosk-centered" style={{ background: '#fff' }}>
        <span style={{ color: '#1e3a4f', fontSize: '1.2rem' }}>Laddar enkät...</span>
      </div>
    );
  }

  // ── Fel ──
  if (error) {
    return (
      <div className="kiosk-centered" style={{ background: '#fff', flexDirection: 'column' }}>
        <p style={{ color: '#e74c3c' }}>Kunde inte ladda enkäten.</p>
        <p style={{ color: '#7a9aaa', fontSize: '0.85rem' }}>{error}</p>
      </div>
    );
  }

  const { tp, dept } = kioskData;
  const logo = kioskData.chain.custom_logo || FA_LOGO;

  // Dolt videoelement — alltid mountat för att hålla kameraströmmen aktiv
  const cameraVideo = (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '1px',
        height: '1px',
        opacity: 0,
        pointerEvents: 'none',
      }}
      aria-hidden="true"
    />
  );

  // Diagnostik-overlay (tillfälligt). Visas bara om ?debug=1 finns i URL.
  // Lägg den i en separat React-fragment så den ritas över allt annat.
  const debugOverlay = debugMode ? (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      maxHeight: '40vh',
      overflowY: 'auto',
      background: 'rgba(0, 0, 0, 0.85)',
      color: '#9fe',
      fontFamily: 'monospace',
      fontSize: '11px',
      padding: '6px 8px',
      lineHeight: 1.3,
      zIndex: 99999,
      pointerEvents: 'none',
      whiteSpace: 'pre-wrap',
    }}>
      {debugLog.length === 0 ? '(diag tom — väntar på events)' : debugLog.join('\n')}
    </div>
  ) : null;

  // ════════════════════════════════════════════════════════
  // STEG 3 — Tack-vy
  // ════════════════════════════════════════════════════════
  if (step === 3) {
    return (
      <>
        {cameraVideo}
        <div className="kiosk-thanks">
          <img src={MEGAFON_LOGO} alt="Feedback App" className="kiosk-thanks-megafon" />
          <h2 className="kiosk-thanks-title">Tack för din feedback!</h2>
          <p className="kiosk-thanks-sub">Ditt svar har sparats.</p>
          <div className="kiosk-thanks-countdown">{countdown}</div>
        </div>
        {debugOverlay}
      </>
    );
  }

  // ════════════════════════════════════════════════════════
  // STEG 2 — Fördefinierade svar / fritext / uppföljning
  // ════════════════════════════════════════════════════════
  if (step === 2) {
    return (
      <>
        {cameraVideo}
        <div className="kiosk-wrap">
          <div className="kiosk-logo-header">
            <img src={logo} alt="Logo"
              onError={e => { e.target.src = FA_LOGO; }} />
          </div>

          <form className="kiosk-form" onSubmit={e => {
            e.preventDefault();
            if (submitting) return; // Sprint A.7: redundant skydd ovanpå submit-guarden
            // Sprint A.8.1: läs faceDataRef.current (synkront) istället för faceData state.
            submit(score, freeTextEnabled ? comment : '', predefinedAnswer, followUpEmail, faceDataRef.current);
          }}>
            <p className="kiosk-step2-label">Vad beskriver bäst din upplevelse?</p>

            {predefinedAnswersEnabled && visibleAnswers.length > 0 && (
              <div className="kiosk-predefined-buttons">
                {visibleAnswers.map(answer => (
                  <button
                    key={answer.text}
                    type="button"
                    disabled={submitting}
                    className={`kiosk-predefined-btn ${predefinedAnswer === answer.text ? 'kiosk-predefined-btn--selected' : ''}`}
                    onClick={() => {
                      if (submitting) return;     // Sprint A.7
                      bumpStep2Activity();        // Sprint A.7: kunden interagerar — ge mer tid
                      const chosen = predefinedAnswer === answer.text ? '' : answer.text;
                      setPredefinedAnswer(chosen);
                      if (!freeTextEnabled && !showFollowUp && chosen !== '') {
                        // Sprint A.8.1 (face-fix-v2): skicka MED faceDataRef.current.
                        // Tidigare anropades submit() med bara 3 argument vilket gjorde
                        // att face=null default-värdet användes — och DET var den faktiska
                        // orsaken till att face-rate stannade på ~20% efter v1-fixen.
                        // Webhallens config (polaritetsfiltrerade fördef. svar, ingen
                        // fritext, ingen follow-up för 4-10) går nästan uteslutande genom
                        // den här grenen.
                        submit(score, '', chosen, '', faceDataRef.current);
                      }
                    }}
                  >
                    {answer.text}
                  </button>
                ))}
              </div>
            )}

            {freeTextEnabled && (
              <label className="kiosk-label">
                Kommentar (valfritt)
                <textarea
                  className="kiosk-textarea"
                  value={comment}
                  onChange={e => {
                    setComment(e.target.value);
                    bumpStep2Activity(); // Sprint A.7: skriver — ge mer tid
                  }}
                  placeholder="Berätta gärna mer..."
                  rows={4}
                  disabled={submitting}
                />
              </label>
            )}

            {showFollowUp && (
              <div className="kiosk-followup">
                <div className="kiosk-followup-icon">✉</div>
                <p className="kiosk-followup-text">
                  Väldigt tråkigt att höra – vill du att vi kontaktar dig och följer upp ärendet?
                </p>
                <input
                  type="email"
                  className="kiosk-followup-input"
                  placeholder="Din e-postadress (valfritt)"
                  value={followUpEmail}
                  onChange={e => {
                    setFollowUpEmail(e.target.value);
                    bumpStep2Activity(); // Sprint A.7: skriver — ge mer tid
                  }}
                  disabled={submitting}
                />
              </div>
            )}

            {hasSubmitButton && (
              <button
                className="kiosk-submit-btn"
                type="submit"
                disabled={submitting}
              >
                {submitting ? 'Sparar...' : (
                  <>
                    Skicka
                    {step2Countdown > 0 && (
                      <span style={{
                        opacity: 0.55,
                        fontSize: '0.85em',
                        fontWeight: 'normal',
                        marginLeft: '0.6em',
                      }}>
                        {step2Countdown}s
                      </span>
                    )}
                  </>
                )}
              </button>
            )}

            {/* Sprint A.7: liten countdown-text för det fall då ingen Skicka-
                knapp visas (t.ex. enbart fördefinierade svar utan fritext). */}
            {!hasSubmitButton && !submitting && step2Countdown > 0 && (
              <p style={{
                textAlign: 'center',
                color: '#7a9aaa',
                fontSize: '0.85rem',
                marginTop: '0.75rem',
                opacity: 0.65,
              }}>
                Skickas automatiskt om {step2Countdown}s
              </p>
            )}

            <div className="kiosk-meta-row">
              <TpBadge tp={tp} dept={dept} />
              <img src={FA_LOGO} alt="Feedback App" className="kiosk-fa-logo" />
            </div>
          </form>
        </div>
        {debugOverlay}
      </>
    );
  }

  // ════════════════════════════════════════════════════════
  // STEG 1 — NPS-fråga + betygsskala
  // ════════════════════════════════════════════════════════
  return (
    <>
      {cameraVideo}
      <div className="kiosk-wrap">
        <div className="kiosk-logo-header">
          <img src={logo} alt="Logo"
            onError={e => { e.target.src = FA_LOGO; }} />
        </div>
        <div className="kiosk-form">
          <h2>{npsQuestion}</h2>
          {/* Sprint A.7: när submitting=true (tap registrerat, kameraanalys + INSERT pågår)
              tonas score-väljaren ner och pointer-events stängs av så otåliga kunder
              inte kan trigga fler taps. Detta är visuell feedback ovanpå den synkrona
              captureLockRef-guarden som garanterar korrekthet även om disable inte
              hinner renderas i tid. */}
          <div
            style={{
              opacity: submitting ? 0.5 : 1,
              pointerEvents: submitting ? 'none' : 'auto',
              transition: 'opacity 150ms ease-out',
            }}
          >
            <ScoreSelector
              value={score}
              onChange={handleScoreSelect}
              colorMode={npsColorMode}
            />
          </div>
          {submitting && (
            <p style={{
              textAlign: 'center',
              color: '#7a9aaa',
              marginTop: '1rem',
              fontSize: '0.95rem',
            }}>
              Sparar ditt svar...
            </p>
          )}
          <div className="kiosk-meta-row">
            <TpBadge tp={tp} dept={dept} />
            <img src={FA_LOGO} alt="Feedback App" className="kiosk-fa-logo" />
          </div>
        </div>
      </div>
      {debugOverlay}
    </>
  );
}
