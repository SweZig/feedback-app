import { categorize } from '../utils/npsCalculations';
import './ScoreSelector.css';

function ScoreSelector({ value, onChange, colorMode }) {
  const neutral = colorMode === 'neutral';

  return (
    <div className="score-selector">
      <div className="score-scale-wrapper">
        <div className="score-labels">
          <span>Inte alls troligt</span>
          <span>Mycket troligt</span>
        </div>
        <div className="score-buttons">
          {Array.from({ length: 11 }, (_, i) => {
            const category = categorize(i);
            const btnClass = neutral
              ? `score-btn score-btn--neutral ${value === i ? 'score-btn--selected' : ''}`
              : `score-btn score-btn--${category} ${value === i ? 'score-btn--selected' : ''}`;
            return (
              <button
                key={i}
                type="button"
                className={btnClass}
                onClick={() => onChange(i)}
              >
                {i}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default ScoreSelector;
