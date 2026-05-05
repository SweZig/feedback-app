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
async function saveKioskResponse({
  touchpointId,
  chainId,
  score,
  comment,
  selectedAnswer,
  followUpEmail,
  ageGroup,   // 'barn' | 'ungdom' | 'vuxen' | 'äldre' | null
  gender,     // 'man' | 'kvinna' | 'okänt' | null
  isDuplicate, // boolean
}) {
  const nps_category =
    score <= 6 ? 'detractor' :
    score <= 8 ? 'passive'   : 'promoter';

  const metadata = {};
  if (followUpEmail?.trim()) metadata.followUpEmail = followUpEmail.trim();

  const { data: resp, error: respError } = await supabase
    .from('responses')
    .insert({
      touchpoint_id: touchpointId,
      chain_id:      chainId,
      score,
      nps_category,
      session_id:    generateUUID(),
      responded_at:  new Date().toISOString(),
      metadata,
      age_group:     ageGroup     || null,
      gender:        gender       || null,
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

  // Heartbeat-controller (Sprint A.6) — pingNow() kan anropas vid user-interaction
  // för att garantera att vi får en ping även om setInterval pausats av WebView.
  const heartbeatRef = useRef({ stop: () => {}, pingNow: () => {} });

  // Step-ref så auto-reload-timern kan kolla nuvarande step utan stale closure
  const stepRef = useRef(step);
  useEffect(() => { stepRef.current = step; }, [step]);

  // ── Kamera + ansiktsanalys ──
  const { videoRef, captureAnalysis } = useFaceCamera();

  useEffect(() => {
    fetchKioskData(accessToken)
      .then(data => { setKioskData(data); setLoading(false); })
      .catch(e  => { setError(e.message); setLoading(false); });
  }, [accessToken]);

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
    submit(score, freeTextEnabled ? comment : '', predefinedAnswer, followUpEmail, faceData);
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

    try {
      await saveKioskResponse({
        touchpointId:   kioskData.tp.id,
        chainId:        kioskData.tp.chain_id,
        score:          s,
        comment:        c || '',
        selectedAnswer: pa || null,
        followUpEmail:  email || '',
        ageGroup:       face?.ageGroup   || null,
        gender:         face?.gender     || null,
        isDuplicate:    face?.isDuplicate || false,
      });
      setStep(3);
      // OBS: savingRef nollställs INTE här — vi vill blockera ev. sena dubbel-anrop
      // som ligger i pipen från fördröjda captureAnalysis-promises. Ref nollställs
      // i resetSurvey() när tackvyn räknat ner.
    } catch (e) {
      console.error('[Kiosk] saveResponse fel:', e);
      setError('Kunde inte spara svar: ' + (e?.message || JSON.stringify(e)));
      // Vid fel: släpp guarden så användaren kan försöka igen
      savingRef.current = false;
      setSubmitting(false);
    }
  }

  // ── Score-val: navigera direkt, kör kameraanalys i bakgrunden ──
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

    // Navigera omedelbart — blockerar inte UI
    if (step2HasContent(val)) {
      setStep(2);
      // Vi släpper INTE captureLockRef här — den nollställs i resetSurvey().
      // Steg 2:s submit-paths använder savingRef i submit() för sin egen guard.
      return;
    }

    // Visuell feedback medan kameraanalys + INSERT pågår
    setSubmitting(true);

    // Kameraanalys asynkront i bakgrunden
    captureAnalysis().then(faceResult => {
      setFaceData(faceResult ? {
        ageGroup:    faceResult.ageGroup,
        gender:      faceResult.gender,
        isDuplicate: faceResult.isDuplicate,
      } : null);

      if (!step2HasContent(val)) {
        submit(val, '', '', '', faceResult);
      }
    }).catch(e => {
      console.warn('[Kiosk] Kameraanalys misslyckades:', e.message);
      if (!step2HasContent(val)) {
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
            submit(score, freeTextEnabled ? comment : '', predefinedAnswer, followUpEmail, faceData);
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
                        submit(score, '', chosen);
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
    </>
  );
}
