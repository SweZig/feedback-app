import { categorize } from '../utils/npsCalculations';
import './CommentList.css';

function CommentList({ responses }) {
  const withContent = responses
    .filter((r) => r.comment || r.predefinedAnswer || r.followUpEmail)
    .sort((a, b) => b.timestamp - a.timestamp);

  if (withContent.length === 0) {
    return <p className="comments-empty">Inga kommentarer ännu.</p>;
  }

  return (
    <div className="comments">
      <h3>Kommentarer</h3>
      <ul className="comments-list">
        {withContent.map((r) => (
          <li key={r.id} className="comment-item">
            <div className="comment-header">
              <span className={`comment-badge comment-badge--${categorize(r.score)}`}>
                {r.score}
              </span>
              <span className="comment-date">
                {new Date(r.timestamp).toLocaleDateString('sv-SE')}
              </span>
            </div>
            {r.predefinedAnswer && (
              <span className="comment-predefined">{r.predefinedAnswer}</span>
            )}
            {r.comment && <p className="comment-text">{r.comment}</p>}
            {r.followUpEmail && (
              <div className="comment-followup">
                <span className="comment-followup-icon">✉</span>
                <span className="comment-followup-email">{r.followUpEmail}</span>
                <span className="comment-followup-label">vill bli kontaktad</span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default CommentList;
