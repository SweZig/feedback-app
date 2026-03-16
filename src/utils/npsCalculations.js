export function categorize(score) {
  if (score <= 6) return 'detractor';
  if (score <= 8) return 'passive';
  return 'promoter';
}

export function calculateNps(responses) {
  if (responses.length === 0) return null;

  const counts = { detractor: 0, passive: 0, promoter: 0 };
  responses.forEach((r) => {
    counts[categorize(r.score)]++;
  });

  const total = responses.length;
  const nps = Math.round(
    ((counts.promoter - counts.detractor) / total) * 100
  );

  return {
    nps,
    counts,
    total,
    percentages: {
      detractor: Math.round((counts.detractor / total) * 100),
      passive: Math.round((counts.passive / total) * 100),
      promoter: Math.round((counts.promoter / total) * 100),
    },
  };
}
