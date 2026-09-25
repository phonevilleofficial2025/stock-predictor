import { Router } from 'express';
import { db } from '../db.js';
import { getDeviceMetrics } from '../lib/deviceMetrics.js';
import { computeScore, classifyStatus, computeSuggestion, splitSuggestionByVariant } from '../lib/predictions.js';

const router = Router();

// Batches what used to be 2-4 queries *per device* (CPFR lookup, variant list, per-variant
// sales lookup) into a handful of queries total. With thousands of devices this was the
// dominant cost behind /predictions taking several seconds and blocking the whole server.
function loadCpfrByDevice(week) {
  const map = new Map();
  if (week === null) return map;
  const rows = db.prepare('SELECT device_model AS deviceModel, weekly_cpfr AS weeklyCpfr, actual_do AS actualDo FROM cpfr WHERE week_number = ?').all(week);
  for (const r of rows) map.set(r.deviceModel, r.weeklyCpfr - r.actualDo);
  return map;
}

function loadVariantsByDevice() {
  const map = new Map();
  const rows = db.prepare('SELECT id, sku, variant_name AS variantName, device_model AS deviceModel FROM products').all();
  for (const r of rows) {
    if (!map.has(r.deviceModel)) map.set(r.deviceModel, []);
    map.get(r.deviceModel).push({ id: r.id, sku: r.sku, variantName: r.variantName });
  }
  return map;
}

function loadProductWeekQty(weeks) {
  const map = new Map(); // productId -> { [week]: qty }
  if (weeks.length === 0) return map;
  const placeholders = weeks.map(() => '?').join(',');
  const rows = db.prepare(`SELECT product_id AS productId, week_number AS week, total_qty AS qty FROM sales_weekly WHERE week_number IN (${placeholders})`).all(...weeks);
  for (const r of rows) {
    if (!map.has(r.productId)) map.set(r.productId, {});
    map.get(r.productId)[r.week] = r.qty;
  }
  return map;
}

router.get('/predictions', (req, res) => {
  const { latestWeek, priorWeek, devices } = getDeviceMetrics();
  if (devices.size === 0) return res.json({ latestWeek, priorWeek, predictions: [] });

  const cpfrByDevice = loadCpfrByDevice(latestWeek);
  const variantsByDevice = loadVariantsByDevice();
  const weeks = [latestWeek, priorWeek].filter((w) => w !== null);
  const productWeekQty = loadProductWeekQty(weeks);

  function variantSplitFor(deviceModel, suggestion) {
    const variants = variantsByDevice.get(deviceModel) || [];
    const withAvg = variants.map((v) => {
      const q = (week) => (week === null ? 0 : (productWeekQty.get(v.id)?.[week] || 0));
      return { sku: v.sku, variantName: v.variantName, avg2wk: (q(latestWeek) + q(priorWeek)) / 2 };
    });
    return splitSuggestionByVariant(suggestion, withAvg);
  }

  const predictions = Array.from(devices.values()).map((d) => {
    const totalCpfr = cpfrByDevice.get(d.deviceModel) || 0;
    const estimatedSellout = d.avg2wk * 2;

    const base = computeScore({ onHand: d.onHand, avg2wk: d.avg2wk, totalCpfr: 0 });
    const withCpfr = computeScore({ onHand: d.onHand, avg2wk: d.avg2wk, totalCpfr });
    const status = base.score === null ? null : classifyStatus(base.score, d.isFlagship);
    const statusWithCpfr = withCpfr.score === null ? null : classifyStatus(withCpfr.score, d.isFlagship);
    const suggestion = computeSuggestion({ onHand: d.onHand, avg2wk: d.avg2wk, existingCpfr: totalCpfr, isFlagship: d.isFlagship });

    return {
      deviceModel: d.deviceModel,
      isFlagship: d.isFlagship,
      brand: d.brand,
      onHand: d.onHand,
      avg2wk: d.avg2wk,
      totalCpfr,
      estimatedSellout,
      estimatedOnHand: base.estimatedOnHand,
      score: base.score,
      status,
      estimatedOnHandWithCpfr: withCpfr.estimatedOnHand,
      scoreWithCpfr: withCpfr.score,
      statusWithCpfr,
      suggestion,
      variantSplit: variantSplitFor(d.deviceModel, suggestion),
    };
  });

  res.json({ latestWeek, priorWeek, predictions });
});

export default router;
