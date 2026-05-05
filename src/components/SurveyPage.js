// src/components/SurveyPage.js
//
// Inloggat enkätgränssnitt — visas under "Enkät"-fliken efter login.
// Skiljer sig från KioskPage som körs anonymt via ?tp=<access_token>.
//
// Sprint A.7 — samma två fixar som KioskPage, applicerade här för konsistens:
//   1. Dedup-guard mot dubbla INSERTs. Synkron useRef-flagga (savingRef)
//      blockerar parallella saveResponse-anrop som annars kan uppstå om
//      användaren spam-klickar Skicka eller dubbel-tappar score.
//   2. Inaktivitetstimer. 60-sekunders nedräkning som auto-submittar med
//      det som ligger ifyllt och nollställer formuläret. Återställs vid
//      keystroke / val av följdfråga så att användare som skriver långa
//      kommentarer inte avbryts.

import { useState, useEffect, useRef } from 'react';
import ScoreSelector from './ScoreSelector';
import { saveResponse } from '../utils/storageAdapter';
import { TYPE_LABELS, MODE_LABELS, getEffectiveConfig } from '../utils/settings';
import './SurveyPage.css';

const MEGAFON_LOGO = process.env.PUBLIC_URL + '/Megafon_bla_512px.png';
const FA_LOGO = process.env.PUBLIC_URL + '/FA_Original_transparent-01.svg';

const FOLLOW_UP_THRESHOLD = 2;

// Sprint A.7: hur länge formuläret får stå utan användaraktivitet innan
// svaret skickas automatiskt och formuläret nollställs. Återställs vid
// keystroke i textarea/email-fält och vid val av följdfråga.
const STEP2_AUTO_SUBMIT_SECONDS = 60;

