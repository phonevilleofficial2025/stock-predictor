export const STATUS = { HEALTHY: 'Healthy', MODERATE: 'Moderate', CRITICAL: 'Critical' };

export function healthyThreshold(isFlagship) {
  return isFlagship ? 4 : 8;
}

export function classifyStatus(score, isFlagship) {
  if (isFlagship) {
    return score >= 4 ? STATUS.HEALTHY : STATUS.CRITICAL;
  }
  if (score > 8) return STATUS.HEALTHY;
  if (score <= 4) return STATUS.CRITICAL;
  return STATUS.MODERATE;
}

// avg2wk: average sell-out qty over the last 2 weeks for a device.
// onHand: current combined on-hand stock for the device.
// totalCpfr: total CPFR already committed for the device (0 for the base/no-CPFR view).
export function computeScore({ onHand, avg2wk, totalCpfr = 0 }) {
  const estimatedSellout = avg2wk * 2;
  const estimatedOnHand = onHand + totalCpfr - estimatedSellout;
  const score = avg2wk === 0 ? null : estimatedOnHand / avg2wk;
  return { estimatedSellout, estimatedOnHand, score };
}

export function computeDevicePrediction({ onHand, week1Qty, week2Qty, totalCpfr = 0, isFlagship = false }) {
  const avg2wk = ((Number(week1Qty) || 0) + (Number(week2Qty) || 0)) / 2;

  const base = computeScore({ onHand, avg2wk, totalCpfr: 0 });
  const withCpfr = computeScore({ onHand, avg2wk, totalCpfr });

  const status = base.score === null ? null : classifyStatus(base.score, isFlagship);
  const statusWithCpfr = withCpfr.score === null ? null : classifyStatus(withCpfr.score, isFlagship);

  return {
    avg2wk,
    estimatedSellout: base.estimatedSellout,
    estimatedOnHand: base.estimatedOnHand,
    score: base.score,
    status,
    estimatedOnHandWithCpfr: withCpfr.estimatedOnHand,
    scoreWithCpfr: withCpfr.score,
    statusWithCpfr,
    suggestion: computeSuggestion({ onHand, avg2wk, existingCpfr: totalCpfr, isFlagship }),
  };
}

// Smallest additional CPFR quantity (on top of existingCpfr) needed to reach the Healthy threshold.
export function computeSuggestion({ onHand, avg2wk, existingCpfr = 0, isFlagship = false }) {
  if (!avg2wk || avg2wk <= 0) return 0;
  const threshold = healthyThreshold(isFlagship);
  const estimatedSellout = avg2wk * 2;
  const rawNeeded = threshold * avg2wk + estimatedSellout - onHand - existingCpfr;
  let suggestion = Math.max(0, Math.ceil(rawNeeded));

  // Non-flagship Healthy requires score > threshold strictly; nudge up if the rounded
  // suggestion only reaches the boundary exactly.
  if (!isFlagship) {
    const resultingScore = (onHand + existingCpfr + suggestion - estimatedSellout) / avg2wk;
    if (resultingScore <= threshold) suggestion += 1;
  }
  return suggestion;
}

// Splits a device-level suggested order quantity across variants, proportional to each
// variant's share of the device's total recent sell-out. Falls back to an even split
// when there's no sell-out history to weight by.
export function splitSuggestionByVariant(deviceSuggestion, variants) {
  const totalVariantAvg = variants.reduce((sum, v) => sum + (v.avg2wk || 0), 0);
  if (totalVariantAvg <= 0) {
    const even = variants.length ? deviceSuggestion / variants.length : 0;
    return variants.map((v) => ({ ...v, suggestedQty: Math.round(even) }));
  }
  return variants.map((v) => ({
    ...v,
    suggestedQty: Math.round(deviceSuggestion * ((v.avg2wk || 0) / totalVariantAvg)),
  }));
}
