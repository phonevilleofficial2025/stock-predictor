// Mirrors server/src/lib/predictions.js and balance.js so the Simulation sheet can
// recalculate instantly in the browser (no round trip) when a cell is edited. The
// server re-derives the same figures from the saved values, so it stays the source
// of truth — this is purely for the live/optimistic view.

export const STATUS = { HEALTHY: 'Healthy', MODERATE: 'Moderate', CRITICAL: 'Critical' };

export function healthyThreshold(isFlagship) {
  return isFlagship ? 4 : 8;
}

export function classifyStatus(score, isFlagship) {
  if (score === null || score === undefined) return null;
  if (isFlagship) return score >= 4 ? STATUS.HEALTHY : STATUS.CRITICAL;
  if (score > 8) return STATUS.HEALTHY;
  if (score <= 4) return STATUS.CRITICAL;
  return STATUS.MODERATE;
}

export function computeScore({ onHand, avg2wk, totalCpfr = 0 }) {
  const estimatedSellout = avg2wk * 2;
  const estimatedOnHand = onHand + totalCpfr - estimatedSellout;
  const score = avg2wk === 0 ? null : estimatedOnHand / avg2wk;
  return { estimatedSellout, estimatedOnHand, score };
}

// months: [{ month, label, totalCpfr, monthBalance }] in chronological order.
// Returns the same rows with a recomputed cumulative `unserved` field.
export function computeUnservedSeries(months) {
  let running = 0;
  return months.map((row) => {
    running = running + (Number(row.totalCpfr) || 0) - (Number(row.monthBalance) || 0);
    return { ...row, unserved: running };
  });
}
