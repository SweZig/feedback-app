import { useState, useEffect, useRef } from 'react';
import ScoreSelector from './ScoreSelector';
import { addResponse } from '../utils/storage';
import './SurveyPage.css';

function SurveyPage({ activeCustomer }) {
  const [score, setScore] = useState(null);
  const [comment, setComment] = useState('');
  const [predefinedAnswer, setPredefinedAnswer] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [countdown, setCountdown] = useState(6);
  const timerRef = useRef(null);

  const freeTextEnabled = activeCustomer ? activeCustomer.freeTextEnabled : true;
  const colorMode = activeCustomer?.npsColorMode || 'colored';
  const countdownStart = activeCustomer?.countdownSeconds || 6;
  const predefinedEnabled = activeCustomer?.predefinedAnswersEnabled && (activeCustomer?.predefinedAnswers?.length > 0);
  const predefinedAnswers = activeCustomer?.predefinedAnswers || [];

  const hasFollowUp = freeTextEnabled || predefinedEnabled;

  useEffect(() => {
    if (!submitted) return;
    setCountdown(countdownStart);
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          setScore(null);
          setComment('');
          setPredefinedAnswer('');
          setSubmitted(false);
          return countdownStart;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [submitted, countdownStart]);

  function submit(s, c, pa) {
    addResponse(s, c, activeCustomer?.id, pa);
    setSubmitted(true);
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (score === null) return;
    submit(score, freeTextEnabled ? comment : '', predefinedAnswer);
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
      <h2>Hur troligt är det att du skulle rekommendera oss?</h2>
      <ScoreSelector
        value={score}
        onChange={(val) => {
          setScore(val);
          if (!hasFollowUp) {
            addResponse(val, '', activeCustomer?.id, '');
            setSubmitted(true);
          }
        }}
        colorMode={colorMode}
      />
      {score !== null && predefinedEnabled && (
        <div className="survey-predefined">
          <p className="survey-predefined-label">Vad beskriver bäst din upplevelse?</p>
          <div className="survey-predefined-buttons">
            {predefinedAnswers.map((answer) => (
              <button
                key={answer}
                type="button"
                className={`survey-predefined-btn ${predefinedAnswer === answer ? 'survey-predefined-btn--selected' : ''}`}
                onClick={() => setPredefinedAnswer(predefinedAnswer === answer ? '' : answer)}
              >
                {answer}
              </button>
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
            onChange={(e) => setComment(e.target.value)}
            placeholder="Berätta gärna mer..."
            rows={4}
          />
        </label>
      )}
      {score !== null && hasFollowUp && (
        <button className="survey-btn" type="submit">
          Skicka
        </button>
      )}
    </form>
  );
}

export default SurveyPage;
