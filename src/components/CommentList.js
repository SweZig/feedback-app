import { categorize } from '../utils/npsCalculations';
import './CommentList.css';

function CommentList({ responses }) {
  const withComments = responses
    .filter((r) => r.comment || r.predefinedAnswer)
    .sort((a, b) => b.timestamp - a.timestamp);

  if (withComments.length === 0) {
    return <p className="comments-empty">Inga kommentarer ännu.</p>;
  }

  return (
    <div className="comments">
      <h3>Kommentarer</h3>
      <ul className="comments-list">
        {withComments.map((r) => (
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
          </li>
        ))}
      </ul>
    </div>
  );
}

export default CommentList;
