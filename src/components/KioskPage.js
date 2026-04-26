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
  const timerRef = useRef(null);

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
  //
  // Sprint A.6: startHeartbeat returnerar nu { stop, pingNow }. pingNow lagras i
  // heartbeatRef så handleScoreSelect kan trigga manuell ping vid user-interaction.
  // Detta är nödvändigt eftersom Chrome 81 WebView (SM-T510 Android 10) pausar
  // setInterval när skärmen släcks och inte tillförlitligt återupptar vid wakeup.
  //
  // Tysta katcher — om en ping failar bryts inte enkätflödet.
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
  //
  // Bara fysiska kiosker — online/eNPS-länkar besöks bara kort av en användare
  // och behöver ingen periodisk reload.
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
        // Användaren är mitt i ett svar — vänta tills tack-vyn nollställt till steg 1
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

  function step2HasContent(val) {
    const answers = getVisibleAnswers(val);
    const willFollowUp = followUpEnabled && val <= FOLLOW_UP_THRESHOLD;
    return freeTextEnabled ||
           (predefinedAnswersEnabled && answers.length > 0) ||
           willFollowUp;
  }

  // Tack-vy nedräkning
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

  function resetSurvey() {
    setStep(1);
    setScore(null);
    setComment('');
    setPredefinedAnswer('');
    setFollowUpEmail('');
    setFaceData(null);
  }

  async function submit(s, c, pa, email = '', face = null) {
    if (!kioskData) { console.error('[Kiosk] submit: kioskData är null'); return; }
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
    } catch (e) {
      console.error('[Kiosk] saveResponse fel:', e);
      setError('Kunde inte spara svar: ' + (e?.message || JSON.stringify(e)));
    }
  }

  // ── Score-val: navigera direkt, kör kameraanalys i bakgrunden ──
  function handleScoreSelect(val) {
    setScore(val);

    // Sprint A.6: trigga heartbeat vid user-interaction. Throttlas internt.
    // Detta garanterar att vi ser kiosken som "online" så fort någon faktiskt
    // använder den, även om setInterval pausats av WebView över natten.
    heartbeatRef.current.pingNow();

    // Navigera omedelbart — blockerar inte UI
    if (step2HasContent(val)) {
      setStep(2);
    }

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
            submit(score, freeTextEnabled ? comment : '', predefinedAnswer, followUpEmail, faceData);
          }}>
            <p className="kiosk-step2-label">Vad beskriver bäst din upplevelse?</p>

            {predefinedAnswersEnabled && visibleAnswers.length > 0 && (
              <div className="kiosk-predefined-buttons">
                {visibleAnswers.map(answer => (
                  <button
                    key={answer.text}
                    type="button"
                    className={`kiosk-predefined-btn ${predefinedAnswer === answer.text ? 'kiosk-predefined-btn--selected' : ''}`}
                    onClick={() => {
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
                  onChange={e => setComment(e.target.value)}
                  placeholder="Berätta gärna mer..."
                  rows={4}
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
                  onChange={e => setFollowUpEmail(e.target.value)}
                />
              </div>
            )}

            {(freeTextEnabled || showFollowUp) && (
              <button className="kiosk-submit-btn" type="submit">Skicka</button>
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
          <ScoreSelector
            value={score}
            onChange={handleScoreSelect}
            colorMode={npsColorMode}
          />
          <div className="kiosk-meta-row">
            <TpBadge tp={tp} dept={dept} />
            <img src={FA_LOGO} alt="Feedback App" className="kiosk-fa-logo" />
          </div>
        </div>
      </div>
    </>
  );
}
