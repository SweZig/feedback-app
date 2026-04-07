import { useState, useEffect, useRef } from 'react';
import ScoreSelector from './ScoreSelector';
import { saveResponse } from '../utils/storageAdapter';
import { TYPE_LABELS, MODE_LABELS, getEffectiveConfig } from '../utils/settings';
import './SurveyPage.css';

const MEGAFON_LOGO = process.env.PUBLIC_URL + '/Megafon_bla_512px.png';
const FA_LOGO = process.env.PUBLIC_URL + '/FA_Original_transparent-01.svg';

const FOLLOW_UP_THRESHOLD = 2;

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
  const hasFollowUp = freeTextEnabled || (predefinedAnswersEnabled && visibleAnswers.length > 0) || showFollowUp;

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

  async function submit(s, c, pa) {
    await saveResponse({
      id:              crypto.randomUUID(),
      touchpointId:    activeTpId,
      chainId:         activeTp?.chainId || activeCustomer?.id,
      score:           s,
      comment:         c || '',
      selectedAnswers: pa ? [pa] : [],
      sessionId:       crypto.randomUUID(),
      respondedAt:     new Date().toISOString(),
      metadata:        {},
    });
    setSubmitted(true);
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (score === null) return;
    submit(score, freeTextEnabled ? comment : '', predefinedAnswer);
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
      <ScoreSelector
        value={score}
        onChange={(val) => {
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

      <div className="survey-meta-row">
        <TpBadge />
        {activeTp && <img src={FA_LOGO} alt="Feedback App" className="survey-fa-logo" />}
      </div>

      {score !== null && predefinedAnswersEnabled && visibleAnswers.length > 0 && (
        <div className="survey-predefined">
          <p className="survey-predefined-label">Vad beskriver bäst din upplevelse?</p>
          <div className="survey-predefined-buttons">
            {visibleAnswers.map((answer) => (
              <button key={answer.text} type="button"
                className={`survey-predefined-btn ${predefinedAnswer === answer.text ? 'survey-predefined-btn--selected' : ''}`}
                onClick={() => setPredefinedAnswer(predefinedAnswer === answer.text ? '' : answer.text)}
              >{answer.text}</button>
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
