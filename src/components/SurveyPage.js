import { useState, useEffect, useRef } from 'react';
import ScoreSelector from './ScoreSelector';
import { addResponse } from '../utils/storage';
import { TYPE_LABELS, MODE_LABELS, getEffectiveConfig } from '../utils/settings';
import './SurveyPage.css';

const FOLLOW_UP_THRESHOLD = 2; // scores 0, 1, 2 trigger follow-up

function SurveyPage({ activeCustomer }) {
  const [score, setScore] = useState(null);
  const [comment, setComment] = useState('');
  const [predefinedAnswer, setPredefinedAnswer] = useState('');
  const [followUpEmail, setFollowUpEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [countdown, setCountdown] = useState(6);
  const timerRef = useRef(null);

  const activeTpId = activeCustomer?.activeTouchpointId || null;
  const activeTp = (activeCustomer?.touchpoints || []).find((t) => t.id === activeTpId) || null;
  const activeDept = activeTp
    ? (activeCustomer?.departments || []).find((d) => d.id === activeTp.departmentId) || null
    : null;

  const config = getEffectiveConfig(activeCustomer, activeTpId);
  const {
    freeTextEnabled = true,
    predefinedAnswersEnabled = false,
    predefinedAnswers = [],
    npsColorMode = 'colored',
    countdownSeconds = 6,
    followUpEnabled = false,
  } = config;

  const mode = activeTp?.mode || 'app';
  const showFollowUp = followUpEnabled && score !== null && score <= FOLLOW_UP_THRESHOLD;
  const hasFollowUp = freeTextEnabled || (predefinedAnswersEnabled && predefinedAnswers.length > 0) || showFollowUp;

  useEffect(() => {
    if (!submitted) return;
    setCountdown(countdownSeconds);
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          setScore(null); setComment(''); setPredefinedAnswer(''); setFollowUpEmail(''); setSubmitted(false);
          return countdownSeconds;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [submitted, countdownSeconds]);

  function submit(s, c, pa, email) {
    addResponse(s, c, activeCustomer?.id, pa, activeTpId, email);
    setSubmitted(true);
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (score === null) return;
    submit(score, freeTextEnabled ? comment : '', predefinedAnswer, followUpEnabled ? followUpEmail : '');
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
        <h2>Tack för din feedback!</h2>
        <p>Ditt svar har sparats.</p>
        <div className="survey-countdown">{countdown}</div>
      </div>
    );
  }

  return (
    <form className="survey-form" onSubmit={handleSubmit}>
      <TpBadge />
      <h2>Hur troligt är det att du skulle rekommendera oss?</h2>
      <ScoreSelector
        value={score}
        onChange={(val) => {
          setScore(val);
          // Reset follow-up email if score changes to above threshold
          if (val > FOLLOW_UP_THRESHOLD) setFollowUpEmail('');
          const willShowFollowUp = followUpEnabled && val <= FOLLOW_UP_THRESHOLD;
          const willHaveFollowUp = freeTextEnabled || (predefinedAnswersEnabled && predefinedAnswers.length > 0) || willShowFollowUp;
          if (!willHaveFollowUp) {
            addResponse(val, '', activeCustomer?.id, '', activeTpId, '');
            setSubmitted(true);
          }
        }}
        colorMode={npsColorMode}
      />

      {score !== null && predefinedAnswersEnabled && predefinedAnswers.length > 0 && (
        <div className="survey-predefined">
          <p className="survey-predefined-label">Vad beskriver bäst din upplevelse?</p>
          <div className="survey-predefined-buttons">
            {predefinedAnswers.map((answer) => (
              <button key={answer} type="button"
                className={`survey-predefined-btn ${predefinedAnswer === answer ? 'survey-predefined-btn--selected' : ''}`}
                onClick={() => setPredefinedAnswer(predefinedAnswer === answer ? '' : answer)}
              >{answer}</button>
            ))}
          </div>
        </div>
      )}

      {score !== null && freeTextEnabled && (
        <label className="survey-label">
          Kommentar (valfritt)
          <textarea className="survey-textarea" value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Berätta gärna mer..." rows={4} />
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
            onChange={(e) => setFollowUpEmail(e.target.value)}
          />
        </div>
      )}

      {score !== null && hasFollowUp && (
        <button className="survey-btn" type="submit">Skicka</button>
      )}
    </form>
  );
}

export default SurveyPage;