function SurveyPage({ activeCustomer }) {
  const [score, setScore] = useState(null);
  const [comment, setComment] = useState('');
  const [predefinedAnswer, setPredefinedAnswer] = useState('');
  const [followUpEmail, setFollowUpEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [countdown, setCountdown] = useState(6);
  const [submitting, setSubmitting] = useState(false);
  const [step2Countdown, setStep2Countdown] = useState(STEP2_AUTO_SUBMIT_SECONDS);
  const timerRef = useRef(null);
  const step2TimerRef = useRef(null);

  // Sprint A.7: synkron dedup-guard. Sätts till true inuti submit() innan
  // await saveResponse — nästa submit-anrop som hinner före React-render
  // ser flaggan och avslutas tidigt. Nollställs i tackvyns reset-block.
  const savingRef = useRef(false);

  const activeTpId = activeCustomer?.activeTouchpointId || null;
  const activeTp = (activeCustomer?.touchpoints || []).find((t) => t.id === activeTpId) || null;
  const activeDept = activeTp
    ? (activeCustomer?.departments || []).find((d) => d.id === activeTp.departmentId) || null
    : null;

  const config = getEffectiveConfig(activeCustomer, activeTpId);
  const {
    npsQuestion = 'På en skala från 0–10, hur troligt är det att du skulle rekommendera oss till vänner och bekanta?',
    freeTextEnabled = true,
    predefinedAnswersEnabled = false,
    predefinedAnswers = [],
    npsColorMode = 'colored',
    countdownSeconds = 6,
    followUpEnabled = false,
    showPositiveAnswersForPromoters = false,
    showNegativeAnswersForDetractors = false,
  } = config;

  const normalizedAnswers = predefinedAnswers.map((a) =>
    typeof a === 'string' ? { text: a, polarity: null } : a
  );

  // Neutrala svar (polarity: null) visas bara om minst ett polärt svar
  // också är synligt för aktuellt betyg — annars hänger de i luften ensamma.
  const hasAnyPolarityAnswer = normalizedAnswers.some(a => a.polarity !== null);
  const visibleAnswers = (score === null)
    ? normalizedAnswers
    : normalizedAnswers.filter((a) => {
        if (a.polarity === 'positive') return showPositiveAnswersForPromoters && score >= 9;
        if (a.polarity === 'negative') return showNegativeAnswersForDetractors && score <= 3;
        // Neutral: visa alltid om inga polaritetssvar är definierade,
        // annars bara om minst ett polärt svar också är synligt
        if (hasAnyPolarityAnswer) {
          const anyPolarVisible =
            (showPositiveAnswersForPromoters && score >= 9 && normalizedAnswers.some(x => x.polarity === 'positive')) ||
            (showNegativeAnswersForDetractors && score <= 3 && normalizedAnswers.some(x => x.polarity === 'negative'));
          return anyPolarVisible;
        }
        return true;
      });

  const mode = activeTp?.mode || 'app';
  const showFollowUp = followUpEnabled && score !== null && score <= FOLLOW_UP_THRESHOLD;
  // "Skicka"-knappen behövs bara om fritext ELLER uppföljningsfält visas.
  // Bara fördefinierade svar = auto-submit vid klick på svar.
  const needsSubmitButton = freeTextEnabled || showFollowUp;
  const hasPredefinedVisible = predefinedAnswersEnabled && visibleAnswers.length > 0;

  // Tackvy-nedräkning + reset (befintlig logik utökad med dedup-state-reset)
  useEffect(() => {
    if (!submitted) return;
    setCountdown(countdownSeconds);
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          setScore(null);
          setComment('');
          setPredefinedAnswer('');
          setFollowUpEmail('');
          setSubmitted(false);
          // Sprint A.7: nollställ dedup + step2-state inför nästa svar.
          // Avsiktligt FÖRST när tackvyn räknat ner — inte direkt efter INSERT —
          // så sena dubbel-anrop som ligger i pipen inte triggar spöksparningar.
          setSubmitting(false);
          setStep2Countdown(STEP2_AUTO_SUBMIT_SECONDS);
          savingRef.current = false;
          return countdownSeconds;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [submitted, countdownSeconds]);

  // Sprint A.7: inaktivitetstimer. Startar när score är satt och formuläret
  // står ofyllt-väntar-på-användare. Stoppas via cleanup när score nollställs,
  // submitted/submitting blir true, eller komponenten unmountar.
  useEffect(() => {
    if (score === null) return;
    if (submitted) return;
    if (submitting) return;
    if (savingRef.current) return;

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
  }, [score, submitted, submitting]);

  // Auto-submit när countdown når 0. Separat useEffect för att få access till
  // FÄRSKA värden av comment/predefinedAnswer/followUpEmail (effekten re-skapar
  // sin closure varje gång den körs). savingRef-checken förhindrar dubbel-submit
  // om användaren klickar Skicka samma sekund som timern dör.
  useEffect(() => {
    if (step2Countdown !== 0) return;
    if (score === null) return;
    if (submitted) return;
    if (savingRef.current) return;
    if (process.env.NODE_ENV !== 'production') {
      console.log('[Survey] inaktivitet — auto-submit');
    }
    submit(score, freeTextEnabled ? comment : '', predefinedAnswer, followUpEmail);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step2Countdown, score, submitted]);

  // Återställer step2-timern till 60. Anropas från textarea/email/predefined.
  function bumpStep2Activity() {
    if (submitted) return;
    if (savingRef.current) return;
    setStep2Countdown(STEP2_AUTO_SUBMIT_SECONDS);
  }

  async function submit(s, c, pa, email = '') {
    // Sprint A.7: dedup-guard. Blockerar parallella submit-anrop som annars
    // skulle resultera i flera identiska INSERTs på samma sekund.
    if (savingRef.current) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Survey] submit blockerad — sparning redan i gång');
      }
      return;
    }
    savingRef.current = true;
    setSubmitting(true);

    // Stoppa step2-timern direkt så den inte triggar en andra auto-submit
    // mellan att savingRef sätts och att den blir kontrollerad i useEffect.
    if (step2TimerRef.current) {
      clearInterval(step2TimerRef.current);
      step2TimerRef.current = null;
    }

    try {
      await saveResponse({
        id:              crypto.randomUUID(),
        touchpointId:    activeTpId,
        chainId:         activeTp?.chainId || activeCustomer?.id,
        score:           s,
        comment:         c || '',
        selectedAnswers: pa ? [pa] : [],
        followUpEmail:   email,
        sessionId:       crypto.randomUUID(),
        respondedAt:     new Date().toISOString(),
        metadata:        {},
      });
      setSubmitted(true);
      // OBS: savingRef nollställs INTE här — det görs först i tackvyns
      // reset-block efter nedräkningen.
    } catch (e) {
      console.error('[Survey] saveResponse fel:', e);
      // Vid fel: släpp guarden så användaren kan försöka igen
      savingRef.current = false;
      setSubmitting(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (score === null) return;
    if (submitting) return; // Sprint A.7: redundant skydd ovanpå submit-guarden
    submit(score, freeTextEnabled ? comment : '', predefinedAnswer, followUpEmail);
  }

  function TpBadge() {
    if (!activeTp) return null;
    return (
      <div className="survey-dept-badge">
        {activeTp.type && (
          <span className={`survey-dept-type survey-dept-type--${activeTp.type}`}>
            {TYPE_LABELS[activeTp.type]}
          </span>
        )}
        {activeDept && <span className="survey-dept-name">{activeDept.name}</span>}
        {activeDept && activeTp.name !== activeDept.name && (
          <><span className="survey-dept-sep">›</span><span className="survey-tp-name">{activeTp.name}</span></>
        )}
      </div>
    );
  }

  if (activeTp && mode !== 'app') {
    return (
      <div className="survey-form survey-link-mode">
        <TpBadge />
        <p className="survey-link-msg">Denna mätpunkt besvaras via {MODE_LABELS[mode] || mode}.</p>
        <p className="survey-link-sub">Gå till Inställningar → Avdelningar för att hämta länken.</p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="survey-thanks">
        <img src={MEGAFON_LOGO} alt="Feedback App" className="survey-megafon-logo" />
        <h2>Tack för din feedback!</h2>
        <p>Ditt svar har sparats.</p>
        <div className="survey-countdown">{countdown}</div>
      </div>
    );
  }

  return (
    <form className="survey-form" onSubmit={handleSubmit}>
      <h2>{npsQuestion}</h2>

      {/* Sprint A.7: när submitting=true tonas score-väljaren ner och pointer-events
          stängs av så otåliga klick inte triggar fler submits. Visuell feedback
          ovanpå den synkrona savingRef-guarden. */}
      <div
        style={{
          opacity: submitting ? 0.5 : 1,
          pointerEvents: submitting ? 'none' : 'auto',
          transition: 'opacity 150ms ease-out',
        }}
      >
        <ScoreSelector
          value={score}
          onChange={(val) => {
            // Sprint A.7: blockera nya score-val medan submit pågår
            if (savingRef.current) return;
            setScore(val);
            if (val > FOLLOW_UP_THRESHOLD) setFollowUpEmail('');
            const willShowFollowUp = followUpEnabled && val <= FOLLOW_UP_THRESHOLD;
            const willVisibleAnswers = normalizedAnswers.filter((a) => {
              if (a.polarity === 'positive') return showPositiveAnswersForPromoters && val >= 9;
              if (a.polarity === 'negative') return showNegativeAnswersForDetractors && val <= 3;
              if (hasAnyPolarityAnswer) {
                const anyPolarVisible =
                  (showPositiveAnswersForPromoters && val >= 9 && normalizedAnswers.some(x => x.polarity === 'positive')) ||
                  (showNegativeAnswersForDetractors && val <= 3 && normalizedAnswers.some(x => x.polarity === 'negative'));
                return anyPolarVisible;
              }
              return true;
            });
            const willHaveFollowUp = freeTextEnabled || (predefinedAnswersEnabled && willVisibleAnswers.length > 0) || willShowFollowUp;
            if (!willHaveFollowUp) {
              submit(val, '', '');
            }
          }}
          colorMode={npsColorMode}
        />
      </div>

      {/* Sprint A.7: "Sparar..."-text under ScoreSelector när submit körs och
          ingen Skicka-knapp finns att visa "Sparar..."-text i. */}
      {submitting && !needsSubmitButton && (
        <p style={{
          textAlign: 'center',
          color: '#7a9aaa',
          marginTop: '1rem',
          fontSize: '0.95rem',
        }}>
          Sparar ditt svar...
        </p>
      )}

      <div className="survey-meta-row">
        <TpBadge />
        {activeTp && <img src={FA_LOGO} alt="Feedback App" className="survey-fa-logo" />}
      </div>

      {score !== null && hasPredefinedVisible && (
        <div className="survey-predefined">
          <p className="survey-predefined-label">Vad beskriver bäst din upplevelse?</p>
          <div className="survey-predefined-buttons">
            {visibleAnswers.map((answer) => (
              <button
                key={answer.text}
                type="button"
                disabled={submitting}
                className={`survey-predefined-btn ${predefinedAnswer === answer.text ? 'survey-predefined-btn--selected' : ''}`}
                onClick={() => {
                  if (submitting) return;     // Sprint A.7
                  bumpStep2Activity();        // Sprint A.7: kunden interagerar — ge mer tid
                  const chosen = predefinedAnswer === answer.text ? '' : answer.text;
                  setPredefinedAnswer(chosen);
                  // Auto-submit direkt om varken fritext eller uppföljningsfält visas
                  if (!freeTextEnabled && !showFollowUp && chosen !== '') {
                    submit(score, '', chosen);
                  }
                }}
              >{answer.text}</button>
            ))}
          </div>
        </div>
      )}

      {score !== null && freeTextEnabled && (
        <label className="survey-label">
          Kommentar (valfritt)
          <textarea
            className="survey-textarea"
            value={comment}
            onChange={(e) => {
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
        <div className="survey-followup">
          <div className="survey-followup-icon">✉</div>
          <p className="survey-followup-text">
            Väldigt tråkigt att höra – vill du att vi kontaktar dig och följer upp ärendet?
          </p>
          <input
            type="email"
            className="survey-followup-input"
            placeholder="Din e-postadress (valfritt)"
            value={followUpEmail}
            onChange={(e) => {
              setFollowUpEmail(e.target.value);
              bumpStep2Activity(); // Sprint A.7: skriver — ge mer tid
            }}
            disabled={submitting}
          />
        </div>
      )}

      {score !== null && needsSubmitButton && (
        <button
          className="survey-btn"
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

      {/* Sprint A.7: liten countdown-text för predefined-only-fallet då ingen
          Skicka-knapp visas. Visas bara om vi väntar på interaktion. */}
      {score !== null && !needsSubmitButton && hasPredefinedVisible && !submitting && step2Countdown > 0 && (
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
    </form>
  );
}

export default SurveyPage;
