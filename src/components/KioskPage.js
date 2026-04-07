// src/components/KioskPage.js
//
// Kiosk-läge — visas när appen öppnas med ?tp=<access_token>
// Kräver INGEN inloggning. Identifierar touchpoint via access_token.
// Används av Fully Kiosk Browser på Android-surfplattor i butik.

import { useState, useEffect, useRef } from 'react';
import ScoreSelector from './ScoreSelector';
import { supabase } from '../utils/supabaseClient';
import { TYPE_LABELS, getDefaultConfig } from '../utils/settings';
import './SurveyPage.css';

const MEGAFON_LOGO = process.env.PUBLIC_URL + '/Megafon_bla_512px.png';
const FA_LOGO      = process.env.PUBLIC_URL + '/FA_Original_transparent-01.svg';

const FOLLOW_UP_THRESHOLD = 2;

// ── Hämta touchpoint + kedja-config från Supabase via access_token ──
async function fetchKioskData(accessToken) {
  // 1. Hämta touchpoint
  const { data: tp, error: tpError } = await supabase
    .from('touchpoints')
    .select('*')
    .eq('access_token', accessToken)
    .is('deleted_at', null)
    .single();

  if (tpError || !tp) throw new Error('Touchpoint hittades inte');

  // 2. Hämta kedja (för config)
  const { data: chain, error: chainError } = await supabase
    .from('chains')
    .select('*')
    .eq('id', tp.chain_id)
    .is('deleted_at', null)
    .single();

  if (chainError || !chain) throw new Error('Kedja hittades inte');

  // 3. Hämta avdelning (för badge)
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
async function saveKioskResponse({ touchpointId, chainId, score, comment, selectedAnswer }) {
  const nps_category =
    score <= 6 ? 'detractor' :
    score <= 8 ? 'passive'   : 'promoter';

  const { data: resp, error: respError } = await supabase
    .from('responses')
    .insert({
      touchpoint_id: touchpointId,
      chain_id:      chainId,
      score,
      nps_category,
      session_id:    crypto.randomUUID(),
      responded_at:  new Date().toISOString(),
      metadata:      {},
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

  if (selectedAnswer) {
    // Hitta predefined_answer_id om det är text
    await supabase.from('response_comments').insert({
      response_id: resp.id,
      comment:     `[Svar: ${selectedAnswer}]`,
    }).catch(() => {}); // ignorera fel här — kommentar är nice-to-have
  }

  return resp;
}


export default function KioskPage({ accessToken }) {
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [kioskData, setKioskData] = useState(null); // { tp, chain, dept }

  const [score, setScore]                   = useState(null);
  const [comment, setComment]               = useState('');
  const [predefinedAnswer, setPredefinedAnswer] = useState('');
  const [followUpEmail, setFollowUpEmail]   = useState('');
  const [submitted, setSubmitted]           = useState(false);
  const [countdown, setCountdown]           = useState(6);
  const timerRef = useRef(null);

  // Ladda touchpoint-data vid mount
  useEffect(() => {
    fetchKioskData(accessToken)
      .then(data => { setKioskData(data); setLoading(false); })
      .catch(e  => { setError(e.message); setLoading(false); });
  }, [accessToken]);

  // Nedräkning efter svar
  const config = kioskData
    ? resolveKioskConfig(kioskData.chain, kioskData.tp)
    : getDefaultConfig('physical');

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

  const normalizedAnswers = (predefinedAnswers || []).map(a =>
    typeof a === 'string' ? { text: a, polarity: null } : a
  );

  const visibleAnswers = score === null
    ? normalizedAnswers
    : normalizedAnswers.filter(a => {
        if (a.polarity === 'positive') return showPositiveAnswersForPromoters && score >= 9;
        if (a.polarity === 'negative') return showNegativeAnswersForDetractors && score <= 3;
        const hasAnyPolarity = normalizedAnswers.some(x => x.polarity !== null);
        if (hasAnyPolarity) {
          return (showPositiveAnswersForPromoters && score >= 9) ||
                 (showNegativeAnswersForDetractors && score <= 3);
        }
        return true;
      });

  const showFollowUp = followUpEnabled && score !== null && score <= FOLLOW_UP_THRESHOLD;
  const hasFollowUp  = freeTextEnabled ||
                       (predefinedAnswersEnabled && visibleAnswers.length > 0) ||
                       showFollowUp;

  useEffect(() => {
    if (!submitted) return;
    setCountdown(countdownSeconds);
    timerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          setScore(null);
          setComment('');
          setPredefinedAnswer('');
          setFollowUpEmail('');
          setSubmitted(false);
          return countdownSeconds;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [submitted, countdownSeconds]);

  async function submit(s, c, pa) {
    if (!kioskData) return;
    try {
      await saveKioskResponse({
        touchpointId:   kioskData.tp.id,
        chainId:        kioskData.tp.chain_id,
        score:          s,
        comment:        c || '',
        selectedAnswer: pa || null,
      });
    } catch (e) {
      console.error('[KioskPage] saveResponse:', e);
    }
    setSubmitted(true);
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (score === null) return;
    submit(score, freeTextEnabled ? comment : '', predefinedAnswer);
  }

  // ── Laddning ──
  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#f0f4f7',
        color: '#1e3a4f', fontSize: '1.2rem',
      }}>
        Laddar enkät...
      </div>
    );
  }

  // ── Fel ──
  if (error) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', background: '#f0f4f7',
        color: '#e74c3c', fontSize: '1rem', gap: '1rem',
      }}>
        <p>Kunde inte ladda enkäten.</p>
        <p style={{ color: '#7a9aaa', fontSize: '0.85rem' }}>{error}</p>
      </div>
    );
  }

  const { tp, dept } = kioskData;
  const logo = kioskData.chain.custom_logo || FA_LOGO;

  // ── Tack-vy ──
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

  // ── Badge ──
  function TpBadge() {
    return (
      <div className="survey-dept-badge">
        {tp.type && (
          <span className={`survey-dept-type survey-dept-type--${tp.type}`}>
            {TYPE_LABELS[tp.type]}
          </span>
        )}
        {dept && <span className="survey-dept-name">{dept.name}</span>}
        {dept && tp.name !== dept.name && (
          <>
            <span className="survey-dept-sep">›</span>
            <span className="survey-tp-name">{tp.name}</span>
          </>
        )}
      </div>
    );
  }

  // ── Enkätvy ──
  return (
    <div style={{ minHeight: '100vh', background: '#f0f4f7' }}>
      {/* Logotyp — ingen navigation */}
      <div style={{
        display: 'flex', justifyContent: 'center', padding: '1rem',
        background: '#fff', borderBottom: '1px solid #e0e8f0',
      }}>
        <img
          src={logo}
          alt="Logo"
          style={{ maxHeight: '48px', maxWidth: '200px', objectFit: 'contain' }}
          onError={e => { e.target.src = FA_LOGO; }}
        />
      </div>

      {/* Enkätformulär */}
      <form className="survey-form" onSubmit={handleSubmit}>
        <h2>{npsQuestion}</h2>
        <ScoreSelector
          value={score}
          onChange={val => {
            setScore(val);
            if (val > FOLLOW_UP_THRESHOLD) setFollowUpEmail('');
            const willVisibleAnswers = normalizedAnswers.filter(a => {
              if (a.polarity === 'positive') return showPositiveAnswersForPromoters && val >= 9;
              if (a.polarity === 'negative') return showNegativeAnswersForDetractors && val <= 3;
              const hasAny = normalizedAnswers.some(x => x.polarity !== null);
              if (hasAny) return (showPositiveAnswersForPromoters && val >= 9) || (showNegativeAnswersForDetractors && val <= 3);
              return true;
            });
            const willFollowUp = followUpEnabled && val <= FOLLOW_UP_THRESHOLD;
            const willHaveFollowUp = freeTextEnabled || (predefinedAnswersEnabled && willVisibleAnswers.length > 0) || willFollowUp;
            if (!willHaveFollowUp) submit(val, '', '');
          }}
          colorMode={npsColorMode}
        />

        <div className="survey-meta-row">
          <TpBadge />
          <img src={FA_LOGO} alt="Feedback App" className="survey-fa-logo" />
        </div>

        {score !== null && predefinedAnswersEnabled && visibleAnswers.length > 0 && (
          <div className="survey-predefined">
            <p className="survey-predefined-label">Vad beskriver bäst din upplevelse?</p>
            <div className="survey-predefined-buttons">
              {visibleAnswers.map(answer => (
                <button
                  key={answer.text}
                  type="button"
                  className={`survey-predefined-btn ${predefinedAnswer === answer.text ? 'survey-predefined-btn--selected' : ''}`}
                  onClick={() => setPredefinedAnswer(predefinedAnswer === answer.text ? '' : answer.text)}
                >
                  {answer.text}
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
              onChange={e => setComment(e.target.value)}
              placeholder="Berätta gärna mer..."
              rows={4}
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
              onChange={e => setFollowUpEmail(e.target.value)}
            />
          </div>
        )}

        {score !== null && hasFollowUp && (
          <button className="survey-btn" type="submit">Skicka</button>
        )}
      </form>
    </div>
  );
}
