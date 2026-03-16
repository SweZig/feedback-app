import './DistributionBar.css';

function DistributionBar({ percentages, counts }) {
  const segments = [
    { key: 'detractor', label: 'Kritiker', pct: percentages.detractor, count: counts.detractor },
    { key: 'passive', label: 'Passiva', pct: percentages.passive, count: counts.passive },
    { key: 'promoter', label: 'Ambassadörer', pct: percentages.promoter, count: counts.promoter },
  ];

  return (
    <div className="distribution">
      <div className="distribution-bar">
        {segments.map(
          (seg) =>
            seg.pct > 0 && (
              <div
                key={seg.key}
                className={`distribution-segment distribution-segment--${seg.key}`}
                style={{ width: `${seg.pct}%` }}
              >
                {seg.pct >= 10 && `${seg.pct}%`}
              </div>
            )
        )}
      </div>
      <div className="distribution-legend">
        {segments.map((seg) => (
          <div key={seg.key} className="distribution-legend-item">
            <span className={`distribution-dot distribution-dot--${seg.key}`} />
            <span>
              {seg.label}: {seg.count} ({seg.pct}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default DistributionBar;
